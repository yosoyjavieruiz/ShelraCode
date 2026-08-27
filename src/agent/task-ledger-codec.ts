import type { AgentTaskLedger, AgentPhase } from "./task-state.js";
import {
  createTaskRuntimeSnapshot,
  TASK_RUNTIME_SCHEMA_VERSION,
  type TaskRuntimeSnapshot,
  type TaskRuntimeSnapshotInput,
} from "./task-runtime-state.js";

export interface RuntimeSnapshotFailure {
  code: "INVALID_RUNTIME_SNAPSHOT";
  reason: string;
  details?: Record<string, unknown>;
}

export type RuntimeRestoreResult =
  | { ok: true; snapshot: TaskRuntimeSnapshot }
  | { ok: false; error: RuntimeSnapshotFailure };

const phases = new Set<AgentPhase>([
  "frame",
  "discover",
  "analyze",
  "plan",
  "act",
  "observe",
  "reflect",
  "verify",
  "review",
  "complete",
  "blocked",
  "failed",
  "cancelled",
]);
const modes = new Set([
  "conversation",
  "knowledge",
  "workspace_question",
  "plan",
  "review",
  "coding",
  "command",
]);
const inFlightKinds = new Set([
  "model",
  "tool",
  "mutation",
  "verification",
  "subagent",
]);
const taskNodeStatuses = new Set([
  "pending",
  "blocked",
  "ready",
  "running",
  "verifying",
  "passed",
  "failed",
  "superseded",
]);
const planStepStatuses = new Set([
  "pending",
  "active",
  "done",
  "failed",
  "skipped",
]);
const planNodeKinds = new Set(["workspace", "semantic", "clarification"]);
const planNodeSources = new Set(["model", "controller", "controller-recovery"]);
const planRevisionSources = new Set(["llm", "controller"]);
const recoveryStrategies = new Set([
  "retry",
  "retrieve_more",
  "repair",
  "replan",
  "decompose",
  "switch_model",
  "ask_user",
  "stop",
]);
const verificationStages = new Set(["test", "typecheck", "lint", "build"]);
const contractStatuses = new Set(["compiled", "clarification_required"]);
const criterionStatuses = new Set([
  "unknown",
  "satisfied",
  "failed",
  "not_applicable",
]);
const contractEvidenceKinds = new Set([
  "repository",
  "scope",
  "artifact",
  "verification",
  "review",
]);
const executionProfiles = new Set([
  "conversation",
  "direct",
  "linear",
  "structured",
  "decomposed",
]);

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.trim().length > 0)
  );
}

