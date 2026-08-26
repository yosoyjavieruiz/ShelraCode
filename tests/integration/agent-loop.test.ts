import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CheckpointService } from "../../src/checkpoint/checkpoint.js";
import {
  runAgent,
  sanitizeAssistantTextForCompletion,
} from "../../src/agent/loop.js";
import type {
  NormalizedModelRequest,
  ProviderAdapter,
  ProviderEvent,
} from "../../src/providers/types.js";
import type { ModelCandidate } from "../../src/shared/types.js";
import { LocalCodeDatabase } from "../../src/storage/database.js";
import { workspaceTools } from "../../src/tools/workspace.js";
import type { VerificationCommand } from "../../src/agent/verification-plan.js";
import { createLogger, type LogRecord } from "../../src/shared/logging.js";

const candidate: ModelCandidate = {
  id: "local/fake-coder",
  providerId: "local",
  modelId: "fake-coder-wire-id",
  displayName: "Fake Coder (human label)",
  source: "local",
  capabilities: {
    tools: true,
    structuredOutput: true,
    reasoning: false,
    vision: false,
    maxContext: 16_000,
  },
  free: { status: "verified_free" },
  privacy: {
    classification: "local",
    retentionKnown: true,
    trainsOnInputs: false,
  },
  quality: { coding: 0.8, toolUse: 0.8, confidence: "measured" },
  health: { state: "healthy" },
};

class FakeAgentProvider implements ProviderAdapter {
  readonly id = "local";
  readonly displayName = "Fake local";
  lastRequest?: NormalizedModelRequest;
  readonly requests: NormalizedModelRequest[] = [];
  private turn = 0;

  constructor(private readonly includeReasoning = false) {}

  async discoverModels(): Promise<ModelCandidate[]> {
    return [candidate];
  }

  async health(): Promise<{ state: "healthy" }> {
    return { state: "healthy" };
  }

  async quota() {
    return {
      providerId: "local",
      confidence: "unknown" as const,
      observedAt: new Date().toISOString(),
    };
  }

  async *stream(request: NormalizedModelRequest): AsyncIterable<ProviderEvent> {
    this.lastRequest = request;
    this.requests.push(structuredClone(request));
    this.turn += 1;
    if (this.includeReasoning)
      yield {
        type: "reasoning.delta",
        text: "private model reasoning that must never enter the transcript. ".repeat(
          8,
        ),
      };
    if (this.turn === 1) {
      yield {
        type: "tool.call",
        call: {
          id: "read-1",
          name: "ReadFile",
          arguments: JSON.stringify({ path: "src/value.ts" }),
        },
      };
    } else if (this.turn === 2) {
      yield {
        type: "tool.call",
        call: {
          id: "edit-1",
          name: "EditFile",
          arguments: JSON.stringify({
            path: "src/value.ts",
            oldText: "export const value = 1;",
            newText: "export const value = 2;",
          }),
        },
      };
    } else {
      yield {
        type: "text.delta",
        text: "Updated the value and verified the change.",
      };
    }
    yield { type: "done" };
  }

