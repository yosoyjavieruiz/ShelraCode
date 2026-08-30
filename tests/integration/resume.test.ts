import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CheckpointService } from "../../src/checkpoint/checkpoint.js";
import { runAgent } from "../../src/agent/loop.js";
import {
  addTaskEvidence,
  createTaskLedger,
  recordTaskAction,
  setTaskPhase,
} from "../../src/agent/task-state.js";
import { compileTaskGraph } from "../../src/agent/task-graph.js";
import { createTaskRuntimeSnapshot } from "../../src/agent/task-runtime-state.js";
import { PLAN_TOOL_NAME } from "../../src/agent/planner.js";
import { workspaceTools } from "../../src/tools/workspace.js";
import type {
  NormalizedModelRequest,
  ProviderAdapter,
  ProviderEvent,
} from "../../src/providers/types.js";
import type { ModelCandidate } from "../../src/shared/types.js";
import { LocalCodeDatabase } from "../../src/storage/database.js";
import { fakeAgentCandidate } from "../support/fake-provider.js";

const candidate: ModelCandidate = {
  id: "local/resume-fixture",
  providerId: "local",
  modelId: "resume-fixture-model",
  displayName: "Resume fixture model",
  source: "local",
  capabilities: {
    tools: false,
    structuredOutput: false,
    reasoning: false,
    vision: false,
  },
  free: { status: "verified_free" },
  privacy: {
    classification: "local",
    retentionKnown: true,
    trainsOnInputs: false,
  },
  quality: { confidence: "measured" },
  health: { state: "healthy" },
};

