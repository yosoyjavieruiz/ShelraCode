import type { EvaluationRunManifest } from "../../src/evals/schema.js";

export function observed<T>(value: T) {
  return { state: "observed" as const, value };
}

export function unknown(
  reason: "not_exposed" | "not_collected" | "not_applicable",
) {
  return { state: "unknown" as const, value: null, reason };
}

export function evaluationRunManifestFixture(): EvaluationRunManifest {
  return {
    schemaVersion: 1,
    runId: "20260828T001500Z-qwen7b-trial1",
    createdAt: "2026-08-28T00:15:00.000Z",
    status: "invocation_pending",
    evidenceClass: "real_local_model",
    case: {
      caseId: "local-agent-baseline",
      revision: "v1",
      publicCaseDigest: "1".repeat(64),
      fixtureDigest: "2".repeat(64),
      protectedAcceptanceRef: null,
    },
    source: {
      head: observed("230b5575a592897fa113e3d05407e6f93e4f01da"),
      dirtyStateDigest: observed("3".repeat(64)),
      executedSource: observed({
        kind: "source",
        path: "scripts/evaluate-agent.ts",
        sha256: "4".repeat(64),
      }),
      packageVersion: "0.1.1",
      artifacts: [],
    },
    model: {
      providerFamily: "lm-studio",
      providerId: "lm-studio",
      modelId: "qwen2.5-coder-7b-instruct",
      displayName: "Qwen2.5 Coder 7B Instruct",
      artifactId: unknown("not_exposed"),
      artifactSha256: unknown("not_exposed"),
      revision: unknown("not_exposed"),
      parameterClass: observed("7B"),
      quantization: observed("Q6_K"),
      architecture: observed("qwen2"),
      sizeBytes: observed(6_254_199_296),
    },
    runtime: {
      id: "lm-studio",
      version: unknown("not_exposed"),
      endpointProtocol: observed("openai_compatible"),
      endpoint: observed({
        origin: "http://127.0.0.1:1234",
        pathname: "/v1",
      }),
      chatTemplate: unknown("not_exposed"),
      toolTemplate: unknown("not_exposed"),
      structuredOutputMode: unknown("not_collected"),
      reasoningMode: unknown("not_collected"),
      tokenizerId: unknown("not_exposed"),
      toolParser: unknown("not_exposed"),
      contextConfiguration: {
        catalogMaxTokens: 32_768,
        loadedContextTokens: 16_384,
      },
    },
    request: {
      temperature: 0,
      maxOutputTokens: 512,
      seed: unknown("not_exposed"),
      reasoningEffort: unknown("not_collected"),
      toolSurfaceDigest: "5".repeat(64),
    },
    environment: {
      bun: "1.3.14",
      node: "v24.3.0",
      os: "win32 10.0.26200",
      platform: "win32",
      arch: "x64",
      hardwareFingerprint: unknown("not_collected"),
    },
    driverProfile: unknown("not_applicable"),
    policy: {
      network: "loopback",
      downloads: false,
      paidInference: false,
    },
    command: {
      argv: ["bun", "run", "scripts/evaluate-agent.ts", "--local-only"],
      environmentNames: ["SHELRA_EVAL_MAX_LOCAL_MODELS"],
    },
    reproduction: {
      argv: [
        "bun",
        "run",
        "scripts/evaluate-agent.ts",
        "--replay-run=<manifest.json>",
      ],
    },
  };
}