  classifyError(error: unknown) {
    return {
      code: "UNKNOWN" as const,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

describe("agent loop", () => {
  test("completion text replaces tool-shaped JSON with a safe host summary", () => {
    expect(
      sanitizeAssistantTextForCompletion(
        '{"name":"EditFile","arguments":{"path":"src/math.ts"}}',
        "Changes were applied and verified.",
      ),
    ).toBe("Changes were applied and verified.");
    expect(
      sanitizeAssistantTextForCompletion(
        "The requested change is complete.",
        "Changes were applied and verified.",
      ),
    ).toBe("The requested change is complete.");
  });

  test("reads, edits, verifies and returns a provider-independent result", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "localcode-agent-"));
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "src", "value.ts"),
      "export const value = 1;\n",
      "utf8",
    );
    await writeFile(
      path.join(root, "test.ts"),
      "import { expect, test } from 'bun:test'; test('value', async () => expect((await import('./src/value.ts')).value).toBe(2));\n",
      "utf8",
    );
    const db = new LocalCodeDatabase(":memory:");
    const checkpoint = new CheckpointService(db, root);
    const events: string[] = [];
    const logs: LogRecord[] = [];
    const provider = new FakeAgentProvider(true);

    const result = await runAgent(
      {
        id: "task-1",
        objective: "Change value to 2",
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "EDIT",
        context: "src/value.ts contains export const value = 1;",
        successCriteria: ["value is changed to 2"],
        verificationCommand: "bun test ./test.ts",
      },
      {
        provider,
        tools: workspaceTools,
        logger: createLogger({
          level: "debug",
          sink: { write: (record) => logs.push(record) },
        }),
        onEvent: (event) => events.push(event.type),
        verifySuccessCriteria: (_task, ledger) => ({
          pass:
            ledger.filesChanged.includes("src/value.ts") &&
            ledger.verificationRuns.some((run) => run.status === "passed"),
          satisfiedCriterionIds: ["criterion-1"],
        }),
        createExecutionContext: async () => ({
          root,
          permissionMode: "EDIT",
          signal: new AbortController().signal,
          checkpoint,
        }),
      },
    );

    expect(result.verified).toBe(true);
    expect(result.text).toContain("verified");
    expect(provider.requests[0]?.modelId).toBe("fake-coder-wire-id");
    expect(provider.requests[0]?.temperature).toBe(0.2);
    expect(provider.lastRequest?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          function: expect.objectContaining({
            name: "ReadFile",
            parameters: expect.objectContaining({
              type: "object",
              properties: expect.objectContaining({
                path: expect.objectContaining({ type: "string" }),
              }),
              required: expect.arrayContaining(["path"]),
            }),
          }),
        }),
        expect.objectContaining({
          function: expect.objectContaining({
            name: "EditFile",
            parameters: expect.objectContaining({
              properties: expect.objectContaining({
                path: expect.anything(),
                oldText: expect.anything(),
                newText: expect.anything(),
              }),
              required: expect.arrayContaining(["path", "oldText", "newText"]),
            }),
          }),
        }),
      ]),
    );
    expect(result.toolRuns.map((run) => run.tool)).toEqual([
      "ReadFile",
      "EditFile",
    ]);
    expect(provider.requests[1]?.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          toolCalls: [
            expect.objectContaining({ id: "read-1", name: "ReadFile" }),
          ],
        }),
        expect.objectContaining({ role: "tool", toolCallId: "read-1" }),
      ]),
    );
    expect(events).toContain("verification.finished");
    expect(events).toContain("model.progress");
    expect(logs.map((record) => record.event)).toEqual(
      expect.arrayContaining([
        "agent.task.started",
        "agent.turn.started",
        "agent.tool.started",
        "agent.tool.finished",
        "agent.verification.finished",
        "agent.task.completed",
      ]),
    );
    expect(logs.every((record) => record.context?.taskId === "task-1")).toBe(
      true,
    );
    expect(
      await readFile(path.join(root, "src", "value.ts"), "utf8"),
    ).toContain("value = 2");
    db.close();
  });

  test("does not turn a dependency name into a phantom mutation target", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-path-domain-"),
    );
    await writeFile(
      path.join(root, "index.html"),
      "<main>old</main>\n",
      "utf8",
    );
    const db = new LocalCodeDatabase(":memory:");
    const checkpoint = new CheckpointService(db, root);
    let turn = 0;
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Fake local",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" as const };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown" as const,
          observedAt: new Date().toISOString(),
        };
      },
      async *stream(
        _request: NormalizedModelRequest,
      ): AsyncIterable<ProviderEvent> {
        turn += 1;
        if (turn === 1) {
          yield {
            type: "tool.call",
            call: {
              id: "path-read",
              name: "ReadFile",
              arguments: JSON.stringify({ path: "index.html" }),
            },
          };
        } else if (turn === 2) {
          yield {
            type: "tool.call",
            call: {
              id: "path-write",
              name: "WriteFile",
              arguments: JSON.stringify({
                path: "index.html",
                content: "<main>new</main>\n",
              }),
            },
          };
        } else {
          yield { type: "text.delta", text: "Updated index.html." };
        }
        yield { type: "done" };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "path-domain-task",
        objective: "Update the Moment.js dependency in the file index.html.",
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "AUTO",
        context: "index.html contains the target document.",
        mode: "coding",
      },
      {
        provider,
        tools: workspaceTools,
        reviewFinalDiff: () => true,
        createExecutionContext: async () => ({
          root,
          permissionMode: "AUTO",
          signal: new AbortController().signal,
          checkpoint,
        }),
      },
    );

    expect(result.toolRuns.map((run) => run.tool)).toEqual([
      "ReadFile",
      "WriteFile",
    ]);
    expect(result.toolRuns.every((run) => run.ok)).toBe(true);
    expect(await readFile(path.join(root, "index.html"), "utf8")).toBe(
      "<main>new</main>\n",
    );
    db.close();
  });

  test("completes after host verification instead of asking a weak model for another tool", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-host-completion-"),
    );
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "src", "value.ts"),
      "export const value = 1;\n",
      "utf8",
    );
    await writeFile(
      path.join(root, "test.ts"),
      "import { expect, test } from 'bun:test'; test('value', async () => expect((await import('./src/value.ts')).value).toBe(2));\n",
      "utf8",
    );
    const db = new LocalCodeDatabase(":memory:");
    const checkpoint = new CheckpointService(db, root);
    let turns = 0;
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Weak-model completion fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown" as const,
          observedAt: new Date().toISOString(),
        };
      },
      async *stream() {
        turns += 1;
        if (turns === 1) {
          yield {
            type: "tool.call",
            call: {
              id: "read-value",
              name: "ReadFile",
              arguments: JSON.stringify({ path: "src/value.ts" }),
            },
          };
        } else if (turns === 2) {
          yield {
            type: "tool.call",
            call: {
              id: "edit-value",
              name: "EditFile",
              arguments: JSON.stringify({
                path: "src/value.ts",
                oldText: "export const value = 1;",
                newText: "export const value = 2;",
              }),
            },
          };
        } else {
          yield {
            type: "tool.call",
            call: {
              id: "unnecessary-" + turns,
              name: "SearchText",
              arguments: JSON.stringify({
                query: "this call should never execute",
                path: ".",
              }),
            },
          };
        }
        yield { type: "done" };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-host-completion",
        objective: "Change value to 2 and verify it.",
        root,
        candidate,
        repositoryPolicy: "local_only",
        permissionMode: "AUTO",
        mode: "coding",
        successCriteria: ["value is changed to 2", "bun test passes"],
        verificationCommands: [
          { stage: "test", command: "bun test ./test.ts" },
        ],
        maxTurns: 6,
        systemPromptProfile: "coding",
      },
      {
        provider,
        tools: workspaceTools,
        reviewFinalDiff: () => true,
        checkUserWorkPreserved: (checkpointId) =>
          checkpointId ? checkpoint.isPreserved(checkpointId) : true,
        async verifySuccessCriteria(_task, ledger) {
          const changed = ledger.filesChanged.includes("src/value.ts");
          const tested = ledger.verificationRuns.some(
            (run) => run.status === "passed" && run.exitCode === 0,
          );
          return {
            pass: changed && tested,
            satisfiedCriterionIds: [
              ...(changed ? ["criterion-1"] : []),
              ...(tested ? ["criterion-2"] : []),
            ],
            issues: [
              ...(!changed ? ["The value was not changed."] : []),
              ...(!tested ? ["The test did not pass."] : []),
            ],
          };
        },
        async createExecutionContext() {
          return {
            root,
            permissionMode: "AUTO" as const,
            signal: new AbortController().signal,
            checkpoint,
          };
        },
      },
    );

    expect(result.status).toBe("completed");
    expect(result.verified).toBe(true);
    expect(turns).toBe(2);
    expect(result.toolRuns.map((run) => run.tool)).toEqual([
      "ReadFile",
      "EditFile",
    ]);
    expect(result.text).toContain("verified by host");
    expect(result.ledger.plan?.steps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "step-verify", status: "done" }),
      ]),
    );
    db.close();
  });

  test("feeds missing success criteria back before asking a weak model for another turn", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-criteria-feedback-"),
    );
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "src", "value.ts"),
      "export const value = 1;\n",
      "utf8",
    );
    await writeFile(
      path.join(root, "test.ts"),
      "import { expect, test } from 'bun:test'; test('value', async () => expect((await import('./src/value.ts')).value).toBe(2));\n",
      "utf8",
    );
    const db = new LocalCodeDatabase(":memory:");
    const checkpoint = new CheckpointService(db, root);
    const requests: NormalizedModelRequest[] = [];
    let turns = 0;
    let wrongReadAttempted = false;
    let wrongPathAttempted = false;
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Criteria-feedback fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown" as const,
          observedAt: new Date().toISOString(),
        };
      },
      async *stream(request) {
        requests.push(structuredClone(request));
        turns += 1;
        const hasMissingCriteriaFeedback = request.messages.some(
          (message) =>
            message.role === "user" &&
            message.content.includes("Host criteria") &&
            message.content.includes("Next relevant files") &&
            message.content.includes("src/marker.ts"),
        );
        if (turns === 1) {
          yield {
            type: "tool.call",
            call: {
              id: "edit-value",
              name: "EditFile",
              arguments: JSON.stringify({
                path: "src/value.ts",
                oldText: "export const value = 1;",
                newText: "export const value = 2;",
              }),
            },
          };
        } else if (hasMissingCriteriaFeedback && !wrongReadAttempted) {
          wrongReadAttempted = true;
          yield {
            type: "tool.call",
            call: {
              id: "read-wrong-target",
              name: "ReadFile",
              arguments: JSON.stringify({ path: "src/value.ts" }),
            },
          };
        } else if (hasMissingCriteriaFeedback && !wrongPathAttempted) {
          wrongPathAttempted = true;
          yield {
            type: "tool.call",
            call: {
              id: "write-wrong-target",
              name: "WriteFile",
              arguments: JSON.stringify({
                path: "src/value.ts",
                content: "export const value = 99;\n",
              }),
            },
          };
        } else if (hasMissingCriteriaFeedback) {
          yield {
            type: "tool.call",
            call: {
              id: "write-marker",
              name: "WriteFile",
              arguments: JSON.stringify({
                path: "src/marker.ts",
                content: "export const marker = true;\n",
              }),
            },
          };
        } else {
          yield { type: "text.delta", text: "I need another instruction." };
        }
        yield { type: "done" };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-criteria-feedback",
        objective: "Change value and create the marker file.",
        root,
        candidate,
        repositoryPolicy: "local_only",
        permissionMode: "AUTO",
        mode: "coding",
        context:
          "Fixture evidence: value.ts and marker.ts are the requested files.",
        contextEvidenceState: "SUFFICIENT",
        successCriteria: [
          "value is changed to 2",
          "src/marker.ts exists",
          "bun test passes",
        ],
        verificationCommands: [
          { stage: "test", command: "bun test ./test.ts" },
        ],
        maxTurns: 5,
        systemPromptProfile: "coding",
      },
      {
        provider,
        tools: workspaceTools,
        reviewFinalDiff: () => true,
        checkUserWorkPreserved: (checkpointId) =>
          checkpointId ? checkpoint.isPreserved(checkpointId) : true,
        async verifySuccessCriteria(_task, ledger) {
          const changed = ledger.filesChanged.includes("src/value.ts");
          const marker = ledger.filesChanged.includes("src/marker.ts");
          const tested = ledger.verificationRuns.some(
            (run) => run.status === "passed" && run.exitCode === 0,
          );
          return {
            pass: changed && marker && tested,
            satisfiedCriterionIds: [
              ...(changed ? ["criterion-1"] : []),
              ...(marker ? ["criterion-2"] : []),
              ...(tested ? ["criterion-3"] : []),
            ],
            issues: [
              ...(!changed ? ["The value was not changed."] : []),
              ...(!marker ? ["The marker file is missing."] : []),
              ...(!tested ? ["The test did not pass."] : []),
            ],
          };
        },
        async createExecutionContext() {
          return {
            root,
            permissionMode: "AUTO" as const,
            signal: new AbortController().signal,
            checkpoint,
          };
        },
      },
    );

    expect(result.status).toBe("completed");
    expect(result.verified).toBe(true);
    expect(turns).toBe(4);
    expect(result.toolRuns.map((run) => run.tool)).toEqual([
      "EditFile",
      "ReadFile",
      "WriteFile",
      "WriteFile",
    ]);
    expect(result.toolRuns[1]?.code).toBe("CONFLICT");
    expect(result.toolRuns[2]?.code).toBe("CONFLICT");
    expect(
      requests[1]?.messages.some(
        (message) =>
          message.role === "user" &&
          message.content.includes("Next relevant files") &&
          message.content.includes("src/marker.ts") &&
          message.content.includes(
            "Already satisfied criteria are protected",
          ) &&
          message.content.includes("value is changed to 2"),
      ),
    ).toBe(true);
    expect(
      await readFile(path.join(root, "src", "value.ts"), "utf8"),
    ).toContain("value = 2");
    db.close();
  });

  test("blocks a first write outside the files named by the coding objective", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-initial-scope-"),
    );
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "src", "value.ts"),
      "export const value = 1;\n",
      "utf8",
    );
    const db = new LocalCodeDatabase(":memory:");
    const checkpoint = new CheckpointService(db, root);
    let turns = 0;
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Initial-scope fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown" as const,
          observedAt: new Date().toISOString(),
        };
      },
      async *stream() {
        turns += 1;
        if (turns === 1) {
          yield {
            type: "tool.call",
            call: {
              id: "write-unrelated",
              name: "WriteFile",
              arguments: JSON.stringify({
                path: "notes.ts",
                content: "export const unrelated = true;\n",
              }),
            },
          };
        } else if (turns === 2) {
          yield {
            type: "tool.call",
            call: {
              id: "edit-value",
              name: "EditFile",
              arguments: JSON.stringify({
                path: "src/value.ts",
                oldText: "export const value = 1;",
                newText: "export const value = 2;",
              }),
            },
          };
        } else {
          yield { type: "text.delta", text: "The requested file is updated." };
        }
        yield { type: "done" };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-initial-scope",
        objective: "Update src/value.ts from 1 to 2.",
        root,
        candidate,
        repositoryPolicy: "local_only",
        permissionMode: "AUTO",
        mode: "coding",
        context:
          "Fixture evidence: value.ts is the requested implementation file.",
        contextEvidenceState: "SUFFICIENT",
        successCriteria: ["src/value.ts is updated"],
        maxTurns: 5,
        systemPromptProfile: "coding",
      },
      {
        provider,
        tools: workspaceTools,
        reviewFinalDiff: () => true,
        checkUserWorkPreserved: (checkpointId) =>
          checkpointId ? checkpoint.isPreserved(checkpointId) : true,
        async verifySuccessCriteria(_task, ledger) {
          const changed = ledger.filesChanged.includes("src/value.ts");
          return {
            pass: changed,
            satisfiedCriterionIds: changed ? ["criterion-1"] : [],
            issues: changed ? [] : ["src/value.ts is still unchanged."],
          };
        },
        async createExecutionContext() {
          return {
            root,
            permissionMode: "AUTO" as const,
            signal: new AbortController().signal,
            checkpoint,
          };
        },
      },
    );

    expect(result.status).toBe("completed");
    expect(result.toolRuns[0]?.code).toBe("CONFLICT");
    expect(result.ledger.filesChanged).toEqual(["src/value.ts"]);
    expect(await readFile(path.join(root, "notes.ts")).catch(() => "")).toBe(
      "",
    );
    db.close();
  });

  test("rolls back a mutation that regresses an already satisfied criterion", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-regression-rollback-"),
    );
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "src", "value.ts"),
      "export const value = 1;\n",
      "utf8",
    );
    await writeFile(
      path.join(root, "test.ts"),
      "import { expect, test } from 'bun:test'; test('value', async () => expect((await import('./src/value.ts')).value).toBe(2));\n",
      "utf8",
    );
    const db = new LocalCodeDatabase(":memory:");
    const checkpoint = new CheckpointService(db, root);
    let turns = 0;
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Regression rollback fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown" as const,
          observedAt: new Date().toISOString(),
        };
      },
      async *stream() {
        turns += 1;
        if (turns === 1) {
          yield {
            type: "tool.call",
            call: {
              id: "edit-value-first",
              name: "EditFile",
              arguments: JSON.stringify({
                path: "src/value.ts",
                oldText: "export const value = 1;",
                newText: "export const value = 2;",
              }),
            },
          };
        } else if (turns === 2) {
          yield {
            type: "tool.call",
            call: {
              id: "read-value-before-regression",
              name: "ReadFile",
              arguments: JSON.stringify({ path: "src/value.ts" }),
            },
          };
        } else if (turns === 3) {
          yield {
            type: "tool.call",
            call: {
              id: "edit-value-regression",
              name: "EditFile",
              arguments: JSON.stringify({
                path: "src/value.ts",
                oldText: "export const value = 2;",
                newText: "export const value = 3;",
              }),
            },
          };
        } else {
          yield {
            type: "tool.call",
            call: {
              id: "write-marker",
              name: "WriteFile",
              arguments: JSON.stringify({
                path: "src/marker.ts",
                content: "export const marker = true;\n",
              }),
            },
          };
        }
        yield { type: "done" };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-regression-rollback",
        objective:
          "Change the value in src/value.ts to 2 and create src/marker.ts.",
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "AUTO",
        mode: "coding",
        context:
          "Fixture evidence: src/value.ts and src/marker.ts are in scope.",
        contextEvidenceState: "SUFFICIENT",
        successCriteria: [
          "value is 2",
          "src/marker.ts exists",
          "bun test passes",
        ],
        verificationCommands: [
          { stage: "test", command: "bun test ./test.ts" },
        ],
        maxTurns: 5,
      },
      {
        provider,
        tools: workspaceTools,
        reviewFinalDiff: () => true,
        checkUserWorkPreserved: (checkpointId) =>
          checkpointId ? checkpoint.isPreserved(checkpointId) : true,
        async verifySuccessCriteria(_task, ledger) {
          const value = await readFile(
            path.join(root, "src", "value.ts"),
            "utf8",
          );
          let marker = false;
          try {
            await readFile(path.join(root, "src", "marker.ts"), "utf8");
            marker = true;
          } catch {
            marker = false;
          }
          const valueOk = value.includes("value = 2");
          const tested = ledger.verificationRuns.some(
            (run) => run.status === "passed" && run.exitCode === 0,
          );
          return {
            pass: valueOk && marker && tested,
            satisfiedCriterionIds: [
              ...(valueOk ? ["criterion-1"] : []),
              ...(marker ? ["criterion-2"] : []),
              ...(tested ? ["criterion-3"] : []),
            ],
            issues: [
              ...(!valueOk ? ["value is not 2."] : []),
              ...(!marker ? ["src/marker.ts is missing."] : []),
              ...(!tested ? ["bun test has not passed."] : []),
            ],
          };
        },
        async createExecutionContext() {
          return {
            root,
            permissionMode: "AUTO" as const,
            signal: new AbortController().signal,
            checkpoint,
          };
        },
      },
    );

    expect(result.status).toBe("completed");
    expect(result.verified).toBe(true);
    expect(turns).toBe(4);
    expect(result.toolRuns.map((run) => run.tool)).toEqual([
      "EditFile",
      "ReadFile",
      "EditFile",
      "WriteFile",
    ]);
    expect(result.ledger.verificationRuns.map((run) => run.status)).toEqual([
      "passed",
      "failed",
      "passed",
    ]);
    expect(
      await readFile(path.join(root, "src", "value.ts"), "utf8"),
    ).toContain("value = 2");
    expect(
      await readFile(path.join(root, "src", "marker.ts"), "utf8"),
    ).toContain("marker = true");
    db.close();
  });

  test("explicit criteria are not auto-satisfied by one mutation and green verification", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-criteria-gate-"),
    );
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "src", "value.ts"),
      "export const value = 1;\n",
      "utf8",
    );
    await writeFile(
      path.join(root, "test.ts"),
      "import { expect, test } from 'bun:test'; test('value', async () => expect((await import('./src/value.ts')).value).toBe(2));\n",
      "utf8",
    );
    const db = new LocalCodeDatabase(":memory:");
    const checkpoint = new CheckpointService(db, root);
    const result = await runAgent(
      {
        id: "task-explicit-criteria-gate",
        objective: "Change value to 2 and complete the second requirement.",
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "EDIT",
        maxTurns: 8,
        successCriteria: [
          "value is changed to 2",
          "the second requirement is complete",
        ],
        verificationCommand: "bun test ./test.ts",
      },
      {
        provider: new FakeAgentProvider(),
        tools: workspaceTools,
        verifySuccessCriteria: () => ({
          pass: false,
          satisfiedCriterionIds: ["criterion-1"],
          issues: ["The second requirement is still incomplete."],
        }),
        createExecutionContext: async () => ({
          root,
          permissionMode: "EDIT" as const,
          signal: new AbortController().signal,
          checkpoint,
        }),
      },
    );

    expect(result.status).toBe("blocked");
    expect(result.verified).toBe(false);
    expect(result.completion.reasons).toContain(
      "success criteria are not satisfied",
    );
    expect(result.turns).toBeLessThan(8);
    expect(
      result.ledger.actions.filter(
        (action) =>
          action.target === "model-turn" && action.status === "failed",
      ),
    ).toHaveLength(2);
    expect(result.ledger.successCriteria[0]?.satisfied).toBe(true);
    expect(result.ledger.successCriteria[1]?.satisfied).toBe(false);
    db.close();
  });

  test("runs every host verification stage and records each result", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-verification-plan-"),
    );
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "src", "value.ts"),
      "export const value = 1;\n",
      "utf8",
    );
    await writeFile(
      path.join(root, "test.ts"),
      "import { expect, test } from 'bun:test'; test('value', async () => expect((await import('./src/value.ts')).value).toBe(2));\n",
      "utf8",
    );
    const db = new LocalCodeDatabase(":memory:");
    const checkpoint = new CheckpointService(db, root);
    const provider = new FakeAgentProvider();
    const verificationCommands: VerificationCommand[] = [
      { stage: "test", command: "bun test ./test.ts" },
      { stage: "typecheck", command: "bun --version" },
      { stage: "build", command: "bun --version" },
    ];

    const result = await runAgent(
      {
        id: "task-verification-plan",
        objective: "Change value to 2",
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "EDIT",
        context: "src/value.ts contains export const value = 1;",
        verificationCommands,
        maxTurns: 6,
      },
      {
        provider,
        tools: workspaceTools,
        createExecutionContext: async () => ({
          root,
          permissionMode: "EDIT",
          signal: new AbortController().signal,
          checkpoint,
        }),
      },
    );

    expect(result.verified).toBe(true);
    expect(result.ledger.verificationPlan).toEqual(verificationCommands);
    expect(result.ledger.verificationRuns).toHaveLength(3);
    expect(result.ledger.verificationRuns.map((run) => run.stage)).toEqual([
      "test",
      "typecheck",
      "build",
    ]);
    expect(
      result.ledger.verificationRuns.every((run) => run.status === "passed"),
    ).toBe(true);
    db.close();
  });

  test("a failed verification stage blocks completion and a later edit reruns the full plan", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-verification-retry-"),
    );
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "src", "value.ts"),
      "export const value = 2;\n",
      "utf8",
    );
    await writeFile(
      path.join(root, "test.ts"),
      "import { expect, test } from 'bun:test'; test('value', async () => expect((await import('./src/value.ts')).value).toBe(2));\n",
      "utf8",
    );
    await writeFile(
      path.join(root, "verify-stage.ts"),
      "import { existsSync, writeFileSync } from 'node:fs';\n" +
        "if (!existsSync('.verification-marker')) { writeFileSync('.verification-marker', 'done'); process.exit(1); }\n",
      "utf8",
    );
    const db = new LocalCodeDatabase(":memory:");
    const checkpoint = new CheckpointService(db, root);
    let turn = 0;
    const requests: NormalizedModelRequest[] = [];
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Verification retry fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" as const };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown" as const,
          observedAt: new Date().toISOString(),
        };
      },
      async *stream() {
        turn += 1;
        if (turn === 1) {
          yield {
            type: "tool.call" as const,
            call: {
              id: "read-value",
              name: "ReadFile",
              arguments: JSON.stringify({ path: "src/value.ts" }),
            },
          };
        } else if (turn === 2) {
          yield {
            type: "tool.call" as const,
            call: {
              id: "edit-value",
              name: "EditFile",
              arguments: JSON.stringify({
                path: "src/value.ts",
                oldText: "export const value = 2;",
                newText: "export const value = 2;\n// first attempt",
              }),
            },
          };
        } else if (turn === 3) {
          yield {
            type: "text.delta" as const,
            text: "The first verification attempt needs more work.",
          };
        } else if (turn === 4) {
          yield {
            type: "tool.call" as const,
            call: {
              id: "write-note",
              name: "WriteFile",
              arguments: JSON.stringify({
                path: "src/verification-note.ts",
                content: "export const verified = true;\n",
              }),
            },
          };
        } else {
          yield {
            type: "text.delta" as const,
            text: "The implementation is verified.",
          };
        }
        yield { type: "done" as const };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-verification-retry",
        objective: "Verify the implementation",
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "EDIT",
        context: "src/value.ts contains the implementation.",
        verificationCommands: [
          { stage: "test", command: "bun test ./test.ts" },
          { stage: "typecheck", command: "bun verify-stage.ts" },
          { stage: "build", command: "bun --version" },
        ],
        maxTurns: 8,
      },
      {
        provider,
        tools: workspaceTools,
        createExecutionContext: async () => ({
          root,
          permissionMode: "EDIT",
          signal: new AbortController().signal,
          checkpoint,
        }),
      },
    );

    expect(result.status).toBe("completed");
    expect(result.verified).toBe(true);
    expect(result.ledger.verificationRuns.map((run) => run.stage)).toEqual([
      "test",
      "typecheck",
      "test",
      "typecheck",
      "build",
    ]);
    expect(result.ledger.verificationRuns[1]?.status).toBe("failed");
    expect(result.ledger.verificationRuns.at(-1)?.status).toBe("passed");
    db.close();
  });

  test("recovers a complete textual tool envelope before it reaches assistant output", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-tool-recovery-"),
    );
    await writeFile(
      path.join(root, "package.json"),
      '{"name":"fixture"}\n',
      "utf8",
    );
    let turn = 0;
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Textual tool fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown",
          observedAt: new Date().toISOString(),
        };
      },
      async *stream() {
        turn += 1;
        if (turn === 1) {
          yield { type: "text.delta", text: '{\n  "name": "ReadFile",\n' };
          yield {
            type: "text.delta",
            text: '  "arguments": { "path": "package.json" }\n}',
          };
        } else {
          yield {
            type: "text.delta",
            text: "The package entry confirms this is the LocalCode application.",
          };
        }
        yield { type: "done" };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN",
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };
    const assistantDeltas: string[] = [];
    const result = await runAgent(
      {
        id: "task-recovery",
        objective: "Open the main package file",
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "PLAN",
        maxTurns: 3,
      },
      {
        provider,
        tools: workspaceTools,
        onEvent(event) {
          if (event.type === "assistant.delta")
            assistantDeltas.push(event.text);
        },
        async createExecutionContext() {
          return {
            root,
            permissionMode: "PLAN",
            signal: new AbortController().signal,
          };
        },
      },
    );

    expect(result.toolRuns.map((item) => item.tool)).toEqual(["ReadFile"]);
    expect(result.text).toContain("package entry");
    expect(assistantDeltas.join("")).not.toContain('"name": "ReadFile"');
  });

  test("recovers a tool envelope after streamed prose without exposing JSON", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "localcode-mixed-tool-"));
    await writeFile(
      path.join(root, "package.json"),
      '{"name":"fixture"}\n',
      "utf8",
    );
    let turn = 0;
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Mixed prose tool fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown",
          observedAt: new Date().toISOString(),
        };
      },
      async *stream() {
        turn += 1;
        if (turn === 1) {
          yield { type: "text.delta", text: "I will inspect first.\n" };
          yield {
            type: "text.delta",
            text: '{"name":"ReadFile","arguments":{"path":"package.json"}}',
          };
        } else {
          yield { type: "text.delta", text: "The package entry is confirmed." };
        }
        yield { type: "done" };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN",
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };
    const assistantDeltas: string[] = [];
    const result = await runAgent(
      {
        id: "task-mixed-tool",
        objective: "Inspect package.json",
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "PLAN",
        maxTurns: 3,
      },
      {
        provider,
        tools: workspaceTools,
        onEvent(event) {
          if (event.type === "assistant.delta")
            assistantDeltas.push(event.text);
        },
        async createExecutionContext() {
          return {
            root,
            permissionMode: "PLAN",
            signal: new AbortController().signal,
          };
        },
      },
    );

    expect(result.toolRuns.map((item) => item.tool)).toEqual(["ReadFile"]);
    expect(assistantDeltas.join("")).toContain("I will inspect first.");
    expect(assistantDeltas.join("")).not.toContain('"name":"ReadFile"');
    expect(
      result.messages.map((message) => message.content).join(""),
    ).not.toContain('"name":"ReadFile"');
  });

  test("retries a repeated textual tool call with tools disabled and preserves the prior observation", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-textual-repeat-"),
    );
    await writeFile(path.join(root, "demo.txt"), "hello probe\n", "utf8");
    const envelope =
      "```json\n" +
      JSON.stringify(
        { name: "ReadFile", arguments: { path: "demo.txt" } },
        null,
        2,
      ) +
      "\n```";
    let turn = 0;
    const requests: NormalizedModelRequest[] = [];
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Textual repeat fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown" as const,
          observedAt: new Date().toISOString(),
        };
      },
      async *stream(request) {
        requests.push(structuredClone(request));
        turn += 1;
        if (turn <= 2) yield { type: "text.delta", text: envelope };
        else
          yield {
            type: "text.delta",
            text: "demo.txt contains hello probe.",
          };
        yield { type: "done" };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-textual-repeat",
        objective: "Read demo.txt and report its contents",
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "PLAN",
        mode: "workspace_question",
        maxTurns: 5,
      },
      {
        provider,
        tools: workspaceTools,
        async createExecutionContext() {
          return {
            root,
            permissionMode: "PLAN",
            signal: new AbortController().signal,
          };
        },
      },
    );

    expect(result.status).toBe("completed");
    expect(result.toolRuns.map((run) => run.tool)).toEqual([
      "ReadFile",
      "ReadFile",
    ]);
    expect(result.toolRuns[0]?.ok).toBe(true);
    expect(result.toolRuns[1]?.ok).toBe(false);
    expect(result.toolRuns[1]?.code).toBe("CONFLICT");
    expect(result.text).toContain("hello probe");
    expect(requests[0]?.toolChoice).toBe("auto");
    expect(requests[1]?.toolChoice).toBe("auto");
    expect(requests[2]?.toolChoice).toBe("none");
  });

  test("recovers the LM Studio <tools> wrapper without leaking its JSON", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-lmstudio-tools-"),
    );
    await writeFile(path.join(root, "demo.txt"), "hello lm studio\n", "utf8");
    const envelope =
      '<tools>\n{"name":"ReadFile","arguments":{"path":"demo.txt"}}\n</tools>';
    let turn = 0;
    const assistantDeltas: string[] = [];
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "LM Studio envelope fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown" as const,
          observedAt: new Date().toISOString(),
        };
      },
      async *stream() {
        turn += 1;
        if (turn === 1) {
          yield { type: "text.delta", text: envelope.slice(0, 12) };
          yield { type: "text.delta", text: envelope.slice(12) };
        } else {
          yield {
            type: "text.delta",
            text: "The file contains hello lm studio.",
          };
        }
        yield { type: "done" };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-lmstudio-envelope",
        objective: "Read demo.txt",
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "PLAN",
        mode: "workspace_question",
        maxTurns: 3,
      },
      {
        provider,
        tools: workspaceTools,
        onEvent(event) {
          if (event.type === "assistant.delta")
            assistantDeltas.push(event.text);
        },
        async createExecutionContext() {
          return {
            root,
            permissionMode: "PLAN",
            signal: new AbortController().signal,
          };
        },
      },
    );

    expect(result.toolRuns.map((run) => run.tool)).toEqual(["ReadFile"]);
    expect(result.text).toContain("hello lm studio");
    expect(assistantDeltas.join("")).not.toContain("<tools>");
    expect(assistantDeltas.join("")).not.toContain('"name":"ReadFile"');
  });

  test("recovers the LM Studio <response> wrapper without leaking its JSON", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-lmstudio-response-"),
    );
    await writeFile(path.join(root, "demo.txt"), "hello response\n", "utf8");
    const envelope =
      '<response>\n{"name":"ReadFile","arguments":{"path":"demo.txt"}}\n</response>';
    let turn = 0;
    const assistantDeltas: string[] = [];
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "LM Studio response envelope fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown" as const,
          observedAt: new Date().toISOString(),
        };
      },
      async *stream() {
        turn += 1;
        if (turn === 1) {
          yield { type: "text.delta", text: envelope.slice(0, 12) };
          yield { type: "text.delta", text: envelope.slice(12) };
        } else {
          yield {
            type: "text.delta",
            text: "The file contains hello response.",
          };
        }
        yield { type: "done" };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-lmstudio-response-envelope",
        objective: "Read demo.txt",
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "PLAN",
        mode: "workspace_question",
        maxTurns: 3,
      },
      {
        provider,
        tools: workspaceTools,
        onEvent(event) {
          if (event.type === "assistant.delta")
            assistantDeltas.push(event.text);
        },
        async createExecutionContext() {
          return {
            root,
            permissionMode: "PLAN",
            signal: new AbortController().signal,
          };
        },
      },
    );

    expect(result.toolRuns.map((run) => run.tool)).toEqual(["ReadFile"]);
    expect(result.text).toContain("hello response");
    expect(assistantDeltas.join("")).not.toContain("<response>");
    expect(assistantDeltas.join("")).not.toContain('"name":"ReadFile"');
  });

  test("recovers a validated LM Studio tool_response EditFile wrapper", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-lmstudio-tool-response-"),
    );
    await writeFile(path.join(root, "demo.txt"), "hello response\n", "utf8");
    const database = new LocalCodeDatabase(":memory:");
    const checkpoint = new CheckpointService(database, root);
    const envelope =
      "<tool_response>\n" +
      '{"tool":"EditFile","ok":true,"output":{"path":"demo.txt","oldText":"hello response","newText":"hello edited","replaceAll":false}}' +
      "\n</tool_response>";
    let turn = 0;
    const assistantDeltas: string[] = [];
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "LM Studio tool response fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown" as const,
          observedAt: new Date().toISOString(),
        };
      },
      async *stream() {
        turn += 1;
        if (turn === 1) {
          yield { type: "text.delta", text: envelope.slice(0, 8) };
          yield { type: "text.delta", text: envelope.slice(8) };
        } else {
          yield { type: "text.delta", text: "The file was edited." };
        }
        yield { type: "done" };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-lmstudio-tool-response-envelope",
        objective: "Edit demo.txt",
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "AUTO",
        mode: "coding",
        context:
          "Fixture evidence: demo.txt is the requested implementation file.",
        contextEvidenceState: "SUFFICIENT",
        maxTurns: 3,
      },
      {
        provider,
        tools: workspaceTools,
        onEvent(event) {
          if (event.type === "assistant.delta")
            assistantDeltas.push(event.text);
        },
        async createExecutionContext() {
          return {
            root,
            permissionMode: "AUTO" as const,
            signal: new AbortController().signal,
            checkpoint,
          };
        },
      },
    );

    expect(result.toolRuns.map((run) => run.tool)).toEqual(["EditFile"]);
    expect(await readFile(path.join(root, "demo.txt"), "utf8")).toContain(
      "hello edited",
    );
    expect(result.text).toContain("file was edited");
    expect(assistantDeltas.join("")).not.toContain("<tool_response>");
    expect(assistantDeltas.join("")).not.toContain('"tool":"EditFile"');
    database.close();
  });

  test("unknown and invalid tool calls still emit ordered structured failures", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-tool-errors-"),
    );
    let turn = 0;
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Tool failure fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown",
          observedAt: new Date().toISOString(),
        };
      },
      async *stream() {
        turn += 1;
        if (turn === 1) {
          yield {
            type: "tool.call",
            call: {
              id: "unknown-1",
              name: "ReadWorkspaceSecret",
              arguments: '{"path":"credentials.txt"}',
            },
          };
          yield {
            type: "tool.call",
            call: {
              id: "invalid-1",
              name: "ReadFile",
              arguments: '{"path":42}',
            },
          };
          yield {
            type: "tool.call",
            call: {
              id: "malformed-1",
              name: "ReadFile",
              arguments: "{",
            },
          };
        } else {
          yield {
            type: "text.delta",
            text: "I could not run those unsupported actions.",
          };
        }
        yield { type: "done" };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN",
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };
    const events: Array<{ type: string; callId?: string }> = [];
    const result = await runAgent(
      {
        id: "task-tool-errors",
        objective: "Inspect the repository",
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "PLAN",
        maxTurns: 3,
      },
      {
        provider,
        tools: workspaceTools,
        onEvent(event) {
          events.push({
            type: event.type,
            ...(event.type === "tool.started" || event.type === "tool.finished"
              ? { callId: event.callId }
              : {}),
          });
        },
        async createExecutionContext() {
          return {
            root,
            permissionMode: "PLAN",
            signal: new AbortController().signal,
          };
        },
      },
    );

    expect(events.filter((event) => event.type.startsWith("tool."))).toEqual([
      { type: "tool.started", callId: "unknown-1" },
      { type: "tool.finished", callId: "unknown-1" },
      { type: "tool.started", callId: "invalid-1" },
      { type: "tool.finished", callId: "invalid-1" },
      { type: "tool.started", callId: "malformed-1" },
      { type: "tool.finished", callId: "malformed-1" },
    ]);
    expect(result.toolRuns).toEqual([
      expect.objectContaining({
        tool: "ReadWorkspaceSecret",
        ok: false,
        code: "PERMISSION_DENIED",
      }),
      expect.objectContaining({
        tool: "ReadFile",
        ok: false,
        code: "INVALID_ARGUMENT",
      }),
      expect.objectContaining({
        tool: "ReadFile",
        ok: false,
        code: "INVALID_ARGUMENT",
        recoverable: true,
        suggestedAction: expect.any(String),
      }),
    ]);
  });

  test("does not resend malformed tool JSON to a local provider", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-malformed-continuation-"),
    );
    const requests: NormalizedModelRequest[] = [];
    let turn = 0;
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Strict local protocol fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown",
          observedAt: new Date().toISOString(),
        };
      },
      async *stream(request) {
        requests.push(structuredClone(request));
        turn += 1;
        if (turn === 1) {
          yield {
            type: "tool.call",
            call: {
              id: "malformed-edit",
              name: "EditFile",
              arguments: '{"path":"fixture.ts"',
            },
          };
        } else {
          const assistant = requests.at(-1)?.messages.at(-2);
          const continuation = assistant?.toolCalls?.[0]?.arguments;
          if (continuation !== "{}")
            throw new Error(
              "provider rejected malformed assistant tool arguments",
            );
          yield {
            type: "text.delta",
            text: "The malformed edit was rejected safely.",
          };
        }
        yield { type: "done" };
      },
      classifyError(error: unknown) {
        return {
          code: "CAPACITY" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-malformed-continuation",
        objective: "Inspect the repository without changing files.",
        root,
        candidate,
        repositoryPolicy: "local_only",
        permissionMode: "PLAN",
        mode: "review",
        maxTurns: 3,
      },
      {
        provider,
        tools: workspaceTools,
        async createExecutionContext() {
          return {
            root,
            permissionMode: "PLAN" as const,
            signal: new AbortController().signal,
          };
        },
      },
    );

    expect(result.status).not.toBe("failed");
    expect(result.toolRuns).toEqual([
      expect.objectContaining({
        tool: "EditFile",
        code: "INVALID_ARGUMENT",
        recoverable: true,
      }),
    ]);
    expect(requests[1]?.messages.at(-2)?.toolCalls?.[0]?.arguments).toBe("{}");
  });

  test("rejects unknown tool fields before a permissive validator can execute", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-tool-schema-"),
    );
    let turn = 0;
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Schema boundary fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown" as const,
          observedAt: new Date().toISOString(),
        };
      },
      async *stream() {
        turn += 1;
        if (turn === 1)
          yield {
            type: "tool.call",
            call: {
              id: "bad-status",
              name: "GitStatus",
              arguments: JSON.stringify({ type: "object" }),
            },
          };
        else
          yield { type: "text.delta", text: "The call was rejected safely." };
        yield { type: "done" };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-schema-boundary",
        objective: "Inspect the repository status.",
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "PLAN",
        mode: "workspace_question",
        maxTurns: 3,
      },
      {
        provider,
        tools: workspaceTools,
        async createExecutionContext() {
          return {
            root,
            permissionMode: "PLAN",
            signal: new AbortController().signal,
          };
        },
      },
    );

    expect(result.toolRuns[0]).toEqual(
      expect.objectContaining({
        tool: "GitStatus",
        ok: false,
        code: "INVALID_ARGUMENT",
        recoverable: true,
        suggestedAction: expect.stringContaining("declared"),
      }),
    );
  });

  test("toolChoice 'none' refuses a tool call even if a misbehaving model attempts one", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "localcode-no-tools-"));
    await writeFile(path.join(root, "secret.txt"), "do not touch\n", "utf8");
    const requests: NormalizedModelRequest[] = [];
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Adversarial greeting fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown",
          observedAt: new Date().toISOString(),
        };
      },
      async *stream(request) {
        requests.push(structuredClone(request));
        yield {
          type: "tool.call",
          call: {
            id: "edit-1",
            name: "EditFile",
            arguments: JSON.stringify({
              path: "secret.txt",
              oldText: "do not touch",
              newText: "touched",
            }),
          },
        };
        yield { type: "done" };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN",
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-greeting",
        objective: "Hola",
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "PLAN",
        maxTurns: 3,
      },
      {
        provider,
        tools: workspaceTools,
        toolChoice: "none",
        async createExecutionContext() {
          return {
            root,
            permissionMode: "PLAN",
            signal: new AbortController().signal,
          };
        },
      },
    );

    expect(result.toolRuns).toEqual([]);
    expect(requests[0]?.toolChoice).toBe("none");
    expect(await readFile(path.join(root, "secret.txt"), "utf8")).toBe(
      "do not touch\n",
    );
  });

  test("redacts secret-shaped tool output before remote provider continuation", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-remote-redact-"),
    );
    await writeFile(
      path.join(root, "config.ts"),
      'export const API_KEY = "sk-super-secret-value-123456789";\n',
      "utf8",
    );
    const requests: NormalizedModelRequest[] = [];
    let turn = 0;
    const provider: ProviderAdapter = {
      id: "groq",
      displayName: "Fake free remote",
      async discoverModels() {
        return [];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "groq",
          confidence: "unknown" as const,
          observedAt: new Date().toISOString(),
        };
      },
      async *stream(request) {
        requests.push(structuredClone(request));
        turn += 1;
        if (turn === 1)
          yield {
            type: "tool.call",
            call: {
              id: "read-secret-shaped",
              name: "ReadFile",
              arguments: JSON.stringify({ path: "config.ts" }),
            },
          };
        else yield { type: "text.delta", text: "The file was inspected." };
        yield { type: "done" };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };
    const remoteCandidate: ModelCandidate = {
      ...candidate,
      id: "groq/free-coder",
      providerId: "groq",
      source: "free_cloud",
      privacy: {
        classification: "zdr_capable",
        retentionKnown: true,
        trainsOnInputs: false,
        zdrAvailable: true,
      },
    };

    await runAgent(
      {
        id: "task-remote-redaction",
        objective: "Read config.ts and summarize it.",
        root,
        candidate: remoteCandidate,
        repositoryPolicy: "public_free",
        permissionMode: "PLAN",
        mode: "workspace_question",
        maxTurns: 3,
      },
      {
        provider,
        tools: workspaceTools,
        async createExecutionContext() {
          return {
            root,
            permissionMode: "PLAN" as const,
            signal: new AbortController().signal,
          };
        },
      },
    );

    const continuation = requests[1];
    const toolMessage = continuation?.messages.find(
      (message) => message.role === "tool",
    );
    expect(JSON.stringify(toolMessage)).not.toContain(
      "sk-super-secret-value-123456789",
    );
    expect(JSON.stringify(toolMessage)).toContain(
      "REDACTED SENSITIVE TOOL OUTPUT",
    );
  });

  test("a minimal system-prompt profile drops the repository-inspection nudge", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "localcode-minimal-"));
    const requests: NormalizedModelRequest[] = [];
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Greeting fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown",
          observedAt: new Date().toISOString(),
        };
      },
      async *stream(request) {
        requests.push(structuredClone(request));
        yield { type: "text.delta", text: "¡Hola! ¿En qué te ayudo?" };
        yield { type: "done" };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN",
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-greeting-minimal",
        objective: "Hola",
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "PLAN",
        maxTurns: 3,
        systemPromptProfile: "minimal",
      },
      {
        provider,
        tools: [],
        toolChoice: "none",
        async createExecutionContext() {
          return {
            root,
            permissionMode: "PLAN",
            signal: new AbortController().signal,
          };
        },
      },
    );

    expect(result.toolRuns).toEqual([]);
    const systemMessage = requests[0]?.messages.find(
      (m) => m.role === "system",
    );
    const userMessage = requests[0]?.messages.find((m) => m.role === "user");
    expect(systemMessage?.content).not.toContain("Inspect the workspace");
    expect(systemMessage?.content).not.toContain("verify mutations");
    expect(userMessage?.content).not.toContain(
      "Inspect the workspace before editing",
    );
    expect(result.text).toContain("En qué te ayudo");
  });

  test("recovers from the reported ListFiles-on-a-file failure without giving up", async () => {
    // Reproduces the exact reported failure: the model calls ListFiles on a
    // skill *file* path (which used to throw a raw ENOTDIR). The controller
    // must force the exact path that produced PATH_IS_FILE before accepting a
    // different repository question. The invalid-maxChars contract is covered
    // independently in tests/unit/tool-error-recovery.test.ts.
    const root = await mkdtemp(path.join(os.tmpdir(), "localcode-recover-"));
    await mkdir(
      path.join(root, ".agents", "skills", "localcode-agent-harness"),
      {
        recursive: true,
      },
    );
    await writeFile(
      path.join(
        root,
        ".agents",
        "skills",
        "localcode-agent-harness",
        "SKILL.md",
      ),
      "# harness\n",
      "utf8",
    );
    await writeFile(root + "/package.json", '{"name":"localcode"}\n', "utf8");
    let turn = 0;
    const toolResultsSeen: unknown[] = [];
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Self-correcting fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown",
          observedAt: new Date().toISOString(),
        };
      },
      async *stream(request) {
        turn += 1;
        const lastToolMessage = [...request.messages]
          .reverse()
          .find((message) => message.role === "tool");
        if (lastToolMessage) toolResultsSeen.push(lastToolMessage.content);
        if (turn === 1) {
          // Wrong tool for a file path — mirrors the reported bug exactly.
          yield {
            type: "tool.call",
            call: {
              id: "list-1",
              name: "ListFiles",
              arguments: JSON.stringify({
                path: ".agents/skills/localcode-agent-harness/SKILL.md",
              }),
            },
          };
        } else if (turn === 2) {
          // Recovery is exact-path scoped; a model cannot use the error as an
          // excuse to jump to an unrelated file.
          yield {
            type: "tool.call",
            call: {
              id: "read-1",
              name: "ReadFile",
              arguments: JSON.stringify({
                path: ".agents/skills/localcode-agent-harness/SKILL.md",
              }),
            },
          };
        } else {
          yield {
            type: "text.delta",
            text: "The skill file was read after PATH_IS_FILE recovery.",
          };
        }
        yield { type: "done" };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN",
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-recover",
        objective: "What language is this project using?",
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "PLAN",
        maxTurns: 5,
        systemPromptProfile: "workspace",
      },
      {
        provider,
        tools: workspaceTools,
        async createExecutionContext() {
          return {
            root,
            permissionMode: "PLAN",
            signal: new AbortController().signal,
          };
        },
      },
    );

    expect(
      result.toolRuns.map((run) => ({ tool: run.tool, ok: run.ok })),
    ).toEqual([
      { tool: "ListFiles", ok: false },
      { tool: "ReadFile", ok: true },
    ]);
    expect(result.toolRuns[0]?.code).toBe("PATH_IS_FILE");
    expect(String(toolResultsSeen[0])).toContain("PATH_IS_FILE");
    expect(String(toolResultsSeen[0])).not.toContain("ENOTDIR");
    // The run must not "declare Done" without ever having answered from
    // real evidence — the final text has to reflect the recovered read.
    expect(result.text).toContain("skill file");
  });

  test("retries a coding turn after a prose-only no-action response", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "localcode-no-action-"));
    await writeFile(
      path.join(root, "value.ts"),
      "export const value = 1;\n",
      "utf8",
    );
    const db = new LocalCodeDatabase(":memory:");
    const checkpoint = new CheckpointService(db, root);
    let turn = 0;
    const requests: NormalizedModelRequest[] = [];
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Prose-first coding fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown" as const,
          observedAt: new Date().toISOString(),
        };
      },
      async *stream(request) {
        requests.push(structuredClone(request));
        turn += 1;
        if (turn === 1) {
          yield {
            type: "tool.call",
            call: {
              id: "read-before-prose",
              name: "ReadFile",
              arguments: JSON.stringify({ path: "value.ts" }),
            },
          };
        } else if (turn === 2) {
          yield {
            type: "text.delta",
            text: "I will inspect the file and then apply the requested change.",
          };
        } else if (turn === 3) {
          yield {
            type: "tool.call",
            call: {
              id: "edit-after-prose",
              name: "EditFile",
              arguments: JSON.stringify({
                path: "value.ts",
                oldText: "export const value = 1;",
                newText: "export const value = 2;",
              }),
            },
          };
        } else {
          yield {
            type: "text.delta",
            text: "Updated value.ts after the host accepted the edit.",
          };
        }
        yield { type: "done" };
        void request;
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-no-action-retry",
        objective: "Change value.ts from 1 to 2.",
        root,
        candidate,
        repositoryPolicy: "local_only",
        permissionMode: "AUTO",
        mode: "coding",
        context:
          "Fixture evidence: value.ts is the requested implementation file.",
        contextEvidenceState: "SUFFICIENT",
        maxTurns: 5,
        systemPromptProfile: "coding",
      },
      {
        provider,
        tools: workspaceTools,
        checkUserWorkPreserved: (checkpointId) =>
          checkpointId ? checkpoint.isPreserved(checkpointId) : true,
        reviewFinalDiff: () => true,
        async createExecutionContext() {
          return {
            root,
            permissionMode: "AUTO" as const,
            signal: new AbortController().signal,
            checkpoint,
          };
        },
      },
    );

    expect(result.status).toBe("completed");
    expect(result.ledger.filesChanged).toEqual(["value.ts"]);
    expect(result.toolRuns.map((run) => run.tool)).toEqual([
      "ReadFile",
      "EditFile",
    ]);
    expect(turn).toBe(4);
    expect(
      requests[2]?.messages.some(
        (message) =>
          message.role === "assistant" &&
          message.content.includes("I will inspect the file"),
      ),
    ).toBe(false);
    expect(requests[2]?.messages.at(-1)?.content).toContain(
      "implementation workspace tool",
    );
    expect(requests[2]?.messages.at(-1)?.content).toContain("EditFile");
    expect(
      result.messages.some(
        (message) =>
          message.role === "user" &&
          message.content.includes("implementation workspace tool"),
      ),
    ).toBe(true);
    expect(await readFile(path.join(root, "value.ts"), "utf8")).toContain(
      "value = 2",
    );
    db.close();
  });

  test("requires a fresh read after a rejected edit before retrying", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-fresh-read-after-edit-"),
    );
    await writeFile(
      path.join(root, "value.ts"),
      "export const value = 1;\n",
      "utf8",
    );
    const db = new LocalCodeDatabase(":memory:");
    const checkpoint = new CheckpointService(db, root);
    let turn = 0;
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Fresh-read edit fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown" as const,
          observedAt: new Date().toISOString(),
        };
      },
      async *stream() {
        turn += 1;
        if (turn === 1 || turn === 4) {
          yield {
            type: "tool.call",
            call: {
              id: `read-${turn}`,
              name: "ReadFile",
              arguments: JSON.stringify({ path: "value.ts" }),
            },
          };
        } else if (turn === 2 || turn === 3) {
          yield {
            type: "tool.call",
            call: {
              id: `stale-edit-${turn}`,
              name: "EditFile",
              arguments: JSON.stringify({
                path: "value.ts",
                oldText: "export const value = 999;",
                newText: "export const value = 2;",
              }),
            },
          };
        } else if (turn === 5) {
          yield {
            type: "tool.call",
            call: {
              id: "valid-edit",
              name: "EditFile",
              arguments: JSON.stringify({
                path: "value.ts",
                oldText: "export const value = 1;",
                newText: "export const value = 2;",
              }),
            },
          };
        } else {
          yield {
            type: "text.delta",
            text: "The fresh observation was applied.",
          };
        }
        yield { type: "done" };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-fresh-read-after-edit",
        objective: "Change value.ts from 1 to 2.",
        root,
        candidate,
        repositoryPolicy: "local_only",
        permissionMode: "AUTO",
        mode: "coding",
        context:
          "Fixture evidence: value.ts is the requested implementation file.",
        contextEvidenceState: "SUFFICIENT",
        maxTurns: 7,
        systemPromptProfile: "coding",
      },
      {
        provider,
        tools: workspaceTools,
        reviewFinalDiff: () => true,
        async createExecutionContext() {
          return {
            root,
            permissionMode: "AUTO" as const,
            signal: new AbortController().signal,
            checkpoint,
          };
        },
      },
    );

    expect(result.status).toBe("completed");
    expect(result.toolRuns.map((run) => run.tool)).toEqual([
      "ReadFile",
      "EditFile",
      "EditFile",
      "ReadFile",
      "EditFile",
    ]);
    expect(result.toolRuns[1]?.ok).toBe(false);
    expect(result.toolRuns[1]?.code).toBe("NOT_FOUND");
    expect(result.toolRuns[2]?.ok).toBe(false);
    expect(result.toolRuns[2]?.code).toBe("CONFLICT");
    expect(await readFile(path.join(root, "value.ts"), "utf8")).toContain(
      "value = 2",
    );
    db.close();
  });

  test("forces a fresh read after an ambiguous staged edit instead of repeating it", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-ambiguous-edit-recovery-"),
    );
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "src", "value.ts"),
      "export const value = 1;\n",
      "utf8",
    );
    await writeFile(
      path.join(root, "src", "other.ts"),
      "export const other = true;\n",
      "utf8",
    );
    const db = new LocalCodeDatabase(":memory:");
    const checkpoint = new CheckpointService(db, root);
    let turn = 0;
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Ambiguous-edit recovery fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown" as const,
          observedAt: new Date().toISOString(),
        };
      },
      async *stream() {
        turn += 1;
        if (turn === 1) {
          yield {
            type: "tool.call" as const,
            call: {
              id: `read-${turn}`,
              name: "ReadFile",
              arguments: JSON.stringify({ path: "src/value.ts" }),
            },
          };
        } else if (turn === 2) {
          // The real local model produced this shape: an EditFile request with
          // no oldText. The host must not execute it or let it repeat.
          yield {
            type: "tool.call" as const,
            call: {
              id: "ambiguous-edit",
              name: "EditFile",
              arguments: JSON.stringify({
                path: "src/value.ts",
                oldText: "",
                newText: "export const value = 2;\n",
              }),
            },
          };
        } else if (turn === 3) {
          // Recovery authorizes an exact path. A model choosing the other
          // staged file must be rejected before that read executes.
          yield {
            type: "tool.call" as const,
            call: {
              id: "wrong-recovery-read",
              name: "ReadFile",
              arguments: JSON.stringify({ path: "src/other.ts" }),
            },
          };
        } else if (turn === 4) {
          yield {
            type: "tool.call" as const,
            call: {
              id: "correct-recovery-read",
              name: "ReadFile",
              arguments: JSON.stringify({ path: "src/value.ts" }),
            },
          };
        } else if (turn === 5) {
          yield {
            type: "tool.call" as const,
            call: {
              id: "valid-edit-after-read",
              name: "EditFile",
              arguments: JSON.stringify({
                path: "src/value.ts",
                oldText: "export const value = 1;",
                newText: "export const value = 2;",
              }),
            },
          };
        } else {
          yield { type: "text.delta" as const, text: "The edit is complete." };
        }
        yield { type: "done" as const };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-ambiguous-edit-recovery",
        objective: "Update src/value.ts and src/other.ts.",
        root,
        candidate,
        repositoryPolicy: "local_only",
        permissionMode: "AUTO",
        mode: "coding",
        stagedPaths: ["src/value.ts", "src/other.ts"],
        context: "The host localized src/value.ts as the current target.",
        contextEvidenceState: "SUFFICIENT",
        successCriteria: ["src/value.ts is updated"],
        maxTurns: 7,
        systemPromptProfile: "coding",
      },
      {
        provider,
        tools: workspaceTools,
        reviewFinalDiff: () => true,
        verifySuccessCriteria: (_task, ledger) => ({
          pass: ledger.filesChanged.includes("src/value.ts"),
          satisfiedCriterionIds: ["criterion-1"],
        }),
        async createExecutionContext() {
          return {
            root,
            permissionMode: "AUTO" as const,
            signal: new AbortController().signal,
            checkpoint,
          };
        },
      },
    );

    expect(result.status).toBe("completed");
    expect(result.toolRuns.map((run) => run.tool)).toEqual([
      "ReadFile",
      "EditFile",
      "ReadFile",
      "ReadFile",
      "EditFile",
    ]);
    expect(result.toolRuns[1]).toMatchObject({
      ok: false,
      code: "CONFLICT",
    });
    expect(result.toolRuns[2]).toMatchObject({
      ok: false,
      code: "CONFLICT",
      path: "src/other.ts",
    });
    expect(await readFile(path.join(root, "src", "value.ts"), "utf8")).toBe(
      "export const value = 2;\n",
    );
    db.close();
  });

  test("a non-progress watchdog stops a loop that repeats the identical tool call", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "localcode-watchdog-"));
    await writeFile(path.join(root, "a.ts"), "export const a = 1;\n", "utf8");
    let calls = 0;
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Stuck-loop fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown",
          observedAt: new Date().toISOString(),
        };
      },
      async *stream() {
        calls += 1;
        yield {
          type: "tool.call",
          call: {
            id: `read-${calls}`,
            name: "ReadFile",
            arguments: JSON.stringify({ path: "a.ts" }),
          },
        };
        yield { type: "done" };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN",
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-stuck",
        objective: "Read the same file forever",
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "PLAN",
        maxTurns: 20,
      },
      {
        provider,
        tools: workspaceTools,
        async createExecutionContext() {
          return {
            root,
            permissionMode: "PLAN",
            signal: new AbortController().signal,
          };
        },
      },
    );
    expect(result.status).toBe("blocked");
    expect(result.completion.reasons).toContain("unresolved blockers remain");
    // Stopped well before maxTurns (20) — the watchdog, not the turn cap.
    expect(calls).toBeLessThan(6);
  });

  test("recovers a coding model from a repeated read inside a staged work unit", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-read-recovery-"),
    );
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "src", "value.ts"),
      "export const value = 1;\n",
      "utf8",
    );
    const db = new LocalCodeDatabase(":memory:");
    const checkpoint = new CheckpointService(db, root);
    let calls = 0;
    const requests: NormalizedModelRequest[] = [];
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Staged read-recovery fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown" as const,
          observedAt: new Date().toISOString(),
        };
      },
      async *stream(request) {
        requests.push(structuredClone(request));
        calls += 1;
        if (calls <= 3) {
          const range = calls;
          yield {
            type: "tool.call",
            call: {
              id: `read-${calls}`,
              name: "ReadFile",
              // A stuck local model often changes only the requested range;
              // the controller must still recognize this as the same
              // non-progressing file observation.
              arguments: JSON.stringify({
                path: "src/value.ts",
                startLine: range,
                endLine: range,
              }),
            },
          };
        } else if (calls === 4) {
          yield {
            type: "tool.call",
            call: {
              id: "edit-value",
              name: "EditFile",
              arguments: JSON.stringify({
                path: "src/value.ts",
                oldText: "export const value = 1;",
                newText: "export const value = 2;",
              }),
            },
          };
        } else {
          yield { type: "text.delta", text: "The staged change is complete." };
        }
        yield { type: "done" };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-staged-read-recovery",
        objective:
          "Update src/value.ts and src/other.ts, then verify the final diff.",
        root,
        candidate,
        repositoryPolicy: "local_only",
        permissionMode: "AUTO",
        mode: "coding",
        stagedPaths: ["src/value.ts", "src/other.ts"],
        context:
          "The host localized src/value.ts as the current implementation target.",
        contextEvidenceState: "SUFFICIENT",
        successCriteria: ["src/value.ts is updated"],
        maxTurns: 8,
        systemPromptProfile: "coding",
      },
      {
        provider,
        tools: workspaceTools,
        toolChoice: "required",
        reviewFinalDiff: () => true,
        async verifySuccessCriteria(_task, ledger) {
          const changed = ledger.filesChanged.includes("src/value.ts");
          return {
            pass: changed,
            satisfiedCriterionIds: changed ? ["criterion-1"] : [],
            issues: changed ? [] : ["src/value.ts is still unchanged."],
          };
        },
        async createExecutionContext() {
          return {
            root,
            permissionMode: "AUTO" as const,
            signal: new AbortController().signal,
            checkpoint,
          };
        },
      },
    );

    expect(result.status).toBe("completed");
    expect(result.verified).toBe(true);
    expect(calls).toBe(5);
    expect(result.toolRuns.map((run) => run.tool)).toEqual([
      "ReadFile",
      "ReadFile",
      "ReadFile",
      "EditFile",
    ]);
    expect(requests[0]?.messages[0]?.content).toContain(
      "current work unit is src/value.ts",
    );
    const narrowedTools = JSON.stringify(requests[1]?.tools ?? []);
    expect(narrowedTools).not.toContain('"name":"ReadFile"');
    expect(narrowedTools).not.toContain('"name":"SearchText"');
    expect(narrowedTools).not.toContain('"name":"ListFiles"');
    expect(narrowedTools).not.toContain('"name":"GlobFiles"');
    expect(narrowedTools).not.toContain('"name":"CreateFile"');
    expect(narrowedTools).toContain('"name":"EditFile"');
    expect(requests[3]?.messages.at(-1)?.content).toContain(
      "Do not call ReadFile on the same path again",
    );
    expect(
      await readFile(path.join(root, "src", "value.ts"), "utf8"),
    ).toContain("value = 2");
    db.close();
  });

  test("rejects a hidden tool call outside the staged execution schema", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-staged-tool-boundary-"),
    );
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "src", "value.ts"),
      "export const value = 1;\n",
      "utf8",
    );
    const db = new LocalCodeDatabase(":memory:");
    const checkpoint = new CheckpointService(db, root);
    const requests: NormalizedModelRequest[] = [];
    let turn = 0;
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Hidden-tool boundary fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown" as const,
          observedAt: new Date().toISOString(),
        };
      },
      async *stream(request) {
        requests.push(structuredClone(request));
        turn += 1;
        if (turn === 1) {
          yield {
            type: "tool.call" as const,
            call: {
              id: "read-value",
              name: "ReadFile",
              arguments: JSON.stringify({ path: "src/value.ts" }),
            },
          };
        } else if (turn === 2) {
          // Shell is intentionally emitted even though the current staged
          // schema contains only bounded mutation tools.
          yield {
            type: "tool.call" as const,
            call: {
              id: "hidden-shell",
              name: "Shell",
              arguments: JSON.stringify({ command: "echo must-not-run" }),
            },
          };
        } else if (turn === 3) {
          yield {
            type: "tool.call" as const,
            call: {
              id: "edit-value",
              name: "EditFile",
              arguments: JSON.stringify({
                path: "src/value.ts",
                oldText: "export const value = 1;",
                newText: "export const value = 2;",
              }),
            },
          };
        } else {
          yield {
            type: "text.delta" as const,
            text: "The bounded change is complete.",
          };
        }
        yield { type: "done" as const };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-staged-tool-boundary",
        objective: "Update src/value.ts and src/other.ts.",
        root,
        candidate,
        repositoryPolicy: "local_only",
        permissionMode: "AUTO",
        mode: "coding",
        stagedPaths: ["src/value.ts", "src/other.ts"],
        context: "The host localized src/value.ts as the current target.",
        contextEvidenceState: "SUFFICIENT",
        successCriteria: ["src/value.ts is updated"],
        maxTurns: 6,
      },
      {
        provider,
        tools: workspaceTools,
        reviewFinalDiff: () => true,
        async verifySuccessCriteria(_task, ledger) {
          const changed = ledger.filesChanged.includes("src/value.ts");
          return {
            pass: changed,
            satisfiedCriterionIds: changed ? ["criterion-1"] : [],
            issues: changed ? [] : ["src/value.ts is still unchanged."],
          };
        },
        async createExecutionContext() {
          return {
            root,
            permissionMode: "AUTO" as const,
            signal: new AbortController().signal,
            checkpoint,
          };
        },
      },
    );

    expect(result.status).toBe("completed");
    expect(result.toolRuns.map((run) => run.tool)).toEqual([
      "ReadFile",
      "Shell",
      "EditFile",
    ]);
    expect(result.toolRuns[1]).toMatchObject({
      ok: false,
      code: "PERMISSION_DENIED",
    });
    expect(JSON.stringify(requests[1]?.tools ?? [])).not.toContain(
      '"name":"Shell"',
    );
    expect(JSON.stringify(requests[1]?.tools ?? [])).not.toContain(
      '"name":"WriteFile"',
    );
    expect(
      await readFile(path.join(root, "src", "value.ts"), "utf8"),
    ).toContain("value = 2");
    db.close();
  });

  test("staged mutation waits for a prior read bundled in the same response", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-staged-observation-boundary-"),
    );
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "src", "value.ts"),
      "export const value = 1;\n",
      "utf8",
    );
    const db = new LocalCodeDatabase(":memory:");
    const checkpoint = new CheckpointService(db, root);
    let turn = 0;
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Staged observation boundary fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown" as const,
          observedAt: new Date().toISOString(),
        };
      },
      async *stream() {
        turn += 1;
        if (turn === 1) {
          yield {
            type: "tool.call" as const,
            call: {
              id: "read-value",
              name: "ReadFile",
              arguments: JSON.stringify({ path: "src/value.ts" }),
            },
          };
          yield {
            type: "tool.call" as const,
            call: {
              id: "premature-edit",
              name: "EditFile",
              arguments: JSON.stringify({
                path: "src/value.ts",
                oldText: "export const value = 1;",
                newText: "export const value = 2;",
              }),
            },
          };
        } else if (turn === 2) {
          yield {
            type: "tool.call" as const,
            call: {
              id: "observed-edit",
              name: "EditFile",
              arguments: JSON.stringify({
                path: "src/value.ts",
                oldText: "export const value = 1;",
                newText: "export const value = 2;",
              }),
            },
          };
        } else {
          yield {
            type: "text.delta" as const,
            text: "The change is complete.",
          };
        }
        yield { type: "done" as const };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-staged-observation-boundary",
        objective: "Update src/value.ts and src/other.ts.",
        root,
        candidate,
        repositoryPolicy: "local_only",
        permissionMode: "AUTO",
        mode: "coding",
        stagedPaths: ["src/value.ts", "src/other.ts"],
        context: "The host localized src/value.ts as the current target.",
        contextEvidenceState: "SUFFICIENT",
        successCriteria: ["src/value.ts is updated"],
        maxTurns: 5,
      },
      {
        provider,
        tools: workspaceTools,
        reviewFinalDiff: () => true,
        async verifySuccessCriteria(_task, ledger) {
          const changed = ledger.filesChanged.includes("src/value.ts");
          return {
            pass: changed,
            satisfiedCriterionIds: changed ? ["criterion-1"] : [],
            issues: changed ? [] : ["src/value.ts is still unchanged."],
          };
        },
        async createExecutionContext() {
          return {
            root,
            permissionMode: "AUTO" as const,
            signal: new AbortController().signal,
            checkpoint,
          };
        },
      },
    );

    expect(result.status).toBe("completed");
    expect(result.toolRuns.map((run) => run.tool)).toEqual([
      "ReadFile",
      "EditFile",
      "EditFile",
    ]);
    expect(result.toolRuns[1]).toMatchObject({
      ok: false,
      code: "CONFLICT",
    });
    expect(result.toolRuns[2]).toMatchObject({ ok: true });
    expect(
      await readFile(path.join(root, "src", "value.ts"), "utf8"),
    ).toContain("value = 2");
    db.close();
  });

  test("complex staged work requires supporting evidence before mutation", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-staged-evidence-gate-"),
    );
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "src", "value.ts"),
      "export const value = 1;\n",
      "utf8",
    );
    await writeFile(
      path.join(root, "src", "other.ts"),
      "export const other = true;\n",
      "utf8",
    );
    const db = new LocalCodeDatabase(":memory:");
    const checkpoint = new CheckpointService(db, root);
    const requests: NormalizedModelRequest[] = [];
    let turn = 0;
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Staged evidence gate fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown" as const,
          observedAt: new Date().toISOString(),
        };
      },
      async *stream(request) {
        requests.push(structuredClone(request));
        turn += 1;
        if (turn === 1) {
          yield {
            type: "tool.call" as const,
            call: {
              id: "read-value-for-evidence",
              name: "ReadFile",
              arguments: JSON.stringify({ path: "src/value.ts" }),
            },
          };
        } else if (turn === 2) {
          // A weak model tries to mutate after only one file read. The host
          // must keep EditFile out of this work-unit schema.
          yield {
            type: "tool.call" as const,
            call: {
              id: "premature-edit-before-supporting-evidence",
              name: "EditFile",
              arguments: JSON.stringify({
                path: "src/value.ts",
                oldText: "export const value = 1;",
                newText: "export const value = 2;",
              }),
            },
          };
        } else if (turn === 3) {
          yield {
            type: "tool.call" as const,
            call: {
              id: "read-related-file",
              name: "ReadFile",
              arguments: JSON.stringify({ path: "src/other.ts" }),
            },
          };
        } else if (turn === 4) {
          yield {
            type: "tool.call" as const,
            call: {
              id: "edit-after-evidence",
              name: "EditFile",
              arguments: JSON.stringify({
                path: "src/value.ts",
                oldText: "export const value = 1;",
                newText: "export const value = 2;",
              }),
            },
          };
        } else {
          yield {
            type: "text.delta" as const,
            text: "The bounded change is complete.",
          };
        }
        yield { type: "done" as const };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-staged-evidence-gate",
        objective:
          "Refactor the routing subsystem across src/value.ts and src/other.ts, update callers and tests, then review the final diff.",
        root,
        candidate,
        repositoryPolicy: "local_only",
        permissionMode: "AUTO",
        mode: "coding",
        stagedPaths: ["src/value.ts", "src/other.ts"],
        context: "The host localized src/value.ts as the current target.",
        contextEvidenceState: "SUFFICIENT",
        successCriteria: ["src/value.ts is updated"],
        maxTurns: 8,
      },
      {
        provider,
        tools: workspaceTools,
        reviewFinalDiff: () => true,
        async verifySuccessCriteria(_task, ledger) {
          const changed = ledger.filesChanged.includes("src/value.ts");
          return {
            pass: changed,
            satisfiedCriterionIds: changed ? ["criterion-1"] : [],
            issues: changed ? [] : ["src/value.ts is still unchanged."],
          };
        },
        async createExecutionContext() {
          return {
            root,
            permissionMode: "AUTO" as const,
            signal: new AbortController().signal,
            checkpoint,
          };
        },
      },
    );

    expect(result.status).toBe("completed");
    expect(
      requests[1]?.tools?.map(
        (tool) => (tool as { function?: { name?: string } }).function?.name,
      ),
    ).not.toContain("EditFile");
    expect(result.toolRuns.map((run) => run.tool)).toEqual([
      "ReadFile",
      "EditFile",
      "ReadFile",
      "EditFile",
    ]);
    expect(result.toolRuns[1]).toMatchObject({
      ok: false,
      code: "PERMISSION_DENIED",
    });
    expect(result.toolRuns[3]).toMatchObject({ ok: true });
    expect(
      await readFile(path.join(root, "src", "value.ts"), "utf8"),
    ).toContain("value = 2");
    db.close();
  });

  test("staged WriteFile cannot overwrite an existing observed target", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-staged-write-boundary-"),
    );
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "src", "value.ts"),
      "export const value = 1;\n",
      "utf8",
    );
    const db = new LocalCodeDatabase(":memory:");
    const checkpoint = new CheckpointService(db, root);
    let turn = 0;
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Staged WriteFile boundary fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown" as const,
          observedAt: new Date().toISOString(),
        };
      },
      async *stream() {
        turn += 1;
        if (turn === 1) {
          yield {
            type: "tool.call" as const,
            call: {
              id: "read-value",
              name: "ReadFile",
              arguments: JSON.stringify({ path: "src/value.ts" }),
            },
          };
        } else if (turn === 2) {
          yield {
            type: "tool.call" as const,
            call: {
              id: "overwrite-value",
              name: "WriteFile",
              arguments: JSON.stringify({
                path: "src/value.ts",
                content: "export const value = 999;\n",
              }),
            },
          };
        } else if (turn === 3) {
          yield {
            type: "tool.call" as const,
            call: {
              id: "edit-value",
              name: "EditFile",
              arguments: JSON.stringify({
                path: "src/value.ts",
                oldText: "export const value = 1;",
                newText: "export const value = 2;",
              }),
            },
          };
        } else {
          yield {
            type: "text.delta" as const,
            text: "The precise edit is complete.",
          };
        }
        yield { type: "done" as const };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-staged-write-boundary",
        objective: "Update src/value.ts and src/other.ts.",
        root,
        candidate,
        repositoryPolicy: "local_only",
        permissionMode: "AUTO",
        mode: "coding",
        stagedPaths: ["src/value.ts", "src/other.ts"],
        context: "The host localized src/value.ts as the current target.",
        contextEvidenceState: "SUFFICIENT",
        maxTurns: 6,
      },
      {
        provider,
        tools: workspaceTools,
        reviewFinalDiff: () => true,
        async createExecutionContext() {
          return {
            root,
            permissionMode: "AUTO" as const,
            signal: new AbortController().signal,
            checkpoint,
          };
        },
      },
    );

    expect(result.status).toBe("completed");
    expect(result.toolRuns.map((run) => run.tool)).toEqual([
      "ReadFile",
      "WriteFile",
      "EditFile",
    ]);
    expect(result.toolRuns[1]).toMatchObject({
      ok: false,
      code: "PERMISSION_DENIED",
    });
    expect(
      await readFile(path.join(root, "src", "value.ts"), "utf8"),
    ).toContain("value = 2");
    expect(
      await readFile(path.join(root, "src", "value.ts"), "utf8"),
    ).not.toContain("999");
    db.close();
  });

  test("failed verification keeps the changed target readable during repair", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-verification-repair-scope-"),
    );
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "src", "value.ts"),
      "export const value = 1;\n",
      "utf8",
    );
    await writeFile(
      path.join(root, "fail-verification.ts"),
      "process.exit(1);\n",
      "utf8",
    );
    const db = new LocalCodeDatabase(":memory:");
    const checkpoint = new CheckpointService(db, root);
    const requests: NormalizedModelRequest[] = [];
    let turn = 0;
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Verification repair-scope fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown" as const,
          observedAt: new Date().toISOString(),
        };
      },
      async *stream(request) {
        requests.push(structuredClone(request));
        turn += 1;
        if (turn === 1) {
          yield {
            type: "tool.call" as const,
            call: {
              id: "read-before-edit",
              name: "ReadFile",
              arguments: JSON.stringify({ path: "src/value.ts" }),
            },
          };
        } else if (turn === 2) {
          yield {
            type: "tool.call" as const,
            call: {
              id: "edit-value",
              name: "EditFile",
              arguments: JSON.stringify({
                path: "src/value.ts",
                oldText: "export const value = 1;",
                newText: "export const value = 2;",
              }),
            },
          };
        } else if (turn === 3) {
          // This is the read that previously hit CONFLICT because the host
          // replaced the write scope with the verification failure paths.
          yield {
            type: "tool.call" as const,
            call: {
              id: "read-after-failed-verification",
              name: "ReadFile",
              arguments: JSON.stringify({ path: "src/value.ts" }),
            },
          };
        } else {
          yield {
            type: "text.delta" as const,
            text: "Verification is still failing and the task remains blocked.",
          };
        }
        yield { type: "done" as const };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-verification-repair-scope",
        objective: "Update src/value.ts and make verification pass.",
        root,
        candidate,
        repositoryPolicy: "local_only",
        permissionMode: "AUTO",
        mode: "coding",
        stagedPaths: ["src/value.ts"],
        context: "The host localized src/value.ts as the current target.",
        contextEvidenceState: "SUFFICIENT",
        successCriteria: ["src/value.ts is updated", "verification passes"],
        verificationCommands: [
          { stage: "test", command: "bun fail-verification.ts" },
        ],
        maxTurns: 4,
      },
      {
        provider,
        tools: workspaceTools,
        reviewFinalDiff: () => true,
        async verifySuccessCriteria() {
          return {
            pass: false,
            satisfiedCriterionIds: [],
            issues: ["Verification is still failing."],
            nextPaths: ["src/value.ts"],
            nextActions: ["Read the changed source before repairing it."],
          };
        },
        async createExecutionContext() {
          return {
            root,
            permissionMode: "AUTO" as const,
            signal: new AbortController().signal,
            checkpoint,
          };
        },
      },
    );

    expect(result.status).toBe("blocked");
    expect(result.toolRuns.map((run) => run.tool)).toEqual([
      "ReadFile",
      "EditFile",
      "ReadFile",
    ]);
    expect(result.toolRuns[2]).toMatchObject({ ok: true });
    expect(result.toolRuns.some((run) => run.code === "CONFLICT")).toBe(false);
    expect(requests[2]?.messages.at(-1)?.content).toContain(
      "verification did not pass",
    );
    expect(
      await readFile(path.join(root, "src", "value.ts"), "utf8"),
    ).toContain("value = 2");
    db.close();
  });

  test("does not complete a repository answer after every tool attempt fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "localcode-false-done-"));
    await writeFile(
      path.join(root, "package.json"),
      '{"name":"fixture"}\n',
      "utf8",
    );
    let turn = 0;
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "False-completion fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown" as const,
          observedAt: new Date().toISOString(),
        };
      },
      async *stream() {
        turn += 1;
        if (turn === 1) {
          yield {
            type: "tool.call",
            call: {
              id: "invalid-read",
              name: "ReadFile",
              arguments: JSON.stringify({ path: 42 }),
            },
          };
        } else {
          yield {
            type: "text.delta",
            text: "The project uses TypeScript, but I cannot cite a successful read.",
          };
        }
        yield { type: "done" };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-false-done",
        objective: "What programming language is this project using?",
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "PLAN",
        mode: "workspace_question",
        maxTurns: 3,
        systemPromptProfile: "workspace",
      },
      {
        provider,
        tools: workspaceTools,
        async createExecutionContext() {
          return {
            root,
            permissionMode: "PLAN",
            signal: new AbortController().signal,
          };
        },
      },
    );

    expect(result.verified).toBe(false);
    expect(result.status).not.toBe("completed");
    expect(result.completion.reasons).toContain(
      "relevant repository evidence is missing",
    );
  });

  test("stops repeated recoverable errors even when the model changes arguments", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "localcode-error-loop-"));
    let calls = 0;
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Recoverable-error fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown" as const,
          observedAt: new Date().toISOString(),
        };
      },
      async *stream() {
        calls += 1;
        yield {
          type: "tool.call",
          call: {
            id: `missing-${calls}`,
            name: "ReadFile",
            arguments: JSON.stringify({ path: `missing-${calls}.ts` }),
          },
        };
        yield { type: "done" };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-repeated-errors",
        objective: "Find the missing source file",
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "PLAN",
        mode: "workspace_question",
        maxTurns: 10,
        systemPromptProfile: "workspace",
      },
      {
        provider,
        tools: workspaceTools,
        async createExecutionContext() {
          return {
            root,
            permissionMode: "PLAN",
            signal: new AbortController().signal,
          };
        },
      },
    );

    expect(result.status).toBe("blocked");
    expect(result.completion.reasons).toContain("unresolved blockers remain");
    expect(calls).toBeLessThan(6);
  });

  test("converts a provider crash into a failed task ledger", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-provider-crash-"),
    );
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Crashing fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown" as const,
          observedAt: new Date().toISOString(),
        };
      },
      async *stream() {
        throw new Error("runtime crashed while streaming");
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };
    const logs: LogRecord[] = [];

    const result = await runAgent(
      {
        id: "task-provider-crash",
        objective: "Inspect the repository",
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "PLAN",
        mode: "workspace_question",
        maxTurns: 2,
        systemPromptProfile: "workspace",
      },
      {
        provider,
        tools: workspaceTools,
        logger: createLogger({
          level: "debug",
          sink: { write: (record) => logs.push(record) },
        }),
        async createExecutionContext() {
          return {
            root,
            permissionMode: "PLAN",
            signal: new AbortController().signal,
          };
        },
      },
    );

    expect(result.status).toBe("failed");
    expect(result.ledger.phase).toBe("failed");
    expect(result.ledger.blockers[0]?.summary).toContain("runtime crashed");
    expect(result.failure?.code).toBe("UNKNOWN");
    expect(result.failure?.message).toContain("runtime crashed");
    expect(
      logs.find((record) => record.event === "agent.task.failed")?.data,
    ).toEqual(
      expect.objectContaining({
        reason: expect.stringContaining("runtime crashed"),
      }),
    );
  });

  test("keeps EditFile hidden until a large read has a usable bounded observation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "localcode-large-read-"));
    await mkdir(path.join(root, "src"));
    const largeSource = [
      "export const marker = 1;",
      ...Array.from(
        { length: 280 },
        (_, index) => `export const generated${index} = ${index};`,
      ),
    ].join("\n");
    await writeFile(path.join(root, "src", "large.ts"), largeSource, "utf8");
    await writeFile(
      path.join(root, "src", "other.ts"),
      "export const other = 1;\n",
      "utf8",
    );

    const requests: NormalizedModelRequest[] = [];
    let turn = 0;
    const provider: ProviderAdapter = {
      id: "local",
      displayName: "Large-read fixture",
      async discoverModels() {
        return [candidate];
      },
      async health() {
        return { state: "healthy" };
      },
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown" as const,
          observedAt: new Date().toISOString(),
        };
      },
      async *stream(request) {
        requests.push(structuredClone(request));
        turn += 1;
        if (turn === 1) {
          yield {
            type: "tool.call" as const,
            call: {
              id: "large-read",
              name: "ReadFile",
              arguments: JSON.stringify({ path: "src/large.ts" }),
            },
          };
        } else if (turn === 2) {
          yield {
            type: "tool.call" as const,
            call: {
              id: "bounded-read",
              name: "ReadFile",
              arguments: JSON.stringify({
                path: "src/large.ts",
                startLine: 1,
              }),
            },
          };
        } else if (turn === 3) {
          yield {
            type: "tool.call" as const,
            call: {
              id: "edit-large",
              name: "EditFile",
              arguments: JSON.stringify({
                path: "src/large.ts",
                oldText: "export const marker = 1;",
                newText: "export const marker = 2;",
              }),
            },
          };
        } else {
          yield {
            type: "text.delta" as const,
            text: "The bounded edit is ready.",
          };
        }
        yield { type: "done" as const };
      },
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      },
    };

    const result = await runAgent(
      {
        id: "task-large-read",
        objective: "Change src/large.ts",
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "EDIT",
        mode: "coding",
        stagedPaths: ["src/large.ts", "src/other.ts"],
        maxTurns: 4,
      },
      {
        provider,
        tools: workspaceTools,
        createExecutionContext: async () => ({
          root,
          permissionMode: "EDIT",
          signal: new AbortController().signal,
        }),
      },
    );

    const toolNames = requests.map((request) =>
      (request.tools ?? []).flatMap((tool) => {
        if (typeof tool !== "object" || tool === null) return [];
        const functionValue = (tool as { function?: unknown }).function;
        if (typeof functionValue !== "object" || functionValue === null)
          return [];
        const name = (functionValue as { name?: unknown }).name;
        return typeof name === "string" ? [name] : [];
      }),
    );

    expect(result.toolRuns.map((run) => run.tool)).toEqual([
      "ReadFile",
      "ReadFile",
      "EditFile",
    ]);
    expect(toolNames[1]).not.toContain("EditFile");
    expect(toolNames[2]).toContain("EditFile");
  });
});
