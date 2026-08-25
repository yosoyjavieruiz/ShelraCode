import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  gitStatusTool,
  listFilesTool,
  readFileTool,
  searchTextTool,
} from "../../src/tools/workspace.js";
import { ToolError, toolErrorCode } from "../../src/tools/errors.js";
import type { ToolExecutionContext } from "../../src/tools/types.js";

// Regression coverage for the exact failures reported against LocalCode's
// agent loop: `ListFiles` called on a SKILL.md file path (raw ENOTDIR) and
// `ReadFile` called with an invalid `maxChars`. Both must now surface a
// typed, model-correctable ToolError instead of an opaque filesystem
// message or a silently-ignored invalid argument.

async function fixtureContext(): Promise<{
  ctx: ToolExecutionContext;
  root: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-tool-errs-"));
  await mkdir(path.join(root, "skills", "harness"), { recursive: true });
  await writeFile(
    path.join(root, "skills", "harness", "SKILL.md"),
    "# harness\n",
    "utf8",
  );
  await writeFile(path.join(root, "package.json"), '{"name":"x"}\n', "utf8");
  return {
    root,
    ctx: { root, permissionMode: "PLAN", signal: new AbortController().signal },
  };
}

test("ListFiles on a file path throws PATH_IS_FILE, not a raw ENOTDIR", async () => {
  const { ctx } = await fixtureContext();
  const input = listFilesTool.validate({ path: "skills/harness/SKILL.md" });
  try {
    await listFilesTool.execute(input, ctx);
    throw new Error("expected listFilesTool.execute to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe("PATH_IS_FILE");
    expect((error as ToolError).message).toContain("ReadFile");
    expect((error as ToolError).message).not.toContain("ENOTDIR");
  }
});

test("ListFiles on a missing path throws PATH_NOT_FOUND, not a raw ENOENT", async () => {
  const { ctx } = await fixtureContext();
  const input = listFilesTool.validate({ path: "does/not/exist" });
  try {
    await listFilesTool.execute(input, ctx);
    throw new Error("expected listFilesTool.execute to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe("PATH_NOT_FOUND");
    expect((error as ToolError).message).not.toContain("ENOENT");
  }
});

test("ReadFile validate() rejects a non-positive maxChars with INVALID_ARGUMENT and a usable default hint", () => {
  expect(() =>
    readFileTool.validate({ path: "package.json", maxChars: 0 }),
  ).toThrow(ToolError);
  try {
    readFileTool.validate({ path: "package.json", maxChars: 0 });
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe("INVALID_ARGUMENT");
    expect((error as ToolError).message).toContain("20000");
  }
});

test("ReadFile keeps host truncation private while allowing bounded line ranges", async () => {
  const { ctx, root } = await fixtureContext();
  await writeFile(path.join(root, "lines.txt"), "one\ntwo\nthree\n", "utf8");

  expect(readFileTool.parameters.properties).not.toHaveProperty("maxChars");
  const result = await readFileTool.execute(
    readFileTool.validate({ path: "lines.txt", startLine: 2, endLine: 2 }),
    ctx,
  );

  expect(result.content).toBe("two");
});

test("ReadFile on a directory throws PATH_IS_DIRECTORY, not a raw EISDIR", async () => {
  const { ctx } = await fixtureContext();
  const input = readFileTool.validate({ path: "skills/harness" });
  try {
    await readFileTool.execute(input, ctx);
    throw new Error("expected readFileTool.execute to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe("PATH_IS_DIRECTORY");
    expect((error as ToolError).message).toContain("ListFiles");
  }
});

test("ReadFile still succeeds for a real file after the stat check", async () => {
  const { ctx } = await fixtureContext();
  const input = readFileTool.validate({ path: "package.json" });
  const result = await readFileTool.execute(input, ctx);
  expect(result.content).toContain('"name":"x"');
});

test("ReadFile rejects binary-looking content with typed evidence", async () => {
  const { ctx, root } = await fixtureContext();
  await writeFile(path.join(root, "image.bin"), Buffer.from([0, 1, 2, 3]));

  await expect(
    readFileTool.execute(readFileTool.validate({ path: "image.bin" }), ctx),
  ).rejects.toMatchObject({ code: "BINARY_FILE", recoverable: true });
});

test("typed tool errors carry recovery metadata across the complete taxonomy", () => {
  const error = new ToolError(
    "COMMAND_TIMEOUT",
    "The command exceeded its timeout.",
    {
      recoverable: true,
      suggestedAction: "Retry with a shorter focused command.",
    },
  );

  expect(error.code).toBe("COMMAND_TIMEOUT");
  expect(error.recoverable).toBe(true);
  expect(error.suggestedAction).toContain("focused");
  expect(toolErrorCode(error)).toBe("COMMAND_TIMEOUT");
});

test("workspace traversal is a typed OUTSIDE_WORKSPACE failure", async () => {
  const { ctx } = await fixtureContext();
  try {
    await readFileTool.execute(
      readFileTool.validate({ path: "../outside.txt" }),
      ctx,
    );
    throw new Error("expected workspace boundary failure");
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe("OUTSIDE_WORKSPACE");
    expect((error as ToolError).recoverable).toBe(false);
  }
});

test("SearchText rejects an invalid pattern before invoking ripgrep", () => {
  expect(() => searchTextTool.validate({ pattern: "[" })).toThrow(ToolError);
  try {
    searchTextTool.validate({ pattern: "[" });
  } catch (error) {
    expect((error as ToolError).code).toBe("INVALID_ARGUMENT");
  }
});

test("GitStatus turns a non-repository command failure into typed evidence", async () => {
  const { ctx } = await fixtureContext();
  await expect(gitStatusTool.execute({}, ctx)).rejects.toMatchObject({
    code: "COMMAND_FAILED",
  });
});