class ResumeProvider implements ProviderAdapter {
  readonly id = "local";
  readonly displayName = "Resume fixture provider";
  readonly requests: NormalizedModelRequest[] = [];

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
    this.requests.push(structuredClone(request));
    yield { type: "text.delta", text: "Resumed from durable task state." };
    yield { type: "done" };
  }

  classifyError(error: unknown) {
    return {
      code: "UNKNOWN" as const,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

describe("durable task resume", () => {
  test("rehydrates the persisted ledger and graph before the next model turn", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "localcode-resume-"));
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "src", "parser.ts"),
      "export const parser = true;\n",
    );
    const storage = new LocalCodeDatabase(":memory:");
    const objective = "Inspect the parser implementation";
    const ledger = createTaskLedger({
      id: "resume-task",
      objective,
      mode: "workspace_question",
      planningMode: "none",
    });
    ledger.taskGraph = compileTaskGraph({
      objective,
      mode: "workspace_question",
      candidateFiles: ["src/parser.ts"],
    });
    ledger.taskGraph.globalConstraints.push("resume-marker");
    addTaskEvidence(ledger, {
      id: "evidence-parser",
      kind: "file",
      source: "src/parser.ts",
      summary: "The parser module exports parser.",
      relevance: 1,
      freshness: 1,
    });
    recordTaskAction(ledger, {
      id: "read-parser",
      kind: "read",
      target: "src/parser.ts",
      status: "succeeded",
      summary: "Persisted before process interruption.",
    });
    setTaskPhase(ledger, "blocked");
    storage.createSession("resume-session", root, objective);
    storage.saveAgentRuntime(
      createTaskRuntimeSnapshot({
        ledger,
        repositoryRoot: root,
        repositoryRevision: "fixture-revision",
        sessionId: "resume-session",
        route: {
          candidateId: candidate.id,
          providerId: candidate.providerId,
          modelId: candidate.modelId,
        },
        contextAnchor: {
          sourceIds: ["src/parser.ts"],
          instructionSources: ["AGENTS.md"],
          memoryIds: ["memory:parser-convention"],
          proofGapIds: ["proof:parser-answer"],
          activeNodeId: "answer",
        },
        activeNodeId: "answer",
        updatedRevision: 7,
      }),
      "resume-session",
    );

    const restored = storage.getLatestAgentRuntime("resume-session");
    expect(restored?.ok).toBe(true);
    if (!restored?.ok) return;
    const provider = new ResumeProvider();
    const persistedMarkers: Array<string | undefined> = [];
    const persistedRecoveryAttempts: number[] = [];
    const result = await runAgent(
      {
        id: restored.snapshot.taskId,
        objective,
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "PLAN",
        mode: "workspace_question",
        planningMode: "none",
        systemPromptProfile: "workspace",
        maxTurns: 1,
        runtimeSnapshot: restored.snapshot,
      },
      {
        provider,
        tools: [],
        toolChoice: "none",
        persistTask: (_ledger, inFlight, rehydration) => {
          persistedMarkers.push(inFlight?.kind);
          if (rehydration?.recoveryHistory)
            persistedRecoveryAttempts.push(
              rehydration.recoveryHistory.recoveryAttempts ?? -1,
            );
        },
        createExecutionContext: async () => ({
          root,
          permissionMode: "PLAN",
          signal: new AbortController().signal,
        }),
      },
    );

    expect(result.ledger.id).toBe("resume-task");
    expect(result.ledger.filesRead).toContain("src/parser.ts");
    expect(
      result.ledger.actions.some((action) => action.id === "read-parser"),
    ).toBe(true);
    expect(result.ledger.taskGraph?.globalConstraints).toContain(
      "resume-marker",
    );
    expect(result.ledger.phase).not.toBe("blocked");
    expect(persistedMarkers).toContain("model");
    expect(persistedMarkers.at(-1)).toBeUndefined();
    expect(persistedRecoveryAttempts).toContain(0);
    expect(provider.requests[0]?.messages.at(-1)?.content).toContain(objective);
    storage.close();
  });

  test("turns an interrupted mutation into bounded recovery without replaying it", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-resume-interrupted-"),
    );
    const objective = "Repair the parser implementation";
    const ledger = createTaskLedger({
      id: "interrupted-task",
      objective,
      mode: "coding",
      planningMode: "none",
    });
    const snapshot = createTaskRuntimeSnapshot({
      ledger,
      repositoryRoot: root,
      inFlight: {
        kind: "mutation",
        actionId: "edit-parser",
        target: "src/parser.ts",
        startedAt: new Date().toISOString(),
      },
    });
    const provider = new ResumeProvider();
    const executed: string[] = [];
    const result = await runAgent(
      {
        id: snapshot.taskId,
        objective,
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "PLAN",
        mode: "coding",
        planningMode: "none",
        maxTurns: 1,
        runtimeSnapshot: snapshot,
      },
      {
        provider,
        tools: [
          {
            name: "EditFile",
            description: "fixture mutation",
            risk: "write",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
              additionalProperties: false,
            },
            validate(input: unknown) {
              return input;
            },
            async execute() {
              executed.push("EditFile");
              return { ok: true };
            },
          },
        ],
        toolChoice: "auto",
        createExecutionContext: async () => ({
          root,
          permissionMode: "PLAN",
          signal: new AbortController().signal,
        }),
      },
    );

    expect(executed).toEqual([]);
    expect(
      result.ledger.actions.some((action) =>
        action.id.includes("resume-interrupted:edit-parser"),
      ),
    ).toBe(true);
    expect(
      result.ledger.blockers.some((blocker) =>
        blocker.summary.includes("edit-parser"),
      ),
    ).toBe(true);
  });

  // Regression: degradeToCompatibilityPlanning (loop.ts) flips the in-run
  // `planningMode` local to "compatibility" but originally left
  // `ledger.planningMode` frozen at its initial "model" value (set once via
  // `??=` long before a degrade can happen). A resumed run re-derives its
  // own planningMode from exactly that persisted field
  // (`restoredLedger?.planningMode ?? task.planningMode ?? ...`), so a
  // resume after a mid-run degrade re-entered LLM planning against a
  // taskGraph that was actually compatibility-shaped -- the task oscillated
  // between the two planning paradigms on every resume instead of
  // continuing the work already underway (reported live as "esta generando
  // un bucle").
  test("does not re-enter LLM planning on resume after a mid-run degrade to compatibility", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-resume-degrade-"),
    );
    const objective = "Create marker.txt with a concise verified marker.";
    const ledger = createTaskLedger({
      id: "degraded-task",
      objective,
      mode: "coding",
      planningMode: "model",
    });
    // Simulate the state left behind by a prior run that already degraded.
    ledger.planningMode = "compatibility";
    ledger.taskGraph = compileTaskGraph({
      objective,
      mode: "coding",
      candidateFiles: ["marker.txt"],
    });
    const snapshot = createTaskRuntimeSnapshot({ ledger, repositoryRoot: root });

    class PlanRefusingProvider implements ProviderAdapter {
      readonly id = "local";
      readonly displayName = "Plan-refusing fixture";
      readonly requests: NormalizedModelRequest[] = [];

      async discoverModels(): Promise<ModelCandidate[]> {
        return [fakeAgentCandidate];
      }
      async health() {
        return { state: "healthy" as const };
      }
      async quota() {
        return {
          providerId: "local",
          confidence: "unknown" as const,
          observedAt: new Date().toISOString(),
        };
      }
      async *stream(
        request: NormalizedModelRequest,
      ): AsyncIterable<ProviderEvent> {
        this.requests.push(structuredClone(request));
        if (request.tools?.some((tool) => (tool as { name?: string }).name === PLAN_TOOL_NAME))
          throw new Error(
            "regression: the planner was re-invoked on resume after the task had already degraded to compatibility planning",
          );
        yield {
          type: "tool.call",
          call: {
            id: "write-marker-resumed",
            name: "WriteFile",
            arguments: JSON.stringify({
              path: "marker.txt",
              content: "verified\n",
            }),
          },
        };
        yield { type: "done" };
      }
      classifyError(error: unknown) {
        return {
          code: "UNKNOWN" as const,
          message: error instanceof Error ? error.message : String(error),
        };
      }
    }

    const provider = new PlanRefusingProvider();
    const result = await runAgent(
      {
        id: snapshot.taskId,
        objective,
        root,
        candidate: fakeAgentCandidate,
        repositoryPolicy: "private",
        permissionMode: "EDIT",
        mode: "coding",
        // A fresh message from app.tsx recomputes this independently of the
        // ledger on every call -- it has no idea the task already degraded.
        // restoredLedger.planningMode must win over this stale "model".
        planningMode: "model",
        executionProfile: "structured",
        maxTurns: 2,
        runtimeSnapshot: snapshot,
      },
      {
        provider,
        tools: workspaceTools,
        toolChoice: "auto",
        createExecutionContext: async () => ({
          root,
          permissionMode: "EDIT",
          signal: new AbortController().signal,
        }),
        reviewFinalDiff: () => true,
        verifySuccessCriteria: async () => ({
          pass: true,
          issues: [],
          nextActions: [],
          nextPaths: [],
          satisfiedCriterionIds: [],
        }),
      },
    );

    expect(result.ledger.taskGraph?.planSource).toBe("compatibility");
    expect(
      provider.requests.some((request) =>
        request.tools?.some((tool) => (tool as { name?: string }).name === PLAN_TOOL_NAME),
      ),
    ).toBe(false);
  });

  test("rehydrates the same task identity and recovery budget after database reopen", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-resume-reopen-"),
    );
    const databasePath = path.join(root, "runtime.sqlite");
    const ledger = createTaskLedger({
      id: "reopen-task",
      objective: "Resume the exact task after process loss",
      mode: "coding",
      planningMode: "none",
    });
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, "src", "value.ts"),
      "export const value = 1;\n",
    );

    const firstProcess = new LocalCodeDatabase(databasePath);
    firstProcess.createSession("reopen-session", root, ledger.objective);
    const firstCheckpoint = new CheckpointService(firstProcess, root);
    const checkpointId = await firstCheckpoint.create("reopen-task", [
      "src/value.ts",
    ]);
    const snapshot = createTaskRuntimeSnapshot({
      ledger,
      repositoryRoot: root,
      sessionId: "reopen-session",
      repositoryRevision: "revision-before-restart",
      repositoryWorkingTreeRevision: "tree-before-restart",
      repositoryWorkingTreePaths: ["src/value.ts"],
      route: {
        candidateId: candidate.id,
        providerId: candidate.providerId,
        modelId: candidate.modelId,
        runtimeId: "lm-studio",
        driverProfileId: "driver-exact-resume",
        driverIdentityDigest: "identity-resume",
        configurationDigest: "config-resume",
      },
      checkpointId,
      acceptanceEvidence: [
        {
          id: "reopen-proof",
          obligationId: "deliverable:resume",
          source: "test",
          command: "bun test tests/resume.test.ts",
          exitCode: 0,
          summary: "Resume proof survived process loss.",
          createdAt: "2026-08-29T00:00:00.000Z",
        },
      ],
      recoveryHistory: {
        schemaVersion: 1,
        totalObserved: 4,
        recoveryAttempts: 2,
        observations: [
          {
            signature: "resume-signature",
            actionKind: "ReadFile",
            stateDigest: "resume-state",
            failureClass: null,
            progress: true,
            createdAt: "2026-08-29T00:00:00.000Z",
          },
        ],
      },
      updatedRevision: 9,
    });

    firstProcess.saveAgentRuntime(snapshot, "reopen-session");
    firstProcess.close();

    const secondProcess = new LocalCodeDatabase(databasePath);
    const reopenedCheckpoint = new CheckpointService(secondProcess, root);
    const restored = secondProcess.getAgentRuntime("reopen-task");
    expect(restored?.ok).toBe(true);
    if (!restored?.ok) return;
    expect(restored.snapshot.taskId).toBe("reopen-task");
    expect(restored.snapshot.ledger.objective).toBe(ledger.objective);
    expect(restored.snapshot.route?.driverProfileId).toBe(
      "driver-exact-resume",
    );
    expect(restored.snapshot.route?.configurationDigest).toBe("config-resume");
    expect(restored.snapshot.checkpointId).toBe(checkpointId);
    expect(reopenedCheckpoint.hasCheckpoint(checkpointId)).toBe(true);
    expect(await reopenedCheckpoint.isPreserved(checkpointId)).toBe(true);
    expect(restored.snapshot.acceptanceEvidence?.[0]?.id).toBe("reopen-proof");
    expect(restored.snapshot.recoveryHistory?.totalObserved).toBe(4);
    expect(restored.snapshot.recoveryHistory?.recoveryAttempts).toBe(2);
    expect(restored.snapshot.repositoryWorkingTreeRevision).toBe(
      "tree-before-restart",
    );
    secondProcess.close();
  });

  test("persists the compaction envelope before continuing after context pressure", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-resume-compaction-"),
    );
    const objective = "Retain the objective while compacting a long task";
    const provider = new ResumeProvider();
    const compactedAnchors: Array<string | undefined> = [];
    const result = await runAgent(
      {
        id: "compaction-task",
        objective,
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "PLAN",
        mode: "workspace_question",
        planningMode: "none",
        systemPromptProfile: "workspace",
        context: "Host observation: " + "x".repeat(2_400),
        contextBudgetChars: 800,
        maxTurns: 1,
        runtimeSnapshot: undefined,
      },
      {
        provider,
        tools: [],
        toolChoice: "none",
        persistTask: (_ledger, _inFlight, rehydration) => {
          if (rehydration?.contextAnchor.summary)
            compactedAnchors.push(rehydration.contextAnchor.summary);
        },
        createExecutionContext: async () => ({
          root,
          permissionMode: "PLAN",
          signal: new AbortController().signal,
        }),
      },
    );

    expect(result.status).toBe("completed");
    expect(compactedAnchors.length).toBeGreaterThan(0);
    expect(compactedAnchors.at(-1)).toContain(objective);
    expect(compactedAnchors.at(-1)).toContain("rehydration");
  });

  test("attributes a Shell mutation to filesChanged so a later resume is not blocked as out-of-scope", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-resume-shell-"),
    );
    const git = async (...args: string[]): Promise<void> => {
      const { runCommand } = await import("../../src/shared/process.js");
      const result = await runCommand("git", args, {
        cwd: root,
        intent: "execute",
        network: "deny",
        isolation: "best_effort",
        allowWeakIsolation: true,
        timeoutMs: 10_000,
      });
      if (result.exitCode !== 0)
        throw new Error(result.stderr || result.stdout || args.join(" "));
    };
    await writeFile(path.join(root, "app.ts"), "export const value = 1;\n");
    await git("init", "-q");
    await git("config", "user.name", "Shelra resume test");
    await git("config", "user.email", "resume@shelra.invalid");
    await git("add", ".");
    await git("commit", "-qm", "baseline");

    const objective = "Format the project with the project formatter";
    class ShellFixtureProvider implements ProviderAdapter {
      readonly id = "local";
      readonly displayName = "Shell fixture provider";
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

      async *stream(): AsyncIterable<ProviderEvent> {
        this.turn += 1;
        if (this.turn === 1) {
          yield {
            type: "tool.call",
            call: {
              id: "run-formatter",
              name: "Shell",
              arguments: JSON.stringify({ command: "run formatter" }),
            },
          };
        } else {
          yield { type: "text.delta", text: "Formatting complete." };
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

    const result = await runAgent(
      {
        id: "shell-mutation-task",
        objective,
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "AUTO",
        mode: "coding",
        planningMode: "none",
        verificationPolicy: "not_required",
        maxTurns: 2,
      },
      {
        provider: new ShellFixtureProvider(),
        tools: [
          {
            name: "Shell",
            description: "Run a formatter across the workspace.",
            risk: "execute",
            parameters: {
              type: "object",
              properties: { command: { type: "string" } },
              required: ["command"],
              additionalProperties: false,
            },
            validate(input: unknown) {
              return input;
            },
            async execute() {
              // Simulates a formatter mutating a file as a side effect of a
              // Shell call, the exact case filesChanged used to miss.
              await writeFile(
                path.join(root, "app.ts"),
                "export const value = 2;\n",
              );
              return { exitCode: 0 };
            },
          },
        ],
        toolChoice: "auto",
        createExecutionContext: async () => ({
          root,
          permissionMode: "AUTO",
          signal: new AbortController().signal,
        }),
      },
    );

    expect(result.ledger.filesChanged).toContain("app.ts");
  });

  test("skips mutation-path attribution for a Shell command classified as read-only", async () => {
    const root = await mkdtemp(
      path.join(os.tmpdir(), "localcode-resume-shell-readonly-"),
    );
    const git = async (...args: string[]): Promise<void> => {
      const { runCommand } = await import("../../src/shared/process.js");
      const result = await runCommand("git", args, {
        cwd: root,
        intent: "execute",
        network: "deny",
        isolation: "best_effort",
        allowWeakIsolation: true,
        timeoutMs: 10_000,
      });
      if (result.exitCode !== 0)
        throw new Error(result.stderr || result.stdout || args.join(" "));
    };
    await writeFile(path.join(root, "app.ts"), "export const value = 1;\n");
    await git("init", "-q");
    await git("config", "user.name", "Shelra resume test");
    await git("config", "user.email", "resume@shelra.invalid");
    await git("add", ".");
    await git("commit", "-qm", "baseline");

    const objective = "Check the git status";
    class ReadonlyShellFixtureProvider implements ProviderAdapter {
      readonly id = "local";
      readonly displayName = "Read-only shell fixture provider";
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

      async *stream(): AsyncIterable<ProviderEvent> {
        this.turn += 1;
        if (this.turn === 1) {
          yield {
            type: "tool.call",
            call: {
              id: "check-status",
              name: "Shell",
              arguments: JSON.stringify({ command: "git status" }),
            },
          };
        } else {
          yield { type: "text.delta", text: "Status checked." };
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

    const result = await runAgent(
      {
        id: "shell-readonly-task",
        objective,
        root,
        candidate,
        repositoryPolicy: "private",
        permissionMode: "AUTO",
        mode: "coding",
        planningMode: "none",
        verificationPolicy: "not_required",
        maxTurns: 2,
      },
      {
        provider: new ReadonlyShellFixtureProvider(),
        tools: [
          {
            name: "Shell",
            description: "Run a read-only status check.",
            risk: "execute",
            parameters: {
              type: "object",
              properties: { command: { type: "string" } },
              required: ["command"],
              additionalProperties: false,
            },
            validate(input: unknown) {
              return input;
            },
            async execute() {
              // A command classified read-only should never trigger
              // mutation-path attribution, even if it has an unexpected
              // side effect (verifying the skip actually engages, not just
              // that nothing happened to write to app.ts).
              await writeFile(
                path.join(root, "app.ts"),
                "export const value = 2;\n",
              );
              return { exitCode: 0 };
            },
          },
        ],
        toolChoice: "auto",
        createExecutionContext: async () => ({
          root,
          permissionMode: "AUTO",
          signal: new AbortController().signal,
        }),
      },
    );

    expect(result.ledger.filesChanged).not.toContain("app.ts");
  });
});
