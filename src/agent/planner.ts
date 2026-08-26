import { normalizeProviderEvents } from "../providers/stream-normalizer.js";
import type { ProviderAdapter, ProviderEvent } from "../providers/types.js";
import {
  compileContextPacket,
  renderContextPacket,
} from "../context/context-compiler.js";
import type { TurnMode } from "./turn-policy.js";

export const PLAN_TOOL_NAME = "ProposeTaskPlan";
const DEFAULT_MAX_PLAN_NODES = 32;
const READ_ONLY_MODES = new Set<TurnMode>([
  "conversation",
  "knowledge",
  "workspace_question",
  "plan",
  "review",
]);
const MUTATION_TOOLS = new Set([
  "EditFile",
  "WriteFile",
  "CreateFile",
  "DeleteFile",
  "Shell",
  "RunTests",
  "ApplyPatch",
]);
const FILE_MUTATION_TOOLS = new Set([
  "EditFile",
  "WriteFile",
  "CreateFile",
  "DeleteFile",
  "ApplyPatch",
]);

export type PlanNodeStatus =
  | "pending"
  | "ready"
  | "running"
  | "verifying"
  | "verified"
  | "blocked"
  | "failed"
  | "superseded";

/**
 * The planner owns the semantic work order.  The controller only needs to
 * know whether a node is executable against the workspace or is a bounded
 * semantic/user-input boundary.  Keeping this explicit prevents an empty
 * tool list from being confused with an accidental permission widening.
 */
export type PlanNodeKind = "workspace" | "semantic" | "clarification";

export interface PlanNodeScope {
  candidateFiles?: string[];
  allowedTools?: string[];
}

export interface PlanNodeProposal {
  id: string;
  objective: string;
  dependencies: string[];
  kind?: PlanNodeKind;
  scope?: PlanNodeScope;
  contextRequirements?: string[];
  requiredEvidence?: string[];
  acceptance?: string[];
  verification?: string[];
}

export interface PlanProposal {
  schemaVersion: 1;
  proposalId: string;
  objective: string;
  summary?: string;
  nodes: PlanNodeProposal[];
  acceptanceCriteria?: string[];
  evidenceRequirements?: string[];
  constraints?: string[];
  supersedes?: string[];
}

export interface PlanRevision {
  id: string;
  revision: number;
  source: "llm" | "controller";
  proposalId: string;
  reason: string;
  addedNodeIds: string[];
  supersededNodeIds: string[];
  createdAt: string;
}

export interface PlanNode extends PlanNodeProposal {
  kind: PlanNodeKind;
  status: PlanNodeStatus;
  source: "model" | "controller" | "controller-recovery";
  revision: number;
}

export interface MonotonicPlan {
  rootObjective: string;
  revision: number;
  currentNodeId?: string;
  nodes: PlanNode[];
  revisions: PlanRevision[];
  /** Semantic plan-level requirements proposed by the LLM and retained across revisions. */
  acceptanceCriteria: string[];
  evidenceRequirements: string[];
  constraints: string[];
}

export interface PlanValidationContext {
  objective: string;
  mode: TurnMode;
  allowedTools?: readonly string[];
  existingNodes?: readonly Pick<PlanNode, "id" | "dependencies">[];
  workspaceRoot?: string;
  maxNodes?: number;
  /** Require a real workspace mutation while a coding task has no mutation yet. */
  requireWorkspaceMutation?: boolean;
}

export interface PlanValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface PlanModelRequest {
  provider: ProviderAdapter;
  modelId: string;
  objective: string;
  mode: TurnMode;
  context?: string;
  constraints: readonly string[];
  allowedTools: readonly string[];
  /** Tell the planner that the current coding task still needs a mutation node. */
  requireWorkspaceMutation?: boolean;
  existingPlan?: MonotonicPlan;
  recovery?: {
    cause: string;
    evidence: readonly string[];
    forbiddenRepeats: readonly string[];
    /** A repair proposal must explicitly replace the node that failed. */
    supersedeNodeId?: string;
    /** Set when a previous recovery proposal was rejected by the controller. */
    retryReason?: string;
  };
  signal: AbortSignal;
  maxOutputTokens?: number;
}

export interface PlanModelResult {
  proposal?: PlanProposal;
  text: string;
  error?: string;
}

export const PLAN_TOOL_DEFINITION = {
  type: "function",
  function: {
    name: PLAN_TOOL_NAME,
    description:
      "Propose the semantic engineering plan for the current objective. This tool describes work only; it never executes repository actions.",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        schemaVersion: { type: "integer", enum: [1] },
        proposalId: { type: "string", minLength: 1 },
        objective: { type: "string", minLength: 1 },
        summary: { type: "string" },
        constraints: { type: "array", items: { type: "string" } },
        acceptanceCriteria: { type: "array", items: { type: "string" } },
        evidenceRequirements: { type: "array", items: { type: "string" } },
        supersedes: { type: "array", items: { type: "string" } },
        nodes: {
          type: "array",
          minItems: 1,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              id: { type: "string", minLength: 1 },
              objective: { type: "string", minLength: 1 },
              dependencies: { type: "array", items: { type: "string" } },
              kind: {
                type: "string",
                enum: ["workspace", "semantic", "clarification"],
              },
              scope: {
                description:
                  "Always include both arrays. Use empty arrays only for semantic or clarification nodes; workspace nodes must list the paths and tools they need.",
                type: "object",
                additionalProperties: false,
                properties: {
                  candidateFiles: {
                    type: "array",
                    items: { type: "string" },
                  },
                  allowedTools: {
                    type: "array",
                    items: { type: "string" },
                  },
                },
                required: ["candidateFiles", "allowedTools"],
              },
              contextRequirements: {
                type: "array",
                items: { type: "string" },
              },
              requiredEvidence: {
                type: "array",
                items: { type: "string" },
              },
              acceptance: { type: "array", items: { type: "string" } },
              verification: { type: "array", items: { type: "string" } },
            },
            required: ["id", "objective", "dependencies", "scope"],
          },
        },
      },
      required: ["schemaVersion", "proposalId", "objective", "nodes"],
    },
  },
} as const;

