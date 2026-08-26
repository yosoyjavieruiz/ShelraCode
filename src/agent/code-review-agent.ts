import type { LocalCodeLogger } from "../shared/logging.js";
import { runCommand } from "../shared/process.js";
import type { VerificationCommand } from "./verification-plan.js";
import type { AgentTaskLedger } from "./task-state.js";
import {
  independentlyVerifyTask,
  type IndependentVerificationResult,
  type VerificationIssue,
} from "./verifier.js";
import type { TurnMode } from "./turn-policy.js";

function isNotGitRepository(result: {
  exitCode: number;
  stdout: string;
  stderr: string;
}): boolean {
  return (
    (result.exitCode === 128 || result.exitCode === 129) &&
    /(?:not a git repository|no es un repositorio(?: de)? git)/iu.test(
      `${result.stderr}\n${result.stdout}`,
    )
  );
}

export interface CodeReviewInput {
  root: string;
  objective: string;
  mode: TurnMode;
  ledger: AgentTaskLedger;
  verificationRequired: boolean;
  verificationCommands?: VerificationCommand[];
  verificationState?: "not_required" | "available" | "unavailable";
  finalReviewPerformed: boolean;
  userWorkPreserved: boolean;
  signal?: AbortSignal;
  logger?: LocalCodeLogger;
}

export interface CodeReviewDimension {
  name:
    | "evidence"
    | "bounded-execution"
    | "verification"
    | "completion-truth"
    | "user-work-safety";
  status: "pass" | "partial" | "fail";
  evidence: string;
}

export interface CodeReviewReport {
  role: "code-review";
  verdict: "PASS" | "BLOCKED";
  score: number;
  dimensions: CodeReviewDimension[];
  issues: VerificationIssue[];
  diffCheck: "passed" | "failed" | "unavailable";
  verification: IndependentVerificationResult;
  reference: string;
}

/**
 * Read-only host reviewer for non-trivial tasks. It deliberately consumes
 * structured ledger state and Git's whitespace check; it never edits files,
 * runs model-generated commands or treats model prose as proof. The Claude
 * Code reference is a behavioral rubric, not a claim of implementation parity.
 */
export async function runCodeReview(
  input: CodeReviewInput,
): Promise<CodeReviewReport> {
  const verification = independentlyVerifyTask({
    objective: input.objective,
    mode: input.mode,
    ledger: input.ledger,
    verificationRequired: input.verificationRequired,
    verificationCommands: input.verificationCommands,
    verificationState: input.verificationState,
    finalReviewPerformed: input.finalReviewPerformed,
    userWorkPreserved: input.userWorkPreserved,
  });
  let diffCheck: CodeReviewReport["diffCheck"] = "unavailable";
  if (!input.signal?.aborted) {
    try {
      const result = await runCommand("git", ["diff", "--check", "--"], {
        intent: "read",
        cwd: input.root,
        signal: input.signal,
        timeoutMs: 10_000,
        logger: input.logger,
      });
      diffCheck =
        result.exitCode === 0
          ? "passed"
          : isNotGitRepository(result)
            ? "unavailable"
            : "failed";
    } catch (error) {
      if (input.signal?.aborted) diffCheck = "unavailable";
      else {
        diffCheck = "failed";
        input.logger?.warn("agent.code_review.diff_check_failed", {
          errorType: error instanceof Error ? error.name : "unknown",
        });
      }
    }
  }

  const relevantEvidence = input.ledger.evidence.filter(
    (evidence) => evidence.relevance >= 0.5 && evidence.freshness > 0,
  ).length;
  const mutationActions = input.ledger.actions.filter(
    (action) => action.kind === "write" || action.kind === "execute",
  ).length;
  const dimensions: CodeReviewDimension[] = [
    {
      name: "evidence",
      status: relevantEvidence > 0 ? "pass" : "fail",
      evidence: `${relevantEvidence} fresh relevant ledger evidence item(s).`,
    },
    {
      name: "bounded-execution",
      status:
        mutationActions === 0 ||
        input.ledger.actions.every((action) => action.status !== "failed")
          ? "pass"
          : "partial",
      evidence: `${input.ledger.actions.length} structured action(s), ${mutationActions} mutation/execute action(s).`,
    },
    {
      name: "verification",
      status:
        input.verificationState === "unavailable"
          ? "fail"
          : verification.issues.some(
                (issue) =>
                  issue.code === "VERIFICATION_FAILED" ||
                  issue.code === "VERIFICATION_MISSING" ||
                  issue.code === "VERIFICATION_UNAVAILABLE",
              )
            ? "fail"
            : "pass",
      evidence: `${input.ledger.verificationRuns.length} verification run(s) recorded.`,
    },
    {
      name: "completion-truth",
      status: verification.pass ? "pass" : "fail",
      evidence: verification.pass
        ? "Independent structured reviewer found no blocking issue."
        : `${verification.issues.length} blocking review issue(s).`,
    },
    {
      name: "user-work-safety",
      status: input.userWorkPreserved ? "pass" : "fail",
      evidence: input.userWorkPreserved
        ? "Checkpoint preservation check passed."
        : "Pre-existing user work could not be proven preserved.",
    },
  ];
  let reviewedVerification = verification;
  if (diffCheck === "failed") {
    reviewedVerification = {
      ...verification,
      pass: false,
      confidence: Math.min(verification.confidence, 0.2),
      issues: [
        ...verification.issues,
        {
          code: "FINAL_REVIEW_FAILED",
          message: "Git whitespace/diff validation failed.",
          severity: "error",
        },
      ],
    };
  }
  const failedDimensions = dimensions.filter(
    (dimension) => dimension.status === "fail",
  ).length;
  const partialDimensions = dimensions.filter(
    (dimension) => dimension.status === "partial",
  ).length;
  const score = Math.max(0, 10 - failedDimensions * 2 - partialDimensions);
  const verdict =
    reviewedVerification.pass && diffCheck !== "failed" ? "PASS" : "BLOCKED";
  input.logger?.info("agent.code_review.finished", {
    verdict,
    score,
    issueCount: verification.issues.length,
    diffCheck,
  });
  return {
    role: "code-review",
    verdict,
    score,
    dimensions,
    issues: verification.issues,
    diffCheck,
    verification: reviewedVerification,
    reference:
      "Claude Code public agent-loop baseline: context, action, verification, repeat; behavioral comparison only.",
  };
}
