import { expect, test } from "bun:test";
import type { AppEvent } from "../../src/shared/events.js";
import type { ModelCandidate, RouteDecision } from "../../src/shared/types.js";
import {
  beginTranscriptTurn,
  createTranscriptPresentation,
  presentAppEvent,
} from "../../src/tui/presentation/adapter.js";

const localCandidate: ModelCandidate = {
  id: "lm-studio/qwen2.5-coder-1.5b",
  providerId: "lm-studio",
  displayName: "Qwen 2.5 Coder 1.5B",
  source: "local",
  capabilities: {
    tools: true,
    structuredOutput: true,
    reasoning: false,
    vision: false,
    maxContext: 32_768,
  },
  free: { status: "verified_free" },
  privacy: { classification: "local", retentionKnown: true },
  quality: { confidence: "reported" },
  health: { state: "healthy" },
  local: { runtime: "LM Studio" },
};

function decision(candidate = localCandidate): RouteDecision {
  return {
    selected: {
      candidate,
      score: 0.91,
      breakdown: {
        taskFit: 0.9,
        predictedSuccess: 0.9,
        quotaHeadroom: 1,
        reliability: 1,
        latency: 0.8,
        contextHeadroom: 0.9,
        toolReliability: 0.9,
        quotaOpportunityCost: 1,
        total: 0.91,
      },
    },
    rejections: [],
    explanation:
      "Privacy gate passed. Cost gate passed. Score 0.91; quota headroom 1.00; reliability 1.00.",
    generatedAt: "2026-08-23T20:00:00.000Z",
  };
}

test("one assistant turn groups prose, one updated activity, tests, and completion in order", () => {
  let state = beginTranscriptTurn(createTranscriptPresentation(), {
    turnId: "turn-1",
    text: "Fix the refresh race and run the auth tests.",
  });
  const events: AppEvent[] = [
    {
      type: "assistant.delta",
      text: "I’ll inspect the session lifecycle first.",
    },
    {
      type: "tool.started",
      callId: "call-read",
      tool: "ReadFile",
      input: { path: "src/auth/session.ts" },
      risk: "read",
    },
    {
      type: "tool.finished",
      callId: "call-read",
      tool: "ReadFile",
      result: {
        tool: "ReadFile",
        ok: true,
        durationMs: 14,
        output: {
          path: "src/auth/session.ts",
          content: "one\ntwo\nthree\n",
          truncated: false,
          sensitivePath: false,
        },
      },
    },
    { type: "assistant.delta", text: "The refresh path is clear." },
    {
      type: "verification.finished",
      exitCode: 0,
      output: "31 pass\n0 fail\nRan 31 tests across 6 files.",
    },
    {
      type: "task.completed",
      result: { verified: true, toolRuns: [{ tool: "ReadFile" }] },
    },
  ];
  for (const event of events) state = presentAppEvent(state, event);

  expect(state.items.map((item) => item.kind)).toEqual([
    "user-turn",
    "assistant-text",
    "activity-group",
    "assistant-text",
    "test-result",
    "completion-notice",
  ]);
  const activity = state.items.find((item) => item.kind === "activity-group");
  expect(activity).toEqual(
    expect.objectContaining({
      activities: [
        expect.objectContaining({
          id: "call-read",
          kind: "read",
          label: "READ",
          target: "src/auth/session.ts",
          state: "success",
          durationMs: 14,
          summary: "3 lines",
        }),
      ],
    }),
  );
  const serialized = JSON.stringify(state.items);
  expect(serialized).not.toContain('"name":"ReadFile"');
  expect(serialized).not.toContain('"arguments"');
});