// Recovery is still semantic LLM work, but its append-only bookkeeping cannot
// be optional. Giving the recovery turn a stricter schema prevents a small
// model from returning a plausible-looking replacement while omitting the
// supersession that keeps the old failed node in the plan history.
export const RECOVERY_PLAN_TOOL_DEFINITION = {
  ...PLAN_TOOL_DEFINITION,
  function: {
    ...PLAN_TOOL_DEFINITION.function,
    parameters: {
      ...PLAN_TOOL_DEFINITION.function.parameters,
      required: [
        ...PLAN_TOOL_DEFINITION.function.parameters.required,
        "supersedes",
      ],
    },
  },
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter(
    (item): item is string => typeof item === "string",
  );
  return values.length === value.length
    ? [...new Set(values.map((item) => item.trim()).filter(Boolean))]
    : undefined;
}

function parseNode(value: unknown): PlanNodeProposal | undefined {
  if (!isRecord(value)) return undefined;
  const id = stringValue(value.id);
  const objective = stringValue(value.objective);
  const dependencies = stringArray(value.dependencies);
  if (!id || !objective || !dependencies) return undefined;
  const kind =
    value.kind === undefined ||
    value.kind === "workspace" ||
    value.kind === "semantic" ||
    value.kind === "clarification"
      ? (value.kind as PlanNodeKind | undefined)
      : undefined;
  if (value.kind !== undefined && kind === undefined) return undefined;
  const rawScope = isRecord(value.scope) ? value.scope : undefined;
  const candidateFiles = rawScope
    ? stringArray(rawScope.candidateFiles)
    : undefined;
  const allowedTools = rawScope
    ? stringArray(rawScope.allowedTools)
    : undefined;
  const scope =
    candidateFiles !== undefined || allowedTools !== undefined
      ? {
          ...(candidateFiles === undefined ? {} : { candidateFiles }),
          ...(allowedTools === undefined ? {} : { allowedTools }),
        }
      : undefined;
  const contextRequirements = stringArray(value.contextRequirements);
  const requiredEvidence = stringArray(value.requiredEvidence);
  const acceptance = stringArray(value.acceptance);
  const verification = stringArray(value.verification);
  return {
    id,
    objective,
    dependencies,
    ...(kind ? { kind } : {}),
    ...(scope ? { scope } : {}),
    ...(contextRequirements === undefined ? {} : { contextRequirements }),
    ...(requiredEvidence === undefined ? {} : { requiredEvidence }),
    ...(acceptance === undefined ? {} : { acceptance }),
    ...(verification === undefined ? {} : { verification }),
  };
}

/** Parse a provider tool argument or structured JSON response without trusting its shape. */
export function parsePlanProposal(value: unknown): PlanProposal | undefined {
  if (!isRecord(value)) return undefined;
  const schemaVersion = value.schemaVersion;
  const proposalId = stringValue(value.proposalId);
  const objective = stringValue(value.objective);
  const rawNodes = Array.isArray(value.nodes) ? value.nodes : undefined;
  if (schemaVersion !== 1 || !proposalId || !objective || !rawNodes)
    return undefined;
  const nodes = rawNodes.map(parseNode);
  if (nodes.some((node): node is undefined => node === undefined))
    return undefined;
  const acceptanceCriteria = stringArray(value.acceptanceCriteria);
  const evidenceRequirements = stringArray(value.evidenceRequirements);
  const constraints = stringArray(value.constraints);
  const supersedes = stringArray(value.supersedes);
  return {
    schemaVersion: 1,
    proposalId,
    objective,
    ...(stringValue(value.summary)
      ? { summary: stringValue(value.summary) }
      : {}),
    nodes: nodes as PlanNodeProposal[],
    ...(acceptanceCriteria === undefined ? {} : { acceptanceCriteria }),
    ...(evidenceRequirements === undefined ? {} : { evidenceRequirements }),
    ...(constraints === undefined ? {} : { constraints }),
    ...(supersedes === undefined ? {} : { supersedes }),
  };
}

function pathIsInsideWorkspace(value: string): boolean {
  const normalized = value.trim().replaceAll("\\", "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:[\\/]/u.test(normalized)
  )
    return false;
  const parts = normalized.split("/");
  return !parts.some((part) => part === "..");
}

