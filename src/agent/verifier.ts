import type { AgentTaskLedger } from "./task-state.js";
import type { TurnMode } from "./turn-policy.js";
import type { VerificationCommand } from "./verification-plan.js";
import type { ObjectiveProofAssessment } from "./objective-proof.js";

export interface VerificationIssue {
  code:
    | "NO_EVIDENCE"
    | "NO_MUTATION"
    | "VERIFICATION_MISSING"
    | "VERIFICATION_UNAVAILABLE"
    | "VERIFICATION_FAILED"
    | "FINAL_REVIEW_MISSING"
    | "FINAL_REVIEW_FAILED"
    | "BLOCKER_PRESENT"
    | "USER_WORK_CHANGED"
    | "OBJECTIVE_PROOF_MISSING";
  message: string;
  severity: "error" | "warning";
}

export interface IndependentVerificationInput {
  objective: string;
  mode: TurnMode;
  ledger: AgentTaskLedger;
  verificationRequired: boolean;
  verificationCommands?: VerificationCommand[];
  verificationState?: "not_required" | "available" | "unavailable";
  finalReviewPerformed: boolean;
  userWorkPreserved: boolean;
  objectiveProof?: ObjectiveProofAssessment;
}

export interface IndependentVerificationResult {
  pass: boolean;
  confidence: number;
  issues: VerificationIssue[];
}

/**
 * Host-side completion review. It reads only the structured task ledger and
 * never edits the workspace. Model prose cannot override these checks.
 */
export function independentlyVerifyTask(
  input: IndependentVerificationInput,
): IndependentVerificationResult {
  const issues: VerificationIssue[] = [];
  const evidenceRequired = new Set<TurnMode>([
    "workspace_question",
    "plan",
    "review",
    "coding",
    "command",
  ]);
  if (
    evidenceRequired.has(input.mode) &&
    !input.ledger.evidence.some(
      (evidence) => evidence.relevance >= 0.5 && evidence.freshness > 0,
    )
  )
    issues.push({
      code: "NO_EVIDENCE",
      message: "The task has no recorded repository evidence.",
      severity: "error",
    });
  if (input.mode === "coding" && input.ledger.filesChanged.length === 0)
    issues.push({
      code: "NO_MUTATION",
      message: "The coding task recorded no changed file.",
      severity: "error",
    });
  if (input.verificationRequired) {
    const requiredCommands = input.verificationCommands ?? [];
    if (input.verificationState === "unavailable")
      issues.push({
        code: "VERIFICATION_UNAVAILABLE",
        message:
          "No host-owned verification command is available for this coding task.",
        severity: "error",
      });
    if (requiredCommands.length > 0) {
      for (const required of requiredCommands) {
        const latest = [...input.ledger.verificationRuns]
          .reverse()
          .find((run) => run.command === required.command);
        if (!latest)
          issues.push({
            code: "VERIFICATION_MISSING",
            message: `Required ${required.stage} verification was not recorded: ${required.command}`,
            severity: "error",
          });
        else if (latest.status !== "passed" || latest.exitCode !== 0)
          issues.push({
            code: "VERIFICATION_FAILED",
            message: `Required ${required.stage} verification did not pass: ${required.command}`,
            severity: "error",
          });
      }
    } else {
      const latest = input.ledger.verificationRuns.at(-1);
      if (!latest)
        issues.push({
          code: "VERIFICATION_MISSING",
          message: "Required verification was not recorded.",
          severity: "error",
        });
      else if (latest.status !== "passed" || latest.exitCode !== 0)
        issues.push({
          code: "VERIFICATION_FAILED",
          message: "The latest required verification did not pass.",
          severity: "error",
        });
    }
  }
  const latestAction = input.ledger.actions.at(-1);
  if (
    (input.mode === "command" || input.mode === "coding") &&
    latestAction?.kind === "execute" &&
    latestAction.status === "failed"
  )
    issues.push({
      code: "VERIFICATION_FAILED",
      message: "The latest execution action failed.",
      severity: "error",
    });
  if (input.mode === "coding" && !input.finalReviewPerformed)
    issues.push({
      code: "FINAL_REVIEW_MISSING",
      message: "The final diff review was not recorded.",
      severity: "error",
    });
  for (const blocker of input.ledger.blockers)
    issues.push({
      code: "BLOCKER_PRESENT",
      message: blocker.summary,
      severity: "error",
    });
  if (!input.userWorkPreserved)
    issues.push({
      code: "USER_WORK_CHANGED",
      message:
        "A checkpointed file changed outside the task's latest known content.",
      severity: "error",
    });
  if (input.objectiveProof && !input.objectiveProof.pass)
    for (const requirement of input.objectiveProof.missingRequirements.slice(
      0,
      8,
    ))
      issues.push({
        code: "OBJECTIVE_PROOF_MISSING",
        message: `Required objective proof is missing: ${requirement.requirementId}. ${requirement.reason}`,
        severity: "error",
      });
  const errors = issues.filter((issue) => issue.severity === "error").length;
  return {
    pass: errors === 0,
    confidence: errors === 0 ? 1 : Math.max(0, 1 - errors / 5),
    issues,
  };
}
