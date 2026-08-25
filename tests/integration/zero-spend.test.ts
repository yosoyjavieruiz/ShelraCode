import { expect, test } from "bun:test";
import { selectRoute } from "../../src/router/router.js";
import type { ModelCandidate } from "../../src/shared/types.js";

const candidate = (
  source: ModelCandidate["source"],
  freeStatus: ModelCandidate["free"]["status"],
): ModelCandidate => ({
  id: `${source}/model`,
  providerId: source === "paid_cloud" ? "paid" : "free",
  displayName: "model",
  source,
  capabilities: {
    tools: true,
    structuredOutput: true,
    reasoning: false,
    vision: false,
    maxContext: 32_000,
  },
  free: {
    status: freeStatus,
    ...(source === "free_cloud"
      ? {
          verifiedAt: "2026-08-23T10:00:00.000Z",
          expiresAt: "2026-08-24T10:00:00.000Z",
        }
      : {}),
  },
  privacy: {
    classification: "zdr_capable",
    retentionKnown: true,
    zdrAvailable: true,
    trainsOnInputs: false,
  },
  quality: { coding: 0.9, toolUse: 0.9, confidence: "reported" },
  health: { state: "healthy" },
  agentProbe: {
    conversation: true,
    readTool: true,
    multiTurnTools: true,
    agenticCodingEligible: true,
    agentCapabilityClass: "advanced_coding_agent",
    notes: [],
  },
});

test("strict-zero excludes a healthy paid provider when free quota is exhausted", () => {
  const decision = selectRoute({
    now: new Date("2026-08-23T12:00:00.000Z"),
    task: {
      class: "DEBUGGING",
      complexity: 0.8,
      contextNeed: 0.5,
      toolNeed: true,
      risk: 0.6,
      opportunityCost: "high_value",
    },
    repositoryPolicy: "trusted_cloud",
    routingMode: "strict-zero",
    contextTokens: 1_000,
    candidates: [
      candidate("free_cloud", "verified_free"),
      candidate("paid_cloud", "paid"),
    ],
    quotas: {
      free: {
        providerId: "free",
        requestsRemaining: 0,
        requestsLimit: 100,
        confidence: "provider_reported",
        observedAt: "2026-08-23T11:59:00.000Z",
      },
    },
  });

  expect(decision.selected).toBeUndefined();
  expect(
    decision.rejections.find((item) => item.providerId === "paid")?.reasons,
  ).toContain("paid route excluded by strict-zero");
  expect(decision.explanation).toContain("No eligible route");
});
