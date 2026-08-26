import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
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
