import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectRepositorySnapshot } from "../../src/context/repository-snapshot.js";
import { loadScopedInstructions } from "../../src/context/instructions.js";

test("scoped instructions apply from the repository root to the target directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-instructions-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(
    path.join(root, "AGENTS.md"),
    "Root rule: use tests.\n",
    "utf8",
  );
  await writeFile(
    path.join(root, "src", "AGENTS.md"),
    "Source rule: preserve exports.\n",
    "utf8",
  );
  await writeFile(path.join(root, "src", "auth.ts"), "export {}\n", "utf8");

  const snapshot = await inspectRepositorySnapshot(root);
  const instructions = await loadScopedInstructions(
    root,
    snapshot.instructionFiles,
    ["src/auth.ts"],
  );

  expect(instructions.map((item) => item.path)).toEqual([
    "AGENTS.md",
    "src/AGENTS.md",
  ]);
  expect(instructions[0]?.content).toContain("use tests");
  expect(instructions[1]?.content).toContain("preserve exports");
});

test("nested instructions are not loaded when no target is in their scope", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-instructions-"));
  await mkdir(path.join(root, "docs"), { recursive: true });
  await writeFile(path.join(root, "AGENTS.md"), "Root rule\n", "utf8");
  await writeFile(
    path.join(root, "docs", "AGENTS.md"),
    "Docs-only rule\n",
    "utf8",
  );

  const snapshot = await inspectRepositorySnapshot(root);
  const instructions = await loadScopedInstructions(
    root,
    snapshot.instructionFiles,
    ["src/app.ts"],
  );

  expect(instructions.map((item) => item.path)).toEqual(["AGENTS.md"]);
});
