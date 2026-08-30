import type { TurnMode } from "./turn-policy.js";
import {
  evaluateEvidenceSufficiency,
  type EvidenceSufficiency,
} from "../context/evidence-sufficiency.js";
import type { ContextEvidence } from "./task-state.js";
import type { ObjectiveProofAssessment } from "./objective-proof.js";
import type { AcceptanceProofAssessment } from "../evidence/acceptance.js";

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
  verificationState?: "not_required" | "available" | "unavailable";
  finalReviewPerformed: boolean;
  unresolvedBlockers: number;
  userWorkPreserved: boolean;
  /** Host-owned proof of the requested objective, when a contract is active. */
  objectiveProof?: ObjectiveProofAssessment;
  /** Canonical obligation/evidence proof, when the caller has compiled one. */
  acceptanceProof?: AcceptanceProofAssessment;
}

export interface CompletionDecision {
  canComplete: boolean;
  reasons: string[];
  evidenceState: EvidenceSufficiency;
  /** Present only when canonical acceptance proof participated in the gate. */
  acceptanceProof?: AcceptanceProofAssessment;
  /** True when a completion declaration was rejected for lack of proof. */
  falseSuccess?: boolean;
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
  if (input.objectiveProof && !input.objectiveProof.pass)
    for (const requirement of input.objectiveProof.missingRequirements.slice(
      0,
      8,
    ))
      reasons.push(
        `required objective proof is missing: ${requirement.requirementId}`,
      );
  if (input.acceptanceProof && !input.acceptanceProof.canComplete) {
    const proofReasons = input.acceptanceProof.reasons.slice(0, 8);
    if (proofReasons.length > 0)
      reasons.push(
        ...proofReasons.map((reason) => `acceptance proof: ${reason}`),
      );
    else reasons.push("required acceptance proof is missing");
  }
  if (input.successCriteriaSatisfied === false)
    reasons.push("success criteria are not satisfied");
  if (EVIDENCE_MODES.has(input.mode) && evidenceState !== "SUFFICIENT")
    reasons.push("relevant repository evidence is missing");
  const verificationState =
    input.verificationState ??
    (input.verificationRequired ? "available" : "not_required");
  if (verificationState === "unavailable")
    reasons.push(
      "required verification is unavailable; completion cannot be claimed as verified",
    );
  else if (
    verificationState === "available" &&
    input.verificationRequired &&
    (!input.verificationPerformed || !input.verificationPassed)
  )
    reasons.push("required verification has not passed");
  if (input.mode === "coding" && !input.finalReviewPerformed)
    reasons.push("final review has not been performed");
  if (input.unresolvedBlockers > 0) reasons.push("unresolved blockers remain");
  if (!input.userWorkPreserved)
    reasons.push("pre-existing user work is not preserved");
  return {
    canComplete: reasons.length === 0,
    reasons,
    evidenceState,
    ...(input.acceptanceProof
      ? {
          acceptanceProof: input.acceptanceProof,
          falseSuccess: input.acceptanceProof.falseSuccess,
        }
      : {}),
  };
}