function hasCycle(
  nodes: readonly PlanNodeProposal[],
  existingNodes: readonly Pick<PlanNode, "id" | "dependencies">[],
): boolean {
  const dependencies = new Map<string, readonly string[]>([
    ...existingNodes.map((node) => [node.id, node.dependencies] as const),
    ...nodes.map((node) => [node.id, node.dependencies] as const),
  ]);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const dependency of dependencies.get(id) ?? []) {
      if (dependencies.has(dependency) && visit(dependency)) return true;
    }
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return [...dependencies.keys()].some(visit);
}

function effectiveNodeKind(
  node: Pick<PlanNodeProposal, "kind" | "scope">,
): PlanNodeKind {
  if (node.kind) return node.kind;
  // Backwards-compatible inference for plans produced before `kind` was
  // added.  An empty scope is a semantic node, never implicit workspace
  // access; a tool-bearing node remains a workspace node.
  return (node.scope?.allowedTools?.length ?? 0) === 0
    ? "semantic"
    : "workspace";
}

const SEMANTIC_WORKSPACE_ACTION_PATTERN =
  /\b(?:create|created|creating|write|writing|edit|editing|add|adding|delete|deleting|remove|removing|fix|repair|implement|implementing|generate|generating|build|building|update|updating|modify|modifying|migrat|refactor|rename|renaming|install|configur|change|changing|crear|crea|creando|escribir|escrib|editar|edita|añadir|agregar|eliminar|borrar|reparar|implementar|implementa|generar|genera|construir|construye|actualizar|modificar|migrar|refactorizar|renombrar|instalar|configurar|cambiar|cambio)\b/iu;
const SEMANTIC_WORKSPACE_OBSERVATION_PATTERN =
  /\b(?:read|reading|inspect|inspecting|search|searching|find|finding|locate|locating|extract|extracting|parse|parsing|trace|tracing|list|listing|verify|verifying|validate|validating|leer|leyendo|inspeccionar|inspeccionando|buscar|buscando|encontrar|localizar|extraer|extrayendo|parsear|rastrear|listar|verificar|validar)\b/iu;

function semanticNodeRequiresWorkspaceTool(objective: string): boolean {
  return (
    SEMANTIC_WORKSPACE_ACTION_PATTERN.test(objective) ||
    SEMANTIC_WORKSPACE_OBSERVATION_PATTERN.test(objective)
  );
}

export function validatePlanProposal(
  proposal: PlanProposal,
  context: PlanValidationContext,
): PlanValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const maxNodes = context.maxNodes ?? DEFAULT_MAX_PLAN_NODES;
  const existingNodes = context.existingNodes ?? [];
  const existingIds = new Set(existingNodes.map((node) => node.id));
  const nodeIds = new Set<string>();
  if (proposal.schemaVersion !== 1)
    errors.push("unsupported plan schema version");
  if (!proposal.proposalId.trim()) errors.push("plan proposalId is empty");
  if (!proposal.objective.trim()) errors.push("plan objective is empty");
  if (proposal.nodes.length === 0)
    errors.push("plan must contain at least one node");
  if (proposal.nodes.length > maxNodes)
    errors.push(`plan contains more than the maximum of ${maxNodes} nodes`);
  if (proposal.objective.trim() !== context.objective.trim())
    warnings.push(
      "the model paraphrased the objective; the controller will retain the original request",
    );

  for (const node of proposal.nodes) {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/u.test(node.id))
      errors.push(`node ${node.id || "<empty>"} has an invalid stable id`);
    if (nodeIds.has(node.id)) errors.push(`node id is duplicated: ${node.id}`);
    if (existingIds.has(node.id))
      errors.push(`node id already exists: ${node.id}`);
    nodeIds.add(node.id);
    if (!node.objective.trim()) errors.push(`node ${node.id} has no objective`);
    for (const dependency of node.dependencies) {
      if (
        !nodeIds.has(dependency) &&
        !existingIds.has(dependency) &&
        !proposal.nodes.some((candidate) => candidate.id === dependency)
      )
        errors.push(`node ${node.id} depends on unknown node ${dependency}`);
    }
    for (const candidatePath of node.scope?.candidateFiles ?? [])
      if (!pathIsInsideWorkspace(candidatePath))
        errors.push(
          `node ${node.id} contains a path outside the workspace: ${candidatePath}`,
        );
    const nodeTools = node.scope?.allowedTools ?? [];
    const nodeKind = effectiveNodeKind(node);
    if (nodeKind === "workspace" && nodeTools.length === 0)
      errors.push(
        `workspace node ${node.id} must declare at least one allowed workspace tool`,
      );
    if (nodeKind === "clarification" && nodeTools.length > 0)
      errors.push(
        `clarification node ${node.id} cannot request workspace tools`,
      );
    if (
      nodeKind === "semantic" &&
      nodeTools.some((tool) => FILE_MUTATION_TOOLS.has(tool))
    )
      errors.push(`semantic node ${node.id} cannot request file mutations`);
    if (
      nodeKind === "semantic" &&
      semanticNodeRequiresWorkspaceTool(node.objective)
    )
      errors.push(
        `semantic node ${node.id} describes a workspace observation or mutation; use kind=workspace with explicit tools and scope`,
      );
    if (
      nodeTools.some((tool) => FILE_MUTATION_TOOLS.has(tool)) &&
      (node.scope?.candidateFiles?.length ?? 0) === 0
    )
      errors.push(
        `node ${node.id} must declare at least one candidate workspace path for mutation tools`,
      );
    if (context.allowedTools) {
      const allowed = new Set(context.allowedTools);
      for (const tool of nodeTools)
        if (!allowed.has(tool))
          errors.push(`node ${node.id} requests an unavailable tool: ${tool}`);
    }
    if (
      READ_ONLY_MODES.has(context.mode) &&
      nodeTools.some((tool) => MUTATION_TOOLS.has(tool))
    )
      errors.push(`node ${node.id} requests mutation during a read-only task`);
  }
  const superseded = new Set(proposal.supersedes ?? []);
  if (superseded.size !== (proposal.supersedes ?? []).length)
    errors.push("plan supersedes list contains duplicate node ids");
  for (const nodeId of superseded)
    if (!existingIds.has(nodeId))
      errors.push(`plan supersedes unknown node ${nodeId}`);
  for (const node of proposal.nodes)
    if (node.dependencies.some((dependency) => superseded.has(dependency)))
      errors.push(
        `node ${node.id} cannot depend on a node superseded by the same proposal`,
      );
  if (
    context.requireWorkspaceMutation &&
    !proposal.nodes.some((node) => {
      const kind = effectiveNodeKind(node);
      return (
        kind === "workspace" &&
        (node.scope?.allowedTools ?? []).some((tool) =>
          FILE_MUTATION_TOOLS.has(tool),
        )
      );
    })
  )
    errors.push(
      "this coding task still needs at least one workspace node with an explicit file mutation tool and candidate path",
    );
  if (hasCycle(proposal.nodes, existingNodes))
    errors.push("plan dependency cycle detected");
  return { valid: errors.length === 0, errors, warnings };
}

