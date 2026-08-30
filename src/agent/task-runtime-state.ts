import type { AgentTaskLedger } from "./task-state.js";
import { MAX_WORKTREE_PATHS } from "../context/repository-snapshot.js";
import {
  exactModelIdentityDigest,
  type ModelDriverProfile,
} from "../driver/profile.js";
import type { RecoveryLoopSnapshot } from "./recovery.js";
import type { EvidenceRecord } from "../evidence/acceptance.js";
import type { ModelCandidate } from "../shared/types.js";

export const TASK_RUNTIME_SCHEMA_VERSION = 1;

export interface TaskRuntimeRouteIdentity {
  candidateId: string;
  providerId: string;
  modelId?: string;
  runtimeId?: string;
  capability?: string;
  /** Exact certified Driver reference; omitted means authority is unknown. */
  driverProfileId?: string;
  driverIdentityDigest?: string;
  configurationDigest?: string;
}

export interface TaskRuntimeDriverReference {
  driverProfileId: string;
  driverIdentityDigest: string;
  configurationDigest: string;
}

/**
 * Revalidate a persisted exact Driver reference against facts observed by the
 * current host. A runtime snapshot is durable state, not current authority:
 * missing profiles, stale configuration, changed runtime metadata, expired
 * profiles, and partial references all fail closed by returning undefined.
 */
export function revalidateTaskRuntimeDriverReference(
  route: TaskRuntimeRouteIdentity | undefined,
  profile: ModelDriverProfile | undefined,
  candidate: ModelCandidate,
  currentConfigurationDigest: string | undefined,
  now = new Date(),
): TaskRuntimeDriverReference | undefined {
  if (!route || !profile) return undefined;
  if (
    route.candidateId !== candidate.id ||
    route.providerId !== candidate.providerId ||
    (route.modelId !== undefined && route.modelId !== candidate.modelId) ||
    (route.runtimeId !== undefined &&
      route.runtimeId !== candidate.local?.runtime)
  )
    return undefined;
  if (
    !route.driverProfileId ||
    !route.driverIdentityDigest ||
    !route.configurationDigest
  )
    return undefined;
  if (
    profile.status !== "certified" ||
    profile.id !== route.driverProfileId ||
    profile.identityDigest !== route.driverIdentityDigest
  )
    return undefined;
  if (
    !currentConfigurationDigest ||
    currentConfigurationDigest.trim() !== route.configurationDigest
  )
    return undefined;
  if (profile.expiresAt) {
    const expiresAt = Date.parse(profile.expiresAt);
    if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime())
      return undefined;
  }
  try {
    if (exactModelIdentityDigest(profile.identity) !== profile.identityDigest)
      return undefined;
  } catch {
    return undefined;
  }

  const identity = profile.identity;
  const local = candidate.local;
  // These are the runtime facts the catalog can currently expose. Unknown
  // values are not treated as equal: an exact authority reference cannot be
  // restored when the host cannot prove the same artifact/runtime/template.
  if (
    candidate.providerId !== identity.providerFamily ||
    candidate.modelId !== identity.modelId ||
    !local ||
    local.runtime !== identity.runtime
  )
    return undefined;
  if (
    identity.runtimeVersion !== null &&
    local.runtimeVersion !== identity.runtimeVersion
  )
    return undefined;
  if (identity.quantization !== null && local.quant !== identity.quantization)
    return undefined;
  if (identity.artifactId !== null && local.artifactId !== identity.artifactId)
    return undefined;
  if (
    identity.chatTemplate !== null &&
    local.chatTemplate !== identity.chatTemplate
  )
    return undefined;
  if (
    identity.toolTemplate !== null &&
    local.toolParser !== identity.toolTemplate
  )
    return undefined;

  return {
    driverProfileId: route.driverProfileId,
    driverIdentityDigest: route.driverIdentityDigest,
    configurationDigest: route.configurationDigest,
  };
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
  checkpointId?: string;
  recoveryHistory?: RecoveryLoopSnapshot;
  acceptanceEvidence?: EvidenceRecord[];
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
  checkpointId?: string;
  recoveryHistory?: RecoveryLoopSnapshot;
  acceptanceEvidence?: EvidenceRecord[];
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
  checkpointId?: string;
  recoveryHistory?: RecoveryLoopSnapshot;
  acceptanceEvidence?: EvidenceRecord[];
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
          ).slice(0, MAX_WORKTREE_PATHS),
        }
      : {}),
    ledger: structuredClone(input.ledger),
    ...(input.route ? { route: structuredClone(input.route) } : {}),
    contextAnchor,
    ...(input.checkpointId?.trim()
      ? { checkpointId: input.checkpointId.trim() }
      : {}),
    ...(input.recoveryHistory
      ? { recoveryHistory: structuredClone(input.recoveryHistory) }
      : {}),
    ...(input.acceptanceEvidence
      ? { acceptanceEvidence: structuredClone(input.acceptanceEvidence) }
      : {}),
    ...(activeNodeId ? { activeNodeId } : {}),
    ...(input.inFlight ? { inFlight: structuredClone(input.inFlight) } : {}),
    updatedRevision: input.updatedRevision ?? 0,
    updatedAt: input.updatedAt ?? input.ledger.updatedAt,
    ...(input.extensions
      ? { extensions: structuredClone(input.extensions) }
      : {}),
  };
}
