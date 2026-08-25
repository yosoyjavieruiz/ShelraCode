import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { globFilesTool } from "../../src/tools/workspace.js";
import type { ToolExecutionContext } from "../../src/tools/types.js";

async function fixture(): Promise<ToolExecutionContext> {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-glob-"));
  await mkdir(path.join(root, "src", "auth"), { recursive: true });
  await writeFile(
    path.join(root, "src", "auth", "session.ts"),
    "export {}\n",
    "utf8",
  );
  await writeFile(
    path.join(root, "src", "auth", "session.test.ts"),
    "export {}\n",
    "utf8",
  );
  await writeFile(path.join(root, "README.md"), "# fixture\n", "utf8");
  return {
    root,
    permissionMode: "PLAN",
    signal: new AbortController().signal,
  };
}

test("GlobFiles finds bounded filename matches without reading file contents", async () => {
  const ctx = await fixture();
  const result = await globFilesTool.execute(
    globFilesTool.validate({ pattern: "src/**/*.ts" }),
    ctx,
  );

  expect(result.files).toEqual(
    expect.arrayContaining(["src/auth/session.ts", "src/auth/session.test.ts"]),
  );
  expect(result.files).not.toContain("README.md");
});

test("GlobFiles rejects a blank pattern with a typed argument error", () => {
  expect(() => globFilesTool.validate({ pattern: "" })).toThrow(/non-empty/i);
});
