import type { TurnMode } from "./turn-policy.js";
import {
  appendPlanProposal,
  refreshPlanReadiness,
  type MonotonicPlan,
  type PlanNode,
  type PlanNodeKind,
  type PlanProposal,
  type PlanRevision,
  type PlanValidationContext,
} from "./planner.js";

export type TaskNodeStatus =
  | "pending"
  | "blocked"
  | "ready"
  | "running"
  | "verifying"
  | "passed"
  | "failed"
  | "superseded";

export interface TaskNode {
  id: string;
  objective: string;
  dependencies: string[];
  kind?: PlanNodeKind;
  status: TaskNodeStatus;
  scope: {
    candidateFiles: string[];
    allowedTools: string[];
  };
  contextRequirements: string[];
  acceptance: string[];
  verification?: string[];
  attempts: number;
  source?: "model" | "controller" | "controller-recovery";
  revision?: number;
  lastFailure?: string;
}

export interface TaskGraph {
  rootObjective: string;
  globalConstraints: string[];
  nodes: TaskNode[];
  currentNodeId: string;
  planSource?: "model" | "mixed" | "compatibility";
  revision?: number;
  revisions?: PlanRevision[];
  acceptanceCriteria?: string[];
  evidenceRequirements?: string[];
}

export interface TaskGraphInput {
  objective: string;
  mode: TurnMode;
  candidateFiles?: readonly string[];
  verificationCommands?: readonly string[];
  constraints?: readonly string[];
}

const LEGAL_NODE_TRANSITIONS: Readonly<
  Record<TaskNodeStatus, ReadonlySet<TaskNodeStatus>>
> = {
  pending: new Set(["ready", "running", "blocked", "failed"]),
  ready: new Set(["running", "verifying", "passed", "blocked", "failed"]),
  running: new Set(["verifying", "passed", "blocked", "failed"]),
  verifying: new Set(["running", "passed", "blocked", "failed"]),
  passed: new Set(),
  failed: new Set(),
  blocked: new Set(),
  superseded: new Set(),
};

const READ_TOOLS = [
  "ListFiles",
  "GlobFiles",
  "SearchText",
  "ReadFile",
  "GitStatus",
  "GitDiff",
];
const CODING_TOOLS = [
  ...READ_TOOLS,
  "EditFile",
  "WriteFile",
  "CreateFile",
  "DeleteFile",
  "Shell",
  "RunTests",
];

function nodeSlug(value: string): string {
  const slug = value
    .replaceAll("\\", "/")
    .replace(/[^a-z0-9]+/giu, "-")
    .replace(/^-+|-+$/gu, "")
    .toLowerCase();
  return slug || "scope";
}

function uniquePaths(paths: readonly string[] | undefined): string[] {
  return [
    ...new Set((paths ?? []).map((value) => value.trim()).filter(Boolean)),
  ];
}

function node(
  input: Omit<TaskNode, "status" | "attempts"> &
    Partial<Pick<TaskNode, "status" | "attempts">>,
): TaskNode {
  return {
    ...input,
    status: input.status ?? "blocked",
    attempts: input.attempts ?? 0,
  };
}

/**
 * Compile a user objective into a controller-owned dependency graph. This is
 * intentionally conservative: it does not pretend to infer architecture;
 * it creates explicit gates around discovery, bounded mutation, verification
 * and review so a model only needs to choose the next node action.
 */