function boundedArray(value: unknown, max = 512): value is unknown[] {
  return Array.isArray(value) && value.length <= max;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function nonNegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function validPlanRevision(value: unknown): boolean {
  const revision = record(value);
  return Boolean(
    revision &&
    typeof revision.id === "string" &&
    revision.id.length > 0 &&
    nonNegativeInteger(revision.revision) &&
    typeof revision.source === "string" &&
    planRevisionSources.has(revision.source) &&
    typeof revision.proposalId === "string" &&
    revision.proposalId.length > 0 &&
    typeof revision.reason === "string" &&
    boundedArray(revision.addedNodeIds, 64) &&
    stringArray(revision.addedNodeIds) &&
    boundedArray(revision.supersededNodeIds, 64) &&
    stringArray(revision.supersededNodeIds) &&
    typeof revision.createdAt === "string" &&
    revision.createdAt.length > 0,
  );
}

function validTaskGraph(value: unknown): boolean {
  const graph = record(value);
  if (
    !graph ||
    typeof graph.rootObjective !== "string" ||
    graph.rootObjective.trim().length === 0 ||
    !boundedArray(graph.globalConstraints, 128) ||
    !stringArray(graph.globalConstraints) ||
    !boundedArray(graph.nodes, 64) ||
    typeof graph.currentNodeId !== "string" ||
    (graph.planSource !== undefined &&
      !["model", "mixed", "compatibility"].includes(
        String(graph.planSource),
      )) ||
    (graph.revision !== undefined && !nonNegativeInteger(graph.revision)) ||
    (graph.revisions !== undefined &&
      (!boundedArray(graph.revisions, 128) ||
        !graph.revisions.every(validPlanRevision))) ||
    (graph.acceptanceCriteria !== undefined &&
      (!boundedArray(graph.acceptanceCriteria, 128) ||
        !stringArray(graph.acceptanceCriteria))) ||
    (graph.evidenceRequirements !== undefined &&
      (!boundedArray(graph.evidenceRequirements, 128) ||
        !stringArray(graph.evidenceRequirements)))
  )
    return false;

  const ids = new Set<string>();
  for (const value of graph.nodes) {
    const node = record(value);
    const scope = node ? record(node.scope) : undefined;
    if (
      !node ||
      typeof node.id !== "string" ||
      node.id.trim().length === 0 ||
      ids.has(node.id) ||
      typeof node.objective !== "string" ||
      node.objective.trim().length === 0 ||
      !boundedArray(node.dependencies, 64) ||
      !stringArray(node.dependencies) ||
      (node.kind !== undefined &&
        (typeof node.kind !== "string" || !planNodeKinds.has(node.kind))) ||
      typeof node.status !== "string" ||
      !taskNodeStatuses.has(node.status) ||
      !scope ||
      !boundedArray(scope.candidateFiles, 64) ||
      !stringArray(scope.candidateFiles) ||
      !boundedArray(scope.allowedTools, 64) ||
      !stringArray(scope.allowedTools) ||
      !boundedArray(node.contextRequirements, 64) ||
      !stringArray(node.contextRequirements) ||
      !boundedArray(node.acceptance, 64) ||
      !stringArray(node.acceptance) ||
      (node.verification !== undefined &&
        (!boundedArray(node.verification, 64) ||
          !stringArray(node.verification))) ||
      !nonNegativeInteger(node.attempts) ||
      (node.source !== undefined &&
        (typeof node.source !== "string" ||
          !planNodeSources.has(node.source))) ||
      (node.revision !== undefined && !nonNegativeInteger(node.revision)) ||
      !optionalString(node.lastFailure)
    )
      return false;
    ids.add(node.id);
  }
  return (
    (graph.currentNodeId === "" || ids.has(graph.currentNodeId)) &&
    graph.nodes.every((value) => {
      const node = record(value)!;
      return (node.dependencies as string[]).every((dependency) =>
        ids.has(dependency),
      );
    })
  );
}

function validTaskPlan(value: unknown): boolean {
  const plan = record(value);
  if (
    !plan ||
    !boundedArray(plan.steps, 64) ||
    typeof plan.updatedAt !== "string" ||
    plan.updatedAt.length === 0 ||
    (plan.source !== undefined &&
      !["model", "controller"].includes(String(plan.source))) ||
    (plan.revision !== undefined && !nonNegativeInteger(plan.revision)) ||
    (plan.revisions !== undefined &&
      (!boundedArray(plan.revisions, 128) ||
        !plan.revisions.every(validPlanRevision))) ||
    (plan.objective !== undefined && typeof plan.objective !== "string") ||
    (plan.acceptanceCriteria !== undefined &&
      (!boundedArray(plan.acceptanceCriteria, 128) ||
        !stringArray(plan.acceptanceCriteria))) ||
    (plan.evidenceRequirements !== undefined &&
      (!boundedArray(plan.evidenceRequirements, 128) ||
        !stringArray(plan.evidenceRequirements)))
  )
    return false;
  const ids = new Set<string>();
  for (const value of plan.steps) {
    const step = record(value);
    if (
      !step ||
      typeof step.id !== "string" ||
      step.id.trim().length === 0 ||
      ids.has(step.id) ||
      typeof step.description !== "string" ||
      step.description.trim().length === 0 ||
      typeof step.status !== "string" ||
      !planStepStatuses.has(step.status) ||
      (step.kind !== undefined && !planNodeKinds.has(String(step.kind))) ||
      (step.source !== undefined &&
        !planNodeSources.has(String(step.source))) ||
      (step.revision !== undefined && !nonNegativeInteger(step.revision)) ||
      (step.dependencies !== undefined &&
        (!boundedArray(step.dependencies, 64) ||
          !stringArray(step.dependencies))) ||
      (step.scope !== undefined &&
        (!boundedArray(step.scope, 64) || !stringArray(step.scope))) ||
      (step.evidenceRequired !== undefined &&
        (!boundedArray(step.evidenceRequired, 64) ||
          !stringArray(step.evidenceRequired))) ||
      (step.verification !== undefined &&
        (!boundedArray(step.verification, 64) ||
          !stringArray(step.verification)))
    )
      return false;
    ids.add(step.id);
  }
  return plan.steps.every((value) => {
    const dependencies = record(value)?.dependencies;
    return (
      dependencies === undefined ||
      (dependencies as string[]).every((dependency) => ids.has(dependency))
    );
  });
}

function validTaskContract(value: unknown): boolean {
  const contract = record(value);
  if (
    !contract ||
    typeof contract.id !== "string" ||
    contract.id.length === 0 ||
    typeof contract.originalRequest !== "string" ||
    typeof contract.objective !== "string" ||
    typeof contract.mode !== "string" ||
    !modes.has(contract.mode) ||
    !boundedArray(contract.deliverables, 64) ||
    !boundedArray(contract.constraints, 128) ||
    !boundedArray(contract.nonGoals, 128) ||
    !stringArray(contract.nonGoals) ||
    !boundedArray(contract.acceptanceCriteria, 128) ||
    !boundedArray(contract.evidenceRequirements, 128) ||
    !record(contract.risk) ||
    !record(contract.repositoryScope) ||
    !record(contract.permissions) ||
    !boundedArray(contract.uncertainty, 128) ||
    !record(contract.verificationIntent) ||
    typeof contract.status !== "string" ||
    !contractStatuses.has(contract.status) ||
    (contract.executionProfile !== undefined &&
      (typeof contract.executionProfile !== "string" ||
        !executionProfiles.has(contract.executionProfile)))
  )
    return false;
  const risk = record(contract.risk)!;
  const repositoryScope = record(contract.repositoryScope)!;
  const permissions = record(contract.permissions)!;
  const verificationIntent = record(contract.verificationIntent)!;
  if (
    typeof risk.score !== "number" ||
    !Number.isFinite(risk.score) ||
    !["low", "medium", "high", "critical"].includes(String(risk.level)) ||
    !boundedArray(risk.reasons, 64) ||
    !stringArray(risk.reasons) ||
    !boundedArray(repositoryScope.explicitPaths, 128) ||
    !stringArray(repositoryScope.explicitPaths) ||
    !boundedArray(repositoryScope.explicitCommands, 128) ||
    !stringArray(repositoryScope.explicitCommands) ||
    typeof permissions.repositoryRead !== "boolean" ||
    typeof permissions.repositoryWrite !== "boolean" ||
    typeof permissions.execute !== "boolean" ||
    typeof permissions.network !== "boolean" ||
    !["required", "optional", "not_required"].includes(
      String(verificationIntent.projectChecks),
    ) ||
    !["required", "optional"].includes(
      String(verificationIntent.objectiveEvidence),
    ) ||
    !["required", "optional"].includes(String(verificationIntent.finalReview))
  )
    return false;
  for (const value of contract.constraints) {
    const constraint = record(value);
    if (
      !constraint ||
      typeof constraint.id !== "string" ||
      typeof constraint.description !== "string" ||
      !["user", "controller"].includes(String(constraint.source))
    )
      return false;
  }
  for (const value of contract.deliverables) {
    const deliverable = record(value);
    if (
      !deliverable ||
      typeof deliverable.id !== "string" ||
      typeof deliverable.description !== "string" ||
      typeof deliverable.kind !== "string" ||
      typeof deliverable.required !== "boolean" ||
      !boundedArray(deliverable.dependencies, 64) ||
      !stringArray(deliverable.dependencies) ||
      !boundedArray(deliverable.evidence, 64) ||
      !stringArray(deliverable.evidence) ||
      typeof deliverable.status !== "string" ||
      !criterionStatuses.has(deliverable.status) ||
      (deliverable.targetPaths !== undefined &&
        (!boundedArray(deliverable.targetPaths, 64) ||
          !stringArray(deliverable.targetPaths))) ||
      (deliverable.artifactExpectations !== undefined &&
        (!boundedArray(deliverable.artifactExpectations, 64) ||
          !deliverable.artifactExpectations.every((expectation) => {
            const item = record(expectation);
            return Boolean(
              item &&
              ["exact_text", "contains_text", "excludes_text"].includes(
                String(item.type),
              ) &&
              typeof item.value === "string",
            );
          })))
    )
      return false;
  }
  for (const value of contract.acceptanceCriteria) {
    const criterion = record(value);
    if (
      !criterion ||
      typeof criterion.id !== "string" ||
      typeof criterion.description !== "string" ||
      typeof criterion.required !== "boolean" ||
      (criterion.verificationClass !== undefined &&
        typeof criterion.verificationClass !== "string") ||
      !boundedArray(criterion.evidence, 64) ||
      !stringArray(criterion.evidence) ||
      typeof criterion.status !== "string" ||
      !criterionStatuses.has(criterion.status)
    )
      return false;
  }
  for (const value of contract.evidenceRequirements) {
    const requirement = record(value);
    if (
      !requirement ||
      typeof requirement.id !== "string" ||
      typeof requirement.description !== "string" ||
      typeof requirement.kind !== "string" ||
      !contractEvidenceKinds.has(requirement.kind) ||
      typeof requirement.required !== "boolean"
    )
      return false;
  }
  return contract.uncertainty.every((value) => {
    const item = record(value);
    return Boolean(
      item &&
      typeof item.id === "string" &&
      typeof item.description === "string" &&
      typeof item.blocking === "boolean",
    );
  });
}

function validVerificationPlan(value: unknown): boolean {
  return (
    boundedArray(value, 32) &&
    value.every((item) => {
      const plan = record(item);
      return Boolean(
        plan &&
        typeof plan.stage === "string" &&
        verificationStages.has(plan.stage) &&
        typeof plan.command === "string" &&
        plan.command.trim().length > 0,
      );
    })
  );
}

function validLedger(value: unknown): value is AgentTaskLedger {
  const ledger = record(value);
  if (!ledger) return false;
  if (
    typeof ledger.id !== "string" ||
    typeof ledger.objective !== "string" ||
    typeof ledger.mode !== "string" ||
    !modes.has(ledger.mode) ||
    typeof ledger.phase !== "string" ||
    !phases.has(ledger.phase as AgentPhase)
  )
    return false;
  const arrays = [
    "successCriteria",
    "constraints",
    "evidence",
    "hypotheses",
    "actions",
    "filesRead",
    "filesChanged",
    "verificationRuns",
    "blockers",
    "planRevisions",
    "recoveryContracts",
    "verificationPlan",
  ];
  if (
    typeof ledger.startedAt !== "string" ||
    ledger.startedAt.length === 0 ||
    typeof ledger.updatedAt !== "string" ||
    ledger.updatedAt.length === 0 ||
    !arrays.every((key) => boundedArray(ledger[key])) ||
    (ledger.executionProfile !== undefined &&
      (typeof ledger.executionProfile !== "string" ||
        !executionProfiles.has(ledger.executionProfile))) ||
    (ledger.planningMode !== undefined &&
      !["none", "model", "compatibility"].includes(
        String(ledger.planningMode),
      )) ||
    (ledger.contract !== undefined && !validTaskContract(ledger.contract)) ||
    (ledger.plan !== undefined && !validTaskPlan(ledger.plan)) ||
    (ledger.taskGraph !== undefined && !validTaskGraph(ledger.taskGraph)) ||
    !validVerificationPlan(ledger.verificationPlan)
  )
    return false;
  const successCriteria = ledger.successCriteria as unknown[];
  const constraints = ledger.constraints as unknown[];
  const evidence = ledger.evidence as unknown[];
  const actions = ledger.actions as unknown[];
  const verificationRuns = ledger.verificationRuns as unknown[];
  const blockers = ledger.blockers as unknown[];
  const planRevisions = ledger.planRevisions as unknown[];
  const recoveryContracts = ledger.recoveryContracts as unknown[];
  return (
    successCriteria.every((value) => {
      const criterion = record(value);
      return Boolean(
        criterion &&
        typeof criterion.id === "string" &&
        typeof criterion.description === "string" &&
        typeof criterion.required === "boolean" &&
        typeof criterion.satisfied === "boolean",
      );
    }) &&
    constraints.every((value) => {
      const constraint = record(value);
      return Boolean(
        constraint &&
        typeof constraint.id === "string" &&
        typeof constraint.description === "string",
      );
    }) &&
    evidence.every((value) => {
      const evidence = record(value);
      return Boolean(
        evidence &&
        typeof evidence.id === "string" &&
        typeof evidence.kind === "string" &&
        typeof evidence.source === "string" &&
        typeof evidence.summary === "string" &&
        typeof evidence.relevance === "number" &&
        typeof evidence.freshness === "number",
      );
    }) &&
    actions.every((value) => {
      const action = record(value);
      return Boolean(
        action &&
        typeof action.id === "string" &&
        [
          "read",
          "search",
          "write",
          "execute",
          "verify",
          "review",
          "decide",
        ].includes(String(action.kind)) &&
        typeof action.target === "string" &&
        ["running", "succeeded", "failed", "cancelled"].includes(
          String(action.status),
        ) &&
        optionalString(action.startedAt) &&
        optionalString(action.completedAt) &&
        optionalString(action.summary),
      );
    }) &&
    verificationRuns.every((value) => {
      const run = record(value);
      return Boolean(
        run &&
        typeof run.id === "string" &&
        (run.stage === undefined ||
          (typeof run.stage === "string" &&
            verificationStages.has(run.stage))) &&
        typeof run.command === "string" &&
        ["running", "passed", "failed", "cancelled"].includes(
          String(run.status),
        ) &&
        (run.exitCode === undefined || typeof run.exitCode === "number") &&
        optionalString(run.summary) &&
        (run.failurePaths === undefined ||
          (boundedArray(run.failurePaths, 64) &&
            stringArray(run.failurePaths))) &&
        typeof run.startedAt === "string" &&
        optionalString(run.completedAt),
      );
    }) &&
    blockers.every((value) => {
      const blocker = record(value);
      return Boolean(
        blocker &&
        typeof blocker.id === "string" &&
        typeof blocker.summary === "string" &&
        typeof blocker.recoverable === "boolean" &&
        optionalString(blocker.suggestedAction),
      );
    }) &&
    planRevisions.every(validPlanRevision) &&
    recoveryContracts.every((value) => {
      const recovery = record(value);
      return Boolean(
        recovery &&
        typeof recovery.id === "string" &&
        typeof recovery.cause === "string" &&
        optionalString(recovery.failedRequirement) &&
        boundedArray(recovery.evidence, 64) &&
        stringArray(recovery.evidence) &&
        boundedArray(recovery.attemptedStrategies, 64) &&
        stringArray(recovery.attemptedStrategies) &&
        boundedArray(recovery.forbiddenRepeats, 64) &&
        stringArray(recovery.forbiddenRepeats) &&
        optionalString(recovery.supersedeNodeId) &&
        typeof recovery.proposedRecovery === "string" &&
        recoveryStrategies.has(recovery.proposedRecovery) &&
        typeof recovery.createdAt === "string",
      );
    })
  );
}

function validRoute(value: unknown): boolean {
  const route = record(value);
  return Boolean(
    route &&
    typeof route.candidateId === "string" &&
    route.candidateId.length > 0 &&
    typeof route.providerId === "string" &&
    route.providerId.length > 0 &&
    (route.modelId === undefined || typeof route.modelId === "string") &&
    (route.runtimeId === undefined || typeof route.runtimeId === "string") &&
    (route.capability === undefined || typeof route.capability === "string"),
  );
}

function validAnchor(value: unknown): boolean {
  const anchor = record(value);
  return Boolean(
    anchor &&
    stringArray(anchor.sourceIds) &&
    stringArray(anchor.instructionSources) &&
    stringArray(anchor.memoryIds) &&
    stringArray(anchor.proofGapIds) &&
    (anchor.activeNodeId === undefined ||
      typeof anchor.activeNodeId === "string") &&
    (anchor.repositoryRevision === undefined ||
      typeof anchor.repositoryRevision === "string") &&
    (anchor.repositoryWorkingTreeRevision === undefined ||
      typeof anchor.repositoryWorkingTreeRevision === "string") &&
    (anchor.summary === undefined || typeof anchor.summary === "string"),
  );
}

function validInFlight(value: unknown): boolean {
  const marker = record(value);
  return Boolean(
    marker &&
    typeof marker.kind === "string" &&
    inFlightKinds.has(marker.kind) &&
    typeof marker.actionId === "string" &&
    marker.actionId.length > 0 &&
    typeof marker.startedAt === "string" &&
    (marker.target === undefined || typeof marker.target === "string"),
  );
}

function invalid(
  reason: string,
  details?: Record<string, unknown>,
): RuntimeRestoreResult {
  return {
    ok: false,
    error: {
      code: "INVALID_RUNTIME_SNAPSHOT",
      reason,
      ...(details ? { details } : {}),
    },
  };
}

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|AIza[A-Za-z0-9_-]{30,}|AKIA[0-9A-Z]{16})\b/g,
  /(\b(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*["'])[^"']+(?=["'])/gi,
];

