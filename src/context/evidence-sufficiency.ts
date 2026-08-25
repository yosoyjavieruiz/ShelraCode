import type { TurnMode } from "../agent/turn-policy.js";

export type EvidenceSufficiency = "SUFFICIENT" | "INSUFFICIENT" | "CONFLICTING";

interface EvidenceQuality {
  relevance: number;
  freshness: number;
}

export function evaluateEvidenceSufficiency(
  mode: TurnMode,
  evidenceCount: number,
  conflicting = false,
  evidence?: readonly EvidenceQuality[],
): EvidenceSufficiency {
  if (conflicting) return "CONFLICTING";
  if (mode === "conversation" || mode === "knowledge") return "SUFFICIENT";
  if (
    evidence &&
    evidence.some(
      (item) =>
        Number.isFinite(item.relevance) &&
        item.relevance >= 0.5 &&
        Number.isFinite(item.freshness) &&
        item.freshness > 0,
    )
  )
    return "SUFFICIENT";
  if (!evidence && evidenceCount > 0) return "SUFFICIENT";
  return "INSUFFICIENT";
}
