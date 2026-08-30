import { expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readEvaluationRunBundle } from "../../src/evals/artifact-store.js";
import { runLocalEvaluationTrial } from "../../src/evals/local-runner.js";
import type { ProviderAdapter } from "../../src/providers/types.js";
import { evaluationRunManifestFixture } from "../support/evaluation-fixtures.js";

function providerThatFails(onInvoke: () => Promise<void>): ProviderAdapter {
  return {
    id: "lm-studio",
    displayName: "LM Studio",
    discoverModels: async () => [],
    health: async () => ({ state: "healthy" }),
    quota: async () => ({
      providerId: "lm-studio",
      confidence: "unknown",
      observedAt: "2026-08-28T01:30:00.000Z",
    }),
    async *stream() {
      await onInvoke();
      yield {
        type: "error" as const,
        error: {
          code: "MODEL_PROTOCOL_ERROR" as const,
          message: "malformed tool call",
          status: 200,
        },
      };
    },
    classifyError: (error) => ({ code: "UNKNOWN", message: String(error) }),
  };
}

test("local trial persists manifest before inference, records provider and agent failure evidence, and seals FAIL", async () => {
  const artifactRoot = await mkdtemp(
    path.join(os.tmpdir(), "shelra-local-trial-"),
  );
  const manifest = {
    ...evaluationRunManifestFixture(),
    runId: "20260828T013000Z-local-failed-trial",
  };
  let manifestExistedAtInvocation = false;

  try {
    const trial = await runLocalEvaluationTrial({
      artifactRoot,
      manifest,
      provider: providerThatFails(async () => {
        manifestExistedAtInvocation = Boolean(
          await stat(path.join(artifactRoot, manifest.runId, "manifest.json")),
        );
      }),
      async execute({ provider, recordAgentEvent }) {
        const events = [];
        for await (const event of provider.stream(
          {
            modelId: "qwen2.5-coder-7b-instruct",
            messages: [{ role: "user", content: "Read demo.txt" }],
            stream: true,
          },
          new AbortController().signal,
        ))
          events.push(event);
        recordAgentEvent({
          type: "task.failed",
          error: "malformed tool call",
        });
        return {
          value: { events: events.length },
          outcome: "FAIL",
          modelStatus: "failed",
          failure: {
            class: "MODEL_PROTOCOL_ERROR",
            summary: "malformed tool call",
            evidenceRefs: ["provider:event"],
          },
          metrics: { providerEvents: events.length },
          evidenceRefs: ["provider:event", "agent:event"],
        };
      },
    });

    expect(manifestExistedAtInvocation).toBe(true);
    expect(trial.value).toEqual({ events: 1 });
    const bundle = await readEvaluationRunBundle(trial.manifestPath);
    expect(bundle.manifest.status).toBe("invocation_pending");
    expect(bundle.manifest.evidenceClass).toBe("real_local_model");
    expect(bundle.observations.map((item) => item.kind)).toEqual(
      expect.arrayContaining([
        "trial.started",
        "provider.request",
        "provider.event",
        "agent.event",
        "trial.result",
      ]),
    );
    expect(bundle.summary).toMatchObject({
      outcome: "FAIL",
      modelStatus: "failed",
      failure: { class: "MODEL_PROTOCOL_ERROR" },
    });
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});

test("local trial seals an unexpected driver exception instead of leaving an unreadable run", async () => {
  const artifactRoot = await mkdtemp(
    path.join(os.tmpdir(), "shelra-local-trial-crash-"),
  );
  const manifest = {
    ...evaluationRunManifestFixture(),
    runId: "20260828T013500Z-local-crashed-trial",
  };

  try {
    const trial = await runLocalEvaluationTrial({
      artifactRoot,
      manifest,
      provider: providerThatFails(async () => undefined),
      execute: async () => {
        throw new Error("fixture driver crash");
      },
    });

    expect(trial.value).toBeUndefined();
    const bundle = await readEvaluationRunBundle(trial.manifestPath);
    expect(bundle.observations.map((item) => item.kind)).toContain(
      "trial.exception",
    );
    expect(bundle.observations.at(-1)?.kind).toBe("trial.result");
    expect(bundle.summary).toMatchObject({
      outcome: "FAIL",
      modelStatus: "failed",
      failure: {
        class: "EVALUATION_DRIVER_EXCEPTION",
        summary: "fixture driver crash",
      },
    });
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
});
