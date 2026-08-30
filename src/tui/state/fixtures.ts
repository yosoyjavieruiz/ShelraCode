import type { HardwareInspection } from "../../hardware/types.js";
import type { ProviderStatus } from "../../providers/registry.js";
import type { SessionSummary } from "../../storage/database.js";
import type {
  ModelCandidate,
  QuotaSnapshot,
  RouteDecision,
} from "../../shared/types.js";
import type { TranscriptMessage } from "../components/Transcript.js";
import {
  beginTranscriptTurn,
  createTranscriptPresentation,
  presentAppEvent,
  type TranscriptPresentation,
} from "../presentation/adapter.js";
import type { ModelCenterData } from "../views/Centers.js";
import { readProductEnv } from "../../product/identity.js";

export type UIFixtureKind =
  | "home"
  | "empty"
  | "conversation"
  | "thinking"
  | "thinking-long"
  | "assistant-stream"
  | "streaming"
  | "tool-stream"
  | "shell-live-stream"
  | "test-running"
  | "tool-group"
  | "tool-details"
  | "edit-diff"
  | "tools"
  | "tools-expanded"
  | "local-route"
  | "cloud-route"
  | "route-change"
  | "test-pass"
  | "test-failure"
  | "error-recovering"
  | "error-failed"
  | "plan"
  | "long-conversation"
  | "complete"
  | "task-complete"
  | "error"
  | "approval"
  | "palette"
  | "context-picker"
  | "model-picker"
  | "models"
  | "providers"
  | "provider-error"
  | "usage"
  | "routing"
  | "sessions"
  | "settings"
  | "diff";

export interface UIFixtureState {
  objective?: string;
  presentation?: TranscriptPresentation;
  messages?: TranscriptMessage[];
  streamingText?: string;
  expandTools?: boolean;
  modelData?: ModelCenterData;
  providers?: ProviderStatus[];
  quotas?: Record<string, QuotaSnapshot>;
  hardware?: HardwareInspection;
  sessions?: SessionSummary[];
  fixtureScreen?: "providers" | "quota" | "routing" | "sessions";
  lines?: string[];
  diffText?: string;
  decision?: RouteDecision;
  contextCandidates?: string[];
  // AgentMatrixPulse fixtures (docs/ui-chat-v2): freezes the "busy" clock at
  // a fixed elapsed time instead of a live one, so a capture is
  // deterministic — the live timer is real production wiring, not
  // something a static screenshot should depend on.
  busy?: boolean;
  elapsedSeconds?: number;
}

const FIXTURE_ALIASES: Readonly<Record<string, UIFixtureKind>> = {
  "01-home": "home",
  "02-user-message": "conversation",
  "03-thinking-agent-matrix": "thinking",
  "04-long-thinking-agent-matrix": "thinking-long",
  "05-assistant-streaming": "assistant-stream",
  "06-single-tool-running": "tool-stream",
  "07-multi-tool-group": "tool-group",
  "08-tool-group-expanded": "tool-details",
  "09-shell-live-stream": "shell-live-stream",
  "10-test-running": "test-running",
  "11-test-success": "test-pass",
  "12-test-failure": "test-failure",
  "13-edit-diff": "edit-diff",
  "14-route-change": "route-change",
  "15-error-recovering": "error-recovering",
  "16-error-failed": "error-failed",
  "17-approval": "approval",
  "18-plan": "plan",
  "19-completion": "complete",
  "20-command-palette": "palette",
  "21-file-picker": "context-picker",
  "22-80-column": "home",
  "23-24-row": "home",
  "24-long-conversation": "long-conversation",
};

const fixtureModel: ModelCandidate = {
  id: "lm-studio/qwen2.5-coder-1.5b",
  providerId: "lm-studio",
  displayName: "Qwen 2.5 Coder 1.5B",
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
};

const freeFixtureModel: ModelCandidate = {
  ...fixtureModel,
  id: "groq/llama-3.3-70b",
  providerId: "groq",
  displayName: "Llama 3.3 70B",
  source: "free_cloud",
  local: undefined,
  privacy: { classification: "zdr_capable", retentionKnown: true },
};

