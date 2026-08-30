/**
 * Router candidates need a coding-quality signal that actually varies by
 * model, or the router cannot tell a small local model apart from a much
 * stronger free-cloud model and defaults toward whichever is cheapest to
 * reach. No empirical per-model benchmark exists yet, so this estimates
 * quality from the strongest signal actually available at discovery time:
 * parameter count and whether the model is coder-specialized. It is a
 * heuristic, not a measurement — callers must report `confidence: "reported"`,
 * never "measured".
 */

const PARAMETER_COUNT_PATTERN = /(\d+(?:\.\d+)?)\s*b\b/iu;
const CODER_PATTERN = /\b(?:coder|code)\b/iu;

function parseParameterBillions(...values: (string | undefined)[]): number | undefined {
  for (const value of values) {
    if (!value) continue;
    const match = PARAMETER_COUNT_PATTERN.exec(value);
    if (!match) continue;
    const parsed = Number(match[1]);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

/** Monotonic, saturating curve: bigger models score higher, with diminishing returns. */
function parameterCountScore(parameterBillions: number | undefined): number {
  if (parameterBillions === undefined) return 0.5;
  const score = 0.3 + 0.12 * Math.log2(Math.max(0.5, parameterBillions));
  return Math.max(0.3, Math.min(0.9, score));
}

export interface EstimateModelQualityInput {
  modelId: string;
  displayName?: string;
  /** Explicit parameter string reported by the runtime, e.g. "7B", "4.2B". */
  parameters?: string;
  trainedForToolUse?: boolean;
}

export interface EstimatedModelQuality {
  coding: number;
  toolUse: number;
  confidence: "reported";
}

export function estimateModelQuality(
  input: EstimateModelQualityInput,
): EstimatedModelQuality {
  const parameterBillions = parseParameterBillions(
    input.parameters,
    input.modelId,
    input.displayName,
  );
  const base = parameterCountScore(parameterBillions);
  const isCoderSpecialized =
    CODER_PATTERN.test(input.modelId) ||
    (input.displayName !== undefined && CODER_PATTERN.test(input.displayName));
  const coding = Math.max(0.3, Math.min(0.95, base + (isCoderSpecialized ? 0.1 : 0)));
  const toolUse = Math.max(
    0.3,
    Math.min(0.95, input.trainedForToolUse ? base + 0.1 : base),
  );
  return { coding, toolUse, confidence: "reported" };
}
