import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import type { ModelCandidate } from "../../src/shared/types.js";
import { ModelPicker } from "../../src/tui/components/ModelPicker.js";
import { getTheme } from "../../src/tui/theme/tokens.js";

const model = {
  id: "lm-studio/qwen-coder",
  providerId: "lm-studio",
  displayName: "Qwen Coder",
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
  quality: {
    coding: 0.8,
    toolUse: 0.8,
    reasoning: 0.5,
    confidence: "reported",
  },
  health: { state: "healthy", latencyMs: 10 },
  local: { runtime: "LM Studio", fit: "BEST" },
} as unknown as ModelCandidate;

const cloud = {
  ...model,
  id: "groq/llama",
  displayName: "Llama Free",
  source: "free_cloud",
  providerId: "groq",
} as ModelCandidate;
const renderers: Array<{ destroy: () => void }> = [];
afterEach(() => {
  for (const renderer of renderers) renderer.destroy();
  renderers.length = 0;
});

test("model picker presents active, local and free-cloud sections", async () => {
  const setup = await testRender(
    () => (
      <ModelPicker
        theme={getTheme(true)}
        width={80}
        models={[model, cloud]}
        activeModelId={model.id}
        query=""
        selectedIndex={0}
        onInput={() => undefined}
        onMove={() => undefined}
        onSubmit={() => undefined}
      />
    ),
    { width: 80, height: 20 },
  );
  renderers.push(setup.renderer);
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("Models");
  expect(frame).toContain("Auto");
  expect(frame).toContain("LOCAL");
  expect(frame).toContain("Qwen Coder");
  expect(frame).toContain("FREE CLOUD");
  expect(frame).toContain("Llama Free");
  expect(frame).toContain("active");
});

test("model picker preserves provider metadata at compact width", async () => {
  const setup = await testRender(
    () => (
      <ModelPicker
        theme={getTheme(true)}
        width={100}
        models={[model, cloud]}
        activeModelId={model.id}
        query=""
        selectedIndex={0}
        onInput={() => undefined}
        onMove={() => undefined}
        onSubmit={() => undefined}
      />
    ),
    { width: 100, height: 30 },
  );
  renderers.push(setup.renderer);
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("LM Studio");
  expect(frame).toContain("groq");
});
