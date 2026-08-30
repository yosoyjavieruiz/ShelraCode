import { expect, test } from "bun:test";
import {
  CapabilityRegistry,
  type DynamicCapability,
} from "../../src/agent/dynamic-capabilities.js";
import { runPairedCapabilityEvaluation } from "../../src/evals/paired-capability.js";
import type { SkillMetadata } from "../../src/instructions/skill-loader.js";
import {
  createExactModelIdentity,
  createUncalibratedDriverProfile,
  exactModelIdentityDigest,
  type ModelDriverProfile,
} from "../../src/driver/profile.js";

function profile(): ModelDriverProfile {
  const identity = createExactModelIdentity({
    providerFamily: "fixture",
    modelId: "fixture-model",
    runtime: "fixture-runtime",
    endpointProtocol: "openai-compatible",
    contextConfiguration: { context: 8_192 },
    samplingConfiguration: { temperature: 0 },
    operatingSystem: "test",
    createdAt: "2026-08-29T00:00:00.000Z",
  });
  const base = createUncalibratedDriverProfile(identity);
  return {
    ...base,
    status: "certified",
    capabilityLevel: "C2",
    protocol: "constrained_json",
    editCodec: "structured_patch",
    writeAuthority: "bounded",
    networkAuthority: "none",
    benchmarkEvidence: [{ id: "fixture-evidence" }],
  };
}

function skill(overrides: Partial<DynamicCapability> = {}): DynamicCapability {
  return {
    id: "skill:parser",
    version: "1.0.0",
    kind: "skill",
    description: "Parser-focused workflow",
    activation: {
      taskTags: ["parser"],
      languages: ["typescript"],
      frameworks: [],
      requiredCapabilities: [],
    },
    compatibility: {
      minCapabilityLevel: "C1",
      driverProtocols: ["constrained_json"],
    },
    evidence: {
      pairedEvaluationId: null,
      decision: null,
      driverProfileId: null,
      driverIdentityDigest: null,
      configurationDigest: null,
      evaluatedAt: null,
    },
    authority: { mayWrite: false, mayExecute: false, mayNetwork: false },
    ...overrides,
  };
}

function skillMetadata(capability: DynamicCapability): SkillMetadata {
  return {
    id: capability.id,
    name: capability.id,
    description: capability.description,
    version: capability.version,
    path: ".agents/skills/parser/SKILL.md",
    sourceId: ".agents/skills/parser/SKILL.md",
    scope: ".",
    trust: "project",
    precedence: 1,
    keywords: ["parser"],
    activation: capability.activation,
    compatibility: capability.compatibility,
    evidence: capability.evidence,
    authority: capability.authority,
  };
}

function pairedReport(
  current: ModelDriverProfile,
  options: {
    evaluationId?: string;
    capabilityId?: string;
    offSuccess?: boolean;
    onSuccess?: boolean;
    offActions?: number;
    onActions?: number;
  } = {},
) {
  const evaluationId = options.evaluationId ?? "pair-fixture";
  const capabilityId = options.capabilityId ?? "skill:parser";
  const makeTrial = (success: boolean, trialId: string, actions: number) => ({
    taskId: "task-a",
    trialId,
    driverProfileId: current.id,
    driverIdentityDigest: current.identityDigest,
    configurationDigest: "configuration-digest",
    success,
    falseSuccess: false,
    actions,
    inputTokens: success ? 700 : 800,
    outputTokens: success ? 180 : 200,
    wallTimeMs: success ? 900 : 1_000,
    interventions: 0,
    loops: 0,
    securityFailures: 0,
  });
  return runPairedCapabilityEvaluation({
    evaluationId,
    capabilityId,
    profile: { id: current.id, identityDigest: current.identityDigest },
    off: [
      makeTrial(
        options.offSuccess ?? false,
        "attempt-1",
        options.offActions ?? 4,
      ),
      makeTrial(
        options.offSuccess ?? false,
        "attempt-2",
        options.offActions ?? 4,
      ),
    ],
    on: [
      makeTrial(options.onSuccess ?? true, "attempt-1", options.onActions ?? 3),
      makeTrial(options.onSuccess ?? true, "attempt-2", options.onActions ?? 3),
    ],
  });
}

