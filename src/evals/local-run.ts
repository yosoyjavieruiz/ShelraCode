import type { RuntimeDetection } from "../runtimes/types.js";
import type { ModelCandidate } from "../shared/types.js";
import { captureEvaluationModelRuntimeIdentity } from "./identity.js";
import {
  digestPublicEvaluationCase,
  parseEvaluationRunManifest,
  type EvaluationObservationValue,
  type EvaluationRunManifest,
  type PublicEvaluationCase,
} from "./schema.js";

function unknown<T>(
  reason: "not_exposed" | "not_collected" | "not_applicable",
): EvaluationObservationValue<T> {
  return { state: "unknown", value: null, reason };
}

function endpointProtocol(runtimeId: string): string {
  return runtimeId === "ollama" ? "ollama_chat" : "openai_compatible";
}

/**
 * Builds the immutable pre-invocation manifest for one exact local model run.
 * Protected acceptance content is deliberately absent; only its opaque,
 * digest-bound public reference can cross this boundary.
 */
export function createLocalEvaluationRunManifest(input: {
  runId: string;
  createdAt: string;
  evaluationCase: PublicEvaluationCase;
  source: EvaluationRunManifest["source"];
  candidate: ModelCandidate;
  runtime: RuntimeDetection;
  endpointProtocol?: string;
  request: {
    temperature: number;
    maxOutputTokens: number;
    toolSurfaceDigest: string;
  };
  environment: EvaluationRunManifest["environment"];
  commandArgv: string[];
  environmentNames: string[];
}): EvaluationRunManifest {
  const identity = captureEvaluationModelRuntimeIdentity({
    candidate: input.candidate,
    runtime: input.runtime,
    endpointProtocol:
      input.endpointProtocol ?? endpointProtocol(input.runtime.id),
  });
  return parseEvaluationRunManifest({
    schemaVersion: 1,
    runId: input.runId,
    createdAt: input.createdAt,
    status: "invocation_pending",
    evidenceClass: "real_local_model",
    case: {
      caseId: input.evaluationCase.caseId,
      revision: input.evaluationCase.revision,
      publicCaseDigest: digestPublicEvaluationCase(input.evaluationCase),
      fixtureDigest: input.evaluationCase.workspaceFixture.digest,
      protectedAcceptanceRef: input.evaluationCase.protectedAcceptanceRef,
    },
    source: input.source,
    model: identity.model,
    runtime: identity.runtime,
    request: {
      temperature: input.request.temperature,
      maxOutputTokens: input.request.maxOutputTokens,
      seed: unknown("not_exposed"),
      reasoningEffort: unknown("not_collected"),
      toolSurfaceDigest: input.request.toolSurfaceDigest,
    },
    environment: input.environment,
    driverProfile: unknown("not_applicable"),
    policy: {
      network: "loopback",
      downloads: false,
      paidInference: false,
    },
    command: {
      argv: input.commandArgv,
      environmentNames: input.environmentNames,
    },
    reproduction: {
      argv: [
        "bun",
        "run",
        "scripts/evaluate-agent.ts",
        "--replay-run=<manifest.json>",
      ],
    },
  });
}
