import { describe, expect, test } from "bun:test";
import { selectRoute } from "../../src/router/router.js";
import type { ModelCandidate, RouteRequest } from "../../src/shared/types.js";
import { createLogger, type LogRecord } from "../../src/shared/logging.js";

const now = "2026-08-23T18:00:00.000Z";

function candidate(overrides: Partial<ModelCandidate>): ModelCandidate {
  return {
    id: "model/base",
    providerId: "local",
    displayName: "Base model",
    source: "local",
    capabilities: {
      tools: true,
      structuredOutput: true,
      reasoning: false,
      vision: false,
      maxContext: 16_000,
    },
    free: {
      status: "verified_free",
      verifiedAt: now,
      expiresAt: "2026-08-24T18:00:00.000Z",
    },
    privacy: { classification: "local", retentionKnown: true },
    quality: { coding: 0.75, toolUse: 0.75, confidence: "measured" },
    health: { state: "healthy", latencyMs: 50 },
    agentProbe: {
      conversation: true,
      readTool: true,
      multiTurnTools: true,
      agenticCodingEligible: true,
      agentCapabilityClass: "advanced_coding_agent",
      notes: [],
    },
    ...overrides,
  };
}

function request(candidates: ModelCandidate[]): RouteRequest {
  return {
    now: new Date(now),
    task: {
      class: "DEBUGGING",
      complexity: 0.8,
      contextNeed: 4_000,
      toolNeed: true,
      risk: 0.7,
      opportunityCost: "normal",
    },
    repositoryPolicy: "private_zdr_only",
    routingMode: "strict-zero",
    contextTokens: 2_000,
    candidates,
    quotaMaxAgeMs: 15 * 60 * 1_000,
  };
}