test("local route presentation never exposes cloud gates, scores, or runtime as provider", () => {
  let state = beginTranscriptTurn(createTranscriptPresentation(), {
    turnId: "turn-route",
    text: "Inspect the repository.",
  });
  state = presentAppEvent(state, {
    type: "route.selected",
    decision: decision(),
  });

  expect(state.currentRoute).toEqual(
    expect.objectContaining({
      source: "local",
      model: "Qwen 2.5 Coder 1.5B",
      runtime: "LM Studio",
    }),
  );
  const route = state.items.find((item) => item.kind === "route-event");
  expect(route).toBeUndefined();
  const visible = JSON.stringify(state.currentRoute).toLowerCase();
  for (const forbidden of [
    "quota",
    "cost gate",
    "paid route",
    "score",
    "taskfit",
    "reliability",
  ]) {
    expect(visible).not.toContain(forbidden);
  }
});

test("free cloud route uses useful provider and model naming", () => {
  const freeCandidate: ModelCandidate = {
    ...localCandidate,
    id: "groq/openai/gpt-oss-120b",
    providerId: "groq",
    displayName: "GPT-OSS 120B",
    source: "free_cloud",
    local: undefined,
    privacy: { classification: "zdr_capable", retentionKnown: true },
  };
  let state = beginTranscriptTurn(createTranscriptPresentation(), {
    turnId: "turn-free",
    text: "Escalate after local verification fails.",
  });
  state = presentAppEvent(state, {
    type: "route.selected",
    decision: decision(freeCandidate),
  });
  expect(state.currentRoute).toEqual(
    expect.objectContaining({
      source: "free",
      provider: "Groq",
      model: "GPT-OSS 120B",
    }),
  );
  expect(
    state.items.find((item) => item.kind === "route-event"),
  ).toBeUndefined();
});

test("multiple tool events stay in one ordered, collapsed activity group", () => {
  let state = beginTranscriptTurn(createTranscriptPresentation(), {
    turnId: "turn-tools",
    text: "Fix the token refresh race and run the auth tests.",
  });
  const calls = [
    ["read", "ReadFile", { path: "src/auth/session.ts" }],
    ["search", "SearchText", { pattern: "refreshToken" }],
    ["edit", "EditFile", { path: "src/auth/session.ts" }],
    ["test", "RunTests", { command: "bun test auth" }],
  ] as const;
  for (const [callId, tool, input] of calls) {
    state = presentAppEvent(state, {
      type: "tool.started",
      callId,
      tool,
      input,
    });
  }
  state = presentAppEvent(state, {
    type: "tool.finished",
    callId: "test",
    tool: "RunTests",
    result: {
      tool: "RunTests",
      ok: true,
      durationMs: 2_400,
      output: { exitCode: 0, output: "31 pass\n0 fail" },
    },
  });

  const group = state.items.find((item) => item.kind === "activity-group");
  expect(group).toEqual(
    expect.objectContaining({
      label: "Updating and verifying changes",
      expanded: false,
      activities: [
        expect.objectContaining({ id: "read", label: "READ" }),
        expect.objectContaining({ id: "search", label: "SEARCH" }),
        expect.objectContaining({ id: "edit", label: "EDIT" }),
        expect.objectContaining({
          id: "test",
          label: "TEST",
          state: "success",
          summary: "31 passed",
        }),
      ],
    }),
  );
});

test("cancelled tool results keep an explicit cancelled activity state", () => {
  let state = beginTranscriptTurn(createTranscriptPresentation(), {
    turnId: "cancelled-tool",
    text: "Run the validation.",
  });
  state = presentAppEvent(state, {
    type: "tool.started",
    callId: "cancelled-call",
    tool: "RunTests",
    input: { command: "bun test" },
  });
  state = presentAppEvent(state, {
    type: "tool.finished",
    callId: "cancelled-call",
    tool: "RunTests",
    result: {
      tool: "RunTests",
      ok: false,
      code: "CANCELLED",
      error: "The command was cancelled.",
      durationMs: 120,
    },
  });
  const group = state.items.find((item) => item.kind === "activity-group");
  expect(group?.kind).toBe("activity-group");
  if (group?.kind === "activity-group") {
    expect(group.activities[0]?.state).toBe("cancelled");
  }
});

