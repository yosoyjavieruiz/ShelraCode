import { createHash } from "node:crypto";

export const PAIRED_CAPABILITY_EVALUATION_SCHEMA_VERSION = 1 as const;

export interface PairedCapabilityProfile {
  id: string;
  identityDigest: string;
}

/**
 * The observable outcome of one capability trial. This deliberately contains
 * no hidden reasoning or protected acceptance data: only host-verifiable
 * metrics may influence promotion.
 */
export interface CapabilityTrialResult {
  taskId: string;
  /** Distinguishes repeated stochastic trials of the same task. */
  trialId: string;
  driverProfileId: string;
  driverIdentityDigest: string;
  configurationDigest: string;
  success: boolean;
  falseSuccess: boolean;
  actions: number;
  inputTokens?: number;
  outputTokens?: number;
  wallTimeMs?: number;
  interventions?: number;
  loops?: number;
  securityFailures?: number;
}

export interface PairedCapabilityAggregate {
  taskCount: number;
  trialCount: number;
  successRate: number;
  falseSuccessRate: number;
  meanActions: number;
  meanInputTokens: number;
  meanOutputTokens: number;
  meanWallTimeMs: number;
  meanInterventions: number;
  loopRate: number;
  securityFailureRate: number;
  metricCoverage: {
    inputTokens: number;
    outputTokens: number;
    wallTimeMs: number;
    interventions: number;
    loops: number;
    securityFailures: number;
  };
}

export type PairedCapabilityDecision =
  "auto_enable" | "opt_in_only" | "revise" | "remove";

export interface PairedCapabilityEvidence {
  evaluationId: string;
  decision: PairedCapabilityDecision;
  driverProfileId: string;
  driverIdentityDigest: string;
  configurationDigest: string;
  evaluatedAt: string;
}

export interface PairedCapabilityEvaluationReport {
  schemaVersion: typeof PAIRED_CAPABILITY_EVALUATION_SCHEMA_VERSION;
  evaluationId: string;
  capabilityId: string;
  profile: PairedCapabilityProfile;
  configurationDigest: string | null;
  taskIds: string[];
  trialKeys: string[];
  valid: boolean;
  sampleSufficient: boolean;
  beneficial: boolean;
  automaticActivation: boolean;
  decision: PairedCapabilityDecision;
  reasons: string[];
  off: PairedCapabilityAggregate;
  on: PairedCapabilityAggregate;
  evidence: PairedCapabilityEvidence | null;
  evidenceDigest: string;
}

export interface PairedCapabilityEvaluationInput {
  evaluationId: string;
  capabilityId: string;
  profile: PairedCapabilityProfile;
  off: readonly CapabilityTrialResult[];
  on: readonly CapabilityTrialResult[];
  minimumTrialsPerTask?: number;
  evaluatedAt?: string;
}

