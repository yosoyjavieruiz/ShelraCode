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
          capabilities: {
            tools: false,
            structuredOutput: true,
            reasoning: false,
            vision: false,
            maxContext: 16_000,
          },
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

  test("logs the first actionable reason when no executable tool route exists", () => {
    const records: LogRecord[] = [];
    const logger = createLogger({
      level: "debug",
      sink: { write: (record) => records.push(record) },
    });

    const decision = selectRoute(
      request([
        candidate({
          id: "local/no-tools",
          capabilities: {
            tools: false,
            structuredOutput: true,
            reasoning: false,
            vision: false,
            maxContext: 16_000,
          },
        }),
      ]),
      logger,
    );

    expect(decision.selected).toBeUndefined();
    expect(
      records.find((record) => record.event === "route.none")?.data,
    ).toEqual(
      expect.objectContaining({
        reasonSummary: expect.stringContaining(
          "required tool capability is unavailable",
        ),
      }),
    );
  });

  test("an ineligible selected model cannot suppress an eligible fallback", () => {
    const weak = candidate({
      id: "lm-studio/down",
      health: { state: "down" },
    });
    const fallback = candidate({
      id: "openrouter/free-coder",
      providerId: "openrouter",
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
      quality: { coding: 0.7, toolUse: 0.8, confidence: "measured" },
    });
    const route = request([weak, fallback]);
    route.preferredCandidateId = weak.id;

    const decision = selectRoute(route);

    expect(decision.selected?.candidate.id).toBe(fallback.id);
    expect(decision.explanation).toContain("eligible fallback route");
    expect(
      decision.rejections.find((item) => item.candidateId === weak.id)?.reasons,
    ).toContain("provider or runtime is down");
  });

  test("an eligible selected model remains the preferred route", () => {
    const preferred = candidate({
      id: "local/selected",
      quality: { coding: 0.1, toolUse: 0.1, confidence: "measured" },
    });
    const higherScore = candidate({
      id: "local/higher-score",
      quality: { coding: 1, toolUse: 1, confidence: "measured" },
    });
    const route = request([higherScore, preferred]);
    route.preferredCandidateId = preferred.id;

    expect(selectRoute(route).selected?.candidate.id).toBe(preferred.id);
  });

  test("progressive execution admits a measured coding agent for a bounded unit", () => {
    const chatOnly = candidate({
      id: "local/chat-only",
      agentProbe: {
        conversation: true,
        readTool: false,
        multiTurnTools: false,
        agenticCodingEligible: false,
        agentCapabilityClass: "chat_only",
        notes: [],
      },
    });
    const bounded = candidate({
      id: "local/bounded-coder",
      quality: { coding: 0.65, toolUse: 0.8, confidence: "measured" },
      agentProbe: {
        conversation: true,
        readTool: true,
        multiTurnTools: true,
        agenticCodingEligible: true,
        agentCapabilityClass: "coding_agent",
        notes: ["Edit/test protocol passed; advanced recovery is not proven."],
      },
    });
    const route = request([chatOnly, bounded]);
    route.task.requiredCapability = "advanced_coding_agent";
    route.execution = {
      strategy: "progressive",
      boundedScope: ["src/auth/session.ts"],
    };

    const decision = selectRoute(route);

    expect(decision.selected?.candidate.id).toBe(bounded.id);
    expect(decision.explanation).toContain("Progressive execution");
    expect(
      decision.rejections.find((item) => item.candidateId === chatOnly.id),
    ).toBeUndefined();
  });

  test("progressive execution keeps a local chat-only model alive as a host-scaffolded fallback", () => {
    const localChat = candidate({
      id: "local/chat-only-scaffold",
      capabilities: {
        tools: false,
        structuredOutput: false,
        reasoning: false,
        vision: false,
        maxContext: 16_000,
      },
      agentProbe: {
        conversation: true,
        readTool: false,
        multiTurnTools: false,
        agenticCodingEligible: false,
        agentCapabilityClass: "chat_only",
        notes: ["The host must keep this work unit bounded and verified."],
      },
    });
    const route = request([localChat]);
    route.task.requiredCapability = "advanced_coding_agent";
    route.execution = {
      strategy: "progressive",
      boundedScope: ["src/auth/session.ts"],
    };

    const decision = selectRoute(route);

    expect(decision.selected?.candidate.id).toBe(localChat.id);
    expect(decision.explanation).toContain("host-scaffolded");
    expect(decision.explanation).toContain("chat_only");
  });

  test("discovery execution keeps a complex local task alive without write authority", () => {
    const localChat = candidate({
      id: "local/chat-only-discovery",
      capabilities: {
        tools: false,
        structuredOutput: false,
        reasoning: false,
        vision: false,
        maxContext: 16_000,
      },
      agentProbe: {
        conversation: true,
        readTool: false,
        multiTurnTools: false,
        agenticCodingEligible: false,
        agentCapabilityClass: "chat_only",
        notes: ["The host must keep this stage read-only."],
      },
    });
    const route = request([localChat]);
    route.task = {
      ...route.task,
      requiredCapability: "advanced_coding_agent",
      toolNeed: false,
    };
    route.execution = { strategy: "discovery" };

    const decision = selectRoute(route);

    expect(decision.selected?.candidate.id).toBe(localChat.id);
    expect(decision.explanation).toContain("Local discovery execution");
  });

  test("a below-required capability is a soft scoring signal, not a hard gate, without a bounded execution scope", () => {
    const bounded = candidate({
      id: "local/bounded-coder",
      agentProbe: {
        conversation: true,
        readTool: true,
        multiTurnTools: true,
        agenticCodingEligible: true,
        agentCapabilityClass: "coding_agent",
        notes: [],
      },
    });
    const route = request([bounded]);
    route.task.requiredCapability = "advanced_coding_agent";
    route.execution = { strategy: "progressive", boundedScope: [] };

    const decision = selectRoute(route);

    expect(decision.selected?.candidate.id).toBe(bounded.id);
    expect(decision.explanation).toContain(
      "Capability is below the required advanced_coding_agent role (measured coding_agent)",
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

  test("can attempt a fresh free-only route when the provider omits quota headers", () => {
    const remote = candidate({
      id: "groq/free-quota",
      providerId: "groq",
      source: "free_cloud",
      free: {
        status: "free_quota",
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
    route.quotas = {
      groq: {
        providerId: "groq",
        confidence: "unknown",
        observedAt: now,
      },
    };

    const decision = selectRoute(route);

    expect(decision.selected?.candidate.id).toBe(remote.id);
    expect(decision.selected?.breakdown.quotaHeadroom).toBe(0.35);
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

  test("never treats a paid model record as a free-cloud route", () => {
    const leakedPaidModel = candidate({
      id: "openrouter/paid-model",
      providerId: "openrouter",
      source: "free_cloud",
      free: { status: "paid_required" },
      privacy: {
        classification: "zdr_capable",
        retentionKnown: true,
        zdrAvailable: true,
        trainsOnInputs: false,
      },
    });
    const route = request([leakedPaidModel]);
    route.routingMode = "ask-before-paid";
    route.paidApproved = true;

    const decision = selectRoute(route);

    expect(decision.selected).toBeUndefined();
    expect(decision.rejections[0]?.reasons).toContain(
      "paid model excluded from free provider boundary",
    );
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

  test("still selects a candidate whose capability probe is weaker than the task", () => {
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

    const route = request([failedProbe]);
    route.task = {
      ...route.task,
      requiredCapability: "advanced_coding_agent",
    };
    const decision = selectRoute(route);

    expect(decision.selected?.candidate.id).toBe(failedProbe.id);
    expect(decision.rejections).toHaveLength(0);
    expect(decision.explanation).toContain(
      "Capability is below the required advanced_coding_agent role (measured chat_only)",
    );
  });

  test("still selects a chat-only candidate for an advanced coding task, scored lower", () => {
    const weak = candidate({
      id: "local/chat-only-advanced-task",
      agentProbe: {
        conversation: true,
        readTool: false,
        multiTurnTools: false,
        agenticCodingEligible: false,
        agentCapabilityClass: "chat_only",
        notes: ["The model failed the executable tool probe."],
      },
    });
    const route = request([weak]);
    route.task = {
      ...route.task,
      requiredCapability: "advanced_coding_agent",
    };

    const decision = selectRoute(route);

    expect(decision.selected?.candidate.id).toBe(weak.id);
    expect(decision.rejections).toHaveLength(0);
    expect(decision.selected?.breakdown.taskFit).toBeLessThan(1);
  });

  test("still selects a candidate with no capability evidence for a tool task", () => {
    const unprobed = candidate({ id: "local/unprobed", agentProbe: undefined });

    const decision = selectRoute(request([unprobed]));
    expect(decision.selected?.candidate.id).toBe(unprobed.id);
    expect(decision.rejections).toHaveLength(0);
    expect(decision.explanation).toContain(", unprobed)");
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

  test("uses capability as a scoring signal, weighing a stronger measured candidate higher", () => {
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
      decision.rejections.find((item) => item.candidateId === weak.id),
    ).toBeUndefined();
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
