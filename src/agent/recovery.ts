import { createHash } from "node:crypto";
import { redactEvaluationValue } from "../evals/redaction.js";

export type RecoveryStrategy =
  | "retry"
  | "retrieve_more"
  | "repair"
  | "replan"
  | "decompose"
  | "switch_model"
  | "ask_user"
  | "stop";

/**
 * Host-owned failure taxonomy used by recovery and evaluation.  These values
 * deliberately describe the boundary that failed, rather than repeating a
 * provider or tool's free-form error message.
 */
export type FailureClass =
  | "PROTOCOL_PARSE_FAILURE"
  | "SCHEMA_FAILURE"
  | "ILLEGAL_ACTION"
  | "STALE_EDIT"
  | "PATCH_APPLY_FAILURE"
  | "FILE_NOT_FOUND"
  | "SYMBOL_NOT_FOUND"
  | "COMMAND_FAILURE"
  | "TEST_FAILURE"
  | "BUILD_FAILURE"
  | "TYPE_FAILURE"
  | "TIMEOUT"
  | "CONTEXT_OVERFLOW"
  | "MODEL_REFUSAL"
  | "NO_PROGRESS"
  | "REPEATED_ACTION"
  | "CONTRADICTORY_STATE"
  | "SECURITY_DENIAL"
  | "RUNTIME_UNAVAILABLE"
  | "EXPERT_ESCALATION_REQUIRED"
  | "CANCELLED"
  | "UNKNOWN";

export const FAILURE_CLASSES: ReadonlySet<FailureClass> = new Set([
  "PROTOCOL_PARSE_FAILURE",
  "SCHEMA_FAILURE",
  "ILLEGAL_ACTION",
  "STALE_EDIT",
  "PATCH_APPLY_FAILURE",
  "FILE_NOT_FOUND",
  "SYMBOL_NOT_FOUND",
  "COMMAND_FAILURE",
  "TEST_FAILURE",
  "BUILD_FAILURE",
  "TYPE_FAILURE",
  "TIMEOUT",
  "CONTEXT_OVERFLOW",
  "MODEL_REFUSAL",
  "NO_PROGRESS",
  "REPEATED_ACTION",
  "CONTRADICTORY_STATE",
  "SECURITY_DENIAL",
  "RUNTIME_UNAVAILABLE",
  "EXPERT_ESCALATION_REQUIRED",
  "CANCELLED",
  "UNKNOWN",
]);

/** Semantic recovery actions.  They are more precise than the legacy
 * `RecoveryStrategy` values retained for serialized plan compatibility. */
export type RecoveryAction =
  | "retry_same"
  | "repair_syntax"
  | "change_representation"
  | "relocalize"
  | "decompose"
  | "rollback"
  | "ask_expert"
  | "switch_model"
  | "stop";

export const RECOVERY_ACTIONS: ReadonlySet<RecoveryAction> = new Set([
  "retry_same",
  "repair_syntax",
  "change_representation",
  "relocalize",
  "decompose",
  "rollback",
  "ask_expert",
  "switch_model",
  "stop",
]);

/** Preserve the older serialized planner vocabulary at the ledger boundary. */
export function toLegacyRecoveryStrategy(
  action: RecoveryAction,
): RecoveryStrategy {
  switch (action) {
    case "retry_same":
      return "retry";
    case "repair_syntax":
    case "change_representation":
      return "repair";
    case "relocalize":
      return "retrieve_more";
    case "decompose":
      return "decompose";
    case "rollback":
      return "stop";
    case "ask_expert":
      return "ask_user";
    case "switch_model":
      return "switch_model";
    case "stop":
      return "stop";
  }
}