test("auto activation stays inactive until positive paired evidence matches the exact Driver", () => {
  const current = profile();
  const registry = new CapabilityRegistry([skill()]);

  const missingEvidence = registry.resolve("skill:parser", {
    mode: "auto",
    profile: current,
    task: { tags: ["parser"], languages: ["typescript"] },
  });
  expect(missingEvidence.active).toBe(false);
  expect(missingEvidence.reasonCode).toBe("missing_paired_evidence");

  registry.recordPairedEvaluation(
    pairedReport(current, { evaluationId: "pair-parser-1" }),
  );

  const active = registry.resolve("skill:parser", {
    mode: "auto",
    profile: current,
    configurationDigest: "configuration-digest",
    task: { tags: ["parser"], languages: ["typescript"] },
  });
  expect(active.active).toBe(true);
  expect(active.reasonCode).toBe("paired_evidence_verified");

  const changedIdentity = { ...current.identity, runtime: "different-runtime" };
  const changedDriver = {
    ...current,
    identity: changedIdentity,
    identityDigest: exactModelIdentityDigest(changedIdentity),
  };
  const mismatched = registry.resolve("skill:parser", {
    mode: "auto",
    profile: changedDriver,
    configurationDigest: "configuration-digest",
    task: { tags: ["parser"], languages: ["typescript"] },
  });
  expect(mismatched.active).toBe(false);
  expect(mismatched.reasonCode).toBe("driver_profile_mismatch");
});

test("disabled and non-beneficial Skills remain inactive without breaking registry resolution", () => {
  const current = profile();
  const registry = new CapabilityRegistry([skill()]);
  registry.recordPairedEvaluation(
    pairedReport(current, {
      evaluationId: "pair-no-gain",
      offSuccess: true,
      onSuccess: true,
      offActions: 4,
      onActions: 4,
    }),
  );

  const disabled = registry.resolve("skill:parser", {
    mode: "disabled",
    profile: current,
    task: { tags: ["parser"], languages: ["typescript"] },
  });
  expect(disabled.active).toBe(false);
  expect(disabled.reasonCode).toBe("disabled_by_policy");

  const optInOnly = registry.resolve("skill:parser", {
    mode: "auto",
    profile: current,
    configurationDigest: "configuration-digest",
    task: { tags: ["parser"], languages: ["typescript"] },
  });
  expect(optInOnly.active).toBe(false);
  expect(optInOnly.reasonCode).toBe("paired_evaluation_not_positive");

  expect(registry.list()).toHaveLength(1);
});

test("activation cannot grant write, execute, or network authority beyond the certified profile", () => {
  const current = profile();
  const registry = new CapabilityRegistry([
    skill({
      authority: { mayWrite: true, mayExecute: true, mayNetwork: true },
    }),
  ]);

  const decision = registry.resolve("skill:parser", {
    mode: "auto",
    profile: current,
    configurationDigest: "configuration-digest",
    task: { tags: ["parser"], languages: ["typescript"] },
  });
  expect(decision.active).toBe(false);
  expect(decision.reasonCode).toBe("authority_exceeds_profile");
});

test("auto evidence without an exact configuration digest remains inactive", () => {
  const current = profile();
  const registry = new CapabilityRegistry([skill()]);

  const decision = registry.resolve("skill:parser", {
    mode: "auto",
    profile: current,
    configurationDigest: "configuration-digest",
    task: { tags: ["parser"], languages: ["typescript"] },
  });
  expect(decision.active).toBe(false);
  expect(decision.reasonCode).toBe("missing_paired_evidence");
});

test("a tampered certified profile cannot borrow paired evidence", () => {
  const current = profile();
  const registry = new CapabilityRegistry([skill()]);
  const tampered = {
    ...current,
    identity: { ...current.identity, runtime: "different-runtime" },
  };

  const decision = registry.resolve("skill:parser", {
    mode: "auto",
    profile: tampered,
    task: { tags: ["parser"], languages: ["typescript"] },
  });
  expect(decision.active).toBe(false);
  expect(decision.reasonCode).toBe("profile_identity_invalid");
});

test("repository-authored Skill evidence cannot grant automatic activation", () => {
  const current = profile();
  const claimed = skill({
    evidence: {
      pairedEvaluationId: "forged-pair",
      decision: "auto_enable",
      driverProfileId: current.id,
      driverIdentityDigest: current.identityDigest,
      configurationDigest: "configuration-digest",
      evaluatedAt: "2026-08-29T01:00:00.000Z",
    },
  });
  const registry = new CapabilityRegistry();
  registry.registerSkill(skillMetadata(claimed));

  const decision = registry.resolve("skill:parser", {
    mode: "auto",
    profile: current,
    configurationDigest: "configuration-digest",
    task: { tags: ["parser"], languages: ["typescript"] },
  });
  expect(decision.active).toBe(false);
  expect(decision.reasonCode).toBe("missing_paired_evidence");
});

