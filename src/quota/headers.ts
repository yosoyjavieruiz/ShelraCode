import type { QuotaSnapshot } from "../shared/types.js";

interface QuotaHeaderOptions {
  providerId: string;
  modelId?: string;
  observedAt: string;
}

function numberHeader(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

function durationMs(raw: string | null): number | undefined {
  if (!raw) return undefined;
  const match = raw.match(
    /^(?:(\d+(?:\.\d+)?)h)?(?:(\d+(?:\.\d+)?)m)?(?:(\d+(?:\.\d+)?)s)?(?:(\d+(?:\.\d+)?)ms)?$/i,
  );
  if (!match || !match[0]) return undefined;
  const hours = Number(match[1] ?? 0);
  const minutes = Number(match[2] ?? 0);
  const seconds = Number(match[3] ?? 0);
  const milliseconds = Number(match[4] ?? 0);
  const total =
    hours * 3_600_000 + minutes * 60_000 + seconds * 1_000 + milliseconds;
  return Number.isFinite(total) ? total : undefined;
}

export function parseQuotaHeaders(
  headers: Headers,
  options: QuotaHeaderOptions,
): QuotaSnapshot {
  const requestsRemaining = numberHeader(
    headers,
    "x-ratelimit-remaining-requests",
  );
  const requestsLimit = numberHeader(headers, "x-ratelimit-limit-requests");
  const tokensRemaining = numberHeader(headers, "x-ratelimit-remaining-tokens");
  const tokensLimit = numberHeader(headers, "x-ratelimit-limit-tokens");
  const requestReset = durationMs(headers.get("x-ratelimit-reset-requests"));
  const tokenReset = durationMs(headers.get("x-ratelimit-reset-tokens"));
  const resetMs = [requestReset, tokenReset]
    .filter((value): value is number => value !== undefined)
    .sort((a, b) => a - b)[0];
  const observed = new Date(options.observedAt);

  return {
    providerId: options.providerId,
    ...(options.modelId ? { modelId: options.modelId } : {}),
    ...(requestsRemaining === undefined ? {} : { requestsRemaining }),
    ...(requestsLimit === undefined ? {} : { requestsLimit }),
    ...(tokensRemaining === undefined ? {} : { tokensRemaining }),
    ...(tokensLimit === undefined ? {} : { tokensLimit }),
    ...(resetMs === undefined || Number.isNaN(observed.getTime())
      ? {}
      : { resetAt: new Date(observed.getTime() + resetMs).toISOString() }),
    confidence:
      requestsRemaining !== undefined || tokensRemaining !== undefined
        ? "provider_reported"
        : "unknown",
    observedAt: options.observedAt,
  };
}
