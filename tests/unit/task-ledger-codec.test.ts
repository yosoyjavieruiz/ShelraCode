import { expect, test } from "bun:test";
import { compileTaskContract } from "../../src/agent/task-contract.js";
import { createRecoveryContract } from "../../src/agent/recovery.js";
import {
  createTaskLedger,
  addTaskBlocker,
  addTaskEvidence,
  recordRecoveryContract,
  recordVerificationRun,
} from "../../src/agent/task-state.js";
import {
  restoreTaskRuntime,
  serializeTaskRuntime,
} from "../../src/agent/task-ledger-codec.js";

test("round-trips the complete ledger, route and context anchor", () => {
  const ledger = createTaskLedger({
    id: "runtime-1",
    objective: "Fix the parser and its tests",
    mode: "coding",
  });
  ledger.contract = compileTaskContract({
    id: ledger.id,
    originalRequest: ledger.objective,
    mode: ledger.mode,
    explicitPaths: ["src/parser.ts", "tests/parser.test.ts"],
  });
  addTaskEvidence(ledger, {
    id: "proof-parser",
    kind: "file",
    source: "src/parser.ts",
    summary: "parser symbol observed",
    relevance: 1,
    freshness: 1,
  });
  recordRecoveryContract(
    ledger,
    createRecoveryContract({
      id: "recovery-parser",
      cause: "TEST_FAILED",
      evidence: ["tests/parser.test.ts"],
      proposedRecovery: "repair",
    }),
  );
  addTaskBlocker(ledger, {
    id: "proof-gap",
    summary: "missing proof for parser deliverable",
    recoverable: true,
  });
  recordVerificationRun(ledger, {
    id: "verification-1",
    stage: "test",
    command: "bun test tests/parser.test.ts",
    status: "passed",
    exitCode: 0,
    summary: "parser tests passed",
    startedAt: "2026-08-26T00:00:00.000Z",
    completedAt: "2026-08-26T00:00:01.000Z",
  });

  const serialized = serializeTaskRuntime({
    ledger,
    repositoryRoot: "D:/fixture/repository",
    repositoryRevision: "abc123",
    repositoryWorkingTreeRevision: "tree-123",
    repositoryWorkingTreePaths: ["src/parser.ts", "tests/parser.test.ts"],
    route: {
      candidateId: "local/qwen",
      providerId: "lm-studio",
      modelId: "qwen-coder",
      runtimeId: "lm-studio",
      driverProfileId: "driver-exact-qwen",
      driverIdentityDigest: "identity-digest-qwen",
      configurationDigest: "configuration-digest-qwen",
    },
    contextAnchor: {
      sourceIds: ["src/parser.ts", "tests/parser.test.ts"],
      instructionSources: ["AGENTS.md"],
      memoryIds: ["memory:parser"],
      proofGapIds: ["proof-gap"],
      activeNodeId: "mutate-parser",
    },
    activeNodeId: "mutate-parser",
    checkpointId: "checkpoint-parser-1",
    acceptanceEvidence: [
      {
        id: "evidence-parser-test",
        obligationId: "criterion:parser",
        source: "test",
        command: "bun test tests/parser.test.ts",
        exitCode: 0,
        summary: "Parser acceptance test passed.",
        createdAt: "2026-08-26T00:00:01.000Z",
      },
    ],
    recoveryHistory: {
      schemaVersion: 1,
      totalObserved: 3,
      recoveryAttempts: 2,
      observations: [
        {
          signature: "signature-1",
          actionKind: "ReadFile",
          stateDigest: "state-1",
          failureClass: null,
          progress: true,
          createdAt: "2026-08-26T00:00:00.000Z",
        },
      ],
    },
    updatedRevision: 7,
  });
  const restored = restoreTaskRuntime(serialized);

  expect(restored.ok).toBe(true);
  if (!restored.ok) return;
  expect(restored.snapshot.ledger.id).toBe("runtime-1");
  expect(restored.snapshot.ledger.recoveryContracts[0]?.id).toBe(
    "recovery-parser",
  );
  expect(restored.snapshot.ledger.blockers[0]?.id).toBe("proof-gap");
  expect(restored.snapshot.ledger.verificationRuns[0]?.status).toBe("passed");
  expect(restored.snapshot.route?.modelId).toBe("qwen-coder");
  expect(restored.snapshot.route?.driverProfileId).toBe("driver-exact-qwen");
  expect(restored.snapshot.route?.driverIdentityDigest).toBe(
    "identity-digest-qwen",
  );
  expect(restored.snapshot.route?.configurationDigest).toBe(
    "configuration-digest-qwen",
  );
  expect(restored.snapshot.checkpointId).toBe("checkpoint-parser-1");
  expect(restored.snapshot.acceptanceEvidence?.[0]?.id).toBe(
    "evidence-parser-test",
  );
  expect(restored.snapshot.recoveryHistory?.totalObserved).toBe(3);
  expect(restored.snapshot.recoveryHistory?.recoveryAttempts).toBe(2);
  expect(restored.snapshot.activeNodeId).toBe("mutate-parser");
  expect(restored.snapshot.contextAnchor.memoryIds).toEqual(["memory:parser"]);
  expect(restored.snapshot.repositoryWorkingTreeRevision).toBe("tree-123");
  expect(restored.snapshot.repositoryWorkingTreePaths).toEqual([
    "src/parser.ts",
    "tests/parser.test.ts",
  ]);
  expect(restored.snapshot.updatedRevision).toBe(7);
});