export function compileTaskGraph(input: TaskGraphInput): TaskGraph {
  const candidates = uniquePaths(input.candidateFiles);
  const coding = input.mode === "coding";
  // An empty coding scope is a localization problem, not permission to edit
  // the workspace root. Keep that distinction visible in the graph so a
  // caller cannot accidentally turn missing evidence into a broad mutation.
  const files = coding ? candidates : [];
  const tools = coding ? CODING_TOOLS : READ_TOOLS;
  const nodes: TaskNode[] = [
    node({
      id: "discover",
      objective: "Acquire relevant repository evidence for the user objective.",
      dependencies: [],
      status: "ready",
      scope: { candidateFiles: candidates, allowedTools: READ_TOOLS },
      contextRequirements: ["relevant repository evidence"],
      acceptance: ["At least one fresh, relevant evidence item is recorded."],
    }),
    node({
      id: "analyze",
      objective:
        "Analyze the discovered evidence and define the smallest safe next action.",
      dependencies: ["discover"],
      scope: { candidateFiles: candidates, allowedTools: READ_TOOLS },
      contextRequirements: ["discover"],
      acceptance: ["The next bounded action and its scope are explicit."],
    }),
  ];

  if (coding) {
    let previous = "analyze";
    for (const [index, file] of files.entries()) {
      const id = `mutate-${nodeSlug(file)}${index > 0 && nodeSlug(file) === nodeSlug(files[index - 1]!) ? `-${index + 1}` : ""}`;
      nodes.push(
        node({
          id,
          objective: `Apply the smallest requested change within ${file}.`,
          dependencies: [previous],
          scope: { candidateFiles: [file], allowedTools: tools },
          contextRequirements: [`ReadFile ${file}`],
          acceptance: [
            `Only the approved scope ${file} is changed for this node.`,
          ],
        }),
      );
      previous = id;
    }
    if (files.length === 0) {
      nodes.push(
        node({
          id: "localize-scope",
          objective:
            "Locate an explicit, evidence-backed mutation scope before editing.",
          dependencies: [previous],
          scope: { candidateFiles: [], allowedTools: READ_TOOLS },
          contextRequirements: ["relevant target files or symbols"],
          acceptance: ["At least one bounded mutation target is identified."],
        }),
      );
      previous = "localize-scope";
    }
    const verificationCommands = [...(input.verificationCommands ?? [])];
    nodes.push(
      node({
        id: "verify",
        objective:
          "Run the narrowest applicable verification and repair failures.",
        dependencies: [previous],
        scope: {
          candidateFiles: files,
          allowedTools: ["RunTests", "Shell", ...READ_TOOLS],
        },
        contextRequirements:
          verificationCommands.length > 0
            ? verificationCommands
            : ["project verification command"],
        acceptance:
          verificationCommands.length > 0
            ? verificationCommands.map((command) => `${command} passes`)
            : ["Relevant verification passes."],
      }),
    );
    nodes.push(
      node({
        id: "review",
        objective:
          "Review the objective, final diff, verification and user-work preservation.",
        dependencies: ["verify"],
        scope: {
          candidateFiles: files,
          allowedTools: ["GitStatus", "GitDiff", "ReadFile"],
        },
        contextRequirements: ["final diff", "verification results"],
        acceptance: [
          "All required criteria pass and no unrelated user change is overwritten.",
        ],
      }),
    );
  } else {
    nodes.push(
      node({
        id: "answer",
        objective:
          "Answer from the fresh repository evidence without mutation.",
        dependencies: ["analyze"],
        scope: { candidateFiles: candidates, allowedTools: tools },
        contextRequirements: ["relevant repository evidence"],
        acceptance: ["The answer cites observed repository evidence."],
      }),
    );
  }

  return {
    rootObjective: input.objective,
    globalConstraints: [
      ...(input.constraints ?? []),
      ...(coding
        ? [
            "Preserve pre-existing user work.",
            "Do not complete without verification and final review.",
          ]
        : ["This graph is read-only."]),
    ],
    nodes,
    currentNodeId: "discover",
    planSource: "compatibility",
    revision: 0,
    revisions: [],
    acceptanceCriteria: [
      "The requested repository outcome is supported by host evidence.",
    ],
    evidenceRequirements: ["Fresh evidence relevant to the objective."],
  };
}

export function createModelPlanningGraph(input: {
  objective: string;
  constraints?: readonly string[];
}): TaskGraph {
  return {
    rootObjective: input.objective,
    globalConstraints: [...(input.constraints ?? [])],
    nodes: [],
    currentNodeId: "",
    planSource: "model",
    revision: 0,
    revisions: [],
    acceptanceCriteria: [],
    evidenceRequirements: [],
  };
}

