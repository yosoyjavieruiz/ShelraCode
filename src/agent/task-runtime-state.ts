import type { AgentTaskLedger } from "./task-state.js";

export const TASK_RUNTIME_SCHEMA_VERSION = 1;

export interface TaskRuntimeRouteIdentity {
  candidateId: string;
  providerId: string;
  modelId?: string;
  runtimeId?: string;
  capability?: string;
}

export interface TaskContextAnchor {
  sourceIds: string[];
  instructionSources: string[];
  memoryIds: string[];
  proofGapIds: string[];
  activeNodeId?: string;
  repositoryRevision?: string;
  summary?: string;
}

export type TaskInFlightKind =
  "model" | "tool" | "mutation" | "verification" | "subagent";

export interface TaskInFlightMarker {
  kind: TaskInFlightKind;
  actionId: string;
  target?: string;
  startedAt: string;
}

export interface TaskRuntimeSnapshot {
  schemaVersion: typeof TASK_RUNTIME_SCHEMA_VERSION;
  taskId: string;
  sessionId?: string;
  repositoryRoot: string;
  repositoryRevision?: string;
  ledger: AgentTaskLedger;
  route?: TaskRuntimeRouteIdentity;
  contextAnchor: TaskContextAnchor;
  activeNodeId?: string;
  inFlight?: TaskInFlightMarker;
  updatedRevision: number;
  updatedAt: string;
  extensions?: Record<string, unknown>;
}

export interface TaskRuntimeSnapshotInput {
  ledger: AgentTaskLedger;
  repositoryRoot: string;
  sessionId?: string;
  repositoryRevision?: string;
  route?: TaskRuntimeRouteIdentity;
  contextAnchor?: Partial<TaskContextAnchor>;
  activeNodeId?: string;
  inFlight?: TaskInFlightMarker;
  updatedRevision?: number;
  updatedAt?: string;
  extensions?: Record<string, unknown>;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function defaultContextAnchor(
  ledger: AgentTaskLedger,
  repositoryRevision: string | undefined,
): TaskContextAnchor {
  return {
    sourceIds: unique([
      ...ledger.evidence.map((item) => item.source),
      ...ledger.filesRead,
      ...ledger.filesChanged,
    ]),
    instructionSources: [],
    memoryIds: [],
    proofGapIds: [],
    ...(ledger.taskGraph?.currentNodeId
      ? { activeNodeId: ledger.taskGraph.currentNodeId }
      : {}),
    ...(repositoryRevision ? { repositoryRevision } : {}),
  };
}

export function createTaskRuntimeSnapshot(
  input: TaskRuntimeSnapshotInput,
): TaskRuntimeSnapshot {
  const repositoryRoot = input.repositoryRoot.trim();
  if (!repositoryRoot)
    throw new Error("runtime snapshot repositoryRoot is required");
  const anchor = defaultContextAnchor(input.ledger, input.repositoryRevision);
  const contextAnchor: TaskContextAnchor = {
    ...anchor,
    ...input.contextAnchor,
    sourceIds: unique(input.contextAnchor?.sourceIds ?? anchor.sourceIds),
    instructionSources: unique(
      input.contextAnchor?.instructionSources ?? anchor.instructionSources,
    ),
    memoryIds: unique(input.contextAnchor?.memoryIds ?? anchor.memoryIds),
    proofGapIds: unique(input.contextAnchor?.proofGapIds ?? anchor.proofGapIds),
  };
  const activeNodeId =
    input.activeNodeId ??
    contextAnchor.activeNodeId ??
    input.ledger.taskGraph?.currentNodeId;
  if (activeNodeId) contextAnchor.activeNodeId = activeNodeId;
  return {
    schemaVersion: TASK_RUNTIME_SCHEMA_VERSION,
    taskId: input.ledger.id,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    repositoryRoot,
    ...(input.repositoryRevision
      ? { repositoryRevision: input.repositoryRevision }
      : {}),
    ledger: structuredClone(input.ledger),
    ...(input.route ? { route: structuredClone(input.route) } : {}),
    contextAnchor,
    ...(activeNodeId ? { activeNodeId } : {}),
    ...(input.inFlight ? { inFlight: structuredClone(input.inFlight) } : {}),
    updatedRevision: input.updatedRevision ?? 0,
    updatedAt: input.updatedAt ?? input.ledger.updatedAt,
    ...(input.extensions
      ? { extensions: structuredClone(input.extensions) }
      : {}),
  };
}
