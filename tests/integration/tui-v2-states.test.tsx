import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import {
  ModelsView,
  ProvidersView,
  QuotaView,
  RoutingView,
  SetupView,
  SettingsView,
  PrivacyView,
  ChangesView,
} from "../../src/tui/views/Centers.js";
import { getTheme } from "../../src/tui/theme/tokens.js";
import type { ModelCandidate, RouteDecision } from "../../src/shared/types.js";

const renderers: Array<{ destroy: () => void }> = [];
afterEach(() => {
  for (const renderer of renderers) renderer.destroy();
  renderers.length = 0;
});

const model: ModelCandidate = {
  id: "lm-studio/qwen2.5-coder-7b-instruct",
  providerId: "lm-studio",
  displayName: "qwen2.5-coder-7b-instruct",
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
  quality: { coding: 0.8, toolUse: 0.7, confidence: "reported" },
  health: { state: "healthy", latencyMs: 12 },
  local: {
    runtime: "lm-studio",
    quant: "Q4",
    estimatedTps: 28,
    memoryRequiredGb: 8,
    fit: "BEST",
  },
};

const decision: RouteDecision = {
  selected: {
    candidate: model,
    score: 0.88,
    breakdown: {
      taskFit: 0.91,
      predictedSuccess: 0.86,
      quotaHeadroom: 1,
      reliability: 0.94,
      latency: 0.9,
      contextHeadroom: 0.82,
      toolReliability: 0.8,
      quotaOpportunityCost: 0,
      total: 0.88,
    },
  },
  rejections: [],
  explanation: "Local model is healthy and satisfies the privacy policy.",
  generatedAt: new Date(0).toISOString(),
  repositoryPolicy: "private",
  routingMode: "strict-zero",
};

const providers = [
  {
    id: "groq",
    displayName: "Groq",
    configured: true,
    source: "free_cloud" as const,
    freeStatus: "unknown",
    privacy: "unknown",
    endpoint: "https://api.groq.com/openai/v1",
    note: "Explicit confirmation required for automatic strict-zero use.",
  },
];

test.each([80, 120, 160])(
  "renders V2 state fixtures at %d columns",
  async (width) => {
    const setup = await testRender(
      () => (
        <box flexDirection="column" width="100%" height="100%">
          <ModelsView
            theme={getTheme(true)}
            width={width}
            data={{
              recommendations: [
                {
                  id: "qwen",
                  displayName: "Qwen 2.5 Coder",
                  runtime: "LM Studio",
                  fit: "BEST",
                },
              ],
              models: [model],
              quotas: {},
            }}
          />
          <ProvidersView theme={getTheme(true)} providers={providers} />
          <QuotaView theme={getTheme(true)} quotas={{}} />
          <RoutingView
            theme={getTheme(true)}
            decision={decision}
            lines={["Selected local route"]}
          />
          <PrivacyView
            theme={getTheme(true)}
            privacy="private"
            routingMode="strict-zero"
            lines={["Secrets never leave the workspace."]}
          />
          <SettingsView
            theme={getTheme(true)}
            density="comfortable"
            reducedMotion={false}
          />
          <ChangesView theme={getTheme(true)} diff="" lines={[]} />
          <SetupView
            theme={getTheme(true)}
            stage={0}
            providers={providers}
            privacy="private"
            routingMode="strict-zero"
          />
        </box>
      ),
      { width, height: 40 },
    );
    renderers.push(setup.renderer);
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("Models");
    expect(frame).toContain("Obsidian");
  },
);