function safeText(value: string): string {
  return SECRET_PATTERNS.reduce(
    (current, pattern) =>
      current.replace(pattern, (match: string, prefix?: string) =>
        typeof prefix === "string" ? `${prefix}[REDACTED]` : "[REDACTED]",
      ),
    value.slice(0, 8_000),
  );
}

function sanitize(value: unknown, key = "", depth = 0): unknown {
  if (depth > 12) return "[TRUNCATED]";
  if (typeof value === "string") return safeText(value);
  if (typeof value !== "object" || value === null) return value;
  if (Array.isArray(value))
    return value.slice(0, 512).map((item) => sanitize(item, key, depth + 1));
  const source = value as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const [childKey, childValue] of Object.entries(source)) {
    // Raw model messages/tool outputs are intentionally not part of the
    // durable ledger contract. Summaries and structured evidence remain.
    if (
      /^(?:raw|prompt|modelOutput|chainOfThought|toolResult|messages)/iu.test(
        childKey,
      ) ||
      childKey.toLowerCase() === "output"
    )
      continue;
    result[childKey] = sanitize(childValue, childKey, depth + 1);
  }
  void key;
  return result;
}

function prepareSnapshot(
  input: TaskRuntimeSnapshot | TaskRuntimeSnapshotInput,
): TaskRuntimeSnapshot {
  if (
    "schemaVersion" in input &&
    input.schemaVersion === TASK_RUNTIME_SCHEMA_VERSION
  )
    return structuredClone(input);
  return createTaskRuntimeSnapshot(input);
}