function toMonotonicPlan(graph: TaskGraph): MonotonicPlan {
  const nodes: PlanNode[] = graph.nodes.map((node) => ({
    id: node.id,
    objective: node.objective,
    dependencies: [...node.dependencies],
    kind:
      node.kind ??
      (node.scope.allowedTools.length > 0 ? "workspace" : "semantic"),
    scope: {
      ...(node.scope.candidateFiles.length > 0
        ? { candidateFiles: [...node.scope.candidateFiles] }
        : {}),
      ...(node.scope.allowedTools.length > 0
        ? { allowedTools: [...node.scope.allowedTools] }
        : {}),
    },
    contextRequirements: [...node.contextRequirements],
    requiredEvidence: [...node.contextRequirements],
    acceptance: [...node.acceptance],
    ...(node.verification ? { verification: [...node.verification] } : {}),
    status:
      node.status === "passed"
        ? "verified"
        : node.status === "superseded"
          ? "superseded"
          : node.status,
    source:
      node.source === "controller-recovery"
        ? "controller-recovery"
        : node.source === "model"
          ? "model"
          : "controller",
    revision: node.revision ?? 0,
  }));
  return {
    rootObjective: graph.rootObjective,
    revision: graph.revision ?? 0,
    currentNodeId: graph.currentNodeId || undefined,
    nodes,
    revisions: graph.revisions ?? [],
    acceptanceCriteria: [...(graph.acceptanceCriteria ?? [])],
    evidenceRequirements: [...(graph.evidenceRequirements ?? [])],
    constraints: [...graph.globalConstraints],
  };
}

function fromPlanNode(node: PlanNode): TaskNode {
  const status: TaskNodeStatus =
    node.status === "verified"
      ? "passed"
      : node.status === "superseded"
        ? "superseded"
        : node.status;
  return {
    id: node.id,
    objective: node.objective,
    dependencies: [...node.dependencies],
    kind: node.kind,
    status,
    scope: {
      candidateFiles: [...(node.scope?.candidateFiles ?? [])],
      allowedTools: [...(node.scope?.allowedTools ?? [])],
    },
    contextRequirements: [
      ...(node.contextRequirements ?? node.requiredEvidence ?? []),
    ],
    acceptance: [...(node.acceptance ?? [])],
    verification: [...(node.verification ?? [])],
    attempts: 0,
    source: node.source,
    revision: node.revision,
  };
}

/** Convert an accepted model proposal into the controller's graph projection. */
export function appendModelPlanToGraph(
  graph: TaskGraph,
  proposal: PlanProposal,
  context: Omit<PlanValidationContext, "existingNodes"> & { reason?: string },
): { graph: TaskGraph; revision: PlanRevision } {
  const accepted = appendPlanProposal(
    toMonotonicPlan(graph),
    proposal,
    context,
  );
  const nextGraph: TaskGraph = {
    rootObjective: graph.rootObjective,
    globalConstraints: [...graph.globalConstraints],
    nodes: accepted.plan.nodes.map(fromPlanNode),
    currentNodeId: accepted.plan.currentNodeId ?? "",
    planSource: "model",
    revision: accepted.plan.revision,
    revisions: accepted.plan.revisions,
    acceptanceCriteria: [...accepted.plan.acceptanceCriteria],
    evidenceRequirements: [...accepted.plan.evidenceRequirements],
  };
  return { graph: nextGraph, revision: accepted.revision };
}

/** Select the next dependency-ready semantic node proposed by the LLM. */
export function nextReadyTaskNode(graph: TaskGraph): TaskNode | undefined {
  const plan = toMonotonicPlan(graph);
  refreshPlanReadiness(plan);
  const nextId = plan.nodes.find((node) => node.status === "ready")?.id;
  if (!nextId) return undefined;
  return graph.nodes.find((node) => node.id === nextId);
}

export function setTaskNodeStatus(
  graph: TaskGraph,
  nodeId: string,
  status: TaskNodeStatus,
): boolean {
  const target = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!target || target.status === status) return false;
  if (!LEGAL_NODE_TRANSITIONS[target.status].has(status)) return false;
  target.status = status;
  if (status === "running" || status === "verifying")
    graph.currentNodeId = nodeId;
  const plan = toMonotonicPlan(graph);
  refreshPlanReadiness(plan);
  graph.currentNodeId = plan.currentNodeId ?? "";
  for (const next of plan.nodes) {
    const graphNode = graph.nodes.find((candidate) => candidate.id === next.id);
    if (!graphNode || graphNode.status === "superseded") continue;
    const nextStatus: TaskNodeStatus =
      next.status === "verified" ? "passed" : next.status;
    if (
      graphNode.status !== nextStatus &&
      LEGAL_NODE_TRANSITIONS[graphNode.status].has(nextStatus)
    )
      graphNode.status = nextStatus;
  }
  return true;
}

/** Exposed for deterministic scheduler/evaluation checks. */
export function isLegalTaskNodeTransition(
  from: TaskNodeStatus,
  to: TaskNodeStatus,
): boolean {
  return from === to || LEGAL_NODE_TRANSITIONS[from].has(to);
}
