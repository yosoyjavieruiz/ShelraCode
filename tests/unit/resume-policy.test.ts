import { expect, test } from "bun:test";
import {
  assessResumeWorkspace,
  type ResumeWorkspaceInput,
} from "../../src/agent/resume-policy.js";

const baseInput: ResumeWorkspaceInput = {
  savedRepositoryRevision: "head-1",
  currentRepositoryRevision: "head-1",
  savedWorkingTreeRevision: "tree-1",
  currentWorkingTreeRevision: "tree-2",
  currentWorkingTreePaths: [],
  taskPaths: [],
};

test("resume accepts an unchanged repository and legacy snapshots", () => {
  expect(
    assessResumeWorkspace({
      ...baseInput,
      currentWorkingTreeRevision: "tree-1",
    }).status,
  ).toBe("compatible");
  expect(
    assessResumeWorkspace({
      ...baseInput,
      savedWorkingTreeRevision: undefined,
    }).status,
  ).toBe("compatible");
});

test("resume blocks a changed checkout revision", () => {
  const result = assessResumeWorkspace({
    ...baseInput,
    currentRepositoryRevision: "head-2",
  });

  expect(result.status).toBe("blocked");
  expect(result.reason).toContain("repository revision");
});

test("resume blocks a working-tree mismatch when changed paths are unavailable", () => {
  const result = assessResumeWorkspace({
    ...baseInput,
    currentWorkingTreePaths: undefined,
  });

  expect(result.status).toBe("blocked");
  expect(result.reason).toContain("changed paths");
});

test("resume allows task-owned changes but requires fresh observations", () => {
  const result = assessResumeWorkspace({
    ...baseInput,
    currentWorkingTreePaths: [".\\src\\parser.ts"],
    taskPaths: ["src/parser.ts"],
  });

  expect(result.status).toBe("task_changes_detected");
  expect(result.unexpectedPaths).toEqual([]);
  expect(result.changedPaths).toHaveLength(1);
});

test("resume blocks changes outside the task scope", () => {
  const result = assessResumeWorkspace({
    ...baseInput,
    currentWorkingTreePaths: ["src/parser.ts", "README.md"],
    taskPaths: ["src/parser.ts"],
  });

  expect(result.status).toBe("blocked");
  expect(result.unexpectedPaths).toHaveLength(1);
  expect(result.unexpectedPaths[0]).toMatch(/readme\.md/i);
});

test("resume treats an interrupted target as task-owned", () => {
  const result = assessResumeWorkspace({
    ...baseInput,
    currentWorkingTreePaths: ["src/parser.ts"],
    inFlightTarget: "src\\parser.ts",
  });

  expect(result.status).toBe("task_changes_detected");
});

test("resume treats a fingerprint change with zero enumerated paths as compatible (e.g. a branch-only switch)", () => {
  const result = assessResumeWorkspace({
    ...baseInput,
    currentWorkingTreePaths: [],
  });

  expect(result.status).toBe("compatible");
  expect(result.changedPaths).toEqual([]);
  expect(result.unexpectedPaths).toEqual([]);
});

test("resume names the unexpected paths in the blocked reason", () => {
  const result = assessResumeWorkspace({
    ...baseInput,
    currentWorkingTreePaths: ["src/parser.ts", "README.md"],
    taskPaths: ["src/parser.ts"],
  });

  expect(result.status).toBe("blocked");
  expect(result.reason).toMatch(/readme\.md/i);
});
