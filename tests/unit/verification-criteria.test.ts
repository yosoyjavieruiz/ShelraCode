import { describe, expect, test } from "bun:test";
import {
  recordTaskAction,
  recordVerificationRun,
} from "../../src/agent/task-state.js";
import { verifyStructuralCodingCriteria } from "../../src/agent/verification-criteria.js";
import { createTaskLedger } from "../../src/agent/task-state.js";

function ledger() {
  return createTaskLedger({
    id: "criteria-test",
    objective: "Change the repository and verify it.",
    mode: "coding",
    successCriteria: [
      {
        id: "criterion-1",
        description: "A mutation is recorded.",
        required: true,
        satisfied: false,
      },
      {
        id: "criterion-2",
        description: "Verification passes.",
        required: true,
        satisfied: false,
      },
      {
        id: "criterion-3",
        description: "The final review passes.",
        required: true,
        satisfied: false,
      },
    ],
    verificationPlan: [{ stage: "test", command: "bun test" }],
  });
}

describe("structural coding criteria", () => {
  test("passes only after mutation, verification, review, and preservation", async () => {
    const taskLedger = ledger();
    recordTaskAction(taskLedger, {
      id: "write",
      kind: "write",
      target: "src/value.ts",
      status: "succeeded",
    });
    recordVerificationRun(taskLedger, {
      id: "test",
      stage: "test",
      command: "bun test",
      status: "passed",
      exitCode: 0,
      startedAt: new Date().toISOString(),
    });

    const result = await verifyStructuralCodingCriteria(taskLedger, {
      reviewFinalDiff: () => true,
      userWorkPreserved: () => true,
    });

    expect(result).toEqual({
      pass: true,
      satisfiedCriterionIds: ["criterion-1", "criterion-2", "criterion-3"],
      issues: [],
      nextPaths: [],
      nextActions: [],
    });
  });

  test("reports each missing host-owned condition", async () => {
    const result = await verifyStructuralCodingCriteria(ledger(), {
      reviewFinalDiff: () => false,
      userWorkPreserved: () => false,
    });

    expect(result.pass).toBe(false);
    expect(result.satisfiedCriterionIds).toEqual([]);
    expect(result.issues).toEqual([
      "No requested repository mutation is recorded.",
      "Configured project verification has not passed.",
      "The final diff review has not passed.",
      "Pre-existing user work is not preserved.",
    ]);
  });

  test("points recovery at the paths from the latest failed verification", async () => {
    const taskLedger = ledger();
    recordTaskAction(taskLedger, {
      id: "write",
      kind: "write",
      target: "src/value.ts",
      status: "succeeded",
    });
    recordVerificationRun(taskLedger, {
      id: "failed-test",
      stage: "test",
      command: "bun test",
      status: "failed",
      exitCode: 1,
      failurePaths: ["tests/value.test.ts"],
      startedAt: new Date().toISOString(),
    });

    const result = await verifyStructuralCodingCriteria(taskLedger, {
      reviewFinalDiff: () => true,
      userWorkPreserved: () => true,
    });

    expect(result.nextPaths).toEqual(["tests/value.test.ts"]);
    expect(result.nextActions?.[0]).toContain("tests/value.test.ts");
  });
});
