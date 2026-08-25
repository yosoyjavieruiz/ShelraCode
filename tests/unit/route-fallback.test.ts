import { expect, test } from "bun:test";
import {
  runWithRouteFallback,
  selectFallbackRoute,
  shouldEscalateRoute,
} from "../../src/router/route-fallback.js";
import type { ModelCandidate, RouteRequest } from "../../src/shared/types.js";

const now = "2026-08-24T18:00:00.000Z";

function candidate(
  overrides: Partial<ModelCandidate> &
    Pick<ModelCandidate, "id" | "providerId">,
): ModelCandidate {
  return {
    id: overrides.id,
    providerId: overrides.providerId,
    displayName: overrides.displayName ?? overrides.id,
    source: overrides.source ?? "local",
    capabilities: overrides.capabilities ?? {
      tools: true,
      structuredOutput: true,
      reasoning: false,
      vision: false,
      maxContext: 32_000,
    },
    free: overrides.free ?? { status: "verified_free" },
    privacy: overrides.privacy ?? {
      classification: "local",
      retentionKnown: true,
      trainsOnInputs: false,
    },
    quality: overrides.quality ?? {
      coding: 0.7,
      toolUse: 0.7,
      confidence: "measured",
    },
    health: overrides.health ?? { state: "healthy" },
    agentProbe: overrides.agentProbe ?? {
      conversation: true,
      readTool: true,
      multiTurnTools: true,
      agenticCodingEligible: true,
      agentCapabilityClass: "coding_agent",
      notes: [],
    },
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
      opportunityCost: "high_value",
      requiredCapability: "coding_agent",
    },
    repositoryPolicy: "private_zdr_only",
    routingMode: "strict-zero",
    contextTokens: 2_000,
    candidates,
  };
}

test("a diagnosed model/runtime failure selects the next eligible stronger local route", () => {
  const weak = candidate({
    id: "local/weak",
    providerId: "lm-studio",
    quality: { coding: 0.4, toolUse: 0.4, confidence: "measured" },
  });
  const strong = candidate({
    id: "local/strong",
    providerId: "llama.cpp",
    quality: { coding: 0.9, toolUse: 0.9, confidence: "measured" },
    agentProbe: {
      conversation: true,
      readTool: true,
      multiTurnTools: true,
      agenticCodingEligible: true,
      agentCapabilityClass: "advanced_coding_agent",
      notes: [],
    },
  });
  const route = request([weak, strong]);

  expect(
    shouldEscalateRoute({
      code: "MODEL_UNAVAILABLE",
      message: "the runtime stopped",
      mutationOccurred: false,
    }),
  ).toBe(true);
  expect(
    selectFallbackRoute(route, [weak.id], {
      code: "MODEL_UNAVAILABLE",
      message: "the runtime stopped",
      mutationOccurred: false,
    }).selected?.candidate.id,
  ).toBe(strong.id);
});

test("a harness/tool failure or an already-mutated task never retries another model", () => {
  const route = request([
    candidate({ id: "local/first", providerId: "lm-studio" }),
    candidate({ id: "local/second", providerId: "llama.cpp" }),
  ]);

  expect(
    shouldEscalateRoute({
      code: "INVALID_ARGUMENT",
      message: "bad tool input",
      mutationOccurred: false,
    }),
  ).toBe(false);
  expect(
    shouldEscalateRoute({
      code: "CAPACITY",
      message: "provider capacity",
      mutationOccurred: true,
    }),
  ).toBe(false);
  expect(
    selectFallbackRoute(route, ["local/first"], {
      code: "INVALID_ARGUMENT",
      message: "bad tool input",
      mutationOccurred: false,
    }).selected,
  ).toBeUndefined();
});

test("free-provider billing failures never escalate to a paid route", () => {
  expect(
    shouldEscalateRoute({
      code: "PAID_PLAN_REQUIRED",
      message: "paid developer plan required",
      mutationOccurred: false,
    }),
  ).toBe(false);
  expect(
    shouldEscalateRoute({
      code: "FREE_TIER_EXHAUSTED",
      message: "free tier exhausted",
      mutationOccurred: false,
    }),
  ).toBe(true);
});

