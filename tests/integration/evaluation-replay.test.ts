import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createEvaluationRunStore } from "../../src/evals/artifact-store.js";
import { runCommand } from "../../src/shared/process.js";
import { evaluationRunManifestFixture } from "../support/evaluation-fixtures.js";

test("evaluator fails closed when a sealed failed action lacks deterministic replay material", async () => {
  const artifactRoot = await mkdtemp(
    path.join(os.tmpdir(), "shelra-evaluator-replay-"),
  );

  try {
    const store = await createEvaluationRunStore({
      root: artifactRoot,
      manifest: {
        ...evaluationRunManifestFixture(),
        runId: "20260828T010000Z-replay-failed-action",
        evidenceClass: "scripted_fake" as const,
      },
    });
    const requestObservation = await store.appendObservation({
      origin: "provider",
      kind: "provider.request",
      payload: {
        modelId: "qwen2.5-coder-7b-instruct",
        messages: [{ role: "user", content: "Return one action." }],
        toolChoice: "auto",
        temperature: 0,
        maxOutputTokens: 512,
        reasoningEffort: null,
        stream: true,
        toolSurface: { digest: "0".repeat(64), names: [], count: 0 },
      },
    });
    const errorObservation = await store.appendObservation({
      origin: "provider",
      kind: "provider.event",
      payload: {
        type: "error",
        error: {
          code: "MODEL_PROTOCOL_ERROR",
          message: "The model emitted an invalid action.",
        },
      },
    });
    await store.seal({
      startedAt: "2026-08-28T01:00:00.000Z",
      completedAt: "2026-08-28T01:00:01.000Z",
      outcome: "FAIL",
      modelStatus: "failed",
      failure: {
        class: "MODEL_PROTOCOL_ERROR",
        summary: "The model emitted an invalid action.",
        evidenceRefs: [`observation:${errorObservation.sequence}`],
      },
      metrics: { providerEvents: 1 },
      evidenceRefs: [
        `observation:${requestObservation.sequence}`,
        `observation:${errorObservation.sequence}`,
      ],
    });

    const before = await readdir(artifactRoot);
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
    const replay = JSON.parse(result.stdout) as {
      schemaVersion: number;
      kind: string;
      integrity: string;
      runId: string;
      recordedOutcome: string;
      recordedFailureClass: string | null;
      reproduction: {
        status: string;
        reason: string;
      };
    };
    expect(replay).toMatchObject({
      schemaVersion: 1,
      kind: "evaluation_replay",
      integrity: "verified",
      runId: "20260828T010000Z-replay-failed-action",
      recordedOutcome: "FAIL",
      recordedFailureClass: "MODEL_PROTOCOL_ERROR",
      reproduction: {
        status: "BLOCKED",
        reason: expect.stringContaining("capability probe result"),
      },
    });
    expect(result.stdout).not.toContain("The model emitted an invalid action.");
    expect(await readdir(artifactRoot)).toEqual(before);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
}, 30_000);