export function serializeTaskRuntime(
  input: TaskRuntimeSnapshot | TaskRuntimeSnapshotInput,
): string {
  const snapshot = prepareSnapshot(input);
  return JSON.stringify(sanitize(snapshot));
}

export function restoreTaskRuntime(
  value: string | unknown,
): RuntimeRestoreResult {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return invalid("snapshot is not valid JSON");
    }
  }
  const snapshot = record(parsed);
  if (!snapshot) return invalid("snapshot must be an object");
  if (snapshot.schemaVersion !== TASK_RUNTIME_SCHEMA_VERSION)
    return invalid("unsupported runtime snapshot schema version", {
      received: snapshot.schemaVersion,
      supported: TASK_RUNTIME_SCHEMA_VERSION,
    });
  if (
    typeof snapshot.taskId !== "string" ||
    snapshot.taskId.length === 0 ||
    typeof snapshot.repositoryRoot !== "string" ||
    snapshot.repositoryRoot.length === 0 ||
    !validLedger(snapshot.ledger) ||
    !validAnchor(snapshot.contextAnchor) ||
    typeof snapshot.updatedRevision !== "number" ||
    !Number.isInteger(snapshot.updatedRevision) ||
    snapshot.updatedRevision < 0 ||
    typeof snapshot.updatedAt !== "string"
  )
    return invalid("snapshot has missing or invalid required fields");
  if (
    snapshot.taskId !==
    (snapshot.ledger as unknown as Record<string, unknown>).id
  )
    return invalid("snapshot taskId does not match its ledger id");
  const ledger = snapshot.ledger as unknown as Record<string, unknown>;
  const graph = ledger.taskGraph;
  if (
    graph &&
    snapshot.activeNodeId !== undefined &&
    !(
      (graph as Record<string, unknown>).nodes as Array<Record<string, unknown>>
    ).some((node) => node.id === snapshot.activeNodeId)
  )
    return invalid("snapshot active node is not present in its task graph");
  if (snapshot.route !== undefined && !validRoute(snapshot.route))
    return invalid("snapshot route identity is invalid");
  if (snapshot.inFlight !== undefined && !validInFlight(snapshot.inFlight))
    return invalid("snapshot in-flight marker is invalid");
  if (
    snapshot.sessionId !== undefined &&
    (typeof snapshot.sessionId !== "string" || snapshot.sessionId.length === 0)
  )
    return invalid("snapshot sessionId is invalid");
  if (
    snapshot.repositoryRevision !== undefined &&
    typeof snapshot.repositoryRevision !== "string"
  )
    return invalid("snapshot repository revision is invalid");
  if (
    snapshot.repositoryWorkingTreeRevision !== undefined &&
    typeof snapshot.repositoryWorkingTreeRevision !== "string"
  )
    return invalid("snapshot working-tree revision is invalid");
  if (
    snapshot.activeNodeId !== undefined &&
    typeof snapshot.activeNodeId !== "string"
  )
    return invalid("snapshot active node is invalid");
  return { ok: true, snapshot: snapshot as unknown as TaskRuntimeSnapshot };
}