export function createMonotonicPlan(objective: string): MonotonicPlan {
  return {
    rootObjective: objective,
    revision: 0,
    nodes: [],
    revisions: [],
    acceptanceCriteria: [],
    evidenceRequirements: [],
    constraints: [],
  };
}

function dependenciesVerified(
  node: Pick<PlanNode, "dependencies">,
  nodes: readonly PlanNode[],
): boolean {
  const statuses = new Map(
    nodes.map((candidate) => [candidate.id, candidate.status]),
  );
  return node.dependencies.every(
    (dependency) => statuses.get(dependency) === "verified",
  );
}

/** Refresh dependency-derived readiness without deleting or rewriting plan history. */
export function refreshPlanReadiness(plan: MonotonicPlan): void {
  const statuses = new Map(plan.nodes.map((node) => [node.id, node.status]));
  for (const node of plan.nodes) {
    if (node.status !== "pending" && node.status !== "ready") continue;
    const dependencyFailed = node.dependencies.some((dependency) => {
      const status = statuses.get(dependency);
      return status === "failed" || status === "blocked";
    });
    node.status = dependencyFailed
      ? "blocked"
      : dependenciesVerified(node, plan.nodes)
        ? "ready"
        : "pending";
  }
  const current = plan.currentNodeId
    ? plan.nodes.find((node) => node.id === plan.currentNodeId)
    : undefined;
  if (
    !current ||
    (current.status !== "ready" &&
      current.status !== "running" &&
      current.status !== "verifying")
  )
    plan.currentNodeId = plan.nodes.find((node) => node.status === "ready")?.id;
}

export function nextReadyPlanNode(plan: MonotonicPlan): PlanNode | undefined {
  refreshPlanReadiness(plan);
  return plan.nodes.find((node) => node.status === "ready");
}

export function appendPlanProposal(
  plan: MonotonicPlan,
  proposal: PlanProposal,
  context: PlanValidationContext,
): { plan: MonotonicPlan; revision: PlanRevision } {
  const validation = validatePlanProposal(proposal, {
    ...context,
    existingNodes: plan.nodes,
  });
  if (!validation.valid)
    throw new Error(
      `Invalid LLM plan proposal: ${validation.errors.join("; ")}`,
    );
  const revisionNumber = plan.revision + 1;
  const supersededIds = new Set(proposal.supersedes ?? []);
  const existingNodes = plan.nodes.map((node) =>
    supersededIds.has(node.id)
      ? { ...node, status: "superseded" as const }
      : node,
  );
  const addedNodes: PlanNode[] = proposal.nodes.map((node) => ({
    ...node,
    kind: effectiveNodeKind(node),
    objective: node.objective.trim(),
    dependencies: [...node.dependencies],
    ...(node.scope
      ? {
          scope: {
            ...(node.scope.candidateFiles
              ? { candidateFiles: [...node.scope.candidateFiles] }
              : {}),
            ...(node.scope.allowedTools
              ? { allowedTools: [...node.scope.allowedTools] }
              : {}),
          },
        }
      : {}),
    status: node.dependencies.length === 0 ? "ready" : "pending",
    source: "model",
    revision: revisionNumber,
  }));
  const revision: PlanRevision = {
    id: `${proposal.proposalId}:revision:${revisionNumber}`,
    revision: revisionNumber,
    source: "llm",
    proposalId: proposal.proposalId,
    reason:
      proposal.summary?.trim() ||
      "Accepted semantic plan proposal from the LLM.",
    addedNodeIds: addedNodes.map((node) => node.id),
    supersededNodeIds: [...supersededIds],
    createdAt: new Date().toISOString(),
  };
  const nodes = [...existingNodes, ...addedNodes];
  const nextPlan: MonotonicPlan = {
    rootObjective: plan.rootObjective,
    revision: revisionNumber,
    nodes,
    revisions: [...plan.revisions, revision],
    acceptanceCriteria: [
      ...new Set([
        ...plan.acceptanceCriteria,
        ...(proposal.acceptanceCriteria ?? []),
      ]),
    ],
    evidenceRequirements: [
      ...new Set([
        ...plan.evidenceRequirements,
        ...(proposal.evidenceRequirements ?? []),
      ]),
    ],
    constraints: [
      ...new Set([...plan.constraints, ...(proposal.constraints ?? [])]),
    ],
  };
  refreshPlanReadiness(nextPlan);
  return {
    plan: nextPlan,
    revision,
  };
}

