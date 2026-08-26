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
  return arrays.every((key) => Array.isArray(ledger[key]));
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
    snapshot.activeNodeId !== undefined &&
    typeof snapshot.activeNodeId !== "string"
  )
    return invalid("snapshot active node is invalid");
  return { ok: true, snapshot: snapshot as unknown as TaskRuntimeSnapshot };
}
