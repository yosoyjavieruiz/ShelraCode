import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { probeAgentCapability } from "../../src/agent/capability-probe.js";
import { createEvaluationRunStore } from "../../src/evals/artifact-store.js";
import {
  evaluationProviderRequestPayload,
  recordProviderAdapter,
} from "../../src/evals/provider-recorder.js";
import type { ProviderAdapter } from "../../src/providers/types.js";
import { runCommand } from "../../src/shared/process.js";
import { evaluationRunManifestFixture } from "../support/evaluation-fixtures.js";

test("evaluator deterministically reproduces a recorded failed capability probe without inference", async () => {
  const artifactRoot = await mkdtemp(
    path.join(os.tmpdir(), "shelra-real-replay-"),
  );
  const probeRoot = await mkdtemp(
    path.join(os.tmpdir(), "shelra-real-replay-probe-"),
  );
  const manifest = {
    ...evaluationRunManifestFixture(),
    runId: "20260828T014500Z-recorded-probe-failure",
  };
  let liveInferenceCalls = 0;
  const provider: ProviderAdapter = {
    id: "lm-studio",
    displayName: "LM Studio fixture",
    discoverModels: async () => [],
    health: async () => ({ state: "healthy" }),
    quota: async () => ({
      providerId: "lm-studio",
      confidence: "unknown",
      observedAt: "2026-08-28T01:45:00.000Z",
    }),
    async *stream() {
      liveInferenceCalls += 1;
      yield { type: "text.delta", text: "Bearer private-token-value" };
      yield { type: "done" };
    },
    classifyError: (error) => ({ code: "UNKNOWN", message: String(error) }),
  };

  try {
    const store = await createEvaluationRunStore({
      root: artifactRoot,
      manifest,
    });
    const probe = await probeAgentCapability(
      recordProviderAdapter(provider, store),
      manifest.model.modelId,
      new AbortController().signal,
      { root: probeRoot },
    );
    expect(liveInferenceCalls).toBeGreaterThan(0);
    const resultObservation = await store.appendObservation({
      origin: "host",
      kind: "trial.result",
      payload: {
        outcome: "UNPROVEN",
        modelStatus: "unproven",
        failure: {
          class: "CAPABILITY_PROBE_NOT_ELIGIBLE",
          summary: "The model did not select required tools.",
        },
        metrics: { agenticCodingEligible: probe.agenticCodingEligible },
        result: { probe },
      },
    });
    const resultEvidenceRef = `observation:${resultObservation.sequence}`;
    await store.seal({
      startedAt: "2026-08-28T01:45:00.000Z",
      completedAt: "2026-08-28T01:45:03.000Z",
      outcome: "UNPROVEN",
      modelStatus: "unproven",
      failure: {
        class: "CAPABILITY_PROBE_NOT_ELIGIBLE",
        summary: "The model did not select required tools.",
        evidenceRefs: [resultEvidenceRef],
      },
      metrics: { agenticCodingEligible: false },
      evidenceRefs: [resultEvidenceRef],
    });
    const before = await readdir(artifactRoot);
    const callsBeforeReplay = liveInferenceCalls;

    const result = await runCommand(
      "bun",
      [
        "--conditions=browser",
        "run",
        "scripts/evaluate-agent.ts",
        `--replay-run=${store.manifestPath}`,
        "--json",
      ],
      {
        cwd: path.resolve(import.meta.dir, "../.."),
        intent: "execute",
        network: "deny",
        isolation: "best_effort",
        allowWeakIsolation: true,
        timeoutMs: 30_000,
        maxOutputChars: 50_000,
      },
    );

    expect(result.exitCode).toBe(0);
    expect(liveInferenceCalls).toBe(callsBeforeReplay);
    const replay = JSON.parse(result.stdout) as {
      integrity: string;
      runId: string;
      reproduction: {
        status: string;
        kind: string;
        expectedBehaviorDigest: string;
        actualBehaviorDigest: string;
        providerRequestsConsumed: number;
        recordedFailedDimensions: string[];
        reproducedFailedDimensions: string[];
      };
    };
    expect(replay).toMatchObject({
      integrity: "verified",
      runId: manifest.runId,
      reproduction: {
        status: "MATCH",
        kind: "capability_probe",
        providerRequestsConsumed: liveInferenceCalls,
      },
    });
    expect(replay.reproduction.expectedBehaviorDigest).toBe(
      replay.reproduction.actualBehaviorDigest,
    );
    expect(replay.reproduction.recordedFailedDimensions).toContain(
      "errorRecovery",
    );
    expect(replay.reproduction.reproducedFailedDimensions).toEqual(
      replay.reproduction.recordedFailedDimensions,
    );
    expect(result.stdout).not.toContain("private-token-value");
    expect(result.stdout).not.toContain("Bearer [REDACTED]");
    expect(await readdir(artifactRoot)).toEqual(before);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
    await rm(probeRoot, { recursive: true, force: true });
  }
}, 30_000);