function normalizedPlanText(value: string): string {
  return value
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function normalizedPlanPath(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
}

function sameStringArray(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  const normalize = (values: readonly string[] | undefined): string[] =>
    [...(values ?? [])]
      .map((value) => value.trim())
      .filter(Boolean)
      .sort();
  return JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));
}

function samePlanNodeShape(
  left: PlanNodeProposal,
  right: {
    objective: string;
    dependencies: string[];
    kind?: PlanNodeKind;
    scope?: PlanNodeScope;
  },
): boolean {
  return (
    normalizedPlanText(left.objective) ===
      normalizedPlanText(right.objective) &&
    effectiveNodeKind(left) === effectiveNodeKind(right) &&
    sameStringArray(left.dependencies, right.dependencies) &&
    sameStringArray(left.scope?.candidateFiles, right.scope?.candidateFiles) &&
    sameStringArray(left.scope?.allowedTools, right.scope?.allowedTools)
  );
}

/**
 * Add the controller-owned lifecycle fact that a failed node is superseded
 * when the LLM has proposed a clearly corresponding replacement but omitted
 * the bookkeeping field. The LLM still chooses the replacement objective,
 * scope, tools and dependencies; this helper only prevents a valid recovery
 * proposal from being rejected for forgetting monotonic-plan metadata.
 */
export function normalizeRecoveryPlanProposal(
  proposal: PlanProposal,
  existingNodes: readonly {
    id: string;
    objective: string;
    dependencies: string[];
    kind?: PlanNodeKind;
    scope?: PlanNodeScope;
  }[],
  requiredSupersedeNodeId: string,
): { proposal?: PlanProposal; inferred: boolean; reason?: string } {
  const explicitlySupersedes = proposal.supersedes?.includes(
    requiredSupersedeNodeId,
  );
  const failed = existingNodes.find(
    (node) => node.id === requiredSupersedeNodeId,
  );
  if (!failed)
    return {
      inferred: false,
      reason: `Recovery references unknown failed node ${requiredSupersedeNodeId}.`,
    };
  const existingById = new Map(existingNodes.map((node) => [node.id, node]));
  const changedExistingNodes: PlanNodeProposal[] = [];
  const freshNodes: PlanNodeProposal[] = [];
  for (const node of proposal.nodes) {
    const existing = existingById.get(node.id);
    if (!existing) {
      freshNodes.push(node);
      continue;
    }
    // Small local models often echo the still-valid portion of the previous
    // plan during recovery. Preserve that history in the controller graph,
    // but do not submit echoed IDs back through the append-only validator.
    // A changed existing ID is a semantic replacement. Give it a fresh
    // identity below so an imperfect local model returning a full plan
    // snapshot cannot overwrite append-only history. The replacement's
    // objective, scope, tools and dependencies still come from the LLM.
    if (!samePlanNodeShape(node, existing)) changedExistingNodes.push(node);
  }
  if (freshNodes.length === 0 && changedExistingNodes.length === 0)
    return {
      inferred: false,
      reason: "Recovery proposal only repeated existing plan nodes.",
    };

  const usedIds = new Set([
    ...existingNodes.map((node) => node.id),
    ...proposal.nodes.map((node) => node.id),
  ]);
  const replacementIds = new Map<string, string>();
  let replacementNumber = 1;
  for (const node of changedExistingNodes) {
    let replacementId = `${node.id}-recovery-${replacementNumber}`;
    if (replacementId.length > 64)
      replacementId = `${node.id.slice(0, 51)}-repair-${replacementNumber}`;
    while (usedIds.has(replacementId)) {
      replacementNumber += 1;
      replacementId = `${node.id}-recovery-${replacementNumber}`;
      if (replacementId.length > 64)
        replacementId = `${node.id.slice(0, 51)}-repair-${replacementNumber}`;
    }
    usedIds.add(replacementId);
    replacementIds.set(node.id, replacementId);
    replacementNumber += 1;
  }

  const inferredSupersedes = new Set([
    ...(proposal.supersedes ?? []),
    ...changedExistingNodes.map((node) => node.id),
  ]);
  const normalizedNodes = [...changedExistingNodes, ...freshNodes].map(
    (node) => ({
      ...node,
      ...(replacementIds.has(node.id)
        ? { id: replacementIds.get(node.id)! }
        : {}),
      // Preserve dependencies through renamed replacements. A dependency on
      // a superseded failed identity with no replacement is removed: the new
      // node is the recovery boundary and must not wait forever on failed
      // work. All other dependency/lifecycle rules remain host-validated.
      dependencies: node.dependencies
        .map((dependency) => replacementIds.get(dependency) ?? dependency)
        .filter(
          (dependency) =>
            !inferredSupersedes.has(dependency) ||
            replacementIds.has(dependency),
        ),
    }),
  );

  // The LLM owns semantic replanning. Once it explicitly identifies the
  // failed node as superseded and supplies at least one fresh node, the
  // controller must not second-guess the new objective or scope by comparing
  // them with the failed node. A recovery may intentionally change the order
  // or move to a different file (for example, when the worker discovered that
  // the next evidence target was not the node it was executing). Structural
  // validation, workspace boundaries and dependency/lifecycle rules remain
  // authoritative in appendPlanProposal.
  if (explicitlySupersedes)
    return {
      inferred: false,
      proposal: {
        ...proposal,
        nodes: normalizedNodes,
        supersedes: [...inferredSupersedes],
      },
    };

  const failedObjective = normalizedPlanText(failed.objective);
  const failedPaths = new Set(
    (failed.scope?.candidateFiles ?? []).map(normalizedPlanPath),
  );
  const replacementMatches = normalizedNodes.some((node) => {
    const objective = normalizedPlanText(node.objective);
    const objectiveMatches =
      objective.length > 0 &&
      (objective === failedObjective ||
        objective.includes(failedObjective) ||
        failedObjective.includes(objective));
    const pathMatches = (node.scope?.candidateFiles ?? [])
      .map(normalizedPlanPath)
      .some((candidate) => failedPaths.has(candidate));
    return objectiveMatches || pathMatches;
  });
  const failedNodeWasChanged = changedExistingNodes.some(
    (node) => node.id === requiredSupersedeNodeId,
  );
  if (!replacementMatches && !failedNodeWasChanged)
    return {
      inferred: false,
      reason: `Recovery proposal did not identify a replacement for failed node ${requiredSupersedeNodeId} by objective or scope, and it did not explicitly supersede that node.`,
    };
  return {
    inferred: true,
    proposal: {
      ...proposal,
      nodes: normalizedNodes,
      supersedes: [
        ...new Set([...inferredSupersedes, requiredSupersedeNodeId]),
      ],
    },
  };
}

