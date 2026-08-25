import { describe, expect, test } from "bun:test";
import { createProviderRegistry } from "../../src/providers/registry.js";

describe("provider registry", () => {
  test("does not create adapters without explicit credentials", async () => {
    const registry = await createProviderRegistry({});
    expect(registry.adapters).toHaveLength(0);
    expect(
      registry.statuses.find((item) => item.id === "groq")?.configured,
    ).toBe(false);
  });

  test("honors an explicit Groq free confirmation while keeping privacy separate", async () => {
    const registry = await createProviderRegistry({
      GROQ_API_KEY: "test",
      GROQ_FREE_CONFIRMED: "true",
    });
    const groq = registry.adapters[0];
    expect(groq).toBeDefined();
    expect(
      registry.statuses.find((item) => item.id === "groq")?.freeStatus,
    ).toBe("verified_free");
    expect(registry.statuses.find((item) => item.id === "groq")?.privacy).toBe(
      "unknown",
    );
  });

  test("enables Groq's no-payment Free tier as quota-bearing without a paid flag", async () => {
    const registry = await createProviderRegistry({
      GROQ_API_KEY: "test",
      GROQ_FREE_CONFIRMED: "false",
      GROQ_ZDR_CONFIRMED: "false",
    });

    expect(registry.statuses.find((item) => item.id === "groq")).toMatchObject({
      configured: true,
      freeStatus: "free_quota",
      privacy: "unknown",
    });
  });

  test("exposes only OpenRouter free model variants", async () => {
    const registry = await createProviderRegistry(
      {
        OPENROUTER_API_KEY: "test",
        OPENROUTER_FREE_CONFIRMED: "false",
        OPENROUTER_ZDR_CONFIRMED: "false",
      },
      undefined,
      async () =>
        new Response(
          JSON.stringify({
            data: [
              {
                id: "paid/provider-model",
                pricing: { prompt: "0.000001", completion: "0.000002" },
              },
              {
                id: "qwen/qwen-coder:free",
                pricing: { prompt: "0", completion: "0" },
              },
              {
                id: "openrouter/free",
                pricing: { prompt: "0", completion: "0" },
              },
              {
                id: "catalog/zero-priced",
                pricing: { prompt: "0.000000", completion: "0.000000" },
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );

    const openrouter = registry.adapters.find(
      (adapter) => adapter.id === "openrouter",
    );
    expect(openrouter).toBeDefined();
    const models = await openrouter!.discoverModels(
      new AbortController().signal,
    );

    expect(models.map((model) => model.modelId)).toEqual([
      "qwen/qwen-coder:free",
      "openrouter/free",
      "catalog/zero-priced",
    ]);
    expect(models.every((model) => model.free.status === "verified_free")).toBe(
      true,
    );
    expect(
      models.some((model) => model.modelId === "paid/provider-model"),
    ).toBe(false);
  });
});
