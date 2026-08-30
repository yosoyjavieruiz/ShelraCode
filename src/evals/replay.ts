import { createHash } from "node:crypto";
import {
  probeAgentCapability,
  type AgentCapabilityProbeResult,
  type AgentCapabilityProbeEnvironmentInput,
} from "../agent/capability-probe.js";
import type {
  NormalizedModelRequest,
  ProviderAdapter,
  ProviderEvent,
  ProviderFailureCode,
} from "../providers/types.js";
import type {
  EvaluationObservation,
  EvaluationRunBundle,
} from "./artifact-store.js";
import { evaluationProviderRequestPayload } from "./provider-recorder.js";

export interface EvaluationReplayReport {
  schemaVersion: 1;
  kind: "evaluation_replay";
  integrity: "verified";
  runId: string;
  evidenceClass: "scripted_fake" | "real_local_model";
  recordedOutcome: EvaluationRunBundle["summary"]["outcome"];
  recordedFailureClass: string | null;
  manifestDigest: string;
  finalObservationDigest: string | null;
  reproduction:
    | {
        status: "MATCH";
        kind: "capability_probe";
        expectedBehaviorDigest: string;
        actualBehaviorDigest: string;
        providerRequestsRecorded: number;
        providerRequestsConsumed: number;
        reproducedFailureClass: string | null;
        recordedFailedDimensions: string[];
        reproducedFailedDimensions: string[];
      }
    | {
        status: "BLOCKED" | "DIVERGED";
        kind: "capability_probe" | "unavailable";
        reason: string;
        providerRequestsRecorded: number;
        providerRequestsConsumed: number;
        expectedBehaviorDigest?: string;
        actualBehaviorDigest?: string;
        mismatchedFields?: string[];
        recordedFailedDimensions?: string[];
        reproducedFailedDimensions?: string[];
      };
}

interface ReplayFrame {
  request: unknown;
  events: ProviderEvent[];
  exception?: { name: string; message: string };
}

class ReplayDivergenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReplayDivergenceError";
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`)
    .join(",")}}`;
}

