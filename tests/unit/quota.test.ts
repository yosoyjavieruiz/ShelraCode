import { expect, test } from "bun:test";
import { parseQuotaHeaders } from "../../src/quota/headers.js";

test("parses provider rate limit headers into a quota snapshot", () => {
  const observedAt = "2026-08-23T18:00:00.000Z";
  const headers = new Headers({
    "x-ratelimit-limit-requests": "100",
    "x-ratelimit-remaining-requests": "84",
    "x-ratelimit-limit-tokens": "18000",
    "x-ratelimit-remaining-tokens": "12000",
    "x-ratelimit-reset-requests": "2m59.56s",
    "x-ratelimit-reset-tokens": "7.66s",
  });

  const quota = parseQuotaHeaders(headers, {
    providerId: "groq",
    modelId: "openai/gpt-oss-20b",
    observedAt,
  });

  expect(quota.requestsRemaining).toBe(84);
  expect(quota.tokensRemaining).toBe(12_000);
  expect(quota.resetAt).toBe("2026-08-23T18:00:07.660Z");
  expect(quota.confidence).toBe("provider_reported");
});
