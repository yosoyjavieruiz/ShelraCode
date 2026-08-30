import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  buildSkillContext,
  discoverSkillMetadata,
  loadSkillBodies,
  selectRelevantSkills,
} from "../../src/instructions/skill-loader.js";

test("skill discovery returns bounded metadata without loading the body", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-skills-"));
  const skillDir = path.join(root, ".agents", "skills", "parser");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    [
      "---",
      "name: parser-workflow",
      "description: Debug parsers and their focused tests.",
      "---",
      "",
      "FULL_BODY_MUST_NOT_BE_IN_METADATA",
    ].join("\n"),
    "utf8",
  );

  const metadata = await discoverSkillMetadata(root);

  expect(metadata).toHaveLength(1);
  expect(metadata[0]?.name).toBe("parser-workflow");
  expect(metadata[0]?.description).toContain("Debug parsers");
  expect(JSON.stringify(metadata)).not.toContain(
    "FULL_BODY_MUST_NOT_BE_IN_METADATA",
  );
  expect(metadata[0]?.trust).toBe("project");
  expect(metadata[0]?.version).toBe("0");
  expect(metadata[0]?.evidence.pairedEvaluationId).toBeNull();
  expect(metadata[0]?.authority.mayWrite).toBe(false);
});

test("skill metadata carries bounded activation, compatibility, and evidence fields", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-skills-meta-"));
  const skillDir = path.join(root, ".agents", "skills", "parser");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    [
      "---",
      "name: parser-workflow",
      "description: Debug parsers and focused tests.",
      "version: 2.1.0",
      "taskTags: parser, debugging",
      "languages: typescript",
      "frameworks: vitest",
      "requiredCapabilities: repo.symbol",
      "minCapabilityLevel: C2",
      "driverProtocols: constrained_json, xml_system_tools",
      "pairedEvaluationId: pair-parser-1",
      "pairedDecision: auto_enable",
      "driverProfileId: driver-fixture",
      "driverIdentityDigest: identity-fixture",
      "mayWrite: false",
      "mayExecute: false",
      "mayNetwork: false",
      "---",
      "BODY_NOT_METADATA",
    ].join("\n"),
    "utf8",
  );

  const [entry] = await discoverSkillMetadata(root);

  expect(entry?.version).toBe("2.1.0");
  expect(entry?.activation.taskTags).toEqual(["debugging", "parser"]);
  expect(entry?.activation.languages).toEqual(["typescript"]);
  expect(entry?.activation.frameworks).toEqual(["vitest"]);
  expect(entry?.activation.requiredCapabilities).toEqual(["repo.symbol"]);
  expect(entry?.compatibility.minCapabilityLevel).toBe("C2");
  expect(entry?.compatibility.driverProtocols).toEqual([
    "constrained_json",
    "xml_system_tools",
  ]);
  expect(entry?.evidence.pairedEvaluationId).toBe("pair-parser-1");
  expect(entry?.evidence.decision).toBe("auto_enable");
  expect(entry?.authority.mayWrite).toBe(false);
  expect(JSON.stringify(entry)).not.toContain("BODY_NOT_METADATA");
});

test("only a matching skill body is loaded and it stays bounded", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-skills-"));
  const skills = [
    ["parser", "Debug parsers and focused tests", "PARSER_GUIDANCE"],
    ["deploy", "Deploy services to production", "DEPLOY_GUIDANCE"],
  ] as const;
  for (const [name, description, body] of skills) {
    const skillDir = path.join(root, ".agents", "skills", name);
    await mkdir(skillDir, { recursive: true });
    await writeFile(
      path.join(skillDir, "SKILL.md"),
      `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n${"x".repeat(20_000)}`,
      "utf8",
    );
  }

  const metadata = await discoverSkillMetadata(root);
  const selected = selectRelevantSkills(metadata, "Fix the parser tests");
  const loaded = await loadSkillBodies(root, selected, { maxChars: 1_024 });

  expect(selected.map((skill) => skill.name)).toEqual(["parser"]);
  expect(loaded).toHaveLength(1);
  expect(loaded[0]?.body).toContain("PARSER_GUIDANCE");
  expect(loaded[0]?.body).not.toContain("DEPLOY_GUIDANCE");
  expect(loaded[0]?.body.length).toBeLessThanOrEqual(1_024);
  expect(loaded[0]?.sourceId).toContain(".agents/skills/parser/SKILL.md");
});

test("combined Skill discovery is metadata-only unless body loading is explicit", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-skills-context-"),
  );
  const skillDir = path.join(root, ".agents", "skills", "parser");
  await mkdir(skillDir, { recursive: true });
  await writeFile(
    path.join(skillDir, "SKILL.md"),
    "---\nname: parser\ndescription: Debug parser tests\n---\n\nEXPLICIT_BODY_ONLY\n",
    "utf8",
  );

  const metadataOnly = await buildSkillContext(root, "debug parser tests");
  expect(metadataOnly.metadata).toHaveLength(1);
  expect(metadataOnly.loaded).toEqual([]);

  const explicit = await buildSkillContext(root, "debug parser tests", {
    loadBodies: true,
  });
  expect(explicit.loaded[0]?.body).toContain("EXPLICIT_BODY_ONLY");
});
