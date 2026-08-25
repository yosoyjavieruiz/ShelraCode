import { expect, test } from "bun:test";
import path from "node:path";
import { resolveWorkspacePath } from "../../src/shared/paths.js";

test("a bare leading slash is treated as the workspace root, not an OS-absolute escape", () => {
  const root = path.resolve("/workspace/repo");
  expect(resolveWorkspacePath(root, "/")).toBe(root);
});

test("a leading-slash path is treated as workspace-relative", () => {
  const root = path.resolve("/workspace/repo");
  expect(resolveWorkspacePath(root, "/src/index.ts")).toBe(
    path.join(root, "src", "index.ts"),
  );
});

test("a directory-traversal escape attempt is still rejected", () => {
  const root = path.resolve("/workspace/repo");
  expect(() => resolveWorkspacePath(root, "../../etc/passwd")).toThrow(
    /escapes workspace/,
  );
  expect(() => resolveWorkspacePath(root, "/../../etc/passwd")).toThrow(
    /escapes workspace/,
  );
});