const fixtureProviders: ProviderStatus[] = [
  {
    id: "groq",
    displayName: "Groq",
    configured: true,
    source: "free_cloud",
    freeStatus: "verified_free",
    privacy: "zdr confirmed",
    endpoint: "api.groq.com",
    note: "Free capacity verified recently.",
  },
  {
    id: "openrouter",
    displayName: "OpenRouter",
    configured: true,
    source: "free_cloud",
    freeStatus: "stale",
    privacy: "unknown",
    endpoint: "openrouter.ai",
    note: "Health data needs a fresh verification.",
  },
];

const fixtureQuotas: Record<string, QuotaSnapshot> = {
  groq: {
    providerId: "groq",
    requestsRemaining: 81,
    requestsLimit: 100,
    confidence: "provider_reported",
    observedAt: "2026-08-23T14:00:00.000Z",
    resetAt: "in 42 min",
  },
  openrouter: {
    providerId: "openrouter",
    tokensRemaining: 0,
    tokensLimit: 0,
    confidence: "unknown",
    observedAt: "2026-08-23T11:00:00.000Z",
    resetAt: "unknown",
  },
};

function fixtureDecision(candidate: ModelCandidate): RouteDecision {
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
      "Privacy gate passed. Cost gate passed. Score 0.91; quota headroom 1.00.",
    generatedAt: "2026-08-23T14:32:00.000Z",
  };
}

