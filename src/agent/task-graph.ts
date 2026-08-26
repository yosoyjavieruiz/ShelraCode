import type { TurnMode } from "./turn-policy.js";

export type TaskNodeStatus =
  "blocked" | "ready" | "running" | "verifying" | "passed" | "failed";

export interface TaskNode {
  id: string;
  objective: string;
  dependencies: string[];
  status: TaskNodeStatus;
  scope: {
    candidateFiles: string[];
    allowedTools: string[];
  };
  contextRequirements: string[];
  acceptance: string[];
  attempts: number;
  lastFailure?: string;
}

export interface TaskGraph {
  rootObjective: string;
  globalConstraints: string[];
  nodes: TaskNode[];
  currentNodeId: string;
}

export interface TaskGraphInput {
  objective: string;
  mode: TurnMode;
  candidateFiles?: readonly string[];
  verificationCommands?: readonly string[];
  constraints?: readonly string[];
}

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
  };
}

export function setTaskNodeStatus(
  graph: TaskGraph,
  nodeId: string,
  status: TaskNodeStatus,
): boolean {
  const target = graph.nodes.find((candidate) => candidate.id === nodeId);
  if (!target || target.status === status) return false;
  target.status = status;
  if (status === "running" || status === "verifying")
    graph.currentNodeId = nodeId;
  return true;
}
