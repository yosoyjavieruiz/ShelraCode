import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createEvaluationRunStore } from "../../src/evals/artifact-store.js";
import { recordProviderAdapter } from "../../src/evals/provider-recorder.js";
import type {
  ProviderAdapter,
  ProviderEvent,
} from "../../src/providers/types.js";
import { evaluationRunManifestFixture } from "../support/evaluation-fixtures.js";

test("recording provider persists the manifest before invocation and preserves the event stream without storing reasoning text", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shelra-eval-provider-"));
  const manifest = {
    ...evaluationRunManifestFixture(),
    runId: "20260828T003000Z-provider-stream",
  };

  try {
    const store = await createEvaluationRunStore({ root, manifest });
    let manifestExistedAtInvocation = false;
    const sourceEvents: ProviderEvent[] = [
      { type: "reasoning.delta", text: "private chain of thought" },
      { type: "text.delta", text: "public answer" },
      {
        type: "tool.call",
        call: { id: "call-1", name: "ReadFile", arguments: '{"path":"a.ts"}' },
      },
      { type: "done" },
    ];
    const provider: ProviderAdapter = {
      id: "fixture-provider",
      displayName: "Fixture provider",
      discoverModels: async () => [],
      health: async () => ({ state: "healthy" }),
      quota: async () => ({
        providerId: "fixture-provider",
        confidence: "unknown",
        observedAt: "2026-08-28T00:30:00.000Z",
      }),
      async *stream() {
        manifestExistedAtInvocation = Boolean(await stat(store.manifestPath));
        for (const event of sourceEvents) yield event;
      },
      classifyError: (error) => ({ code: "UNKNOWN", message: String(error) }),
    };
    const recording = recordProviderAdapter(provider, store);
    const received: ProviderEvent[] = [];

    for await (const event of recording.stream(
      {
        modelId: "fixture-model",
        messages: [{ role: "user", content: "Read a.ts" }],
        tools: [
          {
            type: "function",
            function: { name: "ReadFile", parameters: { type: "object" } },
          },
        ],
        toolChoice: "auto",
        temperature: 0,
        maxOutputTokens: 128,
        stream: true,
      },
      new AbortController().signal,
    ))
      received.push(event);

    const resultObservation = await store.appendObservation({
      origin: "host",
      kind: "trial.result",
      payload: {
        outcome: "PASS",
        modelStatus: "completed",
        failure: null,
        metrics: { providerEvents: received.length },
      },
    });
    await store.seal({
      startedAt: "2026-08-28T00:30:00.000Z",
      completedAt: "2026-08-28T00:30:01.000Z",
      outcome: "PASS",
      modelStatus: "completed",
      metrics: { providerEvents: received.length },
      evidenceRefs: [`observation:${resultObservation.sequence}`],
    });

    expect(manifestExistedAtInvocation).toBe(true);
    expect(received).toEqual(sourceEvents);
    const observations = await readFile(store.observationsPath, "utf8");
    expect(observations).not.toContain("private chain of thought");
    expect(observations).toContain('"kind":"provider.request"');
    expect(observations).toContain('"kind":"provider.event"');
    expect(observations).toContain('"chars":24');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
