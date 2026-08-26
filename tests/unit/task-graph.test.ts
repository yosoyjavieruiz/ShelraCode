import { expect, test } from "bun:test";
import {
  compileTaskGraph,
  isLegalTaskNodeTransition,
  setTaskNodeStatus,
} from "../../src/agent/task-graph.js";

test("compiles a complex coding objective into dependent bounded work units", () => {
  const graph = compileTaskGraph({
    objective: "Refactor auth and update the callers with regression tests.",
    mode: "coding",
    candidateFiles: ["src/auth.ts", "src/session.ts", "tests/auth.test.ts"],
    verificationCommands: ["bun test"],
  });

  expect(graph.nodes.map((node) => node.id)).toEqual([
    "discover",
    "analyze",
    "mutate-src-auth-ts",
    "mutate-src-session-ts",
    "mutate-tests-auth-test-ts",
    "verify",
    "review",
  ]);
  expect(graph.nodes[2]?.dependencies).toEqual(["analyze"]);
  expect(graph.nodes[3]?.dependencies).toEqual(["mutate-src-auth-ts"]);
  expect(graph.nodes.at(-1)?.dependencies).toEqual(["verify"]);
});

test("keeps repository questions read-only in the compiled graph", () => {
  const graph = compileTaskGraph({
    objective: "Where is createSession implemented?",
    mode: "workspace_question",
    candidateFiles: ["src/session.ts"],
  });

  expect(graph.nodes.some((node) => node.id.startsWith("mutate-"))).toBe(false);
  expect(graph.nodes.at(-1)?.scope.allowedTools).not.toContain("EditFile");
});

test("does not turn an unlocalized coding task into a root mutation scope", () => {
  const graph = compileTaskGraph({
    objective: "Implement the requested change.",
    mode: "coding",
  });

  expect(graph.nodes.map((node) => node.id)).toContain("localize-scope");
  expect(
    graph.nodes.some((node) => node.scope.candidateFiles.includes(".")),
  ).toBe(false);
  expect(
    graph.nodes.find((node) => node.id === "localize-scope")?.scope
      .allowedTools,
  ).not.toContain("EditFile");
});

test("keeps task-node lifecycle monotonic and rejects terminal rewrites", () => {
  const graph = compileTaskGraph({
    objective: "Update src/value.ts",
    mode: "coding",
    candidateFiles: ["src/value.ts"],
  });

  expect(isLegalTaskNodeTransition("ready", "running")).toBe(true);
  expect(isLegalTaskNodeTransition("passed", "running")).toBe(false);
  expect(setTaskNodeStatus(graph, "discover", "running")).toBe(true);
  expect(setTaskNodeStatus(graph, "discover", "passed")).toBe(true);
  expect(setTaskNodeStatus(graph, "discover", "running")).toBe(false);
  expect(graph.nodes.find((node) => node.id === "discover")?.status).toBe(
    "passed",
  );
});
