import { expect, test } from "bun:test";
import { buildContextBudget } from "../../src/context/context-builder.js";

test("reserves context for instructions, tools, results and future turns", () => {
  const budget = buildContextBudget({
    advertisedContext: 16_000,
    safetyMargin: 0.2,
  });

  expect(budget.usableTokens).toBe(12_800);
  expect(budget.reservedTokens).toBe(3_200);
});
