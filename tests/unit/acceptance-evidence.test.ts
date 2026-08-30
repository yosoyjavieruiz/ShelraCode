import { expect, test } from "bun:test";
import { compileTaskContract } from "../../src/agent/task-contract.js";
import {
  InMemoryEvidenceStore,
  compileAcceptanceObligations,
  evaluateProofBackedCompletion,
  normalizeEvidenceRecord,
  type AcceptanceObligation,
  type EvidenceRecord,
} from "../../src/evidence/acceptance.js";

const createdAt = "2026-08-29T00:00:00.000Z";

function obligation(
  overrides: Partial<AcceptanceObligation> = {},
): AcceptanceObligation {
  return {
    id: "criterion:objective",
    statement: "The requested behavior is observable.",
    type: "behavioral",
    required: true,
    status: "pending",
    ...overrides,
  };
}

function evidence(overrides: Partial<EvidenceRecord> = {}): EvidenceRecord {
  return {
    id: "evidence-1",
    obligationId: "criterion:objective",
    source: "runtime",
    summary: "The host observed the requested behavior.",
    createdAt,
    ...overrides,
  };
}

test("compiles contract deliverables, criteria, and evidence requirements into namespaced obligations", () => {
  const contract = compileTaskContract({
    id: "acceptance-contract",
    originalRequest: "Change src/value.ts and run the tests.",
    mode: "coding",
    explicitPaths: ["src/value.ts"],
    verificationCommands: [{ stage: "test", command: "bun test" }],
  });

  const obligations = compileAcceptanceObligations(contract);

  expect(obligations.map((item) => item.id)).toEqual([
    "deliverable:deliverable-path-1",
    "criterion:criterion-objective",
    "criterion:criterion-verification",
    "criterion:criterion-review",
    "evidence:evidence-repository",
    "evidence:evidence-scope",
    "evidence:evidence-verification",
    "evidence:evidence-review",
  ]);
  expect(
    obligations.find((item) => item.id === "criterion:criterion-verification"),
  )?.toMatchObject({
    type: "test",
    required: true,
    verifier: { kind: "host" },
  });
  expect(
    obligations.find((item) => item.id === "criterion:criterion-review"),
  )?.toMatchObject({
    type: "manual",
    verifier: { kind: "manual" },
  });
});

test("the evidence store redacts secrets, deduplicates identical records, and restores snapshots", () => {
  const store = new InMemoryEvidenceStore();
  const stored = store.record(
    "task-1",
    evidence({
      id: "command-1",
      source: "command",
      command: "bun test --token=super-secret",
      summary: "Authorization: super-secret was not printed.",
      exitCode: 0,
    }),
  );

  expect(stored.command).not.toContain("super-secret");
  expect(stored.summary).not.toContain("super-secret");
  expect(store.record("task-1", stored)).toEqual(stored);
  expect(store.list("task-1")).toHaveLength(1);

  const snapshot = store.snapshot();
  const restored = new InMemoryEvidenceStore();
  restored.restore(snapshot);
  expect(restored.get("task-1", "command-1")).toEqual(stored);
  expect(() =>
    restored.record("task-1", { ...stored, summary: "a conflicting record" }),
  ).toThrow("Conflicting evidence id");
});

test("proof-backed completion ignores a claimed satisfied status without linked host evidence", () => {
  const result = evaluateProofBackedCompletion({
    obligations: [obligation({ status: "satisfied" })],
    evidence: [],
    declaredComplete: true,
  });

  expect(result.canComplete).toBe(false);
  expect(result.falseSuccess).toBe(true);
  expect(result.obligations[0]?.status).toBe("pending");
  expect(result.reasons[0]).toContain("self-declared completion was rejected");
  expect(result.evidenceRefs).toEqual([]);
});

test("proof-backed completion requires successful verifier-matched evidence and cites its id", () => {
  const required = obligation({
    id: "criterion:tests",
    statement: "The targeted tests pass.",
    type: "test",
    verifier: { id: "tests", kind: "command", command: "bun test tests/unit" },
  });
  const failed = evaluateProofBackedCompletion({
    obligations: [required],
    evidence: [
      evidence({
        id: "run-failed",
        obligationId: required.id,
        source: "test",
        command: "bun test tests/unit",
        exitCode: 1,
      }),
    ],
  });
  expect(failed.canComplete).toBe(false);
  expect(failed.obligations[0]?.status).toBe("failed");

  const passed = evaluateProofBackedCompletion({
    obligations: [required],
    evidence: [
      evidence({
        id: "run-passed",
        obligationId: required.id,
        source: "test",
        command: "bun test tests/unit",
        exitCode: 0,
      }),
    ],
  });
  expect(passed.canComplete).toBe(true);
  expect(passed.falseSuccess).toBe(false);
  expect(passed.evidenceRefs).toEqual(["run-passed"]);
});

test("a newer failed observation invalidates an older successful observation", () => {
  const required = obligation({
    id: "criterion:latest",
    type: "test",
    verifier: { id: "tests", kind: "command", command: "bun test" },
  });
  const result = evaluateProofBackedCompletion({
    obligations: [required],
    evidence: [
      evidence({
        id: "run-old-pass",
        obligationId: required.id,
        source: "test",
        command: "bun test",
        exitCode: 0,
        createdAt: "2026-08-29T00:00:00.000Z",
      }),
      evidence({
        id: "run-new-failure",
        obligationId: required.id,
        source: "test",
        command: "bun test",
        exitCode: 1,
        createdAt: "2026-08-29T00:00:01.000Z",
      }),
    ],
  });

  expect(result.canComplete).toBe(false);
  expect(result.obligations[0]?.status).toBe("failed");
  expect(result.evidenceRefs).toEqual([]);
});

test("optional obligations do not block completion while failed required obligations do", () => {
  const result = evaluateProofBackedCompletion({
    obligations: [
      obligation({ id: "required", required: true }),
      obligation({ id: "optional", required: false }),
    ],
    evidence: [evidence({ obligationId: "required" })],
  });

  expect(result.canComplete).toBe(true);
  expect(result.obligations.map((item) => item.status)).toEqual([
    "satisfied",
    "pending",
  ]);
});

test("evidence records require a valid timestamp and structured command status", () => {
  expect(() =>
    normalizeEvidenceRecord({
      ...evidence({ source: "command" }),
      command: "bun test",
      createdAt: "not-a-date",
    }),
  ).toThrow("createdAt must be a valid timestamp");
  expect(() =>
    normalizeEvidenceRecord({
      ...evidence({ source: "command" }),
      createdAt,
    }),
  ).toThrow("command evidence requires command");
});