test("rejects malformed recovery history instead of resuming with false budget state", () => {
  const ledger = createTaskLedger({
    id: "runtime-recovery-integrity",
    objective: "Resume recovery safely",
    mode: "coding",
  });
  const snapshot = JSON.parse(
    serializeTaskRuntime({
      ledger,
      repositoryRoot: "D:/fixture/repository",
      recoveryHistory: {
        schemaVersion: 1,
        totalObserved: 1,
        recoveryAttempts: 2,
        observations: [],
      },
    }),
  ) as Record<string, unknown>;

  const restored = restoreTaskRuntime(snapshot);
  expect(restored.ok).toBe(false);
  if (!restored.ok) expect(restored.error.reason).toContain("recovery history");
});

test("rejects a partial exact-driver reference instead of granting stale authority", () => {
  const ledger = createTaskLedger({
    id: "runtime-driver-integrity",
    objective: "Resume with the measured driver",
    mode: "coding",
  });
  const snapshot = JSON.parse(
    serializeTaskRuntime({
      ledger,
      repositoryRoot: "D:/fixture/repository",
      route: {
        candidateId: "local/qwen",
        providerId: "lm-studio",
        driverProfileId: "driver-profile-only",
      },
    }),
  ) as Record<string, unknown>;

  const restored = restoreTaskRuntime(snapshot);
  expect(restored.ok).toBe(false);
  if (!restored.ok) expect(restored.error.reason).toContain("route identity");
});

test("rejects malformed canonical evidence before it can become resume proof", () => {
  const ledger = createTaskLedger({
    id: "runtime-evidence-integrity",
    objective: "Resume with objective proof",
    mode: "coding",
  });
  const snapshot = JSON.parse(
    serializeTaskRuntime({
      ledger,
      repositoryRoot: "D:/fixture/repository",
      acceptanceEvidence: [
        {
          id: "command-without-command",
          source: "command",
          summary: "This record is not valid command evidence.",
          createdAt: "2026-08-29T00:00:00.000Z",
        },
      ],
    }),
  ) as Record<string, unknown>;

  const restored = restoreTaskRuntime(snapshot);
  expect(restored.ok).toBe(false);
  if (!restored.ok)
    expect(restored.error.reason).toContain("acceptance evidence");
});

