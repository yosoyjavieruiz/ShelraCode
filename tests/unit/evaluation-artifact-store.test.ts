import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createEvaluationRunStore,
  readEvaluationRunBundle,
} from "../../src/evals/artifact-store.js";
import { evaluationRunManifestFixture } from "../support/evaluation-fixtures.js";

test("evaluation store persists an immutable manifest before observations can be recorded", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shelra-eval-store-"));
  const manifest = evaluationRunManifestFixture();

  try {
    const store = await createEvaluationRunStore({ root, manifest });
    const persisted = JSON.parse(
      await readFile(store.manifestPath, "utf8"),
    ) as unknown;

    expect(persisted).toEqual(manifest);
    await expect(stat(store.summaryPath)).rejects.toThrow();
    await expect(createEvaluationRunStore({ root, manifest })).rejects.toThrow(
      "already exists",
    );
    expect(JSON.parse(await readFile(store.manifestPath, "utf8"))).toEqual(
      manifest,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("evaluation store redacts and hash-chains raw failure observations before sealing a summary", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shelra-eval-events-"));
  const manifest = {
    ...evaluationRunManifestFixture(),
    runId: "20260828T002000Z-failed-action",
  };

  try {
    const store = await createEvaluationRunStore({ root, manifest });
    const first = await store.appendObservation({
      origin: "provider",
      kind: "provider.request",
      payload: {
        authorization: "Bearer private-token-value",
        message: "token=private-token-value",
      },
    });
    const second = await store.appendObservation({
      origin: "provider",
      kind: "provider.event",
      payload: {
        type: "error",
        code: "MODEL_PROTOCOL_ERROR",
        message: "Bearer private-token-value failed",
      },
    });
    const third = await store.appendObservation({
      origin: "host",
      kind: "trial.result",
      payload: {
        outcome: "FAIL",
        modelStatus: "failed",
        failure: {
          class: "MODEL_PROTOCOL_ERROR",
          summary: "The model emitted an invalid action.",
        },
      },
    });
    const summary = await store.seal({
      startedAt: "2026-08-28T00:20:00.000Z",
      completedAt: "2026-08-28T00:20:03.000Z",
      outcome: "FAIL",
      modelStatus: "failed",
      failure: {
        class: "MODEL_PROTOCOL_ERROR",
        summary: "The model emitted an invalid action.",
        evidenceRefs: [`observation:${third.sequence}`],
      },
      metrics: { providerRequests: 1, providerEvents: 1 },
      evidenceRefs: [
        `observation:${first.sequence}`,
        `observation:${second.sequence}`,
        `observation:${third.sequence}`,
      ],
    });

    expect(first.sequence).toBe(1);
    expect(first.previousDigest).toBeNull();
    expect(second.sequence).toBe(2);
    expect(second.previousDigest).toBe(first.digest);
    expect(third.sequence).toBe(3);
    expect(third.previousDigest).toBe(second.digest);
    expect(summary.observationCount).toBe(3);
    expect(summary.finalObservationDigest).toBe(third.digest);

    const serialized = await readFile(store.observationsPath, "utf8");
    expect(serialized).not.toContain("private-token-value");
    expect(serialized).toContain("[REDACTED]");

    const replayed = await readEvaluationRunBundle(store.manifestPath);
    expect(replayed.summary).toEqual(summary);
    expect(replayed.observations.map((item) => item.digest)).toEqual([
      first.digest,
      second.digest,
      third.digest,
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("evaluation store rejects a symlinked artifact root", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "shelra-eval-symlink-"));
  const realRoot = path.join(parent, "real");
  const linkedRoot = path.join(parent, "linked");

  try {
    await mkdir(realRoot);
    await symlink(
      realRoot,
      linkedRoot,
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      createEvaluationRunStore({
        root: linkedRoot,
        manifest: {
          ...evaluationRunManifestFixture(),
          runId: "20260828T002500Z-symlink-root",
        },
      }),
    ).rejects.toThrow("artifact root must not be a symbolic link");
    await expect(
      stat(path.join(realRoot, "20260828T002500Z-symlink-root")),
    ).rejects.toThrow();
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("evaluation store redacts secret-shaped manifest arguments before persistence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shelra-eval-manifest-"));
  const manifest = {
    ...evaluationRunManifestFixture(),
    runId: "20260828T004000Z-redacted-manifest",
    command: {
      ...evaluationRunManifestFixture().command,
      argv: ["bun", "run", "eval", "--token=private-token-value"],
    },
  };

  try {
    const store = await createEvaluationRunStore({ root, manifest });
    const persisted = await readFile(store.manifestPath, "utf8");
    expect(persisted).not.toContain("private-token-value");
    expect(persisted).toContain("[REDACTED]");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("evaluation bundle reader rejects a symlinked run directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shelra-eval-read-link-"));
  const realRoot = path.join(root, "real");
  const linkedRun = path.join(root, "linked-run");
  const manifest = {
    ...evaluationRunManifestFixture(),
    runId: "20260828T004500Z-linked-replay",
  };

  try {
    const store = await createEvaluationRunStore({ root: realRoot, manifest });
    const observation = await store.appendObservation({
      origin: "host",
      kind: "trial.result",
      payload: {
        outcome: "FAIL",
        modelStatus: "failed",
        failure: {
          class: "MODEL_PROTOCOL_ERROR",
          summary: "Recorded protocol failure.",
        },
      },
    });
    const evidenceRef = `observation:${observation.sequence}`;
    await store.seal({
      startedAt: "2026-08-28T00:45:00.000Z",
      completedAt: "2026-08-28T00:45:01.000Z",
      outcome: "FAIL",
      modelStatus: "failed",
      failure: {
        class: "MODEL_PROTOCOL_ERROR",
        summary: "Recorded protocol failure.",
        evidenceRefs: [evidenceRef],
      },
      metrics: {},
      evidenceRefs: [evidenceRef],
    });
    await symlink(
      store.runDirectory,
      linkedRun,
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      readEvaluationRunBundle(path.join(linkedRun, "manifest.json")),
    ).rejects.toThrow("run directory must not be a symbolic link");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("evaluation store rejects a PASS summary whose model status is failed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shelra-eval-pass-state-"));
  const manifest = {
    ...evaluationRunManifestFixture(),
    runId: "20260828T005000Z-contradictory-pass",
  };

  try {
    const store = await createEvaluationRunStore({ root, manifest });
    const observation = await store.appendObservation({
      origin: "host",
      kind: "trial.result",
      payload: { status: "failed" },
    });

    await expect(
      store.seal({
        startedAt: "2026-08-28T00:50:00.000Z",
        completedAt: "2026-08-28T00:50:01.000Z",
        outcome: "PASS",
        modelStatus: "failed",
        metrics: {},
        evidenceRefs: [`observation:${observation.sequence}`],
      }),
    ).rejects.toThrow("PASS outcome requires completed model status");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("evaluation store rejects a PASS summary that contradicts its referenced failed trial result", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "shelra-eval-contradictory-result-"),
  );
  const manifest = {
    ...evaluationRunManifestFixture(),
    runId: "20260828T005200Z-contradictory-trial-result",
  };

  try {
    const store = await createEvaluationRunStore({ root, manifest });
    const observation = await store.appendObservation({
      origin: "host",
      kind: "trial.result",
      payload: {
        outcome: "FAIL",
        modelStatus: "failed",
        failure: {
          class: "MODEL_PROTOCOL_ERROR",
          summary: "The model action failed.",
        },
      },
    });

    await expect(
      store.seal({
        startedAt: "2026-08-28T00:52:00.000Z",
        completedAt: "2026-08-28T00:52:01.000Z",
        outcome: "PASS",
        modelStatus: "completed",
        metrics: {},
        evidenceRefs: [`observation:${observation.sequence}`],
      }),
    ).rejects.toThrow("summary outcome contradicts trial.result outcome");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real-model evaluation store rejects PASS without a sealed trial result", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "shelra-eval-missing-trial-result-"),
  );
  const manifest = {
    ...evaluationRunManifestFixture(),
    runId: "20260828T005300Z-missing-trial-result",
  };

  try {
    const store = await createEvaluationRunStore({ root, manifest });
    const observation = await store.appendObservation({
      origin: "host",
      kind: "trial.started",
      payload: { caseId: manifest.case.caseId },
    });

    await expect(
      store.seal({
        startedAt: "2026-08-28T00:53:00.000Z",
        completedAt: "2026-08-28T00:53:01.000Z",
        outcome: "PASS",
        modelStatus: "completed",
        metrics: {},
        evidenceRefs: [`observation:${observation.sequence}`],
      }),
    ).rejects.toThrow(
      "real_local_model summary evidence must bind exactly one trial.result",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("real-model evaluation store rejects an unreferenced duplicate trial result", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "shelra-eval-duplicate-trial-result-"),
  );
  const manifest = {
    ...evaluationRunManifestFixture(),
    runId: "20260828T005400Z-duplicate-trial-result",
  };

  try {
    const store = await createEvaluationRunStore({ root, manifest });
    await store.appendObservation({
      origin: "host",
      kind: "trial.result",
      payload: {
        outcome: "FAIL",
        modelStatus: "failed",
        failure: {
          class: "MODEL_PROTOCOL_ERROR",
          summary: "The first terminal result failed.",
        },
      },
    });
    const acceptedResult = await store.appendObservation({
      origin: "host",
      kind: "trial.result",
      payload: {
        outcome: "PASS",
        modelStatus: "completed",
        failure: null,
      },
    });

    await expect(
      store.seal({
        startedAt: "2026-08-28T00:54:00.000Z",
        completedAt: "2026-08-28T00:54:01.000Z",
        outcome: "PASS",
        modelStatus: "completed",
        metrics: {},
        evidenceRefs: [`observation:${acceptedResult.sequence}`],
      }),
    ).rejects.toThrow(
      "real_local_model run must record exactly one trial.result observation",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("evaluation store rejects evidence references that do not name a recorded observation", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "shelra-eval-unbound-evidence-"),
  );
  const manifest = {
    ...evaluationRunManifestFixture(),
    runId: "20260828T005500Z-unbound-evidence",
  };

  try {
    const store = await createEvaluationRunStore({ root, manifest });
    await store.appendObservation({
      origin: "host",
      kind: "trial.result",
      payload: { status: "failed" },
    });

    await expect(
      store.seal({
        startedAt: "2026-08-28T00:55:00.000Z",
        completedAt: "2026-08-28T00:55:01.000Z",
        outcome: "FAIL",
        modelStatus: "failed",
        failure: {
          class: "MODEL_PROTOCOL_ERROR",
          summary: "Recorded protocol failure.",
          evidenceRefs: ["observation:999"],
        },
        metrics: {},
        evidenceRefs: ["observation:999"],
      }),
    ).rejects.toThrow("unknown observation: observation:999");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("evaluation store rejects a summary completed before it started", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shelra-eval-time-order-"));
  const manifest = {
    ...evaluationRunManifestFixture(),
    runId: "20260828T010000Z-reversed-summary-time",
  };

  try {
    const store = await createEvaluationRunStore({ root, manifest });
    const observation = await store.appendObservation({
      origin: "host",
      kind: "trial.result",
      payload: { status: "failed" },
    });
    const evidenceRef = `observation:${observation.sequence}`;

    await expect(
      store.seal({
        startedAt: "2026-08-28T01:00:01.000Z",
        completedAt: "2026-08-28T01:00:00.000Z",
        outcome: "FAIL",
        modelStatus: "failed",
        failure: {
          class: "MODEL_PROTOCOL_ERROR",
          summary: "Recorded protocol failure.",
          evidenceRefs: [evidenceRef],
        },
        metrics: {},
        evidenceRefs: [evidenceRef],
      }),
    ).rejects.toThrow("completedAt must not precede summary.startedAt");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
