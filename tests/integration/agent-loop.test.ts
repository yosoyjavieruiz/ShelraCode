import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CheckpointService } from "../../src/checkpoint/checkpoint.js";
import { runAgent } from "../../src/agent/loop.js";
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
    const provider = new FakeAgentProvider();

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

  test("recovers from the reported ListFiles-on-a-file / invalid-maxChars failures instead of giving up", async () => {
    // Reproduces the exact reported failure: the model first calls
    // ListFiles on a skill *file* path (which used to throw a raw ENOTDIR)
    // and, in a second scenario turn, ReadFile with an invalid maxChars.
    // With typed ToolErrors now surfaced as structured tool results and an
    // explicit recovery instruction in the system prompt, the model turn
    // corrects itself on the next call instead of the loop dead-ending.
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
          // A correct model reads the PATH_IS_FILE code/message from the
          // first tool result and switches tools — it does not repeat
          // ListFiles nor stall.
          yield {
            type: "tool.call",
            call: {
              id: "read-1",
              name: "ReadFile",
              arguments: JSON.stringify({ path: "package.json" }),
            },
          };
        } else {
          yield {
            type: "text.delta",
            text: "This is the LocalCode project, confirmed via package.json.",
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
    expect(result.text).toContain("package.json");
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
    ).toEqual(expect.objectContaining({
      reason: expect.stringContaining("runtime crashed"),
    }));
  });
});
