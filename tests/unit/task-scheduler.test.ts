import { expect, test } from "bun:test";
import {
  compileTaskGraph,
  setTaskNodeStatus,
} from "../../src/agent/task-graph.js";
import {
  inspectTaskSchedule,
  scheduleNextTaskNode,
} from "../../src/agent/task-scheduler.js";

test("schedules the first ready node and advances after its dependency passes", () => {
  const graph = compileTaskGraph({
    objective: "Update src/value.ts",
    mode: "coding",
    candidateFiles: ["src/value.ts"],
  });

  expect(scheduleNextTaskNode(graph)?.id).toBe("discover");
  expect(graph.currentNodeId).toBe("discover");

  expect(setTaskNodeStatus(graph, "discover", "running")).toBe(true);
  expect(setTaskNodeStatus(graph, "discover", "passed")).toBe(true);
  expect(scheduleNextTaskNode(graph)?.id).toBe("analyze");
  expect(graph.currentNodeId).toBe("analyze");
});

test("reports blocked descendants and a deadlock without inventing work", () => {
  const graph = compileTaskGraph({
    objective: "Update src/value.ts",
    mode: "coding",
    candidateFiles: ["src/value.ts"],
  });

  expect(setTaskNodeStatus(graph, "discover", "running")).toBe(true);
  expect(setTaskNodeStatus(graph, "discover", "failed")).toBe(true);

  const schedule = inspectTaskSchedule(graph);
  expect(schedule.readyNodeIds).toEqual([]);
  expect(schedule.blockedNodeIds).toContain("analyze");
  expect(schedule.status).toBe("blocked");
  expect(schedule.reason).toContain("dependency");
  expect(scheduleNextTaskNode(graph)).toBeUndefined();
});

test("reconciles a stale ready node when a dependency fails", () => {
  const graph = compileTaskGraph({
    objective: "Update src/value.ts",
    mode: "coding",
    candidateFiles: ["src/value.ts"],
  });

  graph.nodes.find((node) => node.id === "analyze")!.status = "ready";
  expect(setTaskNodeStatus(graph, "discover", "failed")).toBe(true);

  const schedule = inspectTaskSchedule(graph);
  expect(graph.nodes.find((node) => node.id === "analyze")?.status).toBe(
    "blocked",
  );
  expect(schedule.blockedNodeIds).toContain("analyze");
  expect(scheduleNextTaskNode(graph)).toBeUndefined();
});

test("preserves an active node and never schedules a later ready node concurrently", () => {
  const graph = compileTaskGraph({
    objective: "Answer from repository evidence",
    mode: "workspace_question",
    candidateFiles: ["src/value.ts"],
  });

  expect(setTaskNodeStatus(graph, "discover", "running")).toBe(true);
  const schedule = inspectTaskSchedule(graph);

  expect(schedule.status).toBe("running");
  expect(schedule.currentNodeId).toBe("discover");
  expect(schedule.readyNodeIds).toEqual([]);
  expect(scheduleNextTaskNode(graph)?.id).toBe("discover");
});
