import { expect, test } from "bun:test";
import { CircuitBreaker } from "../../src/providers/circuit-breaker.js";

test("opens after repeated failures and probes after bounded backoff", () => {
  let now = 0;
  const breaker = new CircuitBreaker({
    failureThreshold: 2,
    baseBackoffMs: 1_000,
    now: () => now,
  });

  expect(breaker.canRequest("groq", "model")).toBe(true);
  breaker.recordFailure("groq", "model");
  breaker.recordFailure("groq", "model");

  expect(breaker.state("groq", "model")).toBe("OPEN");
  expect(breaker.canRequest("groq", "model")).toBe(false);

  now = 1_000;
  expect(breaker.canRequest("groq", "model")).toBe(true);
  expect(breaker.state("groq", "model")).toBe("HALF_OPEN");

  breaker.recordSuccess("groq", "model");
  expect(breaker.state("groq", "model")).toBe("CLOSED");
});
