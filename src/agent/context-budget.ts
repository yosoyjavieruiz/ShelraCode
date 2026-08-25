import type { ModelCandidate } from "../shared/types.js";
import type { TurnMode } from "./turn-policy.js";

function parameterBillions(candidate: ModelCandidate): number | undefined {
  const value = candidate.local?.parameters;
  if (!value) return undefined;
  const match = value.match(/([0-9]+(?:\.[0-9]+)?)\s*[bB]/u);
  if (!match) return undefined;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Pick an active prompt budget rather than feeding a small model its entire
 * advertised context. The provider may support 32K or more, but a 1.5B
 * model generally makes better next-action decisions with a compact state,
 * the relevant evidence, and a bounded recent observation. Raw artifacts
 * remain on disk and can be re-read by the host/tool loop.
 */
export function recommendedAgentContextChars(
  candidate: ModelCandidate,
  mode: TurnMode,
  complexity: number,
): number {
  if (mode === "conversation" || mode === "knowledge") return 6_000;
  if (mode === "workspace_question" || mode === "review" || mode === "plan")
    return 10_000;

  const parameters = parameterBillions(candidate);
  const budget =
    parameters === undefined
      ? complexity >= 0.75
        ? 18_000
        : 14_000
      : parameters <= 2
        ? 10_000
        : parameters <= 4
          ? 14_000
          : parameters <= 8
            ? 20_000
            : 28_000;
  const providerLimit = candidate.capabilities.maxContext
    ? Math.max(4_000, Math.floor(candidate.capabilities.maxContext * 4 * 0.6))
    : budget;
  return Math.min(budget, providerLimit);
}
