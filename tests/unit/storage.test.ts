import { expect, test } from "bun:test";
import {
  LocalCodeDatabase,
  RuntimePersistenceConflictError,
} from "../../src/storage/database.js";
import { createTaskLedger, setTaskPhase } from "../../src/agent/task-state.js";
import { createTaskEpisodeMemoryFact } from "../../src/shared/memory.js";
import { createTaskRuntimeSnapshot } from "../../src/agent/task-runtime-state.js";

test("storage migrations are idempotent and preserve settings", () => {
  const storage = new LocalCodeDatabase(":memory:");

  storage.setSetting("routing.mode", "strict-zero");
  storage.setSetting("privacy.policy", "private");

  storage.migrate();

  expect(storage.getSetting("routing.mode")).toBe("strict-zero");
  expect(storage.getSetting("privacy.policy")).toBe("private");
  expect(storage.schemaVersion()).toBe(4);

  storage.close();
});

test("storage caches exact model capability probe results", () => {
  const storage = new LocalCodeDatabase(":memory:");
  const probe = {
    conversation: true,
    readTool: true,
    multiTurnTools: true,
    agenticCodingEligible: true,
    agentCapabilityClass: "coding_agent" as const,
    environment: {
      modelId: "fixture-model",
      runtimeId: "lm-studio",
      task: "capability-probe",
      quantization: "Q4_K_M",
      generation: { temperature: 0, maxOutputTokens: 512 },
    },
    notes: ["measured"],
  };
  storage.saveModelCapability("lm-studio", "fixture-model", probe);
  expect(
    storage.getModelCapability("lm-studio", "fixture-model")?.probe,
  ).toEqual(probe);
  expect(
    storage.getModelCapability("lm-studio", "fixture-model")?.version,
  ).toBe(1);
  storage.close();
});

test("storage persists typed semantic and episodic memory facts", () => {
  const storage = new LocalCodeDatabase(":memory:");
  const semantic = {
    id: "semantic:repo:language",
    repository: "repo",
    kind: "semantic" as const,
    fact: "The repository uses TypeScript.",
    evidence: [{ source: "package.json", revision: "abc" }],
    provenance: "observed" as const,
    confidence: 0.95,
    scope: ["repository", "language"],
    tags: ["typescript"],
    createdAt: "2026-08-25T00:00:00.000Z",
    lastValidatedAt: "2026-08-25T00:00:00.000Z",
  };
  storage.saveMemoryFact(semantic);
  storage.saveMemoryFact(
    createTaskEpisodeMemoryFact({
      repository: "repo",
      taskId: "task-episode",
      objective: "Fix the TypeScript auth test",
      status: "completed",
      phase: "complete",
      verified: true,
      filesChanged: ["src/auth.ts"],
      verification: [{ command: "bun test", status: "passed" }],
    }),
  );

  expect(storage.listMemoryFacts("repo", "semantic")).toEqual([semantic]);
  expect(storage.listMemoryFacts("repo", "episodic")).toHaveLength(1);
  storage.invalidateMemoryFact(semantic.id);
  expect(storage.listMemoryFacts("repo", "semantic")).toHaveLength(0);
  storage.close();
});

test("storage persists and restores the structured agent task ledger", () => {
  const storage = new LocalCodeDatabase(":memory:");
  const ledger = createTaskLedger({
    id: "task-1",
    objective: "Find the session implementation",
    mode: "workspace_question",
  });
  setTaskPhase(ledger, "discover");

  storage.saveAgentTask(ledger, "session-1");
  const restored = storage.getAgentTask("task-1");

  expect(restored?.id).toBe("task-1");
  expect(restored?.objective).toBe("Find the session implementation");
  expect(restored?.phase).toBe("discover");
  expect(storage.listAgentTasks("session-1")).toHaveLength(1);

  setTaskPhase(ledger, "analyze");
  storage.saveAgentTask(ledger, "session-1");
  expect(storage.getAgentTask("task-1")?.phase).toBe("analyze");

  storage.close();
});