const PAIRED_DECISIONS: readonly PairedCapabilityDecision[] = [
  "auto_enable",
  "opt_in_only",
  "revise",
  "remove",
];

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`;
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value), "utf8").digest("hex");
}

function validText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function trialErrors(trial: CapabilityTrialResult, label: string): string[] {
  const errors: string[] = [];
  for (const [field, value] of [
    ["taskId", trial.taskId],
    ["trialId", trial.trialId],
    ["driverProfileId", trial.driverProfileId],
    ["driverIdentityDigest", trial.driverIdentityDigest],
    ["configurationDigest", trial.configurationDigest],
  ] as const)
    if (!validText(value)) errors.push(`${label}.${field} is required`);
  for (const [field, value] of [
    ["actions", trial.actions],
    ["inputTokens", trial.inputTokens],
    ["outputTokens", trial.outputTokens],
    ["wallTimeMs", trial.wallTimeMs],
    ["interventions", trial.interventions],
    ["loops", trial.loops],
    ["securityFailures", trial.securityFailures],
  ] as const)
    if (value !== undefined && !validNonNegative(value))
      errors.push(`${label}.${field} must be non-negative`);
  for (const [field, value] of [
    ["success", trial.success],
    ["falseSuccess", trial.falseSuccess],
  ] as const)
    if (typeof value !== "boolean")
      errors.push(`${label}.${field} is required`);
  return errors;
}

function mean(
  trials: readonly CapabilityTrialResult[],
  field: keyof CapabilityTrialResult,
): number {
  if (trials.length === 0) return 0;
  return (
    trials.reduce((total, trial) => {
      const value = trial[field];
      return total + (typeof value === "number" ? value : 0);
    }, 0) / trials.length
  );
}

function rate(
  trials: readonly CapabilityTrialResult[],
  predicate: (trial: CapabilityTrialResult) => boolean,
): number {
  if (trials.length === 0) return 0;
  return trials.filter(predicate).length / trials.length;
}

function aggregate(
  trials: readonly CapabilityTrialResult[],
): PairedCapabilityAggregate {
  const metricCoverage = {
    inputTokens: rate(trials, (trial) => trial.inputTokens !== undefined),
    outputTokens: rate(trials, (trial) => trial.outputTokens !== undefined),
    wallTimeMs: rate(trials, (trial) => trial.wallTimeMs !== undefined),
    interventions: rate(trials, (trial) => trial.interventions !== undefined),
    loops: rate(trials, (trial) => trial.loops !== undefined),
    securityFailures: rate(
      trials,
      (trial) => trial.securityFailures !== undefined,
    ),
  };
  return {
    taskCount: new Set(trials.map((trial) => trial.taskId)).size,
    trialCount: trials.length,
    successRate: rate(trials, (trial) => trial.success),
    falseSuccessRate: rate(trials, (trial) => trial.falseSuccess),
    meanActions: mean(trials, "actions"),
    meanInputTokens: mean(trials, "inputTokens"),
    meanOutputTokens: mean(trials, "outputTokens"),
    meanWallTimeMs: mean(trials, "wallTimeMs"),
    meanInterventions: mean(trials, "interventions"),
    loopRate: rate(trials, (trial) => (trial.loops ?? 0) > 0),
    securityFailureRate: rate(
      trials,
      (trial) => (trial.securityFailures ?? 0) > 0,
    ),
    metricCoverage,
  };
}

function trialKey(trial: CapabilityTrialResult): string {
  return `${trial.taskId}\u0000${trial.trialId}`;
}

function sameValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

/**
 * Compares capability OFF/ON trials under one exact Driver configuration.
 * The report is deliberately conservative: a capability is automatically
 * promotable only when the paired distribution is valid, improves an
 * observable outcome, and introduces no false-success, loop, or security
 * regression.
 */
export function runPairedCapabilityEvaluation(
  input: PairedCapabilityEvaluationInput,
): PairedCapabilityEvaluationReport {
  const evaluatedAt = input.evaluatedAt ?? new Date().toISOString();
  const reasons: string[] = [];
  const off = aggregate(input.off);
  const on = aggregate(input.on);
  const taskIds = [...new Set(input.off.map((trial) => trial.taskId))].sort();
  const trialKeys = input.off.map(trialKey).sort();
  const onTrialKeys = input.on.map(trialKey).sort();
  const onTaskIds = [...new Set(input.on.map((trial) => trial.taskId))].sort();
  const minimumTrialsPerTask = input.minimumTrialsPerTask ?? 2;
  let valid = true;

  if (!validText(input.evaluationId)) {
    valid = false;
    reasons.push("evaluationId is required");
  }
  if (!validText(input.capabilityId)) {
    valid = false;
    reasons.push("capabilityId is required");
  }
  if (
    !validText(input.profile.id) ||
    !validText(input.profile.identityDigest)
  ) {
    valid = false;
    reasons.push("exact Driver profile identity is required");
  }
  if (input.off.length === 0 || input.on.length === 0) {
    valid = false;
    reasons.push("both OFF and ON trials are required");
  }
  if (
    !sameValues(trialKeys, onTrialKeys) ||
    new Set(trialKeys).size !== trialKeys.length ||
    new Set(onTrialKeys).size !== onTrialKeys.length
  ) {
    valid = false;
    reasons.push("OFF and ON must use the same task set without duplicates");
  }
  if (!Number.isInteger(minimumTrialsPerTask) || minimumTrialsPerTask <= 0) {
    valid = false;
    reasons.push("minimum repeated trials must be a positive integer");
  }

  const allTrials = [...input.off, ...input.on];
  allTrials.forEach((trial, index) => {
    const errors = trialErrors(trial, `trial[${index}]`);
    if (errors.length > 0) {
      valid = false;
      reasons.push(...errors);
    }
    if (
      trial.driverProfileId !== input.profile.id ||
      trial.driverIdentityDigest !== input.profile.identityDigest
    ) {
      valid = false;
      reasons.push("all trials must use the exact Driver profile");
    }
  });

  const configurationDigests = [
    ...new Set(allTrials.map((trial) => trial.configurationDigest)),
  ];
  if (configurationDigests.length !== 1) {
    valid = false;
    reasons.push("OFF and ON must use the same Driver configuration");
  }
  const configurationDigest = configurationDigests[0] ?? null;

  const offCounts = new Map<string, number>();
  const onCounts = new Map<string, number>();
  for (const trial of input.off)
    offCounts.set(trial.taskId, (offCounts.get(trial.taskId) ?? 0) + 1);
  for (const trial of input.on)
    onCounts.set(trial.taskId, (onCounts.get(trial.taskId) ?? 0) + 1);
  const sampleSufficient =
    valid &&
    [...new Set([...offCounts.keys(), ...onCounts.keys()])].every(
      (taskId) =>
        (offCounts.get(taskId) ?? 0) >= minimumTrialsPerTask &&
        (onCounts.get(taskId) ?? 0) >= minimumTrialsPerTask,
    );
  if (!sampleSufficient)
    reasons.push(
      `Automatic activation requires at least ${minimumTrialsPerTask} repeated trials per task.`,
    );

  const falseSuccessRegression = on.falseSuccessRate > off.falseSuccessRate;
  if (falseSuccessRegression) reasons.push("ON increases false-success rate");

  const completeMetricCoverage = [
    "inputTokens",
    "outputTokens",
    "wallTimeMs",
    "interventions",
    "loops",
    "securityFailures",
  ].every(
    (metric) =>
      off.metricCoverage[metric as keyof typeof off.metricCoverage] === 1 &&
      on.metricCoverage[metric as keyof typeof on.metricCoverage] === 1,
  );
  if (!completeMetricCoverage)
    reasons.push(
      "Automatic activation requires complete paired metric coverage.",
    );
  if (
    completeMetricCoverage &&
    on.securityFailureRate > off.securityFailureRate
  )
    reasons.push("ON increases security failure rate");
  if (completeMetricCoverage && on.loopRate > off.loopRate)
    reasons.push("ON increases loop rate");
  const noRegression =
    !falseSuccessRegression &&
    (!completeMetricCoverage ||
      (on.securityFailureRate <= off.securityFailureRate &&
        on.loopRate <= off.loopRate));
  const successGain = on.successRate > off.successRate;
  const qualityMaintained = on.successRate >= off.successRate;
  const efficiencyGain =
    (off.meanActions > 0 && on.meanActions < off.meanActions * 0.9) ||
    (off.meanWallTimeMs > 0 && on.meanWallTimeMs < off.meanWallTimeMs * 0.9);
  const beneficial =
    valid &&
    sampleSufficient &&
    completeMetricCoverage &&
    noRegression &&
    (successGain || (qualityMaintained && efficiencyGain));
  if (!beneficial && reasons.length === 0)
    reasons.push("ON did not demonstrate a paired measurable gain");

  const decision: PairedCapabilityDecision = !valid
    ? "revise"
    : !noRegression
      ? "revise"
      : beneficial
        ? "auto_enable"
        : "opt_in_only";
  const evidence: PairedCapabilityEvidence | null =
    valid && configurationDigest
      ? {
          evaluationId: input.evaluationId,
          decision,
          driverProfileId: input.profile.id,
          driverIdentityDigest: input.profile.identityDigest,
          configurationDigest,
          evaluatedAt,
        }
      : null;
  const reportWithoutDigest = {
    schemaVersion: PAIRED_CAPABILITY_EVALUATION_SCHEMA_VERSION,
    evaluationId: input.evaluationId,
    capabilityId: input.capabilityId,
    profile: input.profile,
    configurationDigest,
    taskIds,
    trialKeys,
    valid,
    sampleSufficient,
    beneficial,
    automaticActivation: decision === "auto_enable",
    decision,
    reasons,
    off,
    on,
    evidence,
  };
  return {
    ...reportWithoutDigest,
    evidenceDigest: digest(reportWithoutDigest),
  };
}

/**
 * Checks the integrity of a report before another host service consumes its
 * promotion evidence. This detects mutation or truncation after Shelra Lab
 * produced the report; it does not replace provenance and access controls.
 */
export function verifyPairedCapabilityEvaluationReport(
  report: PairedCapabilityEvaluationReport,
): boolean {
  if (!validText(report.evidenceDigest)) return false;
  const { evidenceDigest, ...withoutDigest } = report;
  return digest(withoutDigest) === evidenceDigest;
}

export function isPairedCapabilityDecision(
  value: unknown,
): value is PairedCapabilityDecision {
  return (
    typeof value === "string" &&
    PAIRED_DECISIONS.includes(value as PairedCapabilityDecision)
  );
}

export const evaluatePairedCapability = runPairedCapabilityEvaluation;
