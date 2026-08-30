import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readEvaluationRunBundle } from "../../src/evals/artifact-store.js";
import { runLocalProtocolEvaluationTrial } from "../../src/evals/protocol-trial.js";
import { replayEvaluationRunBundle } from "../../src/evals/replay.js";
import type { ProviderAdapter } from "../../src/providers/types.js";
import { evaluationRunManifestFixture } from "../support/evaluation-fixtures.js";

test("protocol-only local trial seals exactly the real provider frames replay consumes", async () => {
  const artifactRoot = await mkdtemp(
    path.join(os.tmpdir(), "shelra-protocol-trial-"),
  );
  const manifest = {
    ...evaluationRunManifestFixture(),
    runId: "20260828T020000Z-protocol-only-trial",
  };
  let inferenceCalls = 0;
  const provider: ProviderAdapter = {
    id: "lm-studio",
    displayName: "LM Studio fixture",
    discoverModels: async () => [],
    health: async () => ({ state: "healthy" }),
    quota: async () => ({
      providerId: "lm-studio",
      confidence: "unknown",
      observedAt: "2026-08-28T02:00:00.000Z",
    }),
    async *stream() {
      inferenceCalls += 1;
      yield { type: "text.delta", text: "No tool call selected." };
      yield { type: "done" };
    },
    classifyError: (error) => ({ code: "UNKNOWN", message: String(error) }),
  };

  try {
    const trial = await runLocalProtocolEvaluationTrial({
      artifactRoot,
      manifest,
      provider,
      modelId: manifest.model.modelId,
      signal: new AbortController().signal,
    });
    const bundle = await readEvaluationRunBundle(trial.manifestPath);
    const recordedRequests = bundle.observations.filter(
      (observation) => observation.kind === "provider.request",
    ).length;

    expect(recordedRequests).toBe(inferenceCalls);
    expect(recordedRequests).toBeGreaterThan(0);
    expect(bundle.observations.at(-1)?.kind).toBe("trial.result");
    expect(bundle.summary).toMatchObject({
      outcome: "UNPROVEN",
      modelStatus: "unproven",
      failure: { class: "PROTOCOL_PROBE_DIMENSIONS_FAILED" },
    });

    const replay = await replayEvaluationRunBundle(bundle);
    expect(replay.exitCode).toBe(0);
    expect(replay.report.reproduction).toMatchObject({
      status: "MATCH",
      kind: "capability_probe",
      providerRequestsRecorded: recordedRequests,
      providerRequestsConsumed: recordedRequests,
    });
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
}, 30_000);
