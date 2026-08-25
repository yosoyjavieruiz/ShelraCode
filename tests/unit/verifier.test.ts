import { expect, test } from "bun:test";
import {
  addTaskEvidence,
  createTaskLedger,
  recordTaskAction,
  recordVerificationRun,
} from "../../src/agent/task-state.js";
import { independentlyVerifyTask } from "../../src/agent/verifier.js";

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