test("a verified free route can be used after a local runtime failure, but local-only policy still blocks it", () => {
  const local = candidate({ id: "local/first", providerId: "lm-studio" });
  const remote = candidate({
    id: "groq/free-coder",
    providerId: "groq",
    source: "free_cloud",
    free: {
      status: "verified_free",
      verifiedAt: now,
      expiresAt: "2026-08-25T18:00:00.000Z",
    },
    privacy: {
      classification: "zdr_capable",
      retentionKnown: true,
      trainsOnInputs: false,
      zdrAvailable: true,
    },
  });
  const route = request([local, remote]);
  const failure = {
    code: "CAPACITY" as const,
    message: "local runtime unavailable",
    mutationOccurred: false,
  };

  expect(
    selectFallbackRoute(route, [local.id], failure).selected?.candidate.id,
  ).toBe(remote.id);
  expect(
    selectFallbackRoute(
      { ...route, repositoryPolicy: "local_only" },
      [local.id],
      failure,
    ).selected,
  ).toBeUndefined();
});

test("execution retries a failed model once with the next eligible route", async () => {
  const first = candidate({
    id: "local/first",
    providerId: "lm-studio",
    quality: { coding: 0.9, toolUse: 0.9, confidence: "measured" },
  });
  const second = candidate({
    id: "local/second",
    providerId: "llama.cpp",
    quality: { coding: 0.8, toolUse: 0.8, confidence: "measured" },
  });
  const attempts: string[] = [];
  const result = await runWithRouteFallback(
    request([first, second]),
    async (model) => {
      attempts.push(model.id);
      return model.id === first.id
        ? {
            status: "failed" as const,
            failure: {
              code: "CAPACITY" as const,
              message: "runtime capacity",
            },
            mutationOccurred: false,
          }
        : { status: "completed" as const, mutationOccurred: false };
    },
  );

  expect(attempts).toEqual([first.id, second.id]);
  expect(result.outcome?.status).toBe("completed");
  expect(result.decision.selected?.candidate.id).toBe(second.id);
});

test("an incomplete model can escalate before it mutates the workspace", async () => {
  const first = candidate({
    id: "local/reader",
    providerId: "lm-studio",
    quality: { coding: 1, toolUse: 1, confidence: "measured" },
    agentProbe: {
      conversation: true,
      readTool: true,
      multiTurnTools: true,
      agenticCodingEligible: true,
      agentCapabilityClass: "coding_agent",
      notes: [],
    },
  });
  const second = candidate({
    id: "local/builder",
    providerId: "llama.cpp",
    quality: { coding: 0.1, toolUse: 0.1, confidence: "measured" },
    agentProbe: {
      conversation: true,
      readTool: true,
      multiTurnTools: true,
      agenticCodingEligible: true,
      agentCapabilityClass: "advanced_coding_agent",
      notes: [],
    },
  });
  const attempts: string[] = [];

  expect(
    shouldEscalateRoute({
      code: "AGENT_INCOMPLETE",
      message: "no action",
      mutationOccurred: false,
    }),
  ).toBe(true);
  expect(
    shouldEscalateRoute({
      code: "AGENT_INCOMPLETE",
      message: "partial mutation",
      mutationOccurred: true,
    }),
  ).toBe(false);

  const result = await runWithRouteFallback(
    request([first, second]),
    async (model) => {
      attempts.push(model.id);
      return model.id === first.id
        ? {
            status: "blocked" as const,
            failure: {
              code: "AGENT_INCOMPLETE" as const,
              message: "no executable action",
            },
            mutationOccurred: false,
          }
        : { status: "completed" as const, mutationOccurred: false };
    },
  );

  expect(attempts).toEqual([first.id, second.id]);
  expect(result.outcome?.status).toBe("completed");
});
