import { expect, test } from "bun:test";
import {
  normalizeWorkspacePath,
  workspacePathComparisonKey,
  workspaceRootsMatch,
} from "../../src/shared/workspace-paths.js";

test("normalizeWorkspacePath strips a leading slash a model commonly uses for the workspace root", () => {
  expect(normalizeWorkspacePath("/src/parser.ts")).toBe("src/parser.ts");
  expect(normalizeWorkspacePath("\\src\\parser.ts")).toBe("src/parser.ts");
});

test("normalizeWorkspacePath collapses redundant and parent segments", () => {
  expect(normalizeWorkspacePath("./src/parser.ts")).toBe("src/parser.ts");
  expect(normalizeWorkspacePath("src/../src/parser.ts")).toBe("src/parser.ts");
  expect(normalizeWorkspacePath("src//parser.ts")).toBe("src/parser.ts");
});

test("normalizeWorkspacePath keeps an unresolvable leading .. instead of escaping", () => {
  expect(normalizeWorkspacePath("../outside.ts")).toBe("../outside.ts");
});

test("workspacePathComparisonKey folds case only on platforms with a case-insensitive default filesystem", () => {
  const key = workspacePathComparisonKey("Src/Parser.ts");
  if (process.platform === "win32" || process.platform === "darwin")
    expect(key).toBe("src/parser.ts");
  else expect(key).toBe("Src/Parser.ts");
});

test("workspaceRootsMatch compares absolute roots without collapsing them as relative paths", () => {
  expect(workspaceRootsMatch("/home/dev/project", "/home/dev/project/")).toBe(
    true,
  );
  expect(workspaceRootsMatch("C:\\repo\\app", "C:/repo/app")).toBe(true);
  expect(
    workspaceRootsMatch("/home/dev/project-a", "/home/dev/project-b"),
  ).toBe(false);
});
