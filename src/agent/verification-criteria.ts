import type { SuccessCriteriaVerification } from "./types.js";
import type { AgentTaskLedger } from "./task-state.js";

export interface StructuralCodingCriteriaChecks {
  reviewFinalDiff: () => boolean | Promise<boolean>;
  userWorkPreserved: () => boolean | Promise<boolean>;
}

function verificationPassed(ledger: AgentTaskLedger): boolean {
  if (ledger.verificationPlan.length === 0) return true;
  return ledger.verificationPlan.every((required) => {
    const latest = [...ledger.verificationRuns]
      .reverse()
      .find((run) => run.command === required.command);
    return latest?.status === "passed" && latest.exitCode === 0;
  });
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
  const mutationRecorded = ledger.filesChanged.length > 0;
  const verificationReady = verificationPassed(ledger);
  const reviewPassed = await checks.reviewFinalDiff();
  const userWorkPreserved = await checks.userWorkPreserved();

  if (mutationRecorded) satisfiedCriterionIds.push("criterion-1");
  else issues.push("No requested repository mutation is recorded.");

  if (verificationReady) satisfiedCriterionIds.push("criterion-2");
  else issues.push("Configured project verification has not passed.");

  if (reviewPassed && userWorkPreserved)
    satisfiedCriterionIds.push("criterion-3");
  else {
    if (!reviewPassed) issues.push("The final diff review has not passed.");
    if (!userWorkPreserved)
      issues.push("Pre-existing user work is not preserved.");
  }

  return {
    pass: issues.length === 0,
    satisfiedCriterionIds,
    issues,
  };
}