export interface RecoveryPolicy {
  schemaVersion: 1;
  id: string;
  /** Maximum occurrences of one action/state/failure signature. */
  maxAttemptsPerSignature: number;
  /** Maximum consecutive no-progress observations for one failure class. */
  maxAttemptsPerFailureClass: number;
  /** Hard cap across all recovery observations for this task. */
  maxTotalAttempts: number;
  /** If true, repeated failures may not select `retry_same`. */
  requireChangedStrategy: boolean;
  /** A security failure never enters this list; it always stops. */
  strategyOrder: readonly RecoveryAction[];
}

export interface RecoveryPolicyInput {
  id?: string;
  maxAttemptsPerSignature?: number;
  maxAttemptsPerFailureClass?: number;
  maxTotalAttempts?: number;
  requireChangedStrategy?: boolean;
  strategyOrder?: readonly RecoveryAction[];
}

const DEFAULT_STRATEGY_ORDER: readonly RecoveryAction[] = [
  "repair_syntax",
  "relocalize",
  "decompose",
  "change_representation",
  "rollback",
  "ask_expert",
  "switch_model",
  "stop",
];

function boundedPositiveInteger(
  value: number | undefined,
  fallback: number,
  label: string,
): number {
  const next = value ?? fallback;
  if (!Number.isSafeInteger(next) || next < 1 || next > 64)
    throw new Error(`${label} must be a safe integer between 1 and 64.`);
  return next;
}

/** Create a bounded policy; callers cannot accidentally disable loop safety. */
export function createRecoveryPolicy(
  input: RecoveryPolicyInput = {},
): RecoveryPolicy {
  const strategyOrder = [
    ...(input.strategyOrder ?? DEFAULT_STRATEGY_ORDER),
  ].filter((value, index, values) => values.indexOf(value) === index);
  if (strategyOrder.length === 0 || !strategyOrder.includes("stop"))
    throw new Error("Recovery policy must include a stop action.");
  for (const strategy of strategyOrder)
    if (!RECOVERY_ACTIONS.has(strategy))
      throw new Error(`Unknown recovery action: ${String(strategy)}.`);
  return {
    schemaVersion: 1,
    id: input.id?.trim() || "bounded-recovery-v1",
    maxAttemptsPerSignature: boundedPositiveInteger(
      input.maxAttemptsPerSignature,
      2,
      "maxAttemptsPerSignature",
    ),
    maxAttemptsPerFailureClass: boundedPositiveInteger(
      input.maxAttemptsPerFailureClass,
      4,
      "maxAttemptsPerFailureClass",
    ),
    maxTotalAttempts: boundedPositiveInteger(
      input.maxTotalAttempts,
      8,
      "maxTotalAttempts",
    ),
    requireChangedStrategy: input.requireChangedStrategy ?? true,
    strategyOrder,
  };
}

export const DEFAULT_RECOVERY_POLICY: RecoveryPolicy = createRecoveryPolicy();

export interface FailureClassificationInput {
  source?: "tool" | "provider" | "verification" | "controller" | "model";
  code?: string | null;
  message?: string | null;
  recoverable?: boolean;
}

function normalizedFailureText(input: FailureClassificationInput): string {
  return `${input.code ?? ""} ${input.message ?? ""}`.toLowerCase();
}

