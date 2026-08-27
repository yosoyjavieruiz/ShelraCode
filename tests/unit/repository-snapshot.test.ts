import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectRepositorySnapshot } from "../../src/context/repository-snapshot.js";
import { runCommand } from "../../src/shared/process.js";

test("repository snapshot detects manifests, languages, source/test roots, and scoped instructions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-snapshot-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "tests"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    '{"scripts":{"test":"bun test"}}\n',
    "utf8",
  );
  await writeFile(path.join(root, "tsconfig.json"), "{}\n", "utf8");
  await writeFile(
    path.join(root, "AGENTS.md"),
    "Use the fixture conventions.\n",
    "utf8",
  );
  await writeFile(
    path.join(root, "src", "app.ts"),
    "export const app = true;\n",
    "utf8",
  );
  await writeFile(
    path.join(root, "tests", "app.test.ts"),
    "export {};\n",
    "utf8",
  );

  const snapshot = await inspectRepositorySnapshot(root);

  expect(snapshot.cwd).toBe(root);
  expect(snapshot.topLevelEntries).toEqual(
    expect.arrayContaining(["package.json", "tsconfig.json", "src", "tests"]),
  );
  expect(snapshot.manifests.map((manifest) => manifest.path)).toEqual(
    expect.arrayContaining(["package.json", "tsconfig.json"]),
  );
  expect(snapshot.languages[0]?.language).toBe("TypeScript");
  expect(snapshot.sourceRoots).toContain("src");
  expect(snapshot.testRoots).toContain("tests");
  expect(snapshot.instructionFiles[0]?.path).toBe("AGENTS.md");
});

test("repository snapshot fingerprints staged, unstaged and untracked content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-snapshot-git-"));
  const git = async (...args: string[]): Promise<void> => {
    const result = await runCommand("git", args, {
      cwd: root,
      intent: "execute",
      network: "deny",
      isolation: "best_effort",
      allowWeakIsolation: true,
      timeoutMs: 10_000,
    });
    if (result.exitCode !== 0)
      throw new Error(result.stderr || result.stdout || args.join(" "));
  };

  await writeFile(path.join(root, "app.ts"), "export const value = 1;\n");
  await git("init", "-q");
  await git("config", "user.name", "Shelra snapshot test");
  await git("config", "user.email", "snapshot@shelra.invalid");
  await git("add", ".");
  await git("commit", "-qm", "snapshot baseline");

  const clean = await inspectRepositorySnapshot(root);
  expect(clean.workingTreeRevision).toBeTruthy();

  await writeFile(path.join(root, "app.ts"), "export const value = 2;\n");
  const unstaged = await inspectRepositorySnapshot(root);
  expect(unstaged.workingTreeRevision).not.toBe(clean.workingTreeRevision);
  expect(unstaged.workingTreePaths).toContain("app.ts");

  await git("add", "app.ts");
  const staged = await inspectRepositorySnapshot(root);
  expect(staged.workingTreeRevision).not.toBe(unstaged.workingTreeRevision);

  await writeFile(path.join(root, "notes.txt"), "first\n");
  const untracked = await inspectRepositorySnapshot(root);
  expect(untracked.workingTreeRevision).not.toBe(staged.workingTreeRevision);
  expect(untracked.workingTreePaths).toEqual(
    expect.arrayContaining(["app.ts", "notes.txt"]),
  );
  await writeFile(path.join(root, "notes.txt"), "second\n");
  const untrackedChanged = await inspectRepositorySnapshot(root);
  expect(untrackedChanged.workingTreeRevision).not.toBe(
    untracked.workingTreeRevision,
  );
});
