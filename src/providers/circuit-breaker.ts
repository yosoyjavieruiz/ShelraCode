export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface CircuitRecord {
  state: CircuitState;
  consecutiveFailures: number;
  openedAt?: number;
  nextProbeAt?: number;
  lastSuccessAt?: number;
}

interface CircuitBreakerOptions {
  failureThreshold?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  now?: () => number;
  jitter?: (backoffMs: number) => number;
}

export class CircuitBreaker {
  private readonly records = new Map<string, CircuitRecord>();
  private readonly failureThreshold: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly now: () => number;
  private readonly jitter: (backoffMs: number) => number;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 3;
    this.baseBackoffMs = options.baseBackoffMs ?? 1_000;
    this.maxBackoffMs = options.maxBackoffMs ?? 60_000;
    this.now = options.now ?? Date.now;
    this.jitter = options.jitter ?? (() => 0);
  }

  private key(providerId: string, modelId: string): string {
    return `${providerId}\u0000${modelId}`;
  }

  private get(providerId: string, modelId: string): CircuitRecord {
    const key = this.key(providerId, modelId);
    const current = this.records.get(key);
    if (current) return current;
    const created: CircuitRecord = { state: "CLOSED", consecutiveFailures: 0 };
    this.records.set(key, created);
    return created;
  }

  state(providerId: string, modelId: string): CircuitState {
    return this.get(providerId, modelId).state;
  }

  canRequest(providerId: string, modelId: string): boolean {
    const record = this.get(providerId, modelId);
    if (record.state === "CLOSED" || record.state === "HALF_OPEN") return true;
    if (record.nextProbeAt !== undefined && this.now() >= record.nextProbeAt) {
      record.state = "HALF_OPEN";
      return true;
    }
    return false;
  }

  recordFailure(providerId: string, modelId: string): void {
    const record = this.get(providerId, modelId);
    record.consecutiveFailures += 1;
    if (record.consecutiveFailures < this.failureThreshold) return;
    const exponent = record.consecutiveFailures - this.failureThreshold;
    const rawBackoff = Math.min(
      this.maxBackoffMs,
      this.baseBackoffMs * 2 ** exponent,
    );
    const backoff = Math.max(0, rawBackoff + this.jitter(rawBackoff));
    record.state = "OPEN";
    record.openedAt = this.now();
    record.nextProbeAt = this.now() + backoff;
  }

  recordSuccess(providerId: string, modelId: string): void {
    const record = this.get(providerId, modelId);
    record.state = "CLOSED";
    record.consecutiveFailures = 0;
    record.openedAt = undefined;
    record.nextProbeAt = undefined;
    record.lastSuccessAt = this.now();
  }

  snapshot(providerId: string, modelId: string): Readonly<CircuitRecord> {
    return { ...this.get(providerId, modelId) };
  }
}