/**
 * Normalize a recovery proposal that does not have one uniquely identified
 * failed node.
 *
 * Local planners often return a complete plan snapshot after a no-action,
 * stagnation, or completion-recovery signal.  The snapshot can legitimately
 * repeat nodes that are already present in the append-only graph.  Repeating
 * those identities must preserve history rather than make the controller
 * reject the whole recovery as a duplicate plan.
 *
 * The controller may discard exact echoes because they add no new semantic
 * work.  It may also assign a fresh identity to an explicitly superseded
 * changed node so the LLM's replacement remains append-only.  It never
 * decides which new semantic nodes to add or how they are ordered.
 */
export function normalizeAppendOnlyRecoveryPlanProposal(
  proposal: PlanProposal,
  existingNodes: readonly {
    id: string;
    objective: string;
    dependencies: string[];
    kind?: PlanNodeKind;
    scope?: PlanNodeScope;
  }[],
): { proposal?: PlanProposal; reason?: string } {
  const existingById = new Map(existingNodes.map((node) => [node.id, node]));
  const explicitSupersedes = new Set(proposal.supersedes ?? []);
  const changedExistingNodes: PlanNodeProposal[] = [];
  const freshNodes: PlanNodeProposal[] = [];
  const repeatedNodeIds: string[] = [];

  for (const node of proposal.nodes) {
    const existing = existingById.get(node.id);
    if (!existing) {
      freshNodes.push(node);
      continue;
    }
    if (samePlanNodeShape(node, existing)) {
      repeatedNodeIds.push(node.id);
      continue;
    }
    if (!explicitSupersedes.has(node.id))
      return {
        reason: `Recovery changed existing node ${node.id}; explicitly list that node in supersedes and provide a fresh replacement id.`,
      };
    changedExistingNodes.push(node);
  }

  if (freshNodes.length === 0 && changedExistingNodes.length === 0)
    return {
      reason:
        repeatedNodeIds.length > 0
          ? "Recovery proposal only repeated existing plan nodes."
          : "Recovery proposal did not add a fresh plan node.",
    };

  const usedIds = new Set([
    ...existingNodes.map((node) => node.id),
    ...proposal.nodes.map((node) => node.id),
  ]);
  const replacementIds = new Map<string, string>();
  let replacementNumber = 1;
  for (const node of changedExistingNodes) {
    let replacementId = `${node.id}-recovery-${replacementNumber}`;
    if (replacementId.length > 64)
      replacementId = `${node.id.slice(0, 51)}-repair-${replacementNumber}`;
    while (usedIds.has(replacementId)) {
      replacementNumber += 1;
      replacementId = `${node.id}-recovery-${replacementNumber}`;
      if (replacementId.length > 64)
        replacementId = `${node.id.slice(0, 51)}-repair-${replacementNumber}`;
    }
    usedIds.add(replacementId);
    replacementIds.set(node.id, replacementId);
    replacementNumber += 1;
  }

  const supersedes = new Set([
    ...explicitSupersedes,
    ...changedExistingNodes.map((node) => node.id),
  ]);
  const normalizedNodes = [...changedExistingNodes, ...freshNodes].map(
    (node) => ({
      ...node,
      ...(replacementIds.has(node.id)
        ? { id: replacementIds.get(node.id)! }
        : {}),
      dependencies: node.dependencies
        .map((dependency) => replacementIds.get(dependency) ?? dependency)
        .filter(
          (dependency) =>
            !supersedes.has(dependency) || replacementIds.has(dependency),
        ),
    }),
  );

  return {
    proposal: {
      ...proposal,
      nodes: normalizedNodes,
      ...(supersedes.size > 0 ? { supersedes: [...supersedes] } : {}),
    },
  };
}

function firstJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const candidates = [
    trimmed,
    trimmed.replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, ""),
  ];
  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      const start = candidate.indexOf("{");
      const end = candidate.lastIndexOf("}");
      if (start >= 0 && end > start) {
        try {
          return JSON.parse(candidate.slice(start, end + 1)) as unknown;
        } catch {
          // Try the next candidate.
        }
      }
    }
  }
  return undefined;
}

function planPrompt(input: PlanModelRequest): string {
  const currentNode = input.existingPlan?.currentNodeId
    ? input.existingPlan.nodes.find(
        (node) => node.id === input.existingPlan?.currentNodeId,
      )
    : undefined;
  const state = input.existingPlan
    ? JSON.stringify({
        revision: input.existingPlan.revision,
        currentNodeId: input.existingPlan.currentNodeId ?? null,
        currentNode: currentNode
          ? {
              id: currentNode.id,
              status: currentNode.status,
              objective: currentNode.objective,
              dependencies: currentNode.dependencies,
              kind: currentNode.kind,
              scope: currentNode.scope,
              requiredEvidence: currentNode.requiredEvidence,
              acceptance: currentNode.acceptance,
              verification: currentNode.verification,
            }
          : null,
        acceptanceCriteria: input.existingPlan.acceptanceCriteria,
        evidenceRequirements: input.existingPlan.evidenceRequirements,
        constraints: input.existingPlan.constraints,
        nodes: input.existingPlan.nodes.map((node) => ({
          id: node.id,
          status: node.status,
          objective: node.objective,
          dependencies: node.dependencies,
          kind: node.kind,
          scope: node.scope,
          requiredEvidence: node.requiredEvidence,
          acceptance: node.acceptance,
          verification: node.verification,
        })),
      })
    : "none";
  const recovery = input.recovery ? JSON.stringify(input.recovery) : "none";
  const context = input.context?.trim()
    ? renderContextPacket(
        compileContextPacket({
          objective: input.objective,
          constraints: input.constraints,
          evidence: [
            {
              source: "host-context",
              kind: "repository",
              summary: input.context,
              relevance: 1,
            },
          ],
          legalActions: [PLAN_TOOL_NAME],
          expectedOutput: "One semantic plan proposal; no workspace mutation.",
          tokenBudget: Math.min(
            4_096,
            Math.max(512, Math.ceil(input.context.length / 4)),
          ),
        }),
      )
    : "";
  return [
    "Create the semantic engineering plan for the user's objective.",
    "Return exactly one ProposeTaskPlan tool call; do not execute tools and do not write prose instead of the plan.",
    "Use stable node ids, explicit dependencies, bounded workspace scope, required evidence and verification for each node. Every node must include scope with both candidateFiles and allowedTools arrays; use [] only for a semantic or clarification node, and give every workspace node the exact relative paths and tools it needs.",
    'Node encoding examples (replace the placeholders with the paths and tools that your plan actually needs): a repository-read node is {kind:"workspace", scope:{candidateFiles:["relative/file"], allowedTools:["ReadFile"]}}; a mutation node is {kind:"workspace", scope:{candidateFiles:["relative/file"], allowedTools:["EditFile","WriteFile"]}}; a semantic node is {kind:"semantic", scope:{candidateFiles:[], allowedTools:[]}}. These examples describe the schema only; you must choose the real semantic order and real scope from the objective and evidence.',
    "The plan order and semantic work belong to you. Use kind=workspace for a node that observes or changes the repository, kind=semantic only for a bounded reasoning/drafting decision over evidence already supplied in this request, and kind=clarification only when an essential user decision is missing. Do not ask about optional formatting, style, naming, implementation-detail choices, or other choices that have a safe conventional default; make that choice inside the relevant work node. Ask only when alternatives are materially incompatible, irreversible, security-sensitive, or change the requested product outcome. A semantic node must have no workspace observation or file mutation responsibility and no workspace tools; a clarification node must have no workspace tools.",
    "Never label an action such as read, inspect, search, locate, extract, parse, verify, create, write, edit, add, fix, implement, generate, build, update, modify, migrate, refactor, rename, configure, or their equivalent in the user's language as kind=semantic when the action still needs repository state or changes files. Use kind=workspace with the smallest legal tool set and explicit candidateFiles. A semantic node may decide how to proceed, but it cannot stand in for a missing ReadFile, SearchText, verification, or mutation.",
    "Every workspace node must declare at least one allowed workspace tool and list every path it may mutate in scope. Never emit kind=workspace with an empty allowedTools list; use kind=semantic or kind=clarification when no workspace action is needed. If one deliverable can be implemented inline or across several files, choose one coherent representation and scope all files for that node; never expect the worker to mutate a path that the node did not declare. Keep optional design decisions inside an implementation node instead of creating blocking semantic nodes.",
    "When an objective requires coordinated changes to coupled artifacts (for example an implementation and its directly related tests, an API and its callers, or a schema and its migration), prefer one coherent workspace node whose candidateFiles covers the coupled mutation when that keeps the change verifiable as a unit. Split work only when the dependency is genuinely independent or a prior node can be verified without making the repository's required checks fail. The controller will not invent a missing repair node after an intermediate failure; you own that semantic decomposition.",
    "The host will enforce permissions and retain the original objective.",
    `Mode: ${input.mode}`,
    `Original objective: ${input.objective}`,
    `Host constraints: ${JSON.stringify(input.constraints)}`,
    `Available tools: ${JSON.stringify(input.allowedTools)}`,
    ...(input.requireWorkspaceMutation
      ? [
          "The current coding task has no successful mutation yet. This proposal must include at least one kind=workspace node with an explicit file mutation tool and candidateFiles; do not return an all-semantic plan.",
        ]
      : []),
    currentNode
      ? `Controller execution state: current node is ${currentNode.id} (${currentNode.status}). Its objective is ${currentNode.objective}. Recovery must make the next node executable from this state; do not ask the worker to perform a later node's action before this node's declared scope is satisfied.`
      : "Controller execution state: there is no active node yet; define the first executable node in your semantic order.",
    `Previous monotonic plan: ${state}`,
    `Recovery context: ${recovery}`,
    input.recovery
      ? "This is a recovery proposal. Return only new replacement/repair nodes, never repeat existing node ids. Preserve valid prior nodes. Include the required failed node id in supersedes (the recovery tool schema requires it) and do not depend on that superseded node. The required superseded node id, when supplied above, is mandatory. If recovery needs a semantic decision, use kind=semantic; if it needs the user, use kind=clarification. When the controller reports an invalid action, make the replacement node's objective, candidateFiles and allowedTools directly address that exact rejected action; a recovery may intentionally change the semantic scope or order, but it must use a new node id. Do not echo the old node as a substitute. If the recovery context says the current plan has no ready node, supersede every obsolete blocked or failed descendant needed to reopen the remaining work and add fresh replacement nodes for the complete remaining semantic path; do not leave all remaining work dependent on blocked or failed history. The controller will not invent those semantic nodes or their order for you. This is not a request for an explanation: the single ProposeTaskPlan call is the only useful response."
      : "This is the initial proposal. Define the semantic work order yourself; do not use a fixed host-generated task tree.",
    input.recovery?.retryReason
      ? `The controller rejected the previous recovery response for this reason: ${input.recovery.retryReason}. Correct that exact problem in this proposal and return the required tool call.`
      : "",
    input.recovery?.supersedeNodeId
      ? `RECOVERY HARD REQUIREMENT: set supersedes to include exactly ${input.recovery.supersedeNodeId}; add at least one fresh replacement node with a new id. The replacement may target a different file or semantic step when the rejected action proves the old scope/order was wrong.`
      : "",
    context
      ? `Relevant repository context:\n${context}`
      : "No repository context was supplied; plan evidence acquisition first.",
  ].join("\n\n");
}