const TYPED_FAILURE_CODES = new Set([
  "OUTSIDE_WORKSPACE",
  "SECURITY_DENIAL",
  "PRIVACY_NOT_ALLOWED",
  "PERMISSION_DENIED",
  "ILLEGAL_ACTION",
  "CANCELLED",
  "CONTEXT_TOO_LARGE",
  "CONTEXT_OVERFLOW",
  "INSUFFICIENT_CONTEXT",
  "RUNTIME_UNAVAILABLE",
  "MODEL_UNAVAILABLE",
  "MODEL_NOT_FOUND",
  "TIMEOUT",
  "COMMAND_TIMEOUT",
  "MODEL_REFUSAL",
  "REFUSAL",
  "MODEL_PROTOCOL_ERROR",
  "PROTOCOL_PARSE_FAILURE",
  "TOOL_BATCH_TOO_LARGE",
  "SCHEMA_FAILURE",
  "INVALID_ARGUMENT",
  "STALE_EDIT",
  "PATCH_APPLY_FAILURE",
  "PATH_NOT_FOUND",
  "NOT_FOUND",
  "FILE_NOT_FOUND",
  "PATH_IS_FILE",
  "SYMBOL_NOT_FOUND",
  "TEST_FAILED",
  "TEST_FAILURE",
  "TYPE_FAILURE",
  "TYPE_ERROR",
  "BUILD_FAILURE",
  "BUILD_FAILED",
  "COMMAND_FAILED",
  "COMMAND_FAILURE",
  "REPEATED_ACTION",
  "NO_PROGRESS_REPEATED_CALL",
  "NO_PROGRESS",
  "NO_PROGRESS_REPEATED_ERROR",
  "NO_PROGRESS_MUTATION_FAILURE",
  "CONTRADICTORY_STATE",
  "EXPERT_ESCALATION_REQUIRED",
]);

const SECURITY_FAILURE_TEXT =
  /(?:outside (?:the )?workspace|path escapes workspace|workspace escape|symlink escape|unauthorized|secret|network egress|network policy|security denial)/u;