test("storage persists the versioned runtime envelope for durable resume", () => {
  const storage = new LocalCodeDatabase(":memory:");
  const ledger = createTaskLedger({
    id: "runtime-task",
    objective: "Resume the parser repair",
    mode: "coding",
  });
  const snapshot = createTaskRuntimeSnapshot({
    ledger,
    repositoryRoot: "D:/fixture/repository",
    repositoryRevision: "revision-1",
    sessionId: "session-runtime",
    route: {
      candidateId: "local/qwen",
      providerId: "lm-studio",
      modelId: "qwen-coder",
    },
    contextAnchor: {
      sourceIds: ["src/parser.ts"],
      instructionSources: ["AGENTS.md"],
      memoryIds: ["memory:parser"],
      proofGapIds: ["deliverable-parser"],
      activeNodeId: "mutate-parser",
    },
    activeNodeId: "mutate-parser",
    updatedRevision: 4,
  });

  storage.saveAgentRuntime(snapshot, "session-runtime");
  const restored = storage.getAgentRuntime("runtime-task");
  const latest = storage.getLatestAgentRuntime("session-runtime");

  expect(restored?.ok).toBe(true);
  expect(latest?.ok).toBe(true);
  if (!restored?.ok || !latest?.ok) return;
  expect(restored.snapshot.route?.modelId).toBe("qwen-coder");
  expect(restored.snapshot.activeNodeId).toBe("mutate-parser");
  expect(restored.snapshot.contextAnchor.proofGapIds).toEqual([
    "deliverable-parser",
  ]);
  expect(restored.snapshot.updatedRevision).toBe(4);
  expect(latest.snapshot.taskId).toBe("runtime-task");
  storage.close();
});

test("storage rejects an out-of-order runtime snapshot", () => {
  const storage = new LocalCodeDatabase(":memory:");
  const ledger = createTaskLedger({
    id: "runtime-ordering",
    objective: "Resume safely",
    mode: "workspace_question",
  });
  const latest = createTaskRuntimeSnapshot({
    ledger,
    repositoryRoot: "D:/fixture/repository",
    updatedRevision: 4,
  });
  const stale = createTaskRuntimeSnapshot({
    ledger,
    repositoryRoot: "D:/fixture/repository",
    updatedRevision: 3,
  });

  storage.saveAgentRuntime(latest);
  expect(() => storage.saveAgentRuntime(stale)).toThrow(
    RuntimePersistenceConflictError,
  );
  const restored = storage.getAgentRuntime("runtime-ordering");
  expect(restored?.ok).toBe(true);
  if (restored?.ok) expect(restored.snapshot.updatedRevision).toBe(4);
  storage.close();
});

test("storage normalizes ledgers created before the verification plan field", () => {
  const storage = new LocalCodeDatabase(":memory:");
  const legacy = {
    id: "legacy-task",
    objective: "old task",
    mode: "coding",
    phase: "blocked",
    successCriteria: [],
    constraints: [],
    evidence: [],
    hypotheses: [],
    actions: [],
    filesRead: [],
    filesChanged: [],
    verificationRuns: [],
    blockers: [],
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  storage.db
    .query(
      `INSERT INTO agent_tasks
        (id, session_id, objective, mode, phase, ledger_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      legacy.id,
      null,
      legacy.objective,
      legacy.mode,
      legacy.phase,
      JSON.stringify(legacy),
      legacy.startedAt,
      legacy.updatedAt,
    );

  expect(storage.getAgentTask(legacy.id)?.verificationPlan).toEqual([]);
  storage.close();
});

test("storage exposes recent sessions and their transcript", () => {
  const storage = new LocalCodeDatabase(":memory:");
  storage.createSession(
    "s1",
    "repo",
    "Explain the repository",
    "2026-08-23T00:00:00.000Z",
  );
  expect(storage.sessionExists("s1")).toBe(true);
  expect(storage.sessionExists("missing")).toBe(false);
  storage.appendMessage(
    "s1",
    "user",
    "Explain the repository",
    "2026-08-23T00:01:00.000Z",
  );

  expect(storage.listSessions()[0]?.objective).toBe("Explain the repository");
  expect(storage.listMessages("s1")[0]?.content).toBe("Explain the repository");

  storage.close();
});