test("registry registration rejects preloaded activation evidence", () => {
  const current = profile();
  expect(
    () =>
      new CapabilityRegistry([
        skill({
          evidence: {
            pairedEvaluationId: "forged-pair",
            decision: "auto_enable",
            driverProfileId: current.id,
            driverIdentityDigest: current.identityDigest,
            configurationDigest: "configuration-digest",
            evaluatedAt: "2026-08-29T01:00:00.000Z",
          },
        }),
      ]),
  ).toThrow("recordPairedEvaluation");
});

test("automatic activation rejects paired evidence for a different current configuration", () => {
  const current = profile();
  const registry = new CapabilityRegistry([skill()]);
  registry.recordPairedEvaluation(
    pairedReport(current, { evaluationId: "pair-config" }),
  );

  const decision = registry.resolve("skill:parser", {
    mode: "auto",
    profile: current,
    configurationDigest: "different-configuration",
    task: { tags: ["parser"], languages: ["typescript"] },
  });
  expect(decision.active).toBe(false);
  expect(decision.reasonCode).toBe("configuration_mismatch");
});

test("registry can promote only the evidence produced by a valid paired report", () => {
  const current = profile();
  const registry = new CapabilityRegistry([skill()]);
  const report = runPairedCapabilityEvaluation({
    evaluationId: "pair-registry",
    capabilityId: "skill:parser",
    profile: {
      id: current.id,
      identityDigest: current.identityDigest,
    },
    off: [
      {
        taskId: "task-a",
        trialId: "attempt-1",
        driverProfileId: current.id,
        driverIdentityDigest: current.identityDigest,
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
      },
      {
        taskId: "task-a",
        trialId: "attempt-2",
        driverProfileId: current.id,
        driverIdentityDigest: current.identityDigest,
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
      },
    ],
    on: [
      {
        taskId: "task-a",
        trialId: "attempt-1",
        driverProfileId: current.id,
        driverIdentityDigest: current.identityDigest,
        configurationDigest: "configuration-digest",
        success: true,
        falseSuccess: false,
        actions: 3,
        inputTokens: 700,
        outputTokens: 180,
        wallTimeMs: 900,
        interventions: 0,
        loops: 0,
        securityFailures: 0,
      },
      {
        taskId: "task-a",
        trialId: "attempt-2",
        driverProfileId: current.id,
        driverIdentityDigest: current.identityDigest,
        configurationDigest: "configuration-digest",
        success: true,
        falseSuccess: false,
        actions: 3,
        inputTokens: 700,
        outputTokens: 180,
        wallTimeMs: 900,
        interventions: 0,
        loops: 0,
        securityFailures: 0,
      },
    ],
  });

  registry.recordPairedEvaluation(report);
  expect(
    registry.resolve("skill:parser", {
      mode: "auto",
      profile: current,
      configurationDigest: "configuration-digest",
      task: { tags: ["parser"], languages: ["typescript"] },
    }).active,
  ).toBe(true);
});

test("registry rejects a paired report whose evidence digest was tampered", () => {
  const current = profile();
  const registry = new CapabilityRegistry([skill()]);
  const report = runPairedCapabilityEvaluation({
    evaluationId: "pair-registry-tamper",
    capabilityId: "skill:parser",
    profile: {
      id: current.id,
      identityDigest: current.identityDigest,
    },
    off: [
      {
        taskId: "task-a",
        trialId: "attempt-1",
        driverProfileId: current.id,
        driverIdentityDigest: current.identityDigest,
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
      },
      {
        taskId: "task-a",
        trialId: "attempt-2",
        driverProfileId: current.id,
        driverIdentityDigest: current.identityDigest,
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
      },
    ],
    on: [
      {
        taskId: "task-a",
        trialId: "attempt-1",
        driverProfileId: current.id,
        driverIdentityDigest: current.identityDigest,
        configurationDigest: "configuration-digest",
        success: true,
        falseSuccess: false,
        actions: 3,
        inputTokens: 700,
        outputTokens: 180,
        wallTimeMs: 900,
        interventions: 0,
        loops: 0,
        securityFailures: 0,
      },
      {
        taskId: "task-a",
        trialId: "attempt-2",
        driverProfileId: current.id,
        driverIdentityDigest: current.identityDigest,
        configurationDigest: "configuration-digest",
        success: true,
        falseSuccess: false,
        actions: 3,
        inputTokens: 700,
        outputTokens: 180,
        wallTimeMs: 900,
        interventions: 0,
        loops: 0,
        securityFailures: 0,
      },
    ],
  });

  expect(() =>
    registry.recordPairedEvaluation({
      ...report,
      reasons: [...report.reasons, "forged"],
    }),
  ).toThrow("digest");
});