test("evaluator rejects a replay bundle with an unconsumed provider frame", async () => {
  const artifactRoot = await mkdtemp(
    path.join(os.tmpdir(), "shelra-surplus-replay-"),
  );
  const manifest = {
    ...evaluationRunManifestFixture(),
    runId: "20260828T015000Z-surplus-provider-frame",
  };
  const provider: ProviderAdapter = {
    id: "lm-studio",
    displayName: "LM Studio fixture",
    discoverModels: async () => [],
    health: async () => ({ state: "healthy" }),
    quota: async () => ({
      providerId: "lm-studio",
      confidence: "unknown",
      observedAt: "2026-08-28T01:50:00.000Z",
    }),
    async *stream() {
      yield { type: "text.delta", text: "No tool call selected." };
      yield { type: "done" };
    },
    classifyError: (error) => ({ code: "UNKNOWN", message: String(error) }),
  };

  try {
    const store = await createEvaluationRunStore({
      root: artifactRoot,
      manifest,
    });
    const probe = await probeAgentCapability(
      recordProviderAdapter(provider, store),
      manifest.model.modelId,
      new AbortController().signal,
      { probeErrorRecovery: true },
    );
    const surplusRequest = {
      modelId: manifest.model.modelId,
      messages: [{ role: "user" as const, content: "Unused stale frame." }],
      stream: true as const,
    };
    await store.appendObservation({
      origin: "provider",
      kind: "provider.request",
      payload: evaluationProviderRequestPayload(surplusRequest),
    });
    await store.appendObservation({
      origin: "provider",
      kind: "provider.event",
      payload: { type: "done" },
    });
    const resultObservation = await store.appendObservation({
      origin: "host",
      kind: "trial.result",
      payload: {
        outcome: "UNPROVEN",
        modelStatus: "unproven",
        failure: {
          class: "CAPABILITY_PROBE_NOT_ELIGIBLE",
          summary: "The model did not select required tools.",
        },
        metrics: { agenticCodingEligible: probe.agenticCodingEligible },
        result: { probe },
      },
    });
    const resultEvidenceRef = `observation:${resultObservation.sequence}`;
    await store.seal({
      startedAt: "2026-08-28T01:50:00.000Z",
      completedAt: "2026-08-28T01:50:03.000Z",
      outcome: "UNPROVEN",
      modelStatus: "unproven",
      failure: {
        class: "CAPABILITY_PROBE_NOT_ELIGIBLE",
        summary: "The model did not select required tools.",
        evidenceRefs: [resultEvidenceRef],
      },
      metrics: { agenticCodingEligible: false },
      evidenceRefs: [resultEvidenceRef],
    });

    const result = await runCommand(
      "bun",
      [
        "--conditions=browser",
        "run",
        "scripts/evaluate-agent.ts",
        `--replay-run=${store.manifestPath}`,
        "--json",
      ],
      {
        cwd: path.resolve(import.meta.dir, "../.."),
        intent: "execute",
        network: "deny",
        isolation: "best_effort",
        allowWeakIsolation: true,
        timeoutMs: 30_000,
        maxOutputChars: 50_000,
      },
    );

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.stdout)).toMatchObject({
      reproduction: {
        status: "DIVERGED",
        reason: expect.stringContaining("unconsumed provider frame"),
      },
    });
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
}, 30_000);

test("evaluator rejects a capability result that is not named by sealed summary evidence", async () => {
  const artifactRoot = await mkdtemp(
    path.join(os.tmpdir(), "shelra-unbound-result-replay-"),
  );
  const manifest = {
    ...evaluationRunManifestFixture(),
    runId: "20260828T015500Z-unbound-probe-result",
    evidenceClass: "scripted_fake" as const,
  };
  const provider: ProviderAdapter = {
    id: "lm-studio",
    displayName: "LM Studio fixture",
    discoverModels: async () => [],
    health: async () => ({ state: "healthy" }),
    quota: async () => ({
      providerId: "lm-studio",
      confidence: "unknown",
      observedAt: "2026-08-28T01:55:00.000Z",
    }),
    async *stream() {
      yield { type: "text.delta", text: "No tool call selected." };
      yield { type: "done" };
    },
    classifyError: (error) => ({ code: "UNKNOWN", message: String(error) }),
  };

  try {
    const store = await createEvaluationRunStore({
      root: artifactRoot,
      manifest,
    });
    const probe = await probeAgentCapability(
      recordProviderAdapter(provider, store),
      manifest.model.modelId,
      new AbortController().signal,
      { probeErrorRecovery: true },
    );
    await store.appendObservation({
      origin: "host",
      kind: "trial.result",
      payload: {
        outcome: "UNPROVEN",
        modelStatus: "unproven",
        failure: {
          class: "CAPABILITY_PROBE_NOT_ELIGIBLE",
          summary: "The model did not select required tools.",
        },
        metrics: { agenticCodingEligible: probe.agenticCodingEligible },
        result: { probe },
      },
    });
    const unrelatedObservation = await store.appendObservation({
      origin: "verifier",
      kind: "verifier.result",
      payload: { status: "unproven" },
    });
    const unrelatedEvidenceRef = `observation:${unrelatedObservation.sequence}`;
    await store.seal({
      startedAt: "2026-08-28T01:55:00.000Z",
      completedAt: "2026-08-28T01:55:03.000Z",
      outcome: "UNPROVEN",
      modelStatus: "unproven",
      failure: {
        class: "CAPABILITY_PROBE_NOT_ELIGIBLE",
        summary: "The model did not select required tools.",
        evidenceRefs: [unrelatedEvidenceRef],
      },
      metrics: { agenticCodingEligible: false },
      evidenceRefs: [unrelatedEvidenceRef],
    });

    const result = await runCommand(
      "bun",
      [
        "--conditions=browser",
        "run",
        "scripts/evaluate-agent.ts",
        `--replay-run=${store.manifestPath}`,
        "--json",
      ],
      {
        cwd: path.resolve(import.meta.dir, "../.."),
        intent: "execute",
        network: "deny",
        isolation: "best_effort",
        allowWeakIsolation: true,
        timeoutMs: 30_000,
        maxOutputChars: 50_000,
      },
    );

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      reproduction: {
        status: "BLOCKED",
        reason: expect.stringContaining("summary evidence"),
      },
    });
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
}, 30_000);
