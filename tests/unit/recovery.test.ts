import { expect, test } from "bun:test";
import {
  createRecoveryContract,
  hasRepeatedRecoveryStrategy,
} from "../../src/agent/recovery.js";

test("recovery contracts preserve evidence and forbid identical retries", () => {
  const recovery = createRecoveryContract({
    id: "recovery-1",
    cause: "TEST_FAILED",
    failedRequirement: "focused regression passes",
    evidence: ["tests/session.test.ts: expected 200, received 401"],
    attemptedStrategies: ["run focused test"],
    forbiddenRepeats: ["run focused test"],
    proposedRecovery: "repair",
  });

  expect(recovery.proposedRecovery).toBe("repair");
  expect(recovery.evidence).toContain(
    "tests/session.test.ts: expected 200, received 401",
  );
  expect(hasRepeatedRecoveryStrategy(recovery, "run focused test")).toBe(true);
  expect(hasRepeatedRecoveryStrategy(recovery, "inspect implementation")).toBe(
    false,
  );
});
