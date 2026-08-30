import {
  probeAgentCapability,
  type AgentCapabilityProbeEnvironmentInput,
  type AgentCapabilityProbeResult,
} from "../agent/capability-probe.js";
import type { ProviderAdapter } from "../providers/types.js";
import {
  runLocalEvaluationTrial,
  type LocalEvaluationExecution,
  type LocalEvaluationTrialResult,
} from "./local-runner.js";
import type { EvaluationRunManifest } from "./schema.js";

const PROTOCOL_DIMENSIONS = [
  "conversation",
  "noToolDiscipline",
  "toolSelection",
  "toolArguments",
  "multiTurnTools",
  "errorRecovery",
] as const;

export interface LocalProtocolEvaluationValue {
  probe: AgentCapabilityProbeResult;
  failedDimensions: string[];
}

export async function executeLocalProtocolEvaluation(input: {
  provider: ProviderAdapter;
  modelId: string;
  signal: AbortSignal;
  environment?: AgentCapabilityProbeEnvironmentInput;
}): Promise<LocalEvaluationExecution<LocalProtocolEvaluationValue>> {
  const probe = await probeAgentCapability(
    input.provider,
    input.modelId,
    input.signal,
    {
      probeErrorRecovery: true,
      ...(input.environment ? { environment: input.environment } : {}),
    },
  );
  const failedDimensions = PROTOCOL_DIMENSIONS.filter(
    (dimension) => probe.profile?.[dimension].status !== "pass",
  );
  const measured = failedDimensions.length === 0;

  return {
    value: { probe, failedDimensions: [...failedDimensions] },
    outcome: measured ? "PASS" : "UNPROVEN",
    modelStatus: measured ? "completed" : "unproven",
    ...(measured
      ? {}
      : {
          failure: {
            class: "PROTOCOL_PROBE_DIMENSIONS_FAILED",
            summary: `Protocol-only trial did not pass: ${failedDimensions.join(", ")}.`,
            evidenceRefs: [],
          },
        }),
    metrics: {
      conversation: probe.conversation,
      readTool: probe.readTool,
      multiTurnTools: probe.multiTurnTools,
      agenticCodingEligible: probe.agenticCodingEligible,
      failedDimensionCount: failedDimensions.length,
    },
    evidenceRefs: [],
  };
}

export async function runLocalProtocolEvaluationTrial(input: {
  artifactRoot: string;
  manifest: EvaluationRunManifest;
  provider: ProviderAdapter;
  modelId: string;
  signal: AbortSignal;
  environment?: AgentCapabilityProbeEnvironmentInput;
}): Promise<LocalEvaluationTrialResult<LocalProtocolEvaluationValue>> {
  return runLocalEvaluationTrial({
    artifactRoot: input.artifactRoot,
    manifest: input.manifest,
    provider: input.provider,
    execute: ({ provider }) =>
      executeLocalProtocolEvaluation({
        provider,
        modelId: input.modelId,
        signal: input.signal,
        ...(input.environment ? { environment: input.environment } : {}),
      }),
  });
}