function v4Conversation(kind: UIFixtureKind): TranscriptPresentation {
  let state = beginTranscriptTurn(createTranscriptPresentation(), {
    turnId: "fixture-turn",
    text: "Fix the token refresh race condition and run the auth tests.",
  });
  state = presentAppEvent(state, {
    type: "assistant.delta",
    text: "I'll inspect the session lifecycle first.",
  });
  if (kind === "conversation") return state;
  if (kind === "assistant-stream" || kind === "streaming") {
    return presentAppEvent(state, {
      type: "assistant.delta",
      text: " The refresh path is still being verified…",
    });
  }
  if (kind === "shell-live-stream") {
    state = presentAppEvent(state, {
      type: "tool.started",
      callId: "fixture-shell",
      tool: "Shell",
      input: { command: "bun test --watch=false" },
    });
    state = presentAppEvent(state, {
      type: "tool.output",
      callId: "fixture-shell",
      tool: "Shell",
      stream: "stdout",
      text: "PASS auth/login\nPASS auth/logout\nRUNS auth/refresh",
    });
    return state;
  }
  if (kind === "test-running") {
    state = presentAppEvent(state, {
      type: "verification.started",
      id: "fixture-verification",
      stage: "tests",
      command: "bun test auth",
    });
    return presentAppEvent(state, {
      type: "tool.output",
      callId: "fixture-verification",
      tool: "RunTests",
      stream: "stdout",
      text: "PASS auth/login\nPASS auth/logout\nRUNS auth/refresh",
    });
  }
  if (kind === "plan") {
    return presentAppEvent(state, {
      type: "plan.changed",
      steps: [
        {
          id: "inspect",
          description: "Inspect the current session flow",
          status: "done",
        },
        {
          id: "repair",
          description: "Fix the refresh fallback",
          status: "active",
        },
        { id: "test", description: "Add a regression test", status: "pending" },
        {
          id: "verify",
          description: "Run the relevant validation",
          status: "pending",
        },
        {
          id: "review",
          description: "Review the final diff",
          status: "pending",
        },
      ],
    });
  }
  if (kind === "edit-diff") {
    state = presentAppEvent(state, {
      type: "tool.started",
      callId: "fixture-edit",
      tool: "EditFile",
      input: {
        path: "src/auth/session.ts",
        oldText: "return cachedToken;\n",
        newText: "return cachedToken ?? await refreshToken();\n",
      },
    });
    state = presentAppEvent(state, {
      type: "tool.finished",
      callId: "fixture-edit",
      tool: "EditFile",
      result: {
        tool: "EditFile",
        ok: true,
        durationMs: 18,
        output: { replacements: 1 },
      },
    });
    return {
      ...state,
      items: state.items.map((item) =>
        item.kind === "activity-group" ? { ...item, expanded: true } : item,
      ),
    };
  }
  if (kind === "local-route") {
    return presentAppEvent(state, {
      type: "route.selected",
      decision: fixtureDecision(fixtureModel),
    });
  }
  if (kind === "cloud-route") {
    return presentAppEvent(state, {
      type: "route.selected",
      decision: fixtureDecision(freeFixtureModel),
      reason: "Local verification failed twice.",
    });
  }
  if (kind === "route-change") {
    state = presentAppEvent(state, {
      type: "route.selected",
      decision: fixtureDecision(fixtureModel),
    });
    return presentAppEvent(state, {
      type: "route.selected",
      decision: fixtureDecision(freeFixtureModel),
      reason: "Local verification failed twice.",
    });
  }
  if (
    kind === "error" ||
    kind === "error-recovering" ||
    kind === "error-failed"
  ) {
    return presentAppEvent(state, {
      type: "task.failed",
      error:
        kind === "error-failed"
          ? "Local runtime unavailable"
          : "Local model stopped",
      detail:
        kind === "error-failed"
          ? "The task stopped. Technical details are available on demand."
          : "Restarting runtime…",
    });
  }
  if (kind === "long-conversation") {
    for (let index = 1; index <= 4; index += 1) {
      state = beginTranscriptTurn(state, {
        turnId: `fixture-turn-${index}`,
        text: `Follow-up question ${index}: keep the repository evidence in view.`,
      });
      state = presentAppEvent(state, {
        type: "assistant.delta",
        text: `Turn ${index} is complete; the relevant evidence remains stable.`,
      });
    }
    return state;
  }

  const calls = [
    ["read", "ReadFile", { path: "src/auth/session.ts" }],
    ["search", "SearchText", { pattern: "refreshToken" }],
    ["edit", "EditFile", { path: "src/auth/session.ts" }],
    ["test", "RunTests", { command: "bun test auth" }],
  ] as const;
  const visibleCalls = kind === "tool-stream" ? calls.slice(0, 1) : calls;
  for (const [callId, tool, input] of visibleCalls) {
    state = presentAppEvent(state, {
      type: "tool.started",
      callId,
      tool,
      input,
    });
    if (kind !== "tool-stream") {
      const output =
        tool === "ReadFile"
          ? { content: "one\ntwo\nthree\n", truncated: false }
          : tool === "SearchText"
            ? { matches: ["src/auth/session.ts:42:refreshToken"] }
            : tool === "EditFile"
              ? { replacements: 1 }
              : kind === "test-failure"
                ? {
                    exitCode: 1,
                    output:
                      "30 pass\n1 fail\nauth/session.test.ts\nrefreshes expired token",
                  }
                : { exitCode: 0, output: "31 pass\n0 fail" };
      state = presentAppEvent(state, {
        type: "tool.finished",
        callId,
        tool,
        result: {
          tool,
          ok: true,
          durationMs: tool === "RunTests" ? 2_400 : 14,
          output,
        },
      });
    }
  }
  if (kind === "test-failure") {
    return presentAppEvent(state, {
      type: "verification.finished",
      exitCode: 1,
      output: "30 pass\n1 fail\nauth/session.test.ts\nrefreshes expired token",
    });
  }
  if (kind === "test-pass" || kind === "complete" || kind === "task-complete") {
    state = presentAppEvent(state, {
      type: "verification.finished",
      exitCode: 0,
      output: "31 pass\n0 fail\nRan 31 tests across 6 files.",
    });
  }
  if (kind === "complete" || kind === "task-complete") {
    state = presentAppEvent(state, {
      type: "assistant.delta",
      text: "The refresh race is fixed and the authentication suite passes.",
    });
    state = presentAppEvent(state, {
      type: "task.completed",
      result: { verified: true, toolRuns: calls.map(([, tool]) => ({ tool })) },
    });
  }
  if (kind === "tool-details") {
    state = {
      ...state,
      items: state.items.map((item) =>
        item.kind === "activity-group" ? { ...item, expanded: true } : item,
      ),
    };
  }
  return state;
}

