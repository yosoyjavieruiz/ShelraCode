import { expect, test } from "bun:test";
import { recommendedAgentContextChars } from "../../src/agent/context-budget.js";
import type { ModelCandidate } from "../../src/shared/types.js";

function candidate(parameters: string): ModelCandidate {
  return {
    id: `lm/${parameters}`,
    providerId: "lm-studio",
    modelId: "model",
    displayName: parameters,
    source: "local",
    capabilities: {
      tools: true,
      structuredOutput: true,
      reasoning: false,
      vision: false,
      maxContext: 32_768,
    },
    free: { status: "unknown" },
    privacy: { classification: "local", retentionKnown: true },
    quality: { confidence: "measured" },
    health: { state: "healthy" },
    local: { runtime: "lm-studio", parameters },
  };
}

test("the 1.5B profile receives a compact active coding context", () => {
  expect(recommendedAgentContextChars(candidate("1.54B"), "coding", 0.9)).toBe(
    10_000,
  );
  expect(recommendedAgentContextChars(candidate("14.7B"), "coding", 0.9)).toBe(
    28_000,
  );
});

test("non-coding turns remain bounded independent of model size", () => {
  expect(
    recommendedAgentContextChars(candidate("14.7B"), "workspace_question", 0.2),
  ).toBe(10_000);
});
