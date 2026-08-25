import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectRepositorySnapshot } from "../../src/context/repository-snapshot.js";

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