test("repetitive read activity gets a compact grouped label", () => {
  let state = beginTranscriptTurn(createTranscriptPresentation(), {
    turnId: "repeated-read",
    text: "Inspect the authentication files.",
  });
  for (const [index, path] of [
    "src/auth/session.ts",
    "src/auth/token.ts",
    "tests/auth.test.ts",
  ].entries()) {
    state = presentAppEvent(state, {
      type: "tool.started",
      callId: `read-${index}`,
      tool: "ReadFile",
      input: { path },
    });
  }
  const group = state.items.find((item) => item.kind === "activity-group");
  expect(group?.kind).toBe("activity-group");
  if (group?.kind === "activity-group") {
    expect(group.label).toBe("READ");
    expect(group.activities).toHaveLength(3);
  }
});

test("assistant continuation starts a new activity group in chronological order", () => {
  let state = beginTranscriptTurn(createTranscriptPresentation(), {
    turnId: "turn-batches",
    text: "Inspect both entry points.",
  });
  state = presentAppEvent(state, { type: "assistant.delta", text: "First." });
  state = presentAppEvent(state, {
    type: "tool.started",
    callId: "a",
    tool: "ReadFile",
    input: { path: "package.json" },
  });
  state = presentAppEvent(state, {
    type: "assistant.delta",
    text: "Now I'll inspect the application entry.",
  });
  state = presentAppEvent(state, {
    type: "tool.started",
    callId: "b",
    tool: "ReadFile",
    input: { path: "src/index.ts" },
  });

  expect(state.items.map((item) => item.kind)).toEqual([
    "user-turn",
    "assistant-text",
    "activity-group",
    "assistant-text",
    "activity-group",
  ]);
  expect(
    state.items
      .filter((item) => item.kind === "activity-group")
      .map((item) => item.activities.map((activity) => activity.id)),
  ).toEqual([["a"], ["b"]]);
});

test("route changes use an explicit user-facing reason and never reuse scoring prose", () => {
  const freeCandidate: ModelCandidate = {
    ...localCandidate,
    id: "groq/openai/gpt-oss-120b",
    providerId: "groq",
    displayName: "GPT-OSS 120B",
    source: "free_cloud",
    local: undefined,
  };
  let state = beginTranscriptTurn(createTranscriptPresentation(), {
    turnId: "turn-route-change",
    text: "Verify the repair and escalate only if needed.",
  });
  state = presentAppEvent(state, {
    type: "route.selected",
    decision: decision(),
  });
  state = presentAppEvent(state, {
    type: "route.selected",
    decision: decision(freeCandidate),
    reason: "Local verification failed twice.",
  });

  const routes = state.items.filter((item) => item.kind === "route-event");
  expect(routes).toHaveLength(1);
  expect(routes[0]).toEqual(
    expect.objectContaining({
      previous: expect.objectContaining({
        source: "local",
        model: "Qwen 2.5 Coder 1.5B",
      }),
      route: expect.objectContaining({
        source: "free",
        provider: "Groq",
        model: "GPT-OSS 120B",
      }),
      reason: "Local verification failed twice.",
    }),
  );
  expect(JSON.stringify(routes).toLowerCase()).not.toContain("quota headroom");
  expect(JSON.stringify(routes).toLowerCase()).not.toContain("cost gate");
});

test("selecting the same route again across turns is not presented as a route change", () => {
  let state = beginTranscriptTurn(createTranscriptPresentation(), {
    turnId: "turn-1",
    text: "Hola",
  });
  state = presentAppEvent(state, {
    type: "route.selected",
    decision: decision(),
  });
  state = beginTranscriptTurn(state, {
    turnId: "turn-2",
    text: "revisa todo el codigo",
  });
  state = presentAppEvent(state, {
    type: "route.selected",
    decision: decision(),
  });

  const routes = state.items.filter((item) => item.kind === "route-event");
  // Both selections are quiet because the route never changed.
  expect(routes).toHaveLength(0);
});