/** Request a semantic plan from the selected provider; no workspace tool is executed here. */
export async function requestModelPlan(
  input: PlanModelRequest,
): Promise<PlanModelResult> {
  const textParts: string[] = [];
  const planCalls: string[] = [];
  try {
    const events: AsyncIterable<ProviderEvent> = input.provider.stream(
      {
        modelId: input.modelId,
        messages: [
          {
            role: "system",
            content:
              "You are ShelraCode's semantic planner. The plan is a proposal, not an execution. Never claim a tool ran.",
          },
          { role: "user", content: planPrompt(input) },
        ],
        tools: [
          input.recovery ? RECOVERY_PLAN_TOOL_DEFINITION : PLAN_TOOL_DEFINITION,
        ],
        toolChoice: "required",
        temperature: 0.1,
        maxOutputTokens: input.maxOutputTokens ?? 1_536,
        stream: true,
      },
      input.signal,
    );
    for await (const event of normalizeProviderEvents(events, 0)) {
      if (event.type === "text.delta") textParts.push(event.text);
      else if (event.type === "tool.call" && event.call.name === PLAN_TOOL_NAME)
        planCalls.push(event.call.arguments);
      else if (event.type === "error")
        return {
          text: textParts.join(""),
          error: `${event.error.code}: ${event.error.message}`,
        };
    }
  } catch (error) {
    if (
      input.signal.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    )
      throw error;
    return {
      text: textParts.join(""),
      error: error instanceof Error ? error.message : String(error),
    };
  }

  for (const raw of planCalls) {
    try {
      const parsed: unknown = JSON.parse(raw);
      const proposal = parsePlanProposal(parsed);
      if (proposal) return { proposal, text: textParts.join("") };
    } catch {
      // The provider emitted a malformed proposal; try a text fallback below.
    }
  }
  const text = textParts.join("");
  const proposal = parsePlanProposal(firstJsonObject(text));
  return proposal
    ? { proposal, text }
    : {
        text,
        error: "The model did not return a valid structured plan proposal.",
      };
}
