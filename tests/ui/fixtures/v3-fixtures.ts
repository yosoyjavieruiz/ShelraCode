import type { ModelCandidate } from "../../../src/shared/types.js";

export const uiV3Objectives = [
  "Explain this repository",
  "Find failing tests",
  "Review uncommitted changes",
] as const;

export const uiV3Models: ModelCandidate[] = [
  {
    id: "lm-studio/qwen2.5-coder-7b-instruct",
    providerId: "lm-studio",
    displayName: "Qwen Coder 7B",
    source: "local",
    capabilities: {
      tools: true,
      structuredOutput: true,
      reasoning: false,
      vision: false,
      maxContext: 32768,
    },
    free: { status: "verified_free" },
    privacy: { classification: "local", retentionKnown: true },
    quality: { coding: 0.82, toolUse: 0.76, confidence: "reported" },
    health: { state: "healthy", latencyMs: 18 },
    local: { runtime: "LM Studio", quant: "Q4_K_M", estimatedTps: 28 },
  },
  {
    id: "verified-free/llama-coder",
    providerId: "verified-free",
    displayName: "Llama Coder Free",
    source: "free_cloud",
    capabilities: {
      tools: true,
      structuredOutput: true,
      reasoning: false,
      vision: false,
      maxContext: 32768,
    },
    free: { status: "verified_free", verifiedAt: "2026-08-23T00:00:00Z" },
    privacy: { classification: "public_only", retentionKnown: true },
    quality: { coding: 0.74, toolUse: 0.7, confidence: "reported" },
    health: { state: "healthy" },
  },
];