describe("route selection", () => {
  test("logs every rejection and the selected route with policy-safe metadata", () => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      level: "debug",
      sink: { write: (record) => records.push(record) },
    });
    const decision = selectRoute(
      request([
        candidate({
          id: "local/unprobed",
          agentProbe: undefined,
        }),
        candidate({ id: "local/eligible" }),
      ]),
      logger,
    );

    expect(decision.selected?.candidate.id).toBe("local/eligible");
    expect(records.map((record) => record.event)).toEqual(
      expect.arrayContaining(["route.candidate.rejected", "route.selected"]),
    );
    expect(
      records.every((record) => record.data?.objective === undefined),
    ).toBe(true);
  });

  test("logs the first actionable reason when no route is eligible", () => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      level: "debug",
      sink: { write: (record) => records.push(record) },
    });

    const decision = selectRoute(
      request([candidate({ id: "local/unprobed", agentProbe: undefined })]),
      logger,
    );

    expect(decision.selected).toBeUndefined();
    expect(
      records.find((record) => record.event === "route.none")?.data,
    ).toEqual(
      expect.objectContaining({
        reasonSummary: expect.stringContaining("capability probe required"),
      }),
    );
  });

  test("applies privacy and cost gates before quality", () => {
    const publicPaid = candidate({
      id: "public/strong",
      providerId: "paid",
      source: "paid_cloud",
      free: { status: "paid" },
      privacy: { classification: "public_only", retentionKnown: true },
      quality: { coding: 1, toolUse: 1, confidence: "measured" },
    });
    const paidCompliant = candidate({
      id: "paid/compliant",
      providerId: "paid",
      source: "paid_cloud",
      free: { status: "paid" },
      privacy: {
        classification: "zdr_capable",
        retentionKnown: true,
        zdrAvailable: true,
        trainsOnInputs: false,
      },
      quality: { coding: 1, toolUse: 1, confidence: "measured" },
    });
    const compliantFree = candidate({
      id: "groq/free",
      providerId: "groq",
      source: "free_cloud",
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
    });

    const decision = selectRoute(
      request([publicPaid, paidCompliant, compliantFree]),
    );

    expect(decision.selected?.candidate.id).toBe("groq/free");
    expect(
      decision.rejections.find((item) => item.candidateId === "public/strong")
        ?.reasons,
    ).toEqual(
      expect.arrayContaining(["repository policy requires verified ZDR"]),
    );
    expect(
      decision.rejections.find((item) => item.candidateId === "paid/compliant")
        ?.reasons,
    ).toEqual(expect.arrayContaining(["paid route excluded by strict-zero"]));
    expect(decision.explanation).toContain("Privacy");
  });

  test("uses a local candidate before spending free cloud quota for a low-value task", () => {
    const local = candidate({ id: "local/fast", providerId: "local" });
    const cloud = candidate({
      id: "groq/free",
      providerId: "groq",
      source: "free_cloud",
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
    });
    const lowValue = request([cloud, local]);
    lowValue.task = {
      ...lowValue.task,
      class: "SEARCH",
      complexity: 0.1,
      opportunityCost: "low_value",
    };

    const decision = selectRoute(lowValue);

    expect(decision.selected?.candidate.id).toBe("local/fast");
  });

  test("stops with actionable reasons when free metadata is stale", () => {
    const stale = candidate({
      id: "groq/stale",
      providerId: "groq",
      source: "free_cloud",
      free: {
        status: "verified_free",
        verifiedAt: "2026-08-20T18:00:00.000Z",
        expiresAt: "2026-08-22T18:00:00.000Z",
      },
      privacy: {
        classification: "zdr_capable",
        retentionKnown: true,
        zdrAvailable: true,
        trainsOnInputs: false,
      },
    });

    const decision = selectRoute(request([stale]));

    expect(decision.selected).toBeUndefined();
    expect(decision.rejections[0]?.reasons).toContain("free metadata is stale");
    expect(decision.explanation).toContain("No eligible route");
  });

  test("blocks a cloud route when sanitized context contains a high-confidence secret", () => {
    const cloud = candidate({
      id: "groq/free",
      providerId: "groq",
      source: "free_cloud",
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
    });
    const route = request([cloud]);
    route.containsHighConfidenceSecret = true;

    const decision = selectRoute(route);

    expect(decision.selected).toBeUndefined();
    expect(decision.rejections[0]?.reasons).toContain(
      "high-confidence secret blocks cloud route",
    );
  });

  test("rejects invalid freshness and zero-limit quota values", () => {
    const invalidFreshness = candidate({
      id: "groq/invalid-date",
      providerId: "groq",
      source: "free_cloud",
      free: {
        status: "verified_free",
        verifiedAt: "not-a-date",
        expiresAt: "2026-08-24T18:00:00.000Z",
      },
      privacy: {
        classification: "zdr_capable",
        retentionKnown: true,
        zdrAvailable: true,
        trainsOnInputs: false,
      },
    });
    const exhausted = candidate({
      id: "groq/exhausted",
      providerId: "groq",
      source: "free_cloud",
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
    });
    const route = request([invalidFreshness, exhausted]);
    route.quotas = {
      groq: {
        providerId: "groq",
        requestsRemaining: 0,
        requestsLimit: 0,
        confidence: "provider_reported",
        observedAt: now,
      },
    };

    const decision = selectRoute(route);

    expect(decision.selected).toBeUndefined();
    expect(
      decision.rejections.find(
        (item) => item.candidateId === "groq/invalid-date",
      )?.reasons,
    ).toContain("free metadata is stale");
    expect(
      decision.rejections.find((item) => item.candidateId === "groq/exhausted")
        ?.reasons,
    ).toContain("remaining quota is exhausted");
  });

  test("requires explicit approval before selecting a paid candidate", () => {
    const paid = candidate({
      id: "paid/model",
      providerId: "paid",
      source: "paid_cloud",
      free: { status: "paid" },
      privacy: {
        classification: "zdr_capable",
        retentionKnown: true,
        zdrAvailable: true,
        trainsOnInputs: false,
      },
    });
    const route = request([paid]);
    route.routingMode = "ask-before-paid";

    const blocked = selectRoute(route);
    expect(blocked.selected).toBeUndefined();
    expect(blocked.rejections[0]?.reasons).toContain(
      "paid route requires explicit approval",
    );

    route.paidApproved = true;
    expect(selectRoute(route).selected?.candidate.id).toBe("paid/model");
  });

  test("rejects unknown training behavior under private policy", () => {
    const cloud = candidate({
      id: "cloud/unknown-training",
      providerId: "cloud",
      source: "free_cloud",
      free: {
        status: "verified_free",
        verifiedAt: now,
        expiresAt: "2026-08-24T18:00:00.000Z",
      },
      privacy: { classification: "private_allowed", retentionKnown: true },
    });
    const route = request([cloud]);
    route.repositoryPolicy = "private";

    expect(selectRoute(route).selected).toBeUndefined();
  });

  test("rejects a candidate that failed its agentic-coding capability probe when the task needs tools", () => {
    const failedProbe = candidate({
      id: "local/chat-only",
      providerId: "local",
      agentProbe: {
        conversation: true,
        readTool: false,
        multiTurnTools: false,
        agenticCodingEligible: false,
        agentCapabilityClass: "chat_only",
        notes: [
          "Model did not call ReadFile when explicitly asked to read a file.",
        ],
      },
    });

    const decision = selectRoute(request([failedProbe]));

    expect(decision.selected).toBeUndefined();
    expect(decision.rejections[0]?.reasons).toContain(
      "capability chat_only is below required workspace_reader",
    );
  });

  test("a candidate with no probe result is rejected for repository work", () => {
    const unprobed = candidate({ id: "local/unprobed", agentProbe: undefined });

    const decision = selectRoute(request([unprobed]));
    expect(decision.selected).toBeUndefined();
    expect(decision.rejections[0]?.reasons).toContain(
      "capability probe required for workspace_reader",
    );
  });

  test("respects an open circuit breaker before scoring", () => {
    const cloud = candidate({
      id: "groq/open",
      providerId: "groq",
      source: "free_cloud",
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
    });
    const route = request([cloud]);
    route.circuitBreaker = { canRequest: () => false };

    expect(selectRoute(route).rejections[0]?.reasons ?? []).toContain(
      "circuit breaker is open",
    );
  });

  test("selects a stronger eligible local model instead of a chat-only local model", () => {
    const weak = candidate({
      id: "local/chat-only",
      displayName: "Chat only",
      agentProbe: {
        conversation: true,
        readTool: false,
        multiTurnTools: false,
        agenticCodingEligible: false,
        agentCapabilityClass: "chat_only",
        notes: [],
      },
    });
    const strong = candidate({
      id: "local/strong",
      displayName: "Strong local",
      quality: { coding: 0.7, toolUse: 0.7, confidence: "measured" },
    });

    const decision = selectRoute(request([weak, strong]));

    expect(decision.selected?.candidate.id).toBe("local/strong");
    expect(
      decision.rejections.find((item) => item.candidateId === weak.id)?.reasons,
    ).toContain("capability chat_only is below required workspace_reader");
  });

  test("local candidates do not lose eligibility because of a cloud quota snapshot", () => {
    const local = candidate({ id: "local/no-local-quota" });
    const route = request([local]);
    route.quotas = {
      local: {
        providerId: "local",
        requestsRemaining: 0,
        requestsLimit: 0,
        confidence: "provider_reported",
        observedAt: now,
      },
    };

    expect(selectRoute(route).selected?.candidate.id).toBe(local.id);
  });

  test("local-only privacy policy prevents a remote provider boundary call", () => {
    const remote = candidate({
      id: "groq/remote",
      providerId: "groq",
      source: "free_cloud",
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
    });
    const route = request([remote]);
    route.repositoryPolicy = "local_only";

    const decision = selectRoute(route);
    expect(decision.selected).toBeUndefined();
    expect(decision.rejections[0]?.reasons).toContain(
      "repository policy is local-only",
    );
  });
});