function baseConversation(): UIFixtureState {
  return {
    objective: "Review the authentication session lifecycle",
    messages: [
      {
        role: "user",
        text: "Review the authentication session lifecycle",
      },
      {
        role: "assistant",
        text: "I found a refresh-token race to verify next.",
      },
      {
        role: "tool",
        text: "READ src/auth/session.ts",
        detail: "completed · 12ms",
        status: "success",
      },
      {
        role: "tool",
        text: "TEST auth.test.ts",
        detail: "31 passed",
        status: "success",
      },
    ],
  };
}

export function readUIFixture(
  value = readProductEnv(process.env, "UI_FIXTURE"),
): UIFixtureKind | undefined {
  const fixtures = new Set<UIFixtureKind>([
    "home",
    "empty",
    "conversation",
    "thinking",
    "thinking-long",
    "assistant-stream",
    "streaming",
    "tool-stream",
    "shell-live-stream",
    "test-running",
    "tool-group",
    "tool-details",
    "edit-diff",
    "tools",
    "tools-expanded",
    "local-route",
    "cloud-route",
    "route-change",
    "test-pass",
    "test-failure",
    "error-recovering",
    "error-failed",
    "plan",
    "long-conversation",
    "complete",
    "task-complete",
    "error",
    "approval",
    "palette",
    "context-picker",
    "model-picker",
    "models",
    "providers",
    "provider-error",
    "usage",
    "routing",
    "sessions",
    "settings",
    "diff",
  ]);
  const canonical = value ? (FIXTURE_ALIASES[value] ?? value) : undefined;
  return canonical && fixtures.has(canonical as UIFixtureKind)
    ? (canonical as UIFixtureKind)
    : undefined;
}