test("a no-route decision surfaces the router's real rejection reasons, not a generic string", () => {
  let state = beginTranscriptTurn(createTranscriptPresentation(), {
    turnId: "turn-no-route",
    text: "Corrige el bug de autenticación.",
  });
  state = presentAppEvent(state, {
    type: "route.selected",
    decision: {
      rejections: [
        {
          candidateId: "local/qwen2.5-coder-1.5b",
          providerId: "lm-studio",
          reasons: ["provider health is unverified"],
        },
      ],
      explanation: "No eligible route. provider health is unverified.",
      generatedAt: "2026-08-23T20:00:00.000Z",
    },
  });

  const notices = state.items.filter((item) => item.kind === "error-notice");
  expect(notices).toHaveLength(1);
  const notice = notices[0] as { title: string; detail?: string };
  expect(`${notice.title} ${notice.detail ?? ""}`).toContain(
    "provider health is unverified",
  );
});

test("failed verification keeps only useful bounded lines", () => {
  let state = beginTranscriptTurn(createTranscriptPresentation(), {
    turnId: "turn-test-failure",
    text: "Run the authentication tests.",
  });
  const noisyStack = Array.from(
    { length: 80 },
    (_, index) => `at internal-frame-${index}`,
  ).join("\n");
  state = presentAppEvent(state, {
    type: "verification.finished",
    exitCode: 1,
    output: `30 pass\n1 fail\nauth/session.test.ts\nrefreshes expired token\n${noisyStack}`,
  });

  const result = state.items.find((item) => item.kind === "test-result");
  expect(result).toEqual(
    expect.objectContaining({
      passed: 30,
      failed: 1,
      details: ["auth/session.test.ts", "refreshes expired token"],
    }),
  );
});

test("completion summarizes changes and tests before final assistant prose", () => {
  let state = beginTranscriptTurn(createTranscriptPresentation(), {
    turnId: "turn-complete",
    text: "Fix the refresh race and verify it.",
  });
  state = presentAppEvent(state, {
    type: "tool.started",
    callId: "edit",
    tool: "EditFile",
    input: { path: "src/auth/session.ts" },
  });
  state = presentAppEvent(state, {
    type: "tool.finished",
    callId: "edit",
    tool: "EditFile",
    result: {
      tool: "EditFile",
      ok: true,
      durationMs: 14,
      output: { replacements: 1 },
    },
  });
  state = presentAppEvent(state, {
    type: "verification.finished",
    exitCode: 0,
    output: "31 pass\n0 fail",
  });
  state = presentAppEvent(state, {
    type: "assistant.delta",
    text: "The refresh race is fixed and the auth suite passes.",
  });
  state = presentAppEvent(state, {
    type: "task.completed",
    result: { verified: true, toolRuns: [{ tool: "EditFile" }] },
  });

  expect(state.items.map((item) => item.kind)).toEqual([
    "user-turn",
    "activity-group",
    "test-result",
    "completion-notice",
    "assistant-text",
  ]);
  expect(state.items.find((item) => item.kind === "completion-notice")).toEqual(
    expect.objectContaining({
      summary: "1 file changed · 31 tests passed",
    }),
  );
});

test("errors keep the human problem separate from recovery detail", () => {
  let state = beginTranscriptTurn(createTranscriptPresentation(), {
    turnId: "turn-error",
    text: "Continue locally.",
  });
  state = presentAppEvent(state, {
    type: "task.failed",
    error: "Local model stopped",
    detail: "Restarting runtime…",
  });
  expect(state.items.at(-1)).toEqual(
    expect.objectContaining({
      kind: "error-notice",
      title: "Local model stopped",
      detail: "Restarting runtime…",
      recoverable: false,
    }),
  );
});