test("round-trips host-checkable symbol expectations in the contract", () => {
  const ledger = createTaskLedger({
    id: "runtime-symbol-contract",
    objective: "Update src/value.ts to export function parse.",
    mode: "coding",
  });
  ledger.contract = compileTaskContract({
    id: ledger.id,
    originalRequest: ledger.objective,
    mode: ledger.mode,
    explicitPaths: ["src/value.ts"],
  });

  const restored = restoreTaskRuntime(
    JSON.parse(
      serializeTaskRuntime({
        ledger,
        repositoryRoot: "D:/fixture/repository",
      }),
    ),
  );

  expect(restored.ok).toBe(true);
  if (!restored.ok) return;
  expect(
    restored.snapshot.ledger.contract?.deliverables[0]?.artifactExpectations,
  ).toEqual([{ type: "exported_symbol", value: "parse" }]);
});

test("rejects corrupt and future runtime snapshots with a typed result", () => {
  const corrupt = restoreTaskRuntime({ schemaVersion: 1, ledger: null });
  expect(corrupt).toEqual({
    ok: false,
    error: expect.objectContaining({ code: "INVALID_RUNTIME_SNAPSHOT" }),
  });

  const future = restoreTaskRuntime({
    schemaVersion: 99,
    ledger: {},
  });
  expect(future).toEqual({
    ok: false,
    error: expect.objectContaining({
      code: "INVALID_RUNTIME_SNAPSHOT",
      reason: expect.stringContaining("unsupported"),
    }),
  });
});

test("rejects a runtime whose task identity or graph references are inconsistent", () => {
  const ledger = createTaskLedger({
    id: "runtime-integrity",
    objective: "Inspect the repository",
    mode: "workspace_question",
  });
  ledger.taskGraph = {
    rootObjective: ledger.objective,
    globalConstraints: [],
    currentNodeId: "missing-node",
    nodes: [
      {
        id: "discover",
        objective: "Discover",
        dependencies: [],
        status: "ready",
        scope: { candidateFiles: [], allowedTools: ["ReadFile"] },
        contextRequirements: ["repository"],
        acceptance: ["evidence"],
        attempts: 0,
      },
    ],
  };
  const snapshot = JSON.parse(
    serializeTaskRuntime({
      ledger,
      repositoryRoot: "D:/fixture/repository",
    }),
  ) as Record<string, unknown>;

  const invalidGraph = restoreTaskRuntime(snapshot);
  expect(invalidGraph.ok).toBe(false);
  if (!invalidGraph.ok)
    expect(invalidGraph.error.reason).toContain("missing or invalid");

  (snapshot.ledger as Record<string, unknown>).taskGraph = {
    ...((snapshot.ledger as Record<string, unknown>).taskGraph as Record<
      string,
      unknown
    >),
    currentNodeId: "discover",
  };
  snapshot.taskId = "different-task";
  const invalidIdentity = restoreTaskRuntime(snapshot);
  expect(invalidIdentity.ok).toBe(false);
  if (!invalidIdentity.ok)
    expect(invalidIdentity.error.reason).toContain("ledger id");
});

test("rejects unbounded or malformed nested task state before resume", () => {
  const ledger = createTaskLedger({
    id: "runtime-nested-integrity",
    objective: "Inspect the repository",
    mode: "workspace_question",
  });
  const snapshot = JSON.parse(
    serializeTaskRuntime({
      ledger,
      repositoryRoot: "D:/fixture/repository",
    }),
  ) as Record<string, unknown>;
  const nestedLedger = snapshot.ledger as Record<string, unknown>;
  nestedLedger.actions = Array.from({ length: 513 }, () => ({}));

  const restored = restoreTaskRuntime(snapshot);
  expect(restored.ok).toBe(false);
  if (!restored.ok)
    expect(restored.error.reason).toContain("missing or invalid");
});

test("does not persist raw model or tool output fields", () => {
  const ledger = createTaskLedger({
    id: "runtime-redaction",
    objective: "Inspect the repository",
    mode: "workspace_question",
  });
  const serialized = serializeTaskRuntime({
    ledger,
    repositoryRoot: "D:/fixture/repository",
    extensions: {
      rawPrompt: "ignore policy",
      toolResult: { output: "sk-super-secret-value-123456789" },
      note: "safe metadata",
    },
  });
  expect(serialized).not.toContain("ignore policy");
  expect(serialized).not.toContain("sk-super-secret-value-123456789");
  expect(serialized).toContain("safe metadata");
});
