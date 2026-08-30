import { expect, test } from "bun:test";
import { captureEvaluationModelRuntimeIdentity } from "../../src/evals/identity.js";
import type { ModelCandidate } from "../../src/shared/types.js";

test("evaluation identity records available runtime facts and marks unavailable artifact facts unknown", () => {
  const candidate: ModelCandidate = {
    id: "lm-studio/qwen2.5-coder-7b-instruct",
    providerId: "lm-studio",
    modelId: "qwen2.5-coder-7b-instruct",
    displayName: "Qwen2.5 Coder 7B Instruct",
    source: "local",
    capabilities: {
      tools: true,
      structuredOutput: true,
      reasoning: false,
      vision: false,
      maxContext: 32_768,
    },
    free: { status: "verified_free" },
    privacy: {
      classification: "local",
      retentionKnown: true,
      trainsOnInputs: false,
    },
    quality: { confidence: "reported" },
    health: { state: "healthy" },
    local: {
      runtime: "lm-studio",
      loaded: true,
      quant: "Q6_K",
      quantizationBitsPerWeight: 6.5,
      artifactId: "lmstudio-community/qwen2.5-coder-7b@q6_k",
      publisher: "Qwen",
      format: "gguf",
      modelRevision: "catalog-revision-7",
      runtimeVersion: "0.3.20",
      chatTemplate: "qwen2-tool-use",
      toolParser: "qwen2_native",
      architecture: "qwen2",
      parameters: "7B",
      sizeBytes: 6_254_199_296,
      loadedInstances: [
        {
          id: "qwen2.5-coder-7b-instruct",
          contextLength: 16_384,
          evalBatchSize: 2_048,
          parallel: 4,
          flashAttention: true,
          offloadKvCacheToGpu: true,
        },
      ],
    },
  };

  const identity = captureEvaluationModelRuntimeIdentity({
    candidate,
    runtime: {
      id: "lm-studio",
      displayName: "LM Studio",
      installed: true,
      endpoint: "http://127.0.0.1:1234/v1",
      version: "0.3.20",
    },
    endpointProtocol: "openai_compatible",
    contextConfiguration: { loadedContextTokens: 16_384 },
  });

  expect(identity.model).toMatchObject({
    providerFamily: "lm-studio",
    modelId: "qwen2.5-coder-7b-instruct",
    artifactId: {
      state: "observed",
      value: "lmstudio-community/qwen2.5-coder-7b@q6_k",
    },
    revision: { state: "observed", value: "catalog-revision-7" },
    artifactSha256: {
      state: "unknown",
      value: null,
      reason: "not_exposed",
    },
    quantization: { state: "observed", value: "Q6_K" },
  });
  expect(identity.runtime).toMatchObject({
    id: "lm-studio",
    version: { state: "observed", value: "0.3.20" },
    endpoint: {
      state: "observed",
      value: { origin: "http://127.0.0.1:1234", pathname: "/v1" },
    },
    chatTemplate: { state: "observed", value: "qwen2-tool-use" },
    toolParser: { state: "observed", value: "qwen2_native" },
    contextConfiguration: {
      catalogMaxTokens: 32_768,
      loadedContextTokens: 16_384,
      loaded: true,
      loadedInstanceCount: 1,
      loadedInstanceId: "qwen2.5-coder-7b-instruct",
      evalBatchSize: 2_048,
      parallel: 4,
      flashAttention: true,
      offloadKvCacheToGpu: true,
      quantizationBitsPerWeight: 6.5,
      format: "gguf",
      publisher: "Qwen",
    },
  });
});
