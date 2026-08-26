import type { TurnMode } from "./turn-policy.js";

/**
 * The smallest execution strategy that can safely carry the current task.
 * Profile selection is deliberately based on task shape and risk, never on a
 * benchmark name or a domain-specific task branch.
 */
export type AdaptiveExecutionProfile =
  | "conversation"
  | "direct"
  | "linear"
  | "structured"
  | "decomposed";

export interface ExecutionProfileInput {
  mode: TurnMode;
  complexity: number;
  explicitPathCount: number;
  deliverableCount: number;
  risk: number;
  uncertaintyCount: number;
  contextPressure?: number;
}

function bounded(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
}

export function selectExecutionProfile(
  input: ExecutionProfileInput,
): AdaptiveExecutionProfile {
  if (input.mode === "conversation" || input.mode === "knowledge")
    return "conversation";

  const complexity = bounded(input.complexity);
  const risk = bounded(input.risk);
  const pressure = bounded(input.contextPressure ?? 0);
  const scope = Math.max(0, input.explicitPathCount);
  const deliverables = Math.max(0, input.deliverableCount);

  if (
    complexity >= 0.8 ||
    risk >= 0.85 ||
    scope >= 8 ||
    deliverables >= 6 ||
    pressure >= 0.85
  )
    return "decomposed";

  // A requested plan is itself a semantic planning task. The LLM owns the
  // plan proposal even when the eventual work is read-only.
  if (input.mode === "plan") return "structured";

  if (
    complexity >= 0.5 ||
    risk >= 0.5 ||
    scope >= 2 ||
    deliverables >= 2 ||
    input.uncertaintyCount > 0 ||
    pressure >= 0.5
  )
    return "structured";

  if (input.mode === "coding" && complexity <= 0.25 && scope <= 1)
    return "direct";

  return "linear";
}

export function requiresModelPlan(
  profile: AdaptiveExecutionProfile,
): boolean {
  return profile === "structured" || profile === "decomposed";
}
