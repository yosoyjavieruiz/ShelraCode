import type { TaskGraph, TaskNode, TaskNodeStatus } from "./task-graph.js";

/**
 * Controller-owned scheduling state for a task graph.
 *
 * The LLM may propose nodes, but it cannot decide which node is runnable or
 * make two dependent nodes run at the same time. This module is deliberately
 * side-effect free outside the graph's derived status/current-node fields so
 * the loop and a future durable worker can share the exact same decision.
 */
export type TaskScheduleStatus =
  "ready" | "running" | "verifying" | "waiting" | "complete" | "blocked";

export interface TaskSchedule {
  status: TaskScheduleStatus;
  currentNodeId?: string;
  readyNodeIds: string[];
  blockedNodeIds: string[];
  pendingNodeIds: string[];
  terminalNodeIds: string[];
  reason?: string;
}

const terminalStatuses = new Set<TaskNodeStatus>(["passed", "superseded"]);

const activeStatuses = new Set<TaskNodeStatus>(["running", "verifying"]);

function dependenciesPassed(
  node: TaskNode,
  statuses: ReadonlyMap<string, TaskNodeStatus>,
): boolean {
  return node.dependencies.every(
    (dependency) => statuses.get(dependency) === "passed",
  );
}

function dependencyBlocked(
  node: TaskNode,
  statuses: ReadonlyMap<string, TaskNodeStatus>,
): boolean {
  return node.dependencies.some((dependency) => {
    const status = statuses.get(dependency);
    return status === "failed" || status === "blocked";
  });
}

function deriveStatuses(graph: TaskGraph): Map<string, TaskNodeStatus> {
  const statuses = new Map(
    graph.nodes.map((node) => [node.id, node.status] as const),
  );
  // A failed dependency can block a chain several levels deep. Iterate until
  // the derived state stops changing instead of relying on proposal order.
  let changed = true;
  while (changed) {
    changed = false;
    for (const node of graph.nodes) {
      if (node.status !== "pending" && node.status !== "ready") continue;
      if (dependencyBlocked(node, statuses)) {
        if (statuses.get(node.id) !== "blocked") {
          statuses.set(node.id, "blocked");
          changed = true;
        }
      } else if (dependenciesPassed(node, statuses)) {
        if (statuses.get(node.id) !== "ready") {
          statuses.set(node.id, "ready");
          changed = true;
        }
      }
    }
  }
  return statuses;
}

function applyDerivedStatuses(
  graph: TaskGraph,
  statuses: ReadonlyMap<string, TaskNodeStatus>,
): void {
  for (const node of graph.nodes) {
    const derived = statuses.get(node.id);
    if (
      derived === "blocked" &&
      (node.status === "pending" || node.status === "ready")
    )
      node.status = "blocked";
    else if (derived === "ready" && node.status === "pending")
      node.status = "ready";
  }
}

/**
 * Reconcile dependency-derived readiness and return the single controller
 * decision for the next work unit. Existing running/verifying work always
 * wins; otherwise the first ready node is selected deterministically.
 */
export function inspectTaskSchedule(graph: TaskGraph): TaskSchedule {
  const statuses = deriveStatuses(graph);
  applyDerivedStatuses(graph, statuses);
  const readyNodeIds = graph.nodes
    .filter((node) => statuses.get(node.id) === "ready")
    .map((node) => node.id);
  const blockedNodeIds = graph.nodes
    .filter((node) => statuses.get(node.id) === "blocked")
    .map((node) => node.id);
  const pendingNodeIds = graph.nodes
    .filter((node) => statuses.get(node.id) === "pending")
    .map((node) => node.id);
  const terminalNodeIds = graph.nodes
    .filter((node) => terminalStatuses.has(statuses.get(node.id)!))
    .map((node) => node.id);
  const activeNode = graph.nodes.find((node) =>
    activeStatuses.has(statuses.get(node.id)!),
  );
  const currentNode =
    activeNode ?? graph.nodes.find((node) => readyNodeIds.includes(node.id));
  graph.currentNodeId = currentNode?.id ?? "";

  if (graph.nodes.length > 0 && terminalNodeIds.length === graph.nodes.length)
    return {
      status: "complete",
      readyNodeIds,
      blockedNodeIds,
      pendingNodeIds,
      terminalNodeIds,
    };
  if (activeNode)
    return {
      status: activeNode.status === "verifying" ? "verifying" : "running",
      currentNodeId: activeNode.id,
      readyNodeIds,
      blockedNodeIds,
      pendingNodeIds,
      terminalNodeIds,
    };
  if (readyNodeIds.length > 0)
    return {
      status: "ready",
      currentNodeId: readyNodeIds[0],
      readyNodeIds,
      blockedNodeIds,
      pendingNodeIds,
      terminalNodeIds,
    };
  if (pendingNodeIds.length > 0)
    return {
      status: "waiting",
      readyNodeIds,
      blockedNodeIds,
      pendingNodeIds,
      terminalNodeIds,
      reason:
        "The task graph has pending nodes whose dependencies have not completed.",
    };
  return {
    status: "blocked",
    readyNodeIds,
    blockedNodeIds,
    pendingNodeIds,
    terminalNodeIds,
    reason:
      blockedNodeIds.length > 0
        ? "The next work units are blocked by a failed or blocked dependency."
        : "The task graph has no runnable work unit.",
  };
}

/** Select the controller's next node without widening tools or scope. */
export function scheduleNextTaskNode(graph: TaskGraph): TaskNode | undefined {
  const schedule = inspectTaskSchedule(graph);
  const id = schedule.currentNodeId;
  return id ? graph.nodes.find((node) => node.id === id) : undefined;
}
