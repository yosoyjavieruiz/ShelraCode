import {
  evaluateEvidenceSufficiency,
  type EvidenceSufficiency,
} from "../context/evidence-sufficiency.js";
import type { ContextEvidence } from "./task-state.js";

export interface MutationEvidenceGateInput {
  mode:
    | "conversation"
    | "knowledge"
    | "workspace_question"
    | "plan"
    | "review"
    | "coding"
    | "command";
  declaredState?: EvidenceSufficiency;
  evidence: readonly ContextEvidence[];
}

export interface MutationEvidenceGateResult {
  allowed: boolean;
  state: EvidenceSufficiency;
  reason?: string;
}

/**
 * A context snapshot is a starting hint, not authorization to mutate. The
 * gate is evaluated again immediately before every write so a failed search,
 * stale path or empty discovery cannot be converted into a speculative edit.
 */
export function evaluateMutationEvidenceGate(
  input: MutationEvidenceGateInput,
): MutationEvidenceGateResult {
  if (input.mode !== "coding")
    return {
      allowed: false,
      state: "INSUFFICIENT",
      reason: "turn is not coding",
    };

  const state = evaluateEvidenceSufficiency(
    input.mode,
    input.evidence.length,
    input.declaredState === "CONFLICTING",
    input.evidence,
  );
  if (state === "SUFFICIENT") return { allowed: true, state };

  return {
    allowed: false,
    state,
    reason:
      state === "CONFLICTING"
        ? "repository evidence is conflicting"
        : "relevant repository evidence is insufficient for mutation",
  };
}
