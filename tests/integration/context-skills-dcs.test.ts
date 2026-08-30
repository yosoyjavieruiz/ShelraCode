import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runPairedCapabilityEvaluation } from "../../src/evals/paired-capability.js";
import { buildRepositoryContext } from "../../src/context/repository.js";
import {
  createExactModelIdentity,
  createUncalibratedDriverProfile,
} from "../../src/driver/profile.js";

test("repository context exposes Skill metadata but does not auto-load a matching body", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shelra-context-skills-"));
  await mkdir(path.join(root, ".agents", "skills", "parser"), {
    recursive: true,
  });
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(
    path.join(root, ".agents", "skills", "parser", "SKILL.md"),
    [
      "---",
      "name: parser-workflow",
      "description: Debug parser implementation and tests.",
      "---",
      "",
      "MATCHING_SKILL_BODY_MUST_NOT_BE_AUTOLOADED",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(root, "src", "index.ts"),
    "export const parser = true;\n",
    "utf8",
  );

  const context = await buildRepositoryContext({
    root,
    objective: "Debug parser implementation",
  });

  expect(context.skillMetadata?.map((skill) => skill.name)).toEqual([
    "parser-workflow",
  ]);
  expect(context.selectedSkills).toEqual([]);
  expect(context.prompt).toContain("parser-workflow");
  expect(context.prompt).not.toContain(
    "MATCHING_SKILL_BODY_MUST_NOT_BE_AUTOLOADED",
  );
  expect(context.skillActivationDecisions?.[0]?.reasonCode).toBe(
    "disabled_by_policy",
  );
});

test("repository context loads a Skill only after a host-owned paired report", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shelra-context-dcs-"));
  await mkdir(path.join(root, ".agents", "skills", "parser"), {
    recursive: true,
  });
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(
    path.join(root, ".agents", "skills", "parser", "SKILL.md"),
    [
      "---",
      "name: parser-workflow",
      "description: Debug parser implementation and tests.",
      "taskTags: parser",
      "languages: typescript",
      "minCapabilityLevel: C1",
      "driverProtocols: constrained_json",
      "---",
      "",
      "HOST_APPROVED_SKILL_BODY",
    ].join("\n"),
    "utf8",
  );
  await writeFile(
    path.join(root, "src", "index.ts"),
    "export const parser = true;\n",
    "utf8",
  );

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
  const profile = {
    ...base,
    status: "certified" as const,
    capabilityLevel: "C2" as const,
    protocol: "constrained_json" as const,
    editCodec: "structured_patch" as const,
    writeAuthority: "bounded" as const,
  };
  const report = runPairedCapabilityEvaluation({
    evaluationId: "pair-context-parser",
    capabilityId: "skill:.agents/skills/parser/SKILL.md",
    profile: { id: profile.id, identityDigest: profile.identityDigest },
    off: [
      {
        taskId: "task-a",
        trialId: "attempt-1",
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
      },
      {
        taskId: "task-a",
        trialId: "attempt-2",
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
      },
    ],
    on: [
      {
        taskId: "task-a",
        trialId: "attempt-1",
        driverProfileId: profile.id,
        driverIdentityDigest: profile.identityDigest,
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
        driverProfileId: profile.id,
        driverIdentityDigest: profile.identityDigest,
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

  const context = await buildRepositoryContext({
    root,
    objective: "Debug parser implementation",
    skillActivation: "auto",
    skillProfile: profile,
    skillConfigurationDigest: "configuration-digest",
    skillTask: { tags: ["parser"], languages: ["typescript"] },
    skillEvaluations: [report],
  });

  expect(context.skillActivationDecisions?.[0]?.active).toBe(true);
  expect(context.selectedSkills?.[0]?.body).toContain(
    "HOST_APPROVED_SKILL_BODY",
  );
});
