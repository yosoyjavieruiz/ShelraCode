import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { searchTextTool, listFilesTool } from "../../src/tools/workspace.js";
import type { ToolExecutionContext } from "../../src/tools/types.js";

async function fixtureContext(): Promise<ToolExecutionContext> {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-search-"));
  await mkdir(path.join(root, "src"));
  await writeFile(
    path.join(root, "src", "session.ts"),
    "export function createSession() {\n  return { id: 1 };\n}\n",
    "utf8",
  );
  await writeFile(path.join(root, "README.md"), "# fixture\n", "utf8");
  return {
    root,
    permissionMode: "EDIT",
    signal: new AbortController().signal,
  };
}

test("SearchText finds a matching line even without a system ripgrep binary", async () => {
  const ctx = await fixtureContext();
  const result = await searchTextTool.execute(
    searchTextTool.validate({ pattern: "createSession" }),
    ctx,
  );
  expect(result.matches.length).toBeGreaterThan(0);
  expect(
    result.matches.some((match) => match.path.includes("session.ts")),
  ).toBe(true);
  expect(
    result.matches.some((match) => match.preview.includes("createSession")),
  ).toBe(true);
});

test("SearchText returns no matches for a pattern that isn't present", async () => {
  const ctx = await fixtureContext();
  const result = await searchTextTool.execute(
    searchTextTool.validate({ pattern: "definitelyNotPresentXYZ" }),
    ctx,
  );
  expect(result.matches).toEqual([]);
});

test("SearchText accepts the canonical query and glob fields", async () => {
  const ctx = await fixtureContext();
  const input = searchTextTool.validate({
    query: "createSession",
    glob: "src/**/*.ts",
  });
  const result = await searchTextTool.execute(input, ctx);

  expect(result.matches).toHaveLength(1);
  expect(result.matches[0]?.path).toBe("src/session.ts");
  expect(result.matches[0]?.line).toBe(1);
  expect(result.matches[0]?.column).toBeGreaterThan(0);
});

test("ListFiles still lists workspace files without a system ripgrep binary", async () => {
  const ctx = await fixtureContext();
  const result = await listFilesTool.execute(
    listFilesTool.validate(undefined),
    ctx,
  );
  expect(result.files).toContain("src/session.ts");
  expect(result.files).toContain("README.md");
});
