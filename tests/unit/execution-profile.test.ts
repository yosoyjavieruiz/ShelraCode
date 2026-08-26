import { expect, test } from "bun:test";
import { selectExecutionProfile } from "../../src/agent/execution-profile.js";

test("keeps conversation and a bounded edit on the smallest profile", () => {
  expect(
    selectExecutionProfile({
      mode: "conversation",
      complexity: 0.1,
      explicitPathCount: 0,
      deliverableCount: 0,
      risk: 0,
      uncertaintyCount: 0,
    }),
  ).toBe("conversation");
  expect(
    selectExecutionProfile({
      mode: "coding",
      complexity: 0.2,
      explicitPathCount: 1,
      deliverableCount: 1,
      risk: 0.1,
      uncertaintyCount: 0,
    }),
  ).toBe("direct");
});

test("selects structured or decomposed work from shape and pressure", () => {
  expect(
    selectExecutionProfile({
      mode: "coding",
      complexity: 0.65,
      explicitPathCount: 3,
      deliverableCount: 3,
      risk: 0.6,
      uncertaintyCount: 1,
    }),
  ).toBe("structured");
  expect(
    selectExecutionProfile({
      mode: "coding",
      complexity: 0.9,
      explicitPathCount: 14,
      deliverableCount: 8,
      risk: 0.8,
      uncertaintyCount: 2,
      contextPressure: 0.9,
    }),
  ).toBe("decomposed");
});
