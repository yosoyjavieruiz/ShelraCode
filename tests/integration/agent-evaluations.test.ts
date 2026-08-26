import { describe, expect, test } from "bun:test";
import {
  EXPECTED_AGENT_JOURNEYS,
  runDeterministicAgentEvaluation,
  summarizeAgentEvaluation,
} from "../evals/agent-journeys.js";

describe("autonomous agent evaluation matrix", () => {
  test("covers heterogeneous deterministic journeys with host evidence", async () => {
    const report = await runDeterministicAgentEvaluation();

    expect(report.journeys.map((journey) => journey.id)).toEqual([
      ...EXPECTED_AGENT_JOURNEYS,
    ]);
    expect(report.summary.unproven).toBe(0);
    expect(report.summary.failed).toBe(0);
    expect(report.summary.passed).toBe(EXPECTED_AGENT_JOURNEYS.length);

    for (const journey of report.journeys) {
      expect(journey.passed).toBe(true);
      expect(journey.status).toBe(journey.expectedStatus);
      expect(journey.verificationStatus).toBeDefined();
      expect(journey.recoveryCount).toBeGreaterThanOrEqual(0);
    }

    expect(
      report.journeys.find((item) => item.id === "false-completion"),
    ).toMatchObject({
      status: "blocked",
      verified: false,
      verificationStatus: "not_required",
    });
    expect(
      report.journeys.find((item) => item.id === "failing-test-repair"),
    ).toMatchObject({
      status: "completed",
      verified: true,
      verificationStatus: "passed",
    });
    expect(
      report.journeys.find((item) => item.id === "strict-zero-rejection"),
    ).toMatchObject({
      status: "rejected",
      verified: false,
      verificationStatus: "not_applicable",
    });
  });

  test("does not claim aggregate success when a journey is unproven", () => {
    const summary = summarizeAgentEvaluation([
      {
        id: "synthetic-unproven",
        category: "long_horizon",
        expectedStatus: "completed",
        status: "unproven",
        passed: false,
        verified: false,
        verificationStatus: "unknown",
        recoveryCount: 0,
        turns: 0,
        toolRuns: 0,
        evidenceCount: 0,
        filesChanged: [],
        compactionObserved: false,
        reason: "No admissible model was available.",
      },
    ]);

    expect(summary.unproven).toBe(1);
    expect(summary.aggregateStatus).toBe("UNPROVEN");
    expect(summary.successRate).toBeUndefined();

    const skipped = summarizeAgentEvaluation([
      {
        id: "synthetic-skipped",
        category: "local_model_matrix",
        expectedStatus: "completed",
        status: "skipped",
        passed: false,
        verified: false,
        verificationStatus: "unknown",
        recoveryCount: 0,
        turns: 0,
        toolRuns: 0,
        evidenceCount: 0,
        filesChanged: [],
        compactionObserved: false,
        reason: "Model was not loaded.",
      },
    ]);
    expect(skipped.skipped).toBe(1);
    expect(skipped.aggregateStatus).toBe("UNPROVEN");
    expect(skipped.successRate).toBeUndefined();
  });
});
