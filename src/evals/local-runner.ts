import type { AgentEvent } from "../agent/types.js";
import type { ProviderAdapter } from "../providers/types.js";
import {
  createEvaluationRunStore,
  type EvaluationRunSummary,
  type EvaluationRunSummaryInput,
} from "./artifact-store.js";
import { recordProviderAdapter } from "./provider-recorder.js";
import type { EvaluationRunManifest } from "./schema.js";

export interface LocalEvaluationExecution<T> {
  value: T;
  outcome: EvaluationRunSummaryInput["outcome"];
  modelStatus: EvaluationRunSummaryInput["modelStatus"];
  failure?: EvaluationRunSummaryInput["failure"];
  metrics: EvaluationRunSummaryInput["metrics"];
  evidenceRefs: string[];
}

export interface LocalEvaluationTrialResult<T> {
  manifestPath: string;
  runDirectory: string;
  summary: EvaluationRunSummary;
  value?: T;
}

/**
 * Owns one local evaluation trial's evidence lifecycle. The manifest is on
 * disk before the wrapped provider can be invoked, and every terminal path is
 * sealed into a replayable bundle.
 */
export async function runLocalEvaluationTrial<T>(input: {
  artifactRoot: string;
  manifest: EvaluationRunManifest;
  provider: ProviderAdapter;
  execute(context: {
    provider: ProviderAdapter;
    recordAgentEvent: (event: AgentEvent) => void;
  }): Promise<LocalEvaluationExecution<T>>;
  clock?: () => Date;
}): Promise<LocalEvaluationTrialResult<T>> {
  const clock = input.clock ?? (() => new Date());
  const startedAt = clock().toISOString();
  const store = await createEvaluationRunStore({
    root: input.artifactRoot,
    manifest: input.manifest,
    clock,
  });
  const provider = recordProviderAdapter(input.provider, store);
  let agentQueue: Promise<unknown> = Promise.resolve();
  const recordAgentEvent = (event: AgentEvent): void => {
    agentQueue = agentQueue.then(() =>
      store.appendObservation({
        origin: "agent",
        kind: "agent.event",
        payload: event,
      }),
    );
  };

  await store.appendObservation({
    origin: "host",
    kind: "trial.started",
    payload: {
      caseId: input.manifest.case.caseId,
      modelId: input.manifest.model.modelId,
      evidenceClass: input.manifest.evidenceClass,
    },
  });

  try {
    const execution = await input.execute({ provider, recordAgentEvent });
    await agentQueue;
    const resultObservation = await store.appendObservation({
      origin: "host",
      kind: "trial.result",
      payload: {
        outcome: execution.outcome,
        modelStatus: execution.modelStatus,
        failure: execution.failure ?? null,
        metrics: execution.metrics,
        result: execution.value,
      },
    });
    const resultEvidenceRef = `observation:${resultObservation.sequence}`;
    const summary = await store.seal({
      startedAt,
      completedAt: clock().toISOString(),
      outcome: execution.outcome,
      modelStatus: execution.modelStatus,
      ...(execution.failure
        ? {
            failure: {
              ...execution.failure,
              evidenceRefs: [resultEvidenceRef],
            },
          }
        : {}),
      metrics: execution.metrics,
      evidenceRefs: [resultEvidenceRef],
    });
    return {
      manifestPath: store.manifestPath,
      runDirectory: store.runDirectory,
      summary,
      value: execution.value,
    };
  } catch (error) {
    await agentQueue;
    const message = error instanceof Error ? error.message : String(error);
    const exceptionObservation = await store.appendObservation({
      origin: "host",
      kind: "trial.exception",
      payload: {
        name: error instanceof Error ? error.name : "UnknownError",
        message,
      },
    });
    const resultObservation = await store.appendObservation({
      origin: "host",
      kind: "trial.result",
      payload: {
        outcome: "FAIL",
        modelStatus: "failed",
        failure: {
          class: "EVALUATION_DRIVER_EXCEPTION",
          summary: message,
        },
        metrics: {},
        result: null,
      },
    });
    const resultEvidenceRef = `observation:${resultObservation.sequence}`;
    const summary = await store.seal({
      startedAt,
      completedAt: clock().toISOString(),
      outcome: "FAIL",
      modelStatus: "failed",
      failure: {
        class: "EVALUATION_DRIVER_EXCEPTION",
        summary: message,
        evidenceRefs: [resultEvidenceRef],
      },
      metrics: {},
      evidenceRefs: [
        `observation:${exceptionObservation.sequence}`,
        resultEvidenceRef,
      ],
    });
    return {
      manifestPath: store.manifestPath,
      runDirectory: store.runDirectory,
      summary,
    };
  }
}
