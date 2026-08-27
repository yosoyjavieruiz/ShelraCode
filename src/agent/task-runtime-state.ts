import type { AgentTaskLedger } from "./task-state.js";

export const TASK_RUNTIME_SCHEMA_VERSION = 1;
const MAX_RUNTIME_WORKTREE_PATHS = 512;

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
  repositoryWorkingTreeRevision?: string;
  summary?: string;
}

/**
 * The small, non-transcript envelope shared by compaction and restart. It
 * identifies what must be reloaded; it deliberately does not contain raw
 * prompts, model output, or tool output.
 */
export interface TaskRuntimeRehydration {
  contextAnchor: TaskContextAnchor;
  route?: TaskRuntimeRouteIdentity;
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
  repositoryWorkingTreeRevision?: string;
  repositoryWorkingTreePaths?: string[];
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
  repositoryWorkingTreeRevision?: string;
  repositoryWorkingTreePaths?: string[];
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

export function deriveTaskContextAnchor(
  ledger: AgentTaskLedger,
  repositoryRevision: string | undefined,
  repositoryWorkingTreeRevision?: string,
): TaskContextAnchor {
  return {
    sourceIds: unique([
      ...ledger.evidence.map((item) => item.source),
      ...ledger.filesRead,
      ...ledger.filesChanged,
    ]),
    instructionSources: [],
    memoryIds: [],
    proofGapIds: unique(ledger.blockers.map((blocker) => blocker.id)),
    ...(ledger.taskGraph?.currentNodeId
      ? { activeNodeId: ledger.taskGraph.currentNodeId }
      : {}),
    ...(repositoryRevision ? { repositoryRevision } : {}),
    ...(repositoryWorkingTreeRevision ? { repositoryWorkingTreeRevision } : {}),
  };
}

export function createTaskRuntimeSnapshot(
  input: TaskRuntimeSnapshotInput,
): TaskRuntimeSnapshot {
  const repositoryRoot = input.repositoryRoot.trim();
  if (!repositoryRoot)
    throw new Error("runtime snapshot repositoryRoot is required");
  const anchor = deriveTaskContextAnchor(
    input.ledger,
    input.repositoryRevision,
    input.repositoryWorkingTreeRevision,
  );
  const contextAnchor: TaskContextAnchor = {
    ...anchor,
    ...input.contextAnchor,
    // A resume anchor is a prior-context hint, not a replacement for facts
    // recorded since that anchor was produced. Keep both sets so a later
    // compaction/restart cannot silently forget newly read or changed files.
    sourceIds: unique([
      ...(input.contextAnchor?.sourceIds ?? []),
      ...anchor.sourceIds,
    ]),
    instructionSources: unique([
      ...(input.contextAnchor?.instructionSources ?? []),
      ...anchor.instructionSources,
    ]),
    memoryIds: unique([
      ...(input.contextAnchor?.memoryIds ?? []),
      ...anchor.memoryIds,
    ]),
    proofGapIds: unique([
      ...(input.contextAnchor?.proofGapIds ?? []),
      ...anchor.proofGapIds,
    ]),
  };
  const activeNodeId =
    input.activeNodeId ??
    input.ledger.taskGraph?.currentNodeId ??
    contextAnchor.activeNodeId;
  if (activeNodeId) contextAnchor.activeNodeId = activeNodeId;
  return {
    schemaVersion: TASK_RUNTIME_SCHEMA_VERSION,
    taskId: input.ledger.id,
    ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    repositoryRoot,
    ...(input.repositoryRevision
      ? { repositoryRevision: input.repositoryRevision }
      : {}),
    ...(input.repositoryWorkingTreeRevision
      ? { repositoryWorkingTreeRevision: input.repositoryWorkingTreeRevision }
      : {}),
    ...(input.repositoryWorkingTreePaths
      ? {
          repositoryWorkingTreePaths: unique(
            input.repositoryWorkingTreePaths,
          ).slice(0, MAX_RUNTIME_WORKTREE_PATHS),
        }
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
