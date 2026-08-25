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

  test("requires explicit free and privacy confirmations", async () => {
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
});
