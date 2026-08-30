import { expect, test } from "bun:test";
import { createLocalEvaluationRunManifest } from "../../src/evals/local-run.js";
import { parsePublicEvaluationCase } from "../../src/evals/schema.js";
import type { ModelCandidate } from "../../src/shared/types.js";
import { evaluationRunManifestFixture } from "../support/evaluation-fixtures.js";

test("local run manifest binds the public case to exact observed model and runtime identity before invocation", () => {
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
      architecture: "qwen2",
      parameters: "7B",
      sizeBytes: 6_254_199_296,
      loadedInstances: [
        {
          id: "loaded-qwen",
          contextLength: 16_384,
          evalBatchSize: 2_048,
          parallel: 4,
          flashAttention: true,
          offloadKvCacheToGpu: true,
        },
      ],
    },
  };
  const evaluationCase = parsePublicEvaluationCase({
    schemaVersion: 1,
    caseId: "local-agent-baseline",
    revision: "v1",
    title: "Local agent baseline",
    family: "micro",
    capabilityTarget: "C2",
    origin: "local_real",
    workspaceFixture: {
      source: "generated:local-agent-baseline-v1",
      digest: "a".repeat(64),
    },
    objective: "Complete one bounded edit and verifier run.",
    policy: {
      writeAuthority: "bounded",
      networkAuthority: "loopback",
      commandPolicy: "disposable_fixture_only",
    },
    budgets: {
      actions: 16,
      inputTokens: null,
      outputTokens: 512,
      wallClockMs: 300_000,
    },
    visibleAcceptance: [
      {
        id: "verified-edit",
        statement: "The requested edit and verifier both succeed.",
        type: "test",
        required: true,
      },
    ],
    protectedAcceptanceRef: {
      id: "oracle-local-v1",
      sha256: "b".repeat(64),
    },
    tags: ["local", "real-model"],
  });
  const fixture = evaluationRunManifestFixture();

  const manifest = createLocalEvaluationRunManifest({
    runId: "20260828T011500Z-local-qwen",
    createdAt: "2026-08-28T01:15:00.000Z",
    evaluationCase,
    source: fixture.source,
    candidate,
    runtime: {
      id: "lm-studio",
      displayName: "LM Studio",
      installed: true,
      endpoint: "http://127.0.0.1:1234/v1",
    },
    request: {
      temperature: 0,
      maxOutputTokens: 512,
      toolSurfaceDigest: "c".repeat(64),
    },
    environment: fixture.environment,
    commandArgv: ["bun", "run", "scripts/evaluate-agent.ts", "--local-only"],
    environmentNames: ["SHELRA_EVAL_MAX_LOCAL_MODELS"],
  });

  expect(manifest).toMatchObject({
    status: "invocation_pending",
    evidenceClass: "real_local_model",
    case: {
      caseId: "local-agent-baseline",
      publicCaseDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      protectedAcceptanceRef: {
        id: "oracle-local-v1",
        sha256: "b".repeat(64),
      },
    },
    model: {
      artifactId: {
        state: "observed",
        value: "lmstudio-community/qwen2.5-coder-7b@q6_k",
      },
      artifactSha256: {
        state: "unknown",
        value: null,
        reason: "not_exposed",
      },
      quantization: { state: "observed", value: "Q6_K" },
    },
    runtime: {
      id: "lm-studio",
      endpointProtocol: {
        state: "observed",
        value: "openai_compatible",
      },
      contextConfiguration: {
        catalogMaxTokens: 32_768,
        loadedContextTokens: 16_384,
        loadedInstanceId: "loaded-qwen",
      },
    },
    policy: { network: "loopback", downloads: false, paidInference: false },
  });
  expect(JSON.stringify(manifest)).not.toContain("expectedValue");
  expect(manifest.reproduction.argv.at(-1)).toBe(
    "--replay-run=<manifest.json>",
  );
});
