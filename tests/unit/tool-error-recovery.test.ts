import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createFileTool,
  deleteFileTool,
  gitStatusTool,
  editFileTool,
  listFilesTool,
  readFileTool,
  searchTextTool,
} from "../../src/tools/workspace.js";
import { ToolError, toolErrorCode } from "../../src/tools/errors.js";
import type { ToolExecutionContext } from "../../src/tools/types.js";
import { CheckpointService } from "../../src/checkpoint/checkpoint.js";
import { LocalCodeDatabase } from "../../src/storage/database.js";

// Regression coverage for the exact failures reported against ShelraCode's
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

test("ReadFile on a missing path throws PATH_NOT_FOUND, not a raw ENOENT", async () => {
  const { ctx } = await fixtureContext();
  const input = readFileTool.validate({ path: "does/not/exist.txt" });
  try {
    await readFileTool.execute(input, ctx);
    throw new Error("expected readFileTool.execute to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe("PATH_NOT_FOUND");
    expect((error as ToolError).message).not.toContain("ENOENT");
    expect((error as ToolError).suggestedAction).toContain("parent");
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

test("EditFile rejects a no-op replacement before it can consume a mutation turn", () => {
  expect(() =>
    editFileTool.validate({
      path: "package.json",
      oldText: '"name":"x"',
      newText: '"name":"x"',
    }),
  ).toThrow(ToolError);
  try {
    editFileTool.validate({
      path: "package.json",
      oldText: '"name":"x"',
      newText: '"name":"x"',
    });
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe("INVALID_ARGUMENT");
    expect((error as ToolError).field).toBe("newText");
    expect((error as ToolError).suggestedAction).toContain("different");
  }
});

test("EditFile exposes bounded non-sensitive current content after a stale exact edit", async () => {
  const { ctx, root } = await fixtureContext();
  await writeFile(
    path.join(root, "value.ts"),
    "export const value = 1;\n",
    "utf8",
  );
  const db = new LocalCodeDatabase(":memory:");
  const checkpoint = new CheckpointService(db, root);
  const checkpointId = await checkpoint.create("edit-recovery", ["value.ts"]);
  const input = editFileTool.validate({
    path: "value.ts",
    oldText: "export const value = 999;",
    newText: "export const value = 2;",
  });
  try {
    await editFileTool.execute(input, {
      ...ctx,
      permissionMode: "AUTO",
      checkpoint,
      checkpointId,
    });
    throw new Error("expected editFileTool.execute to reject");
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe("NOT_FOUND");
    expect((error as ToolError).details?.currentContentPreview).toBe(
      "export const value = 1;\n",
    );
    expect((error as ToolError).suggestedAction).toContain(
      "currentContentPreview",
    );
  } finally {
    db.close();
  }
});

test("EditFile reports a typed missing-path error instead of creating a guessed file", async () => {
  const { ctx, root } = await fixtureContext();
  const db = new LocalCodeDatabase(":memory:");
  const checkpoint = new CheckpointService(db, root);
  const checkpointId = await checkpoint.create("missing-edit", ["missing.ts"]);
  await expect(
    editFileTool.execute(
      editFileTool.validate({
        path: "missing.ts",
        oldText: "before",
        newText: "after",
      }),
      { ...ctx, permissionMode: "AUTO", checkpoint, checkpointId },
    ),
  ).rejects.toMatchObject({
    code: "PATH_NOT_FOUND",
    path: "missing.ts",
  });
  expect(await Bun.file(path.join(root, "missing.ts")).exists()).toBe(false);
  db.close();
});

test("WriteFile exposes whether it created or overwrote and includes a bounded diff", async () => {
  const { ctx, root } = await fixtureContext();
  await writeFile(path.join(root, "value.ts"), "const value = 1;\n", "utf8");
  const db = new LocalCodeDatabase(":memory:");
  const checkpoint = new CheckpointService(db, root);
  const checkpointId = await checkpoint.create("write-diff", ["value.ts"]);
  const { writeFileTool } = await import("../../src/tools/workspace.js");
  const result = await writeFileTool.execute(
    { path: "value.ts", content: "const value = 2;\n" },
    { ...ctx, permissionMode: "AUTO", checkpoint, checkpointId },
  );
  expect(result.operation).toBe("overwritten");
  expect(result.change).toMatchObject({
    operation: "overwritten",
    beforeExists: true,
    afterExists: true,
    addedLines: 1,
    removedLines: 1,
  });
  expect(result.change.diffLines).toEqual([
    "- const value = 1;",
    "+ const value = 2;",
  ]);
  db.close();
});

test("CreateFile refuses to overwrite and DeleteFile requires approval", async () => {
  const { ctx, root } = await fixtureContext();
  await writeFile(
    path.join(root, "remove.ts"),
    "const remove = true;\n",
    "utf8",
  );
  const db = new LocalCodeDatabase(":memory:");
  const checkpoint = new CheckpointService(db, root);
  const createCheckpoint = await checkpoint.create("create-existing", [
    "package.json",
  ]);
  await expect(
    createFileTool.execute(
      createFileTool.validate({ path: "package.json", content: "nope" }),
      {
        ...ctx,
        permissionMode: "AUTO",
        checkpoint,
        checkpointId: createCheckpoint,
      },
    ),
  ).rejects.toMatchObject({ code: "PATH_EXISTS", recoverable: false });

  const deleteCheckpoint = await checkpoint.create("delete-file", [
    "remove.ts",
  ]);
  await expect(
    deleteFileTool.execute(deleteFileTool.validate({ path: "remove.ts" }), {
      ...ctx,
      permissionMode: "AUTO",
      checkpoint,
      checkpointId: deleteCheckpoint,
      requestApproval: async () => false,
    }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
  expect(await Bun.file(path.join(root, "remove.ts")).exists()).toBe(true);
  const deleted = await deleteFileTool.execute(
    deleteFileTool.validate({ path: "remove.ts" }),
    {
      ...ctx,
      permissionMode: "AUTO",
      checkpoint,
      checkpointId: deleteCheckpoint,
      requestApproval: async () => true,
    },
  );
  expect(deleted.operation).toBe("deleted");
  expect(deleted.change).toMatchObject({
    operation: "deleted",
    beforeExists: true,
    afterExists: false,
    removedLines: 1,
  });
  expect(deleted.change.diffLines).toEqual(["- const remove = true;"]);
  expect(await Bun.file(path.join(root, "remove.ts")).exists()).toBe(false);
  db.close();
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

test("ReadFile bounds a startLine-only request and exposes continuation metadata", async () => {
  const { ctx, root } = await fixtureContext();
  const lines = Array.from({ length: 300 }, (_, index) => `line-${index + 1}`);
  await writeFile(path.join(root, "large-lines.txt"), lines.join("\n"), "utf8");

  const result = await readFileTool.execute(
    readFileTool.validate({ path: "large-lines.txt", startLine: 81 }),
    ctx,
  );

  expect(result.content.split("\n")[0]).toBe("line-81");
  expect(result.content.split("\n").at(-1)).toBe("line-240");
  expect(result.truncated).toBe(false);
  expect(result.hasMore).toBe(true);
  expect(result.nextStartLine).toBe(241);
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
