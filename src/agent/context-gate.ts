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
  /** Known host fact, not inferred from the model's proposal. */
  repositoryState?: "empty" | "non_empty" | "unknown";
  /** Generic intent classification; never a task-specific acceptance rule. */
  greenfieldIntent?: boolean;
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

  // An empty workspace is itself relevant evidence for a greenfield
  // objective. Requiring a pre-existing source file in that case creates a
  // deadlock: the model cannot create the first artifact because the gate is
  // waiting for evidence that can only exist after creation. Existing-code
  // repair/migration tasks remain blocked because they do not carry the
  // greenfield intent signal.
  if (
    state !== "CONFLICTING" &&
    input.repositoryState === "empty" &&
    input.greenfieldIntent === true
  )
    return { allowed: true, state: "SUFFICIENT" };

  return {
    allowed: false,
    state,
    reason:
      state === "CONFLICTING"
        ? "repository evidence is conflicting"
        : "relevant repository evidence is insufficient for mutation",
  };
}
