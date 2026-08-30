import { expect, test } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readEvaluationRunBundle } from "../../src/evals/artifact-store.js";
import { runCommand } from "../../src/shared/process.js";

test("deterministic evaluator persists a scripted-fake evidence bundle", async () => {
  const artifactRoot = await mkdtemp(
    path.join(os.tmpdir(), "shelra-evaluator-artifacts-"),
  );

  try {
    const result = await runCommand(
      "bun",
      [
        "--conditions=browser",
        "run",
        "scripts/evaluate-agent.ts",
        "--summary",
        `--artifact-root=${artifactRoot}`,
      ],
      {
        cwd: path.resolve(import.meta.dir, "../.."),
        intent: "execute",
        network: "deny",
        isolation: "best_effort",
        allowWeakIsolation: true,
        timeoutMs: 120_000,
        maxOutputChars: 20_000,
      },
    );

    expect(result.exitCode).toBe(0);
    const runIds = await readdir(artifactRoot);
    expect(runIds).toHaveLength(1);
    const bundle = await readEvaluationRunBundle(
      path.join(artifactRoot, runIds[0]!, "manifest.json"),
    );
    expect(bundle.manifest.evidenceClass).toBe("scripted_fake");
    expect(bundle.manifest.model.providerFamily).toBe("scripted_fake");
    expect(bundle.summary).toMatchObject({
      outcome: "PASS",
      modelStatus: "completed",
    });
    expect(bundle.observations.map((item) => item.kind)).toContain(
      "deterministic.result",
    );
    expect(
      bundle.observations.some(
        (item) =>
          typeof item.payload === "object" &&
          item.payload !== null &&
          JSON.stringify(item.payload).includes('"passed":18'),
      ),
    ).toBe(true);
  } finally {
    await rm(artifactRoot, { recursive: true, force: true });
  }
}, 120_000);