export function createUIFixture(kind: UIFixtureKind): UIFixtureState {
  if (kind === "context-picker") {
    return {
      contextCandidates: [
        "package.json",
        "src/index.ts",
        "src/tui/app.tsx",
        "src/agent/loop.ts",
        "docs/ARCHITECTURE.md",
      ],
    };
  }
  if (
    kind === "home" ||
    kind === "empty" ||
    kind === "palette" ||
    kind === "approval"
  )
    return {};
  if (kind === "thinking" || kind === "thinking-long") {
    let state = beginTranscriptTurn(createTranscriptPresentation(), {
      turnId: "fixture-turn",
      text: "Fix the token refresh race condition and run the auth tests.",
    });
    state = presentAppEvent(state, {
      type: "assistant.delta",
      text: "I'll trace the refresh flow first.",
    });
    state = presentAppEvent(state, {
      type: "phase.changed",
      phase: kind === "thinking-long" ? "verify" : "discover",
    });
    return {
      objective: "Fix the token refresh race condition and run the auth tests.",
      presentation: state,
      busy: true,
      elapsedSeconds: kind === "thinking-long" ? 18 : 2,
    };
  }
  if (
    [
      "conversation",
      "assistant-stream",
      "streaming",
      "tool-stream",
      "shell-live-stream",
      "test-running",
      "tool-group",
      "tool-details",
      "edit-diff",
      "local-route",
      "cloud-route",
      "route-change",
      "test-pass",
      "test-failure",
      "error-recovering",
      "error-failed",
      "plan",
      "long-conversation",
      "complete",
      "error",
    ].includes(kind)
  ) {
    return {
      objective: "Fix the token refresh race condition and run the auth tests.",
      presentation: v4Conversation(kind),
      busy:
        kind === "tool-stream" ||
        kind === "shell-live-stream" ||
        kind === "test-running",
      elapsedSeconds:
        kind === "tool-stream"
          ? 3
          : kind === "shell-live-stream"
            ? 18
            : kind === "test-running"
              ? 8
              : undefined,
      expandTools: kind === "tool-details",
      decision:
        kind === "cloud-route" || kind === "route-change"
          ? fixtureDecision(freeFixtureModel)
          : undefined,
    };
  }
  if (kind === "tools" || kind === "tools-expanded") {
    return {
      ...baseConversation(),
      messages: [
        ...(baseConversation().messages ?? []),
        {
          role: "tool",
          text: "READ src/auth/cookies.ts",
          detail: "8ms",
          status: "success",
        },
        {
          role: "tool",
          text: "SEARCH refreshToken",
          detail: "28ms",
          status: "success",
        },
        {
          role: "tool",
          text: "EDIT src/auth/session.ts",
          detail: "+8 -3",
          status: "success",
        },
      ],
      expandTools: kind === "tools-expanded",
    };
  }
  if (kind === "task-complete") {
    return {
      ...baseConversation(),
      messages: [
        ...(baseConversation().messages ?? []),
        {
          role: "event",
          text: "Tests passed",
          detail: "31 passed · 0 failed",
          status: "success",
        },
        {
          role: "assistant",
          text: "The race is fixed and the authentication tests pass.",
        },
      ],
    };
  }
  if (kind === "error") {
    return {
      ...baseConversation(),
      messages: [
        ...(baseConversation().messages ?? []),
        {
          role: "error",
          text: "Groq is temporarily unavailable",
          detail:
            "ShelraCode is keeping the task local. Technical details are available in Providers.",
          status: "warning",
        },
      ],
    };
  }
  if (kind === "model-picker") {
    return {
      modelData: {
        recommendations: [],
        models: [
          fixtureModel,
          {
            ...fixtureModel,
            id: "ollama/qwen2.5-coder:7b",
            displayName: "Qwen 2.5 Coder 7B",
            providerId: "ollama",
            local: { runtime: "Ollama", quant: "Q4_K_M", estimatedTps: 22 },
          },
          freeFixtureModel,
        ],
        quotas: {},
      },
    };
  }
  if (kind === "models") {
    return {
      modelData: {
        recommendations: [
          {
            id: fixtureModel.id,
            displayName: fixtureModel.displayName,
            runtime: "LM Studio",
            fit: "BEST",
          },
        ],
        models: [fixtureModel],
        quotas: {},
      },
    };
  }
  if (kind === "providers" || kind === "provider-error") {
    return {
      providers:
        kind === "providers"
          ? fixtureProviders
          : [fixtureProviders[1] as ProviderStatus],
      fixtureScreen: "providers",
    };
  }
  if (kind === "usage")
    return { quotas: fixtureQuotas, fixtureScreen: "quota" };
  if (kind === "routing") {
    return {
      fixtureScreen: "routing",
      lines: [
        "Task        repository debugging · high confidence",
        "Privacy     private · strict-zero",
        "Selected    Local / Qwen Coder 7B",
        "Why         local tool support is healthy and cost is zero",
      ],
      decision: {
        selected: {
          candidate: fixtureModel,
          score: 0.82,
          breakdown: {
            taskFit: 0.9,
            predictedSuccess: 0.86,
            quotaHeadroom: 1,
            reliability: 0.92,
            latency: 0.8,
            contextHeadroom: 0.9,
            toolReliability: 0.84,
            quotaOpportunityCost: 1,
            total: 0.82,
          },
        },
        rejections: [],
        explanation: "Local tool support is healthy and cost is zero.",
        generatedAt: "2026-08-23T14:32:00.000Z",
      },
    };
  }
  if (kind === "sessions") {
    return {
      fixtureScreen: "sessions",
      sessions: [
        {
          id: "session-1",
          repository: "shelra",
          objective: "Fix routing fallback",
          createdAt: "2026-08-23T12:00:00Z",
          updatedAt: "2026-08-23T14:32:00Z",
        },
        {
          id: "session-2",
          repository: "shelra",
          objective: "Redesign terminal interface",
          createdAt: "2026-08-23T08:00:00Z",
          updatedAt: "2026-08-23T10:18:00Z",
        },
        {
          id: "session-3",
          repository: "shelra",
          objective: "Investigate local model fit",
          createdAt: "2026-08-22T18:00:00Z",
          updatedAt: "2026-08-22T18:44:00Z",
        },
      ],
    };
  }
  if (kind === "diff") {
    return {
      diffText:
        "diff --git a/src/auth/session.ts b/src/auth/session.ts\nindex 1234567..89abcde 100644\n--- a/src/auth/session.ts\n+++ b/src/auth/session.ts\n@@ -1,1 +1,2 @@\n-old session token\n+new session token\n+await refreshToken();\n",
    };
  }
  return {};
}
