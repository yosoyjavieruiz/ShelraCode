import type { SuccessCriteriaVerification } from "./types.js";
import type { AgentTaskLedger } from "./task-state.js";
import type { ObjectiveReviewResult } from "./objective-review.js";

export interface StructuralCodingCriteriaChecks {
  reviewFinalDiff: () => boolean | Promise<boolean>;
  userWorkPreserved: () => boolean | Promise<boolean>;
  /**
   * Optional objective-aware review. The historical structural fallback is
   * retained for direct callers, while the production TUI supplies this so
   * "a mutation happened" cannot stand in for the user's actual request.
   */
  reviewObjective?: () =>
    ObjectiveReviewResult | boolean | Promise<ObjectiveReviewResult | boolean>;
  verificationState?: "not_required" | "available" | "unavailable";
}

function verificationPassed(
  ledger: AgentTaskLedger,
  state: StructuralCodingCriteriaChecks["verificationState"],
): boolean {
  if (state === "unavailable") return false;
  if (ledger.verificationPlan.length === 0) return true;
  return ledger.verificationPlan.every((required) => {
    const latest = [...ledger.verificationRuns]
      .reverse()
      .find((run) => run.command === required.command);
    return latest?.status === "passed" && latest.exitCode === 0;
  });
}

function failureEvidence(run: {
  summary?: string;
  failurePaths?: string[];
}): string | undefined {
  const lines = (run.summary ?? "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) =>
      /(?:expected:|received:|error:|fail\)|failed|\.test\.|\.spec\.)/iu.test(
        line,
      ),
    )
    .slice(0, 6);
  if (lines.length === 0) return undefined;
  const prefix =
    run.failurePaths && run.failurePaths.length > 0
      ? `${run.failurePaths.join(", ")}: `
      : "";
  return `${prefix}${lines.join(" ")}`.slice(0, 900);
}

/**
 * Verify the generic criteria that the TUI can prove without guessing about
 * the user's semantics. Task-specific callers should add a stronger checker
 * when they can inspect exact expected files, symbols, or behavior.
 */
export async function verifyStructuralCodingCriteria(
  ledger: AgentTaskLedger,
  checks: StructuralCodingCriteriaChecks,
): Promise<SuccessCriteriaVerification> {
  const issues: string[] = [];
  const satisfiedCriterionIds: string[] = [];
  const nextActions: string[] = [];
  const nextPaths: string[] = [];
  const objectiveReview = checks.reviewObjective
    ? await checks.reviewObjective()
    : undefined;
  const objectivePassed =
    typeof objectiveReview === "boolean"
      ? objectiveReview
      : (objectiveReview?.pass ?? ledger.filesChanged.length > 0);
  const verificationReady = verificationPassed(
    ledger,
    checks.verificationState,
  );
  const reviewPassed = await checks.reviewFinalDiff();
  const userWorkPreserved = await checks.userWorkPreserved();

  if (objectivePassed) satisfiedCriterionIds.push("criterion-1");
  else {
    if (typeof objectiveReview === "object" && objectiveReview !== null) {
      issues.push(...objectiveReview.issues);
      nextActions.push(...objectiveReview.nextActions);
      if (issues.length === 0)
        issues.push("The concrete coding objective is not yet proven.");
      if (nextActions.length === 0)
        nextActions.push(
          "Apply and verify the smallest requested repository change.",
        );
    } else {
      issues.push("No requested repository mutation is recorded.");
      nextActions.push("Apply the smallest requested repository mutation.");
    }
  }

  if (verificationReady) satisfiedCriterionIds.push("criterion-2");
  else {
    issues.push(
      checks.verificationState === "unavailable"
        ? "No host-owned project verification command is available; completion cannot be claimed as verified."
        : "Configured project verification has not passed.",
    );
    nextActions.push(
      "Inspect the latest verification failure, repair the affected code, and rerun the configured verification.",
    );
    const latestFailedRuns = ledger.verificationPlan
      .map((required) =>
        [...ledger.verificationRuns]
          .reverse()
          .find((run) => run.command === required.command),
      )
      .filter(
        (run): run is NonNullable<typeof run> =>
          run !== undefined && run.status === "failed",
      );
    const failurePaths = [
      ...new Set(latestFailedRuns.flatMap((run) => run.failurePaths ?? [])),
    ];
    nextPaths.push(...failurePaths);
    if (failurePaths.length > 0)
      nextActions.unshift(
        `Read ${failurePaths.join(", ")} before editing; these paths contain the latest verification failure.`,
      );
    const evidence = latestFailedRuns
      .map((run) => failureEvidence(run))
      .find((value): value is string => value !== undefined);
    if (evidence)
      nextActions.unshift(
        `Latest verification evidence: ${evidence}. Use this evidence to correct the failing assertion and preserve behavior that already passes.`,
      );
  }

  if (reviewPassed && userWorkPreserved)
    satisfiedCriterionIds.push("criterion-3");
  else {
    if (!reviewPassed) issues.push("The final diff review has not passed.");
    if (!reviewPassed)
      nextActions.push("Review the final diff before declaring completion.");
    if (!userWorkPreserved) {
      issues.push("Pre-existing user work is not preserved.");
      nextActions.push("Stop and preserve pre-existing user changes.");
    }
  }

  return {
    pass: issues.length === 0,
    satisfiedCriterionIds: [...new Set(satisfiedCriterionIds)],
    issues: [...new Set(issues)],
    nextPaths: [...new Set(nextPaths)],
    nextActions: [...new Set(nextActions)],
  };
}
