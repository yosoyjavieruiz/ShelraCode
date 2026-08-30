import { expect, test } from "bun:test";
import {
  runPairedCapabilityEvaluation,
  type CapabilityTrialResult,
} from "../../src/evals/paired-capability.js";

const profile = {
  id: "driver-fixture",
  identityDigest: "driver-identity-digest",
};

function trial(
  taskId: string,
  trialId = "attempt-1",
  values: Partial<CapabilityTrialResult> = {},
): CapabilityTrialResult {
  return {
    taskId,
    trialId,
    driverProfileId: profile.id,
    driverIdentityDigest: profile.identityDigest,
    configurationDigest: "configuration-digest",
    success: false,
    falseSuccess: false,
    actions: 4,
    inputTokens: 800,
    outputTokens: 200,
    wallTimeMs: 1_000,
    interventions: 0,
    loops: 0,
    securityFailures: 0,
    ...values,
  };
}

test("paired evaluation recommends auto activation only for a verified same-profile gain", () => {
  const report = runPairedCapabilityEvaluation({
    evaluationId: "pair-parser-1",
    capabilityId: "skill:parser",
    profile,
    off: [
      trial("task-a", "attempt-1", { success: false }),
      trial("task-a", "attempt-2", { success: false }),
      trial("task-b", "attempt-1", { success: true }),
      trial("task-b", "attempt-2", { success: true }),
    ],
    on: [
      trial("task-a", "attempt-1", { success: true, actions: 3 }),
      trial("task-a", "attempt-2", { success: true, actions: 3 }),
      trial("task-b", "attempt-1", { success: true, actions: 3 }),
      trial("task-b", "attempt-2", { success: true, actions: 3 }),
    ],
  });

  expect(report.valid).toBe(true);
  expect(report.beneficial).toBe(true);
  expect(report.automaticActivation).toBe(true);
  expect(report.decision).toBe("auto_enable");
  expect(report.off.taskCount).toBe(2);
  expect(report.on.successRate).toBe(1);
});

test("a non-beneficial Skill produces evidence but remains inactive", () => {
  const report = runPairedCapabilityEvaluation({
    evaluationId: "pair-no-gain",
    capabilityId: "skill:parser",
    profile,
    off: [
      trial("task-a", "attempt-1", { success: true }),
      trial("task-a", "attempt-2", { success: true }),
    ],
    on: [
      trial("task-a", "attempt-1", { success: true }),
      trial("task-a", "attempt-2", { success: true }),
    ],
  });

  expect(report.valid).toBe(true);
  expect(report.beneficial).toBe(false);
  expect(report.automaticActivation).toBe(false);
  expect(report.decision).toBe("opt_in_only");
});

test("mismatched task or Driver provenance cannot produce automatic activation", () => {
  const report = runPairedCapabilityEvaluation({
    evaluationId: "pair-invalid",
    capabilityId: "skill:parser",
    profile,
    off: [trial("task-a", "attempt-1", { success: false })],
    on: [
      trial("task-b", "attempt-1", {
        success: true,
        driverIdentityDigest: "different-driver",
      }),
    ],
  });

  expect(report.valid).toBe(false);
  expect(report.automaticActivation).toBe(false);
  expect(report.decision).toBe("revise");
  expect(report.reasons.join(" ")).toContain("same task set");
});

test("security regressions block automatic activation even when success improves", () => {
  const report = runPairedCapabilityEvaluation({
    evaluationId: "pair-security-regression",
    capabilityId: "skill:parser",
    profile,
    off: [
      trial("task-a", "attempt-1", { success: false }),
      trial("task-a", "attempt-2", { success: false }),
    ],
    on: [
      trial("task-a", "attempt-1", { success: true, securityFailures: 1 }),
      trial("task-a", "attempt-2", { success: true, securityFailures: 1 }),
    ],
  });

  expect(report.valid).toBe(true);
  expect(report.beneficial).toBe(false);
  expect(report.automaticActivation).toBe(false);
  expect(report.decision).toBe("revise");
  expect(report.reasons.join(" ")).toContain("security");
});

test("missing optional metrics cannot manufacture an efficiency gain", () => {
  const report = runPairedCapabilityEvaluation({
    evaluationId: "pair-missing-metrics",
    capabilityId: "skill:parser",
    profile,
    off: [
      trial("task-a", "attempt-1", { success: true, wallTimeMs: 1_000 }),
      trial("task-a", "attempt-2", { success: true, wallTimeMs: 1_000 }),
    ],
    on: [
      trial("task-a", "attempt-1", { success: true, wallTimeMs: undefined }),
      trial("task-a", "attempt-2", { success: true, wallTimeMs: undefined }),
    ],
  });

  expect(report.valid).toBe(true);
  expect(report.beneficial).toBe(false);
  expect(report.automaticActivation).toBe(false);
  expect(report.decision).toBe("opt_in_only");
  expect(report.reasons.join(" ")).toContain("metric coverage");
});

test("one trial per task is insufficient for automatic activation by default", () => {
  const report = runPairedCapabilityEvaluation({
    evaluationId: "pair-single-trial",
    capabilityId: "skill:parser",
    profile,
    off: [trial("task-a", "attempt-1", { success: false })],
    on: [trial("task-a", "attempt-1", { success: true })],
  });

  expect(report.valid).toBe(true);
  expect(report.sampleSufficient).toBe(false);
  expect(report.automaticActivation).toBe(false);
  expect(report.reasons.join(" ")).toContain("repeated trials");
});