function digest(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function normalizeReplayRequest(value: unknown, key = ""): unknown {
  if (key === "durationMs") return "<elapsed>";
  if (typeof value === "string")
    return value
      .replace(
        /[A-Za-z]:\\+Users\\+[^\\\r\n"]+\\+AppData\\+Local\\+Temp\\+localcode-capability-probe-[A-Za-z0-9_-]+/giu,
        "<probe-root>",
      )
      .replace(
        /\/(?:private\/)?(?:var\/)?tmp\/localcode-capability-probe-[A-Za-z0-9_-]+/gu,
        "<probe-root>",
      )
      .replace(/("durationMs"\s*:\s*)\d+(?:\.\d+)?/gu, '$1"<elapsed>"')
      .replace(/\[\d+(?:\.\d+)?(?:ms|s)\]/gu, "[<elapsed>]")
      .replace(/\b\d+(?:\.\d+)?\s*ms\b/gu, "<elapsed>");
  if (Array.isArray(value))
    return value.map((entry) => normalizeReplayRequest(entry));
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(
      ([entryKey, entryValue]) => [
        entryKey,
        normalizeReplayRequest(entryValue, entryKey),
      ],
    ),
  );
}

export function digestEvaluationReplayRequest(value: unknown): string {
  return digest(normalizeReplayRequest(value));
}

function providerEvent(value: unknown): ProviderEvent {
  const event = record(value);
  const type = text(event?.type);
  if (type === "done") return { type };
  if (type === "text.delta") {
    const valueText = text(event?.text);
    if (valueText === undefined)
      throw new ReplayDivergenceError("Recorded text frame is malformed.");
    return { type, text: valueText };
  }
  if (type === "reasoning.delta") {
    const chars = finiteNumber(event?.chars);
    if (chars === undefined || !Number.isInteger(chars) || chars < 0)
      throw new ReplayDivergenceError(
        "Recorded reasoning metadata is malformed.",
      );
    return { type, text: " ".repeat(chars) };
  }
  if (type === "tool.call") {
    const call = record(event?.call);
    const id = text(call?.id);
    const name = text(call?.name);
    const argumentsValue = text(call?.arguments);
    if (id === undefined || name === undefined || argumentsValue === undefined)
      throw new ReplayDivergenceError("Recorded tool-call frame is malformed.");
    return { type, call: { id, name, arguments: argumentsValue } };
  }
  if (type === "usage") {
    const usage = record(event?.usage);
    const inputTokens = finiteNumber(usage?.inputTokens);
    const outputTokens = finiteNumber(usage?.outputTokens);
    const totalTokens = finiteNumber(usage?.totalTokens);
    if (
      inputTokens === undefined ||
      outputTokens === undefined ||
      totalTokens === undefined
    )
      throw new ReplayDivergenceError("Recorded usage frame is malformed.");
    return { type, usage: { inputTokens, outputTokens, totalTokens } };
  }
  if (type === "error") {
    const error = record(event?.error);
    const code = text(error?.code);
    const message = text(error?.message);
    if (!code || message === undefined)
      throw new ReplayDivergenceError("Recorded provider error is malformed.");
    return {
      type,
      error: {
        code: code as ProviderFailureCode,
        message,
        ...(finiteNumber(error?.status) === undefined
          ? {}
          : { status: finiteNumber(error?.status) }),
        ...(text(error?.retryAt) === undefined
          ? {}
          : { retryAt: text(error?.retryAt) }),
      },
    };
  }
  throw new ReplayDivergenceError("Recorded provider frame type is unknown.");
}

function replayFrames(observations: EvaluationObservation[]): ReplayFrame[] {
  const frames: ReplayFrame[] = [];
  let current: ReplayFrame | undefined;
  for (const observation of observations) {
    if (observation.kind === "provider.request") {
      current = { request: observation.payload, events: [] };
      frames.push(current);
      continue;
    }
    if (observation.kind === "provider.event") {
      if (!current)
        throw new ReplayDivergenceError(
          "Recorded provider event has no preceding request.",
        );
      current.events.push(providerEvent(observation.payload));
      continue;
    }
    if (observation.kind === "provider.exception") {
      if (!current)
        throw new ReplayDivergenceError(
          "Recorded provider exception has no preceding request.",
        );
      const exception = record(observation.payload);
      current.exception = {
        name: text(exception?.name) ?? "RecordedProviderError",
        message: text(exception?.message) ?? "Recorded provider exception",
      };
    }
  }
  return frames;
}

function expectedProbe(
  observations: EvaluationObservation[],
  evidenceRefs: string[],
): AgentCapabilityProbeResult | undefined {
  const sealedEvidence = new Set(evidenceRefs);
  const resultObservation = [...observations]
    .reverse()
    .find(
      (observation) =>
        observation.kind === "trial.result" &&
        sealedEvidence.has(`observation:${observation.sequence}`),
    );
  const payload = record(resultObservation?.payload);
  const result = record(payload?.result);
  const probe = record(result?.probe);
  if (
    finiteNumber(probe?.probeVersion) === undefined ||
    typeof probe?.conversation !== "boolean" ||
    typeof probe?.readTool !== "boolean" ||
    typeof probe?.multiTurnTools !== "boolean" ||
    typeof probe?.agenticCodingEligible !== "boolean" ||
    text(probe?.agentCapabilityClass) === undefined ||
    !Array.isArray(probe?.notes)
  )
    return undefined;
  return probe as unknown as AgentCapabilityProbeResult;
}

function probeBehavior(
  probe: AgentCapabilityProbeResult,
): Record<string, unknown> {
  const profile = probe.profile;
  const protocolFields = new Set([
    "conversation",
    "noToolDiscipline",
    "toolSelection",
    "toolArguments",
    "multiTurnTools",
    "errorRecovery",
  ]);
  const profileStatuses = profile
    ? Object.fromEntries(
        Object.entries(profile)
          .filter(
            ([key, value]) =>
              protocolFields.has(key) && record(value)?.status !== undefined,
          )
          .map(([key, value]) => [key, record(value)?.status]),
      )
    : null;
  return {
    probeVersion: probe.probeVersion,
    conversation: probe.conversation,
    readTool: probe.readTool,
    multiTurnTools: probe.multiTurnTools,
    agenticCodingEligible: probe.agenticCodingEligible,
    agentCapabilityClass: probe.agentCapabilityClass,
    profileStatuses,
  };
}

function mismatchedBehaviorFields(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): string[] {
  return [...new Set([...Object.keys(expected), ...Object.keys(actual)])]
    .sort()
    .filter((key) => digest(expected[key]) !== digest(actual[key]));
}

function failedProfileDimensions(probe: AgentCapabilityProbeResult): string[] {
  return probe.profile
    ? Object.entries(probe.profile)
        .filter(([, value]) => record(value)?.status === "fail")
        .map(([key]) => key)
        .sort()
    : [];
}

class RecordedProvider implements ProviderAdapter {
  readonly id: string;
  readonly displayName = "Recorded evaluation provider";
  private index = 0;

  constructor(
    id: string,
    private readonly frames: ReplayFrame[],
  ) {
    this.id = id;
  }

  get consumed(): number {
    return this.index;
  }

  discoverModels(): Promise<never> {
    return Promise.reject(
      new ReplayDivergenceError("Replay cannot discover live models."),
    );
  }

  health(): Promise<never> {
    return Promise.reject(
      new ReplayDivergenceError("Replay cannot call a live health endpoint."),
    );
  }

  quota(): Promise<never> {
    return Promise.reject(
      new ReplayDivergenceError("Replay cannot call a live quota endpoint."),
    );
  }

  async *stream(request: NormalizedModelRequest): AsyncIterable<ProviderEvent> {
    const frame = this.frames[this.index];
    if (!frame)
      throw new ReplayDivergenceError(
        "Replay requested more provider frames than were recorded.",
      );
    const requestIndex = this.index + 1;
    this.index = requestIndex;
    if (
      digestEvaluationReplayRequest(frame.request) !==
      digestEvaluationReplayRequest(evaluationProviderRequestPayload(request))
    )
      throw new ReplayDivergenceError(
        `Provider request ${requestIndex} diverged from the recorded request.`,
      );
    for (const event of frame.events) yield event;
    if (frame.exception) {
      const error = new Error(frame.exception.message);
      error.name = frame.exception.name;
      throw error;
    }
  }

  classifyError(error: unknown) {
    return {
      code: "UNKNOWN" as const,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function observedText(observation: {
  state: string;
  value: unknown;
}): string | undefined {
  return observation.state === "observed" &&
    typeof observation.value === "string"
    ? observation.value
    : undefined;
}

function probeEnvironment(
  bundle: EvaluationRunBundle,
): AgentCapabilityProbeEnvironmentInput {
  const { manifest } = bundle;
  return {
    ...(observedText(manifest.model.revision) === undefined
      ? {}
      : { modelRevision: observedText(manifest.model.revision) }),
    ...(observedText(manifest.model.quantization) === undefined
      ? {}
      : { quantization: observedText(manifest.model.quantization) }),
    ...(typeof manifest.runtime.contextConfiguration.catalogMaxTokens !==
    "number"
      ? {}
      : {
          contextLength: manifest.runtime.contextConfiguration.catalogMaxTokens,
        }),
    ...(observedText(manifest.runtime.version) === undefined
      ? {}
      : { runtimeVersion: observedText(manifest.runtime.version) }),
    ...(observedText(manifest.runtime.chatTemplate) === undefined
      ? {}
      : { chatTemplate: observedText(manifest.runtime.chatTemplate) }),
    ...(observedText(manifest.runtime.toolParser) === undefined
      ? {}
      : { toolParser: observedText(manifest.runtime.toolParser) }),
  };
}

function baseReport(bundle: EvaluationRunBundle) {
  return {
    schemaVersion: 1 as const,
    kind: "evaluation_replay" as const,
    integrity: "verified" as const,
    runId: bundle.manifest.runId,
    evidenceClass: bundle.manifest.evidenceClass,
    recordedOutcome: bundle.summary.outcome,
    recordedFailureClass: bundle.summary.failure?.class ?? null,
    manifestDigest: bundle.summary.manifestDigest,
    finalObservationDigest: bundle.summary.finalObservationDigest,
  };
}

export async function replayEvaluationRunBundle(
  bundle: EvaluationRunBundle,
): Promise<{
  report: EvaluationReplayReport;
  exitCode: 0 | 1 | 2;
}> {
  let frames: ReplayFrame[];
  try {
    frames = replayFrames(bundle.observations);
  } catch (error) {
    return {
      report: {
        ...baseReport(bundle),
        reproduction: {
          status: "DIVERGED",
          kind: "unavailable",
          reason: error instanceof Error ? error.message : "Malformed frames.",
          providerRequestsRecorded: 0,
          providerRequestsConsumed: 0,
        },
      },
      exitCode: 1,
    };
  }
  const expected = expectedProbe(
    bundle.observations,
    bundle.summary.evidenceRefs,
  );
  if (!expected)
    return {
      report: {
        ...baseReport(bundle),
        reproduction: {
          status: "BLOCKED",
          kind: "unavailable",
          reason:
            "The sealed summary evidence has no complete recorded capability probe result.",
          providerRequestsRecorded: frames.length,
          providerRequestsConsumed: 0,
        },
      },
      exitCode: 2,
    };
  if (frames.length === 0)
    return {
      report: {
        ...baseReport(bundle),
        reproduction: {
          status: "BLOCKED",
          kind: "capability_probe",
          reason: "The sealed run has no recorded provider response frames.",
          providerRequestsRecorded: 0,
          providerRequestsConsumed: 0,
        },
      },
      exitCode: 2,
    };

  const provider = new RecordedProvider(bundle.manifest.runtime.id, frames);
  try {
    const actual = await probeAgentCapability(
      provider,
      bundle.manifest.model.modelId,
      new AbortController().signal,
      {
        probeErrorRecovery: true,
        environment: probeEnvironment(bundle),
      },
    );
    if (provider.consumed !== frames.length)
      return {
        report: {
          ...baseReport(bundle),
          reproduction: {
            status: "DIVERGED",
            kind: "capability_probe",
            reason: `Replay left ${frames.length - provider.consumed} unconsumed provider frame(s).`,
            providerRequestsRecorded: frames.length,
            providerRequestsConsumed: provider.consumed,
          },
        },
        exitCode: 1,
      };
    const expectedBehavior = probeBehavior(expected);
    const actualBehavior = probeBehavior(actual);
    const expectedBehaviorDigest = digest(expectedBehavior);
    const actualBehaviorDigest = digest(actualBehavior);
    if (expectedBehaviorDigest !== actualBehaviorDigest)
      return {
        report: {
          ...baseReport(bundle),
          reproduction: {
            status: "DIVERGED",
            kind: "capability_probe",
            reason:
              "Replayed capability behavior does not match the recorded result.",
            providerRequestsRecorded: frames.length,
            providerRequestsConsumed: provider.consumed,
            expectedBehaviorDigest,
            actualBehaviorDigest,
            mismatchedFields: mismatchedBehaviorFields(
              expectedBehavior,
              actualBehavior,
            ),
            recordedFailedDimensions: failedProfileDimensions(expected),
            reproducedFailedDimensions: failedProfileDimensions(actual),
          },
        },
        exitCode: 1,
      };
    return {
      report: {
        ...baseReport(bundle),
        reproduction: {
          status: "MATCH",
          kind: "capability_probe",
          expectedBehaviorDigest,
          actualBehaviorDigest,
          providerRequestsRecorded: frames.length,
          providerRequestsConsumed: provider.consumed,
          reproducedFailureClass: bundle.summary.failure?.class ?? null,
          recordedFailedDimensions: failedProfileDimensions(expected),
          reproducedFailedDimensions: failedProfileDimensions(actual),
        },
      },
      exitCode: 0,
    };
  } catch (error) {
    return {
      report: {
        ...baseReport(bundle),
        reproduction: {
          status: "DIVERGED",
          kind: "capability_probe",
          reason:
            error instanceof Error
              ? error.message
              : "Capability replay diverged.",
          providerRequestsRecorded: frames.length,
          providerRequestsConsumed: provider.consumed,
        },
      },
      exitCode: 1,
    };
  }
}
