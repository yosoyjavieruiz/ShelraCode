import { expect, test } from "bun:test";
import { estimateModelQuality } from "../../src/shared/model-quality.js";

test("larger parameter counts score higher coding quality", () => {
  const small = estimateModelQuality({
    modelId: "qwen3.5-2b-claude-4.6-opus-reasoning-distilled",
    parameters: "1.9B",
  });
  const large = estimateModelQuality({
    modelId: "openai/gpt-oss-120b",
  });
  expect(large.coding).toBeGreaterThan(small.coding);
  expect(small.confidence).toBe("reported");
});

test("a coder-specialized model outranks a same-size generalist model", () => {
  const coder = estimateModelQuality({
    modelId: "qwen2.5-coder-7b-instruct",
    parameters: "7B",
  });
  const generalist = estimateModelQuality({
    modelId: "qwen3-8b",
    parameters: "8B",
  });
  expect(coder.coding).toBeGreaterThan(generalist.coding);
});

test("parses parameter count from a bare cloud model id with no explicit metadata", () => {
  const result = estimateModelQuality({ modelId: "qwen/qwen3.6-27b" });
  const tiny = estimateModelQuality({ modelId: "meta-llama/llama-prompt-guard-2-22m" });
  expect(result.coding).toBeGreaterThan(tiny.coding);
});

test("falls back to a neutral score when no parameter signal exists", () => {
  const result = estimateModelQuality({ modelId: "some-mystery-model" });
  expect(result.coding).toBeGreaterThanOrEqual(0.3);
  expect(result.coding).toBeLessThanOrEqual(0.6);
});

test("tool-use training nudges the tool-use score up without affecting coding", () => {
  const withTools = estimateModelQuality({
    modelId: "qwen2.5-coder-7b-instruct",
    parameters: "7B",
    trainedForToolUse: true,
  });
  const withoutTools = estimateModelQuality({
    modelId: "qwen2.5-coder-7b-instruct",
    parameters: "7B",
    trainedForToolUse: false,
  });
  expect(withTools.toolUse).toBeGreaterThan(withoutTools.toolUse);
  expect(withTools.coding).toBe(withoutTools.coding);
});

test("scores stay within the valid [0, 1] range at the extremes", () => {
  const huge = estimateModelQuality({ modelId: "some-model-1000b" });
  const tiny = estimateModelQuality({ modelId: "some-model-0.1b" });
  for (const result of [huge, tiny]) {
    expect(result.coding).toBeGreaterThanOrEqual(0);
    expect(result.coding).toBeLessThanOrEqual(1);
    expect(result.toolUse).toBeGreaterThanOrEqual(0);
    expect(result.toolUse).toBeLessThanOrEqual(1);
  }
});
