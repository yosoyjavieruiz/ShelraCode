import { expect, test } from "bun:test";
import {
  classifyFailure,
  createRecoveryPolicy,
  createRecoveryContract,
  digestRecoveryValue,
  evaluateRecovery,
  hasRepeatedRecoveryStrategy,
  RecoveryLoopDetector,
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

test("classifies host failures without relying on provider prose", () => {
  expect(
    classifyFailure({ code: "MODEL_PROTOCOL_ERROR", source: "provider" }),
  ).toBe("PROTOCOL_PARSE_FAILURE");
  expect(classifyFailure({ code: "INVALID_ARGUMENT", source: "tool" })).toBe(
    "SCHEMA_FAILURE",
  );
  expect(classifyFailure({ code: "STALE_EDIT", source: "tool" })).toBe(
    "STALE_EDIT",
  );
  expect(classifyFailure({ code: "TEST_FAILED", source: "verification" })).toBe(
    "TEST_FAILURE",
  );
  expect(classifyFailure({ code: "PERMISSION_DENIED", source: "tool" })).toBe(
    "ILLEGAL_ACTION",
  );
  expect(
    classifyFailure({
      code: "PERMISSION_DENIED",
      source: "tool",
      message: "unauthorized staged action",
    }),
  ).toBe("ILLEGAL_ACTION");
  expect(
    classifyFailure({
      code: "NOT_FOUND",
      source: "tool",
      message: "File secret.ts not found",
    }),
  ).toBe("FILE_NOT_FOUND");
  expect(classifyFailure({ code: "OUTSIDE_WORKSPACE", source: "tool" })).toBe(
    "SECURITY_DENIAL",
  );
  expect(
    classifyFailure({
      source: "controller",
      code: "CONFLICT",
      message: "The model repeated the same tool call.",
    }),
  ).toBe("REPEATED_ACTION");
});

test("recovery digests are stable and do not expose raw arguments", () => {
  expect(digestRecoveryValue({ b: 2, a: 1 })).toBe(
    digestRecoveryValue({ a: 1, b: 2 }),
  );
  expect(digestRecoveryValue({ a: "secret-value" })).not.toContain(
    "secret-value",
  );
});

test("recovery contracts redact secret-shaped failure evidence", () => {
  const recovery = createRecoveryContract({
    cause: "COMMAND_FAILED",
    failedRequirement: "authorization: Bearer super-secret-value",
    evidence: ["token=super-secret-value"],
    proposedRecovery: "stop",
  });
  expect(recovery.failedRequirement).toContain("[REDACTED]");
  expect(recovery.evidence[0]).toBe("[REDACTED]");
  expect(JSON.stringify(recovery)).not.toContain("super-secret-value");
});

test("the loop detector stops repeated action/state/failure signatures", () => {
  const detector = new RecoveryLoopDetector(
    createRecoveryPolicy({
      id: "test-policy",
      maxAttemptsPerSignature: 2,
      maxAttemptsPerFailureClass: 3,
      maxTotalAttempts: 6,
    }),
  );
  const first = detector.observe({
    actionKind: "EditFile",
    normalizedArguments: { path: "src/value.ts" },
    stateDigest: "state-a",
    failureClass: "STALE_EDIT",
  });
  const second = detector.observe({
    actionKind: "EditFile",
    normalizedArguments: { path: "src/value.ts" },
    stateDigest: "state-a",
    failureClass: "STALE_EDIT",
  });
  expect(first.shouldStop).toBe(false);
  expect(second.shouldStop).toBe(true);
  expect(second.reason).toBe("REPEATED_ACTION");
  expect(second.repeatedSignatureCount).toBe(2);
  expect(detector.snapshot().observations).toHaveLength(2);
});

test("restores bounded recovery history and counters after a process restart", () => {
  const policy = createRecoveryPolicy({
    maxAttemptsPerSignature: 4,
    maxAttemptsPerFailureClass: 4,
    maxTotalAttempts: 2,
  });
  const detector = new RecoveryLoopDetector(policy);
  detector.observe({
    actionKind: "EditFile",
    normalizedArguments: { path: "src/value.ts" },
    stateDigest: "state-a",
    failureClass: "STALE_EDIT",
    strategy: "relocalize",
    createdAt: "2026-08-29T00:00:00.000Z",
  });
  const snapshot = detector.snapshot();

  expect(snapshot.totalObserved).toBe(1);
  expect(snapshot.recoveryAttempts).toBe(1);

  const restored = new RecoveryLoopDetector(policy, snapshot);
  const second = restored.observe({
    actionKind: "ReadFile",
    normalizedArguments: { path: "src/value.ts" },
    stateDigest: "state-b",
    failureClass: "FILE_NOT_FOUND",
    strategy: "relocalize",
    createdAt: "2026-08-29T00:00:01.000Z",
  });
  expect(second.totalObservations).toBe(2);
  expect(second.recoveryAttempts).toBe(2);
  expect(second.reason).toBe("POLICY_LIMIT");

  const afterBudget = restored.observe({
    actionKind: "ReadFile",
    normalizedArguments: { path: "src/other.ts" },
    stateDigest: "state-c",
    failureClass: "FILE_NOT_FOUND",
    strategy: "ask_expert",
    createdAt: "2026-08-29T00:00:02.000Z",
  });
  expect(afterBudget.totalObservations).toBe(3);
  expect(afterBudget.recoveryAttempts).toBe(3);
  expect(afterBudget.reason).toBe("POLICY_LIMIT");
});

test("a progress observation breaks the consecutive failure streak", () => {
  const detector = new RecoveryLoopDetector(
    createRecoveryPolicy({
      maxAttemptsPerSignature: 4,
      maxAttemptsPerFailureClass: 2,
      maxTotalAttempts: 6,
    }),
  );
  detector.observe({
    actionKind: "ReadFile",
    normalizedArguments: { path: "src/value.ts" },
    stateDigest: "state-a",
    failureClass: "FILE_NOT_FOUND",
  });
  detector.observe({
    actionKind: "SearchText",
    normalizedArguments: { query: "value" },
    stateDigest: "state-b",
    progress: true,
  });
  const afterProgress = detector.observe({
    actionKind: "ReadFile",
    normalizedArguments: { path: "src/value.ts" },
    stateDigest: "state-b",
    failureClass: "FILE_NOT_FOUND",
  });
  expect(afterProgress.consecutiveFailureCount).toBe(1);
  expect(afterProgress.shouldStop).toBe(false);
});

test("progress observations do not consume the recovery-attempt budget", () => {
  const detector = new RecoveryLoopDetector(
    createRecoveryPolicy({
      maxAttemptsPerSignature: 4,
      maxAttemptsPerFailureClass: 4,
      maxTotalAttempts: 2,
    }),
  );
  const first = detector.observe({
    actionKind: "ReadFile",
    normalizedArguments: { path: "src/one.ts" },
    stateDigest: "state-a",
    progress: true,
  });
  const second = detector.observe({
    actionKind: "ReadFile",
    normalizedArguments: { path: "src/two.ts" },
    stateDigest: "state-b",
    progress: true,
  });
  expect(first.recoveryAttempts).toBe(0);
  expect(second.recoveryAttempts).toBe(0);
  expect(second.shouldStop).toBe(false);
});

test("recovery evaluation changes strategy and never retries security failures", () => {
  const first = evaluateRecovery({
    failureClass: "STALE_EDIT",
    repeatedCount: 1,
    attemptedStrategies: [],
  });
  expect(first).toMatchObject({
    action: "relocalize",
    allowed: true,
    changedStrategy: false,
  });
  const changed = evaluateRecovery({
    failureClass: "STALE_EDIT",
    repeatedCount: 2,
    stateChanged: false,
    attemptedStrategies: ["relocalize"],
  });
  expect(changed).toMatchObject({
    action: "rollback",
    allowed: true,
    changedStrategy: true,
  });
  const missingHistory = evaluateRecovery({
    failureClass: "STALE_EDIT",
    repeatedCount: 2,
    stateChanged: false,
  });
  expect(missingHistory).toMatchObject({
    action: "stop",
    allowed: false,
    changedStrategy: false,
  });
  const blocked = evaluateRecovery({
    failureClass: "SECURITY_DENIAL",
    repeatedCount: 1,
  });
  expect(blocked).toMatchObject({
    action: "stop",
    allowed: false,
  });
  const exhausted = evaluateRecovery({
    failureClass: "PATCH_APPLY_FAILURE",
    repeatedCount: 2,
    stateChanged: false,
    attemptedStrategies: ["relocalize"],
    policy: createRecoveryPolicy({ strategyOrder: ["relocalize", "stop"] }),
  });
  expect(exhausted).toMatchObject({ action: "stop", allowed: false });
});

test("recovery policies remain bounded and always include a terminal action", () => {
  expect(() => createRecoveryPolicy({ strategyOrder: ["relocalize"] })).toThrow(
    "stop action",
  );
  expect(() => createRecoveryPolicy({ maxAttemptsPerSignature: 0 })).toThrow(
    "between 1 and 64",
  );
});
