import type { RuntimeDetection } from "../runtimes/types.js";
import type { ModelCandidate } from "../shared/types.js";
import type {
  EvaluationObservationValue,
  EvaluationRunManifest,
} from "./schema.js";

function observed<T>(value: T): EvaluationObservationValue<T> {
  return { state: "observed", value };
}

function notExposed<T>(): EvaluationObservationValue<T> {
  return { state: "unknown", value: null, reason: "not_exposed" };
}

function notCollected<T>(): EvaluationObservationValue<T> {
  return { state: "unknown", value: null, reason: "not_collected" };
}

function observedText(
  value: string | undefined,
  missing: "not_exposed" | "not_collected" = "not_exposed",
): EvaluationObservationValue<string> {
  if (value?.trim()) return observed(value.trim());
  return missing === "not_exposed" ? notExposed() : notCollected();
}

function endpointObservation(
  endpoint: string | undefined,
): EvaluationRunManifest["runtime"]["endpoint"] {
  if (!endpoint) return notExposed();
  try {
    const parsed = new URL(endpoint);
    return observed({
      origin: parsed.origin,
      pathname: parsed.pathname || "/",
    });
  } catch {
    return notCollected();
  }
}

export function captureEvaluationModelRuntimeIdentity(input: {
  candidate: ModelCandidate;
  runtime: RuntimeDetection;
  endpointProtocol?: string;
  contextConfiguration?: Record<string, string | number | boolean | null>;
}): {
  model: EvaluationRunManifest["model"];
  runtime: EvaluationRunManifest["runtime"];
} {
  const { candidate } = input;
  const local = candidate.local;
  const loadedInstances = local?.loadedInstances ?? [];
  const loadedInstance =
    loadedInstances.length === 1 ? loadedInstances[0] : undefined;
  const contextConfiguration: Record<string, string | number | boolean | null> =
    {
      ...(candidate.capabilities.maxContext === undefined
        ? {}
        : { catalogMaxTokens: candidate.capabilities.maxContext }),
      ...(local?.loaded === undefined ? {} : { loaded: local.loaded }),
      ...(local?.quantizationBitsPerWeight === undefined
        ? {}
        : { quantizationBitsPerWeight: local.quantizationBitsPerWeight }),
      ...(local?.format ? { format: local.format } : {}),
      ...(local?.publisher ? { publisher: local.publisher } : {}),
      ...(loadedInstances.length === 0
        ? {}
        : { loadedInstanceCount: loadedInstances.length }),
      ...(loadedInstance
        ? {
            loadedInstanceId: loadedInstance.id,
            ...(loadedInstance.contextLength === undefined
              ? {}
              : { loadedContextTokens: loadedInstance.contextLength }),
            ...(loadedInstance.evalBatchSize === undefined
              ? {}
              : { evalBatchSize: loadedInstance.evalBatchSize }),
            ...(loadedInstance.parallel === undefined
              ? {}
              : { parallel: loadedInstance.parallel }),
            ...(loadedInstance.flashAttention === undefined
              ? {}
              : { flashAttention: loadedInstance.flashAttention }),
            ...(loadedInstance.numExperts === undefined
              ? {}
              : { numExperts: loadedInstance.numExperts }),
            ...(loadedInstance.offloadKvCacheToGpu === undefined
              ? {}
              : {
                  offloadKvCacheToGpu: loadedInstance.offloadKvCacheToGpu,
                }),
          }
        : {}),
      ...(input.contextConfiguration ?? {}),
    };
  return {
    model: {
      providerFamily: local?.runtime ?? candidate.providerId,
      providerId: candidate.providerId,
      modelId: candidate.modelId ?? candidate.id,
      displayName: candidate.displayName,
      artifactId: observedText(local?.artifactId),
      artifactSha256: notExposed(),
      revision: observedText(local?.modelRevision),
      parameterClass: observedText(local?.parameters),
      quantization: observedText(local?.quant),
      architecture: observedText(local?.architecture),
      sizeBytes:
        local?.sizeBytes === undefined
          ? notExposed()
          : observed(local.sizeBytes),
    },
    runtime: {
      id: local?.runtime ?? input.runtime.id,
      version: observedText(local?.runtimeVersion ?? input.runtime.version),
      endpointProtocol: observedText(input.endpointProtocol, "not_collected"),
      endpoint: endpointObservation(input.runtime.endpoint),
      chatTemplate: observedText(local?.chatTemplate),
      toolTemplate: notExposed(),
      structuredOutputMode: notCollected(),
      reasoningMode: notCollected(),
      tokenizerId: notExposed(),
      toolParser: observedText(local?.toolParser),
      contextConfiguration,
    },
  };
}