/** Normalize tool/provider/verifier boundaries into the shared taxonomy. */
export function classifyFailure(
  input: FailureClassificationInput,
): FailureClass {
  const code = input.code?.trim().toUpperCase() ?? "";
  const text = normalizedFailureText(input);
  if (
    ["OUTSIDE_WORKSPACE", "SECURITY_DENIAL", "PRIVACY_NOT_ALLOWED"].includes(
      code,
    )
  )
    return "SECURITY_DENIAL";
  // Explicit host error codes are authoritative.  Free-form text is only a
  // fallback for absent/unknown codes, so a filename such as `secret.ts` or
  // an adversarial error message cannot escalate a normal typed failure into
  // a terminal security denial.
  if (!TYPED_FAILURE_CODES.has(code) && SECURITY_FAILURE_TEXT.test(text))
    return "SECURITY_DENIAL";
  if (code === "CANCELLED") return "CANCELLED";
  if (
    ["CONTEXT_TOO_LARGE", "CONTEXT_OVERFLOW", "INSUFFICIENT_CONTEXT"].includes(
      code,
    ) ||
    /context (?:window|length|overflow|too large)/u.test(text)
  )
    return "CONTEXT_OVERFLOW";
  if (
    ["RUNTIME_UNAVAILABLE", "MODEL_UNAVAILABLE", "MODEL_NOT_FOUND"].includes(
      code,
    ) ||
    /runtime (?:unavailable|offline)|model (?:not found|unavailable)/u.test(
      text,
    )
  )
    return "RUNTIME_UNAVAILABLE";
  if (
    ["TIMEOUT", "COMMAND_TIMEOUT"].includes(code) ||
    /(?:timed? out|timeout|deadline exceeded)/u.test(text)
  )
    return "TIMEOUT";
  if (
    ["MODEL_REFUSAL", "REFUSAL"].includes(code) ||
    (input.source === "model" &&
      /(?:refus(?:e|al)|cannot comply|won't|will not)/u.test(text))
  )
    return "MODEL_REFUSAL";
  if (
    ["MODEL_PROTOCOL_ERROR", "PROTOCOL_PARSE_FAILURE"].includes(code) ||
    /(?:malformed|parse|protocol|tool envelope|invalid json)/u.test(text)
  )
    return "PROTOCOL_PARSE_FAILURE";
  if (
    ["TOOL_BATCH_TOO_LARGE", "SCHEMA_FAILURE", "INVALID_ARGUMENT"].includes(
      code,
    ) ||
    /(?:schema|unknown argument|invalid argument|batch)/u.test(text)
  )
    return "SCHEMA_FAILURE";
  if (
    ["STALE_EDIT", "PATCH_APPLY_FAILURE"].includes(code) ||
    /(?:stale edit|patch (?:apply|failed)|ambiguous replacement|no[- ]op edit)/u.test(
      text,
    )
  )
    return code === "STALE_EDIT" ? "STALE_EDIT" : "PATCH_APPLY_FAILURE";
  if (
    ["PATH_NOT_FOUND", "NOT_FOUND", "FILE_NOT_FOUND", "PATH_IS_FILE"].includes(
      code,
    ) ||
    /(?:file|path) (?:not found|does not exist|missing)/u.test(text)
  )
    return "FILE_NOT_FOUND";
  if (
    ["SYMBOL_NOT_FOUND"].includes(code) ||
    /symbol (?:not found|missing|unresolved)/u.test(text)
  )
    return "SYMBOL_NOT_FOUND";
  if (
    ["TEST_FAILED", "TEST_FAILURE"].includes(code) ||
    /(?:test|spec)s? (?:failed|failure)/u.test(text)
  )
    return "TEST_FAILURE";
  if (
    ["TYPE_FAILURE", "TYPE_ERROR"].includes(code) ||
    /type(?:script)? (?:error|failure)|typecheck/u.test(text)
  )
    return "TYPE_FAILURE";
  if (
    ["BUILD_FAILURE", "BUILD_FAILED"].includes(code) ||
    /build (?:failed|failure|error)/u.test(text)
  )
    return "BUILD_FAILURE";
  if (
    ["COMMAND_FAILED", "COMMAND_FAILURE"].includes(code) ||
    /command (?:failed|failure|error)|process exited/u.test(text)
  )
    return "COMMAND_FAILURE";
  if (
    ["REPEATED_ACTION", "NO_PROGRESS_REPEATED_CALL"].includes(code) ||
    (code === "CONFLICT" &&
      /(?:repeated|duplicate)\b[\s\S]{0,80}\b(?:action|call|tool)/u.test(
        text,
      )) ||
    /repeated (?:action|call|tool)|duplicate (?:action|call|tool)/u.test(text)
  )
    return "REPEATED_ACTION";
  if (
    [
      "NO_PROGRESS",
      "NO_PROGRESS_REPEATED_ERROR",
      "NO_PROGRESS_MUTATION_FAILURE",
    ].includes(code) ||
    /no progress|stagnat(?:ed|ion)/u.test(text)
  )
    return "NO_PROGRESS";
  if (
    ["CONTRADICTORY_STATE"].includes(code) ||
    /contradict(?:ory|ion)|state conflict/u.test(text)
  )
    return "CONTRADICTORY_STATE";
  if (
    code === "ILLEGAL_ACTION" ||
    code === "PERMISSION_DENIED" ||
    /(?:permission denied|not allowed|forbidden|approval required|user denied|outside (?:the )?authorized|outside .*scope)/u.test(
      text,
    )
  )
    return "ILLEGAL_ACTION";
  if (code === "EXPERT_ESCALATION_REQUIRED")
    return "EXPERT_ESCALATION_REQUIRED";
  return input.recoverable === false ? "ILLEGAL_ACTION" : "UNKNOWN";
}

function canonical(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object")
    return JSON.stringify(value) ?? String(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
    .join(",")}}`;
}

/** Hash state/action inputs so loop records never persist raw model arguments. */
export function digestRecoveryValue(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

export interface RecoverySignatureInput {
  actionKind: string;
  normalizedArguments?: unknown;
  stateDigest: string;
  failureClass: FailureClass | null;
}

export function createRecoverySignature(input: RecoverySignatureInput): string {
  return digestRecoveryValue({
    actionKind: input.actionKind.trim(),
    argumentsDigest: digestRecoveryValue(input.normalizedArguments ?? null),
    stateDigest: input.stateDigest,
    failureClass: input.failureClass,
  });
}

export interface RecoveryObservation {
  signature: string;
  actionKind: string;
  stateDigest: string;
  failureClass: FailureClass | null;
  strategy?: RecoveryAction;
  progress: boolean;
  createdAt: string;
}

export interface RecoveryLoopDecision {
  signature: string;
  repeatedSignatureCount: number;
  consecutiveFailureCount: number;
  totalObservations: number;
  recoveryAttempts: number;
  stateChanged: boolean;
  strategyChanged: boolean;
  shouldStop: boolean;
  reason?:
    "REPEATED_ACTION" | "NO_PROGRESS" | "POLICY_LIMIT" | "SECURITY_DENIAL";
}

export interface RecoveryLoopSnapshot {
  schemaVersion: 1;
  /** Policy identity used to interpret the cumulative counters. */
  policyId?: string;
  observations: RecoveryObservation[];
  /** Cumulative observations, including entries trimmed from the bounded log. */
  totalObserved?: number;
  /** Cumulative failures/no-progress attempts used by the hard policy budget. */
  recoveryAttempts?: number;
}

function isRecoveryObservation(value: unknown): value is RecoveryObservation {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const observation = value as Record<string, unknown>;
  return (
    typeof observation.signature === "string" &&
    observation.signature.length > 0 &&
    typeof observation.actionKind === "string" &&
    observation.actionKind.length > 0 &&
    typeof observation.stateDigest === "string" &&
    observation.stateDigest.length > 0 &&
    (observation.failureClass === null ||
      (typeof observation.failureClass === "string" &&
        FAILURE_CLASSES.has(observation.failureClass as FailureClass))) &&
    (observation.strategy === undefined ||
      (typeof observation.strategy === "string" &&
        RECOVERY_ACTIONS.has(observation.strategy as RecoveryAction))) &&
    typeof observation.progress === "boolean" &&
    typeof observation.createdAt === "string" &&
    observation.createdAt.length > 0
  );
}

/** Host-side validation for the durable loop state. */
export function isRecoveryLoopSnapshot(
  value: unknown,
): value is RecoveryLoopSnapshot {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const snapshot = value as Record<string, unknown>;
  if (
    snapshot.schemaVersion !== 1 ||
    (snapshot.policyId !== undefined &&
      (typeof snapshot.policyId !== "string" ||
        snapshot.policyId.trim().length === 0)) ||
    !Array.isArray(snapshot.observations) ||
    snapshot.observations.length > 512 ||
    !snapshot.observations.every(isRecoveryObservation)
  )
    return false;
  const counters = ["totalObserved", "recoveryAttempts"] as const;
  if (
    counters.some(
      (key) =>
        snapshot[key] !== undefined &&
        (typeof snapshot[key] !== "number" ||
          !Number.isSafeInteger(snapshot[key]) ||
          (snapshot[key] as number) < 0),
    )
  )
    return false;
  const totalObserved = snapshot.totalObserved as number | undefined;
  const recoveryAttempts = snapshot.recoveryAttempts as number | undefined;
  const derivedAttempts = snapshot.observations.filter(
    (item) => !item.progress || item.failureClass !== null,
  ).length;
  return (
    (totalObserved === undefined ||
      totalObserved >= snapshot.observations.length) &&
    (recoveryAttempts === undefined ||
      (recoveryAttempts >= derivedAttempts &&
        (totalObserved === undefined || recoveryAttempts <= totalObserved)))
  );
}

/**
 * Bounded, host-owned loop detector. It tracks a digest of action + state +
 * failure, so changing only prose or arguments cannot disguise a no-progress
 * loop. A successful state change breaks the consecutive failure streak.
 */
export class RecoveryLoopDetector {
  readonly policy: RecoveryPolicy;
  private readonly observations: RecoveryObservation[] = [];
  private totalObserved = 0;
  private recoveryAttempts = 0;

  constructor(
    policy: RecoveryPolicy = DEFAULT_RECOVERY_POLICY,
    snapshot?: RecoveryLoopSnapshot,
  ) {
    this.policy = createRecoveryPolicy(policy);
    if (snapshot) {
      if (!isRecoveryLoopSnapshot(snapshot))
        throw new Error("Invalid recovery loop snapshot");
      if (snapshot.policyId && snapshot.policyId !== this.policy.id)
        throw new Error(
          `Recovery policy changed from ${snapshot.policyId} to ${this.policy.id}`,
        );
      const bounded = snapshot.observations.slice(
        -this.policy.maxTotalAttempts,
      );
      this.observations.push(...bounded.map((item) => ({ ...item })));
      const derivedAttempts = snapshot.observations.filter(
        (item) => !item.progress || item.failureClass !== null,
      ).length;
      this.totalObserved = Math.max(
        snapshot.totalObserved ?? snapshot.observations.length,
        snapshot.observations.length,
      );
      this.recoveryAttempts = Math.max(
        snapshot.recoveryAttempts ?? derivedAttempts,
        derivedAttempts,
      );
    }
  }

  observe(input: {
    actionKind: string;
    normalizedArguments?: unknown;
    stateDigest: string;
    failureClass?: FailureClass | null;
    strategy?: RecoveryAction;
    progress?: boolean;
    createdAt?: string;
  }): RecoveryLoopDecision {
    const failureClass = input.failureClass ?? null;
    const progress = input.progress === true;
    const signature = createRecoverySignature({
      actionKind: input.actionKind,
      normalizedArguments: input.normalizedArguments,
      stateDigest: input.stateDigest,
      failureClass,
    });
    const observation: RecoveryObservation = {
      signature,
      actionKind: input.actionKind,
      stateDigest: input.stateDigest,
      failureClass,
      ...(input.strategy ? { strategy: input.strategy } : {}),
      progress,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    this.totalObserved += 1;
    // Successful progress is an observation, not a recovery attempt.  The
    // hard policy budget must therefore cover failures/no-progress only;
    // otherwise a few legitimate reads or verification steps would consume
    // the entire recovery budget and terminate healthy work.
    if (!progress || failureClass !== null) this.recoveryAttempts += 1;
    this.observations.push(observation);
    if (this.observations.length > this.policy.maxTotalAttempts)
      this.observations.splice(
        0,
        this.observations.length - this.policy.maxTotalAttempts,
      );
    const repeatedSignatureCount = this.observations.filter(
      (item) => item.signature === signature,
    ).length;
    let consecutiveFailureCount = 0;
    for (const item of [...this.observations].reverse()) {
      if (item.progress || item.failureClass !== failureClass) break;
      consecutiveFailureCount += 1;
    }
    const previous = this.observations.at(-2);
    const stateChanged = previous
      ? previous.stateDigest !== input.stateDigest
      : false;
    const strategyChanged = previous
      ? previous.strategy !== input.strategy
      : false;
    let reason: RecoveryLoopDecision["reason"];
    if (failureClass === "SECURITY_DENIAL") reason = "SECURITY_DENIAL";
    else if (
      (!progress || failureClass !== null) &&
      repeatedSignatureCount >= this.policy.maxAttemptsPerSignature
    )
      reason = "REPEATED_ACTION";
    else if (
      failureClass !== null &&
      !progress &&
      consecutiveFailureCount >= this.policy.maxAttemptsPerFailureClass
    )
      reason = "NO_PROGRESS";
    else if (this.recoveryAttempts >= this.policy.maxTotalAttempts)
      reason = "POLICY_LIMIT";
    return {
      signature,
      repeatedSignatureCount,
      consecutiveFailureCount,
      totalObservations: this.totalObserved,
      recoveryAttempts: this.recoveryAttempts,
      stateChanged,
      strategyChanged,
      shouldStop: reason !== undefined,
      ...(reason ? { reason } : {}),
    };
  }

  snapshot(): RecoveryLoopSnapshot {
    return {
      schemaVersion: 1,
      policyId: this.policy.id,
      observations: this.observations.map((item) => ({ ...item })),
      totalObserved: this.totalObserved,
      recoveryAttempts: this.recoveryAttempts,
    };
  }
}

export interface RecoveryEvaluationInput {
  failureClass: FailureClass;
  attemptedStrategies?: readonly RecoveryAction[];
  repeatedCount?: number;
  stateChanged?: boolean;
  policy?: RecoveryPolicy;
}

export interface RecoveryEvaluation {
  action: RecoveryAction;
  changedStrategy: boolean;
  allowed: boolean;
  reason: string;
}

const PREFERRED_ACTIONS: Readonly<
  Record<FailureClass, readonly RecoveryAction[]>
> = {
  PROTOCOL_PARSE_FAILURE: ["repair_syntax", "change_representation"],
  SCHEMA_FAILURE: ["repair_syntax", "change_representation"],
  ILLEGAL_ACTION: ["relocalize", "stop"],
  STALE_EDIT: ["relocalize", "rollback", "change_representation"],
  PATCH_APPLY_FAILURE: ["change_representation", "relocalize", "rollback"],
  FILE_NOT_FOUND: ["relocalize", "ask_expert"],
  SYMBOL_NOT_FOUND: ["relocalize", "ask_expert"],
  COMMAND_FAILURE: ["repair_syntax", "relocalize", "ask_expert"],
  TEST_FAILURE: ["repair_syntax", "relocalize", "ask_expert"],
  BUILD_FAILURE: ["repair_syntax", "relocalize", "ask_expert"],
  TYPE_FAILURE: ["repair_syntax", "relocalize", "ask_expert"],
  TIMEOUT: ["change_representation", "rollback", "switch_model"],
  CONTEXT_OVERFLOW: ["change_representation", "relocalize", "decompose"],
  MODEL_REFUSAL: ["change_representation", "ask_expert", "stop"],
  NO_PROGRESS: ["relocalize", "change_representation", "ask_expert"],
  REPEATED_ACTION: ["relocalize", "change_representation", "stop"],
  CONTRADICTORY_STATE: ["relocalize", "rollback", "ask_expert"],
  SECURITY_DENIAL: ["stop"],
  RUNTIME_UNAVAILABLE: ["switch_model", "stop"],
  EXPERT_ESCALATION_REQUIRED: ["ask_expert", "stop"],
  CANCELLED: ["stop"],
  UNKNOWN: ["relocalize", "ask_expert", "stop"],
};

/**
 * Pick one changed, policy-compatible recovery action. Security and
 * cancellation are terminal and cannot be weakened by caller preferences.
 */
export function evaluateRecovery(
  input: RecoveryEvaluationInput,
): RecoveryEvaluation {
  const policy = createRecoveryPolicy(input.policy);
  if (input.failureClass === "SECURITY_DENIAL")
    return {
      action: "stop",
      changedStrategy: true,
      allowed: false,
      reason: "Security failures are terminal and cannot be retried.",
    };
  if (input.failureClass === "CANCELLED")
    return {
      action: "stop",
      changedStrategy: true,
      allowed: false,
      reason: "Cancellation is terminal until the operator explicitly resumes.",
    };
  const attempted = new Set(input.attemptedStrategies ?? []);
  const repeated = input.repeatedCount ?? 1;
  const mustChange =
    policy.requireChangedStrategy &&
    repeated > 1 &&
    input.stateChanged !== true;
  if (mustChange && (input.attemptedStrategies?.length ?? 0) === 0)
    return {
      action: "stop",
      changedStrategy: false,
      allowed: false,
      reason:
        "A repeated failure requires evidence of the prior strategy before a changed strategy can be selected.",
    };
  const preferred = PREFERRED_ACTIONS[input.failureClass];
  const allowedStrategies = new Set(policy.strategyOrder);
  const candidates = [
    ...preferred.filter((candidate) => allowedStrategies.has(candidate)),
    ...policy.strategyOrder,
  ].filter((value, index, values) => values.indexOf(value) === index);
  const action = candidates.find(
    (candidate) =>
      candidate !== "stop" &&
      (!mustChange || candidate !== "retry_same") &&
      !attempted.has(candidate),
  );
  if (!action)
    return {
      action: "stop",
      changedStrategy: mustChange,
      allowed: false,
      reason: "No untried recovery strategy remains within the bounded policy.",
    };
  return {
    action,
    changedStrategy: mustChange,
    allowed: true,
    reason: mustChange
      ? `Changed strategy after ${repeated} no-progress observations.`
      : `Selected ${action} for ${input.failureClass}.`,
  };
}

export interface RecoveryContract {
  id: string;
  cause: string;
  failedRequirement?: string;
  evidence: string[];
  attemptedStrategies: string[];
  forbiddenRepeats: string[];
  /** For plan-boundary failures, the replacement must supersede this node. */
  supersedeNodeId?: string;
  proposedRecovery: RecoveryStrategy;
  /** Phase 9 host taxonomy; optional for legacy snapshots. */
  failureClass?: FailureClass;
  /** Digest of the host state at the failed decision boundary. */
  stateDigest?: string;
  /** Semantic action selected by the recovery policy. */
  strategy?: RecoveryAction;
  /** True when this contract intentionally changes recovery strategy. */
  changedStrategy?: boolean;
  createdAt: string;
}

export interface CreateRecoveryContractInput {
  id?: string;
  cause: string;
  failedRequirement?: string;
  evidence?: readonly string[];
  attemptedStrategies?: readonly string[];
  forbiddenRepeats?: readonly string[];
  supersedeNodeId?: string;
  proposedRecovery: RecoveryStrategy;
  failureClass?: FailureClass;
  stateDigest?: string;
  strategy?: RecoveryAction;
  changedStrategy?: boolean;
  createdAt?: string;
}

function unique(values: readonly string[] | undefined): string[] {
  return [
    ...new Set(
      (values ?? [])
        .map((value) => {
          const redacted = redactEvaluationValue(value);
          return typeof redacted === "string" ? redacted.trim() : "";
        })
        .filter(Boolean),
    ),
  ];
}

export function createRecoveryContract(
  input: CreateRecoveryContractInput,
): RecoveryContract {
  const cause = redactEvaluationValue(input.cause.trim());
  const failedRequirement = input.failedRequirement?.trim();
  const redactedFailedRequirement = failedRequirement
    ? redactEvaluationValue(failedRequirement)
    : undefined;
  return {
    id: input.id ?? crypto.randomUUID(),
    cause: typeof cause === "string" ? cause : "UNKNOWN",
    ...(failedRequirement
      ? {
          failedRequirement:
            typeof redactedFailedRequirement === "string"
              ? redactedFailedRequirement
              : "[REDACTED]",
        }
      : {}),
    evidence: unique(input.evidence),
    attemptedStrategies: unique(input.attemptedStrategies),
    forbiddenRepeats: unique(input.forbiddenRepeats),
    ...(input.supersedeNodeId?.trim()
      ? { supersedeNodeId: input.supersedeNodeId.trim() }
      : {}),
    proposedRecovery: input.proposedRecovery,
    ...(input.failureClass ? { failureClass: input.failureClass } : {}),
    ...(input.stateDigest ? { stateDigest: input.stateDigest } : {}),
    ...(input.strategy ? { strategy: input.strategy } : {}),
    ...(input.changedStrategy === undefined
      ? {}
      : { changedStrategy: input.changedStrategy }),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function hasRepeatedRecoveryStrategy(
  recovery: RecoveryContract,
  strategy: string,
): boolean {
  const normalized = strategy.trim();
  return recovery.forbiddenRepeats.includes(normalized);
}
