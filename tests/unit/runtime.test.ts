import { describe, expect, test } from "bun:test";
import { OllamaRuntime } from "../../src/runtimes/ollama.js";
import { OpenAICompatibleLocalRuntime } from "../../src/runtimes/http.js";
import type { FetchLike } from "../../src/providers/types.js";

describe("local runtime adapters", () => {
  test("normalizes Ollama tags as local models", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response(
        JSON.stringify({
          models: [
            { name: "qwen:7b", details: { quantization_level: "Q4_K_M" } },
          ],
        }),
        { status: 200 },
      );
    const adapter = new OllamaRuntime("http://ollama.test", fetchImpl);
    expect((await adapter.detect()).installed).toBe(true);
    const models = await adapter.listModels();
    expect(models[0]?.source).toBe("local");
    expect(models[0]?.local?.quant).toBe("Q4_K_M");
  });

  test("normalizes an OpenAI-compatible local endpoint", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response(
        JSON.stringify({
          data: [{ id: "local-coder", context_length: 16_000 }],
        }),
        { status: 200 },
      );
    const adapter = new OpenAICompatibleLocalRuntime(
      "lm-studio",
      "LM Studio",
      "http://lm.test/v1",
      fetchImpl,
    );
    expect((await adapter.health()).state).toBe("healthy");
    expect((await adapter.listModels())[0]?.capabilities.maxContext).toBe(
      16_000,
    );
    expect(adapter.provider?.().id).toBe("lm-studio");
  });

  test("does not expose embedding-only endpoint entries as coding models", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response(
        JSON.stringify({
          data: [
            { id: "qwen2.5-coder-1.5b-instruct" },
            { id: "text-embedding-nomic-embed-text-v1.5" },
          ],
        }),
        { status: 200 },
      );
    const adapter = new OpenAICompatibleLocalRuntime(
      "lm-studio",
      "LM Studio",
      "http://lm.test/v1",
      fetchImpl,
    );

    expect(
      (await adapter.listModels()).map((model) => model.displayName),
    ).toEqual(["qwen2.5-coder-1.5b-instruct"]);
  });

  test("does not expose Ollama embedding entries as coding models", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response(
        JSON.stringify({
          models: [{ name: "qwen2.5-coder:7b" }, { name: "nomic-embed-text" }],
        }),
        { status: 200 },
      );
    const adapter = new OllamaRuntime("http://ollama.test", fetchImpl);

    expect(
      (await adapter.listModels()).map((model) => model.displayName),
    ).toEqual(["qwen2.5-coder:7b"]);
  });

  test("uses LM Studio native metadata when it is available", async () => {
    const fetchImpl: FetchLike = async (input) => {
      const url = String(input);
      if (url.endsWith("/api/v1/models"))
        return new Response(
          JSON.stringify({
            models: [
              {
                type: "llm",
                key: "qwen2.5-coder-1.5b-instruct",
                display_name: "Qwen2.5 Coder 1.5B Instruct",
                quantization: { name: "Q8_0", bits_per_weight: 8 },
                size_bytes: 1_646_573_056,
                max_context_length: 32_768,
                capabilities: { trained_for_tool_use: false },
              },
              {
                type: "embedding",
                key: "text-embedding-nomic-embed-text-v1.5",
                quantization: { name: "Q4_K_M" },
              },
            ],
          }),
          { status: 200 },
        );
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    };
    const adapter = new OpenAICompatibleLocalRuntime(
      "lm-studio",
      "LM Studio",
      "http://lm.test/v1",
      fetchImpl,
    );

    const [model] = await adapter.listModels();

    expect(model?.modelId).toBe("qwen2.5-coder-1.5b-instruct");
    expect(model?.displayName).toBe("Qwen2.5 Coder 1.5B Instruct");
    expect(model?.local?.quant).toBe("Q8_0");
    expect(model?.local?.sizeBytes).toBe(1_646_573_056);
    expect(model?.local?.trainedForToolUse).toBe(false);
    expect(model?.capabilities.maxContext).toBe(32_768);
  });
});
