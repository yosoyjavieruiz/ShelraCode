import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listRepositoryFiles } from "../../src/context/repository.js";

test("repository file discovery returns safe context-picker candidates", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-context-picker-"),
  );
  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(path.join(root, "package.json"), "{}", "utf8");
    await writeFile(path.join(root, "src", "index.ts"), "export {};", "utf8");
    await writeFile(path.join(root, ".env"), "SECRET=never-show-this", "utf8");

    const files = await listRepositoryFiles(root);

    expect(files).toContain("package.json");
    expect(files).toContain("src/index.ts");
    expect(files).not.toContain(".env");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
