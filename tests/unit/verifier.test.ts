import { expect, test } from "bun:test";
import {
  addTaskEvidence,
  createTaskLedger,
  recordTaskAction,
  recordVerificationRun,
} from "../../src/agent/task-state.js";
import { independentlyVerifyTask } from "../../src/agent/verifier.js";
import type { ObjectiveProofAssessment } from "../../src/agent/objective-proof.js";

test("independent verifier rejects a claimed coding completion without mutation or verification", () => {
  const ledger = createTaskLedger({
    id: "verify-1",
    objective: "Fix the bug",
    mode: "coding",
  });
  const result = independentlyVerifyTask({
    objective: ledger.objective,
    mode: "coding",
    ledger,
    verificationRequired: true,
    finalReviewPerformed: false,
    userWorkPreserved: true,
  });

  expect(result.pass).toBe(false);
  expect(result.issues.map((issue) => issue.code)).toEqual(
    expect.arrayContaining(["NO_MUTATION", "VERIFICATION_MISSING"]),
  );
});

test("independent verifier passes an evidence-backed verified mutation", () => {
  const ledger = createTaskLedger({
    id: "verify-2",
    objective: "Fix the bug",
    mode: "coding",
  });
  addTaskEvidence(ledger, {
    id: "evidence-1",
    kind: "file",
    source: "src/bug.ts",
    summary: "The implementation was inspected before editing.",
    relevance: 1,
    freshness: 1,
  });
  recordTaskAction(ledger, {
    id: "write-1",
    kind: "write",
    target: "src/bug.ts",
    status: "succeeded",
  });
  recordVerificationRun(ledger, {
    id: "test-1",
    command: "bun test",
    status: "passed",
    exitCode: 0,
    startedAt: new Date().toISOString(),
  });
  const result = independentlyVerifyTask({
    objective: ledger.objective,
    mode: "coding",
    ledger,
    verificationRequired: true,
    finalReviewPerformed: true,
    userWorkPreserved: true,
  });

  expect(result).toEqual({ pass: true, confidence: 1, issues: [] });
});

test("independent verifier blocks a command that only produced a failing test", () => {
  const ledger = createTaskLedger({
    id: "verify-3",
    objective: "Run the tests",
    mode: "command",
  });
  recordTaskAction(ledger, {
    id: "run-1",
    kind: "execute",
    target: "RunTests",
    status: "failed",
  });
  recordVerificationRun(ledger, {
    id: "test-1",
    command: "bun test",
    status: "failed",
    exitCode: 1,
    startedAt: new Date().toISOString(),
  });
  const result = independentlyVerifyTask({
    objective: ledger.objective,
    mode: "command",
    ledger,
    verificationRequired: false,
    finalReviewPerformed: true,
    userWorkPreserved: true,
  });

  expect(result.pass).toBe(false);
  expect(
    result.issues.some((issue) => issue.code === "VERIFICATION_FAILED"),
  ).toBe(true);
});

test("independent verifier reports unavailable coding verification explicitly", () => {
  const ledger = createTaskLedger({
    id: "verify-unavailable",
    objective: "Change the implementation",
    mode: "coding",
  });
  addTaskEvidence(ledger, {
    id: "evidence-1",
    kind: "file",
    source: "src/value.ts",
    summary: "The target file was inspected.",
    relevance: 1,
    freshness: 1,
  });
  recordTaskAction(ledger, {
    id: "write-1",
    kind: "write",
    target: "src/value.ts",
    status: "succeeded",
  });
  const result = independentlyVerifyTask({
    objective: ledger.objective,
    mode: "coding",
    ledger,
    verificationRequired: true,
    verificationState: "unavailable",
    finalReviewPerformed: true,
    userWorkPreserved: true,
  });

  expect(result.pass).toBe(false);
  expect(result.issues.map((issue) => issue.code)).toContain(
    "VERIFICATION_UNAVAILABLE",
  );
});

test("independent verifier rejects completion when objective proof is incomplete", () => {
  const ledger = createTaskLedger({
    id: "verify-objective-proof",
    objective: "Update two files",
    mode: "coding",
  });
  addTaskEvidence(ledger, {
    id: "evidence-1",
    kind: "file",
    source: "src/a.ts",
    summary: "The first file was inspected.",
    relevance: 1,
    freshness: 1,
  });
  recordTaskAction(ledger, {
    id: "write-1",
    kind: "write",
    target: "src/a.ts",
    status: "succeeded",
  });
  const objectiveProof: ObjectiveProofAssessment = {
    pass: false,
    confidence: 0,
    proofs: [],
    missingRequirements: [
      {
        requirementId: "deliverable-path-2",
        description: "src/b.ts",
        kind: "deliverable",
        reason: "The second file was not changed.",
        nextAction: "Edit src/b.ts.",
      },
    ],
    nextActions: ["Edit src/b.ts."],
  };
  const result = independentlyVerifyTask({
    objective: ledger.objective,
    mode: "coding",
    ledger,
    verificationRequired: false,
    finalReviewPerformed: true,
    userWorkPreserved: true,
    objectiveProof,
  } as Parameters<typeof independentlyVerifyTask>[0]);

  expect(result.pass).toBe(false);
  expect(result.issues.map((issue) => issue.code)).toContain(
    "OBJECTIVE_PROOF_MISSING",
  );
});
