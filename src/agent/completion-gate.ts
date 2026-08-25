import type { TurnMode } from "./turn-policy.js";
import {
  evaluateEvidenceSufficiency,
  type EvidenceSufficiency,
} from "../context/evidence-sufficiency.js";
import type { ContextEvidence } from "./task-state.js";

export interface CompletionGateInput {
  mode: TurnMode;
  objectiveSatisfied: boolean;
  /** Explicit host/model criterion verification, when supplied by the task. */
  successCriteriaSatisfied?: boolean;
  evidenceCount: number;
  evidence?: readonly ContextEvidence[];
  evidenceState?: EvidenceSufficiency;
  mutationOccurred: boolean;
  verificationRequired: boolean;
  verificationPerformed: boolean;
  verificationPassed: boolean;
  finalReviewPerformed: boolean;
  unresolvedBlockers: number;
  userWorkPreserved: boolean;
}

export interface CompletionDecision {
  canComplete: boolean;
  reasons: string[];
  evidenceState: EvidenceSufficiency;
}

const EVIDENCE_MODES = new Set<TurnMode>([
  "workspace_question",
  "plan",
  "review",
  "coding",
  "command",
]);

export function evaluateCompletionGate(
  input: CompletionGateInput,
): CompletionDecision {
  const reasons: string[] = [];
  const evidenceState =
    input.evidenceState ??
    evaluateEvidenceSufficiency(
      input.mode,
      input.evidenceCount,
      false,
      input.evidence,
    );
  if (!input.objectiveSatisfied)
    reasons.push("success criteria are not satisfied");
  if (input.successCriteriaSatisfied === false)
    reasons.push("success criteria are not satisfied");
  if (EVIDENCE_MODES.has(input.mode) && evidenceState !== "SUFFICIENT")
    reasons.push("relevant repository evidence is missing");
  if (
    input.verificationRequired &&
    (!input.verificationPerformed || !input.verificationPassed)
  )
    reasons.push("required verification has not passed");
  if (input.mode === "coding" && !input.finalReviewPerformed)
    reasons.push("final review has not been performed");
  if (input.unresolvedBlockers > 0) reasons.push("unresolved blockers remain");
  if (!input.userWorkPreserved)
    reasons.push("pre-existing user work is not preserved");
  return { canComplete: reasons.length === 0, reasons, evidenceState };
}
