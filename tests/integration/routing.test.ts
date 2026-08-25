import { expect, test } from "bun:test";
import { CircuitBreaker } from "../../src/providers/circuit-breaker.js";
import { selectRoute } from "../../src/router/router.js";
import type { ModelCandidate, RouteRequest } from "../../src/shared/types.js";

const now = "2026-08-23T18:00:00.000Z";

function cloud(id: string, providerId: string): ModelCandidate {
  return {
    id,
    providerId,
    displayName: id,
    source: "free_cloud",
    capabilities: {
      tools: true,
      structuredOutput: true,
      reasoning: false,
      vision: false,
      maxContext: 32_000,
    },
    free: {
      status: "verified_free",
      verifiedAt: now,
      expiresAt: "2026-08-24T18:00:00.000Z",
    },
    privacy: {
      classification: "zdr_capable",
      retentionKnown: true,
      zdrAvailable: true,
      trainsOnInputs: false,
    },
    quality: { coding: 0.8, toolUse: 0.8, confidence: "reported" },
    health: { state: "healthy", latencyMs: 100 },
    agentProbe: {
      conversation: true,
      readTool: true,
      multiTurnTools: true,
      agenticCodingEligible: true,
      agentCapabilityClass: "advanced_coding_agent",
      notes: [],
    },
  };
}

function request(
  candidates: ModelCandidate[],
  circuitBreaker: CircuitBreaker,
): RouteRequest {
  return {
    now: new Date(now),
    task: {
      class: "DEBUGGING",
      complexity: 0.8,
      contextNeed: 4_000,
      toolNeed: true,
      risk: 0.7,
      opportunityCost: "high_value",
    },
    repositoryPolicy: "private_zdr_only",
    routingMode: "strict-zero",
    contextTokens: 2_000,
    candidates,
    circuitBreaker,
  };
}

test("routing integration falls back after a free provider circuit opens", () => {
  const breaker = new CircuitBreaker({
    failureThreshold: 3,
    baseBackoffMs: 60_000,
    now: () => Date.parse(now),
    jitter: () => 0,
  });
  const local: ModelCandidate = {
    ...cloud("local/unavailable", "local"),
    source: "local",
    health: { state: "down" },
    privacy: {
      classification: "local",
      retentionKnown: true,
      trainsOnInputs: false,
    },
    free: { status: "verified_free" },
  };
  const groq = cloud("groq/free", "groq");
  const openrouter = cloud("openrouter/free", "openrouter");

  const first = selectRoute(request([local, groq, openrouter], breaker));
  expect(first.selected?.candidate.providerId).toBe("groq");

  breaker.recordFailure("groq", groq.id);
  breaker.recordFailure("groq", groq.id);
  breaker.recordFailure("groq", groq.id);

  const fallback = selectRoute(request([local, groq, openrouter], breaker));
  expect(fallback.selected?.candidate.providerId).toBe("openrouter");
  expect(
    fallback.rejections.find((rejection) => rejection.providerId === "groq")
      ?.reasons,
  ).toContain("circuit breaker is open");
  expect(fallback.explanation).toContain("Selected openrouter");
});
