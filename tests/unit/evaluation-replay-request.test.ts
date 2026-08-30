import { expect, test } from "bun:test";
import { digestEvaluationReplayRequest } from "../../src/evals/replay.js";

test("replay request digest ignores host timing noise but preserves semantic content", () => {
  const recorded = {
    modelId: "fixture-model",
    messages: [
      {
        role: "tool",
        content:
          '{"tool":"EditFile","ok":true,"durationMs":20,"output":"C:\\\\Users\\\\Javie\\\\AppData\\\\Local\\\\Temp\\\\localcode-capability-probe-AAAA\\\\test.ts [31.00ms]"}',
      },
    ],
    toolSurface: { names: ["EditFile"], count: 1, digest: "a".repeat(64) },
  };
  const replayed = {
    ...recorded,
    messages: [
      {
        role: "tool",
        content:
          '{"tool":"EditFile","ok":true,"durationMs":3,"output":"C:\\\\Users\\\\Javie\\\\AppData\\\\Local\\\\Temp\\\\localcode-capability-probe-BBBB\\\\test.ts [84.50ms]"}',
      },
    ],
  };
  const changed = {
    ...replayed,
    messages: [
      {
        role: "tool",
        content:
          '{"tool":"EditFile","ok":false,"durationMs":3,"output":"C:\\\\Users\\\\Javie\\\\AppData\\\\Local\\\\Temp\\\\localcode-capability-probe-BBBB\\\\test.ts [84.50ms]"}',
      },
    ],
  };

  expect(digestEvaluationReplayRequest(recorded)).toBe(
    digestEvaluationReplayRequest(replayed),
  );
  expect(digestEvaluationReplayRequest(changed)).not.toBe(
    digestEvaluationReplayRequest(recorded),
  );
});
