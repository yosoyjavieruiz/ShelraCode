import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runAgent } from "../../src/agent/loop.js";
import {
  addTaskEvidence,
  createTaskLedger,
  recordTaskAction,
  setTaskPhase,
} from "../../src/agent/task-state.js";
import { compileTaskGraph } from "../../src/agent/task-graph.js";
import { createTaskRuntimeSnapshot } from "../../src/agent/task-runtime-state.js";
import type {
  NormalizedModelRequest,
  ProviderAdapter,
  ProviderEvent,
} from "../../src/providers/types.js";
import type { ModelCandidate } from "../../src/shared/types.js";
import { LocalCodeDatabase } from "../../src/storage/database.js";

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
        persistTask: (_ledger, inFlight) =>
          persistedMarkers.push(inFlight?.kind),
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
});
