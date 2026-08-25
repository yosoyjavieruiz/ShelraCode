import type {
  NormalizedModelRequest,
  ProviderAdapter,
  ProviderEvent,
} from "../../src/providers/types.js";
import type { ModelCandidate } from "../../src/shared/types.js";

export const fakeAgentCandidate: ModelCandidate = {
  id: "local/fake-coder",
  providerId: "local",
  displayName: "fake-coder",
  source: "local",
  capabilities: {
    tools: true,
    structuredOutput: true,
    reasoning: false,
    vision: false,
    maxContext: 16_000,
  },
  free: { status: "verified_free" },
  privacy: {
    classification: "local",
    retentionKnown: true,
    trainsOnInputs: false,
  },
  quality: { coding: 0.8, toolUse: 0.8, confidence: "measured" },
  health: { state: "healthy" },
  agentProbe: {
    conversation: true,
    readTool: true,
    multiTurnTools: true,
    agenticCodingEligible: true,
    agentCapabilityClass: "advanced_coding_agent",
    notes: [],
  },
};

/**
 * A deterministic fake ProviderAdapter for functional-acceptance testing.
 * Each entry in `turns` is the full set of events yielded for one turn of
 * the agent loop, in the order `runAgent` calls `stream()`. Once `turns` is
 * exhausted, the last turn repeats (useful for adversarial "never stops
 * trying" fixtures) unless `stopAfter` is set, in which case the provider
 * throws to make an unexpected extra turn fail loudly instead of hanging a
 * test.
 */
export class FakeModelAdapter implements ProviderAdapter {
  readonly id = "local";
  readonly displayName = "Scripted fixture";
  readonly requests: NormalizedModelRequest[] = [];
  private call = 0;

  constructor(
    private readonly turns: ProviderEvent[][],
    private readonly options: { stopAfter?: boolean } = {},
  ) {}

  async discoverModels(): Promise<ModelCandidate[]> {
    return [fakeAgentCandidate];
  }

  async health() {
    return { state: "healthy" as const };
  }

  async quota() {
    return {
      providerId: "local",
      confidence: "unknown" as const,
      observedAt: new Date().toISOString(),
    };
  }

  async *stream(
    request: NormalizedModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    this.requests.push(structuredClone(request));
    const index = Math.min(this.call, this.turns.length - 1);
    if (this.options.stopAfter && this.call >= this.turns.length)
      throw new Error(
        `Scripted provider called beyond its ${this.turns.length} scripted turn(s)`,
      );
    this.call += 1;
    for (const event of this.turns[index] ?? []) {
      // Real yield point so an externally aborted signal can be observed
      // mid-stream (matches a real network stream, which never resolves
      // multiple chunks in the same microtask).
      await Promise.resolve();
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      yield event;
    }
  }

  classifyError(error: unknown) {
    return {
      code: "UNKNOWN" as const,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

export function createScriptedProvider(
  turns: ProviderEvent[][],
  options: { stopAfter?: boolean } = {},
): ProviderAdapter & { requests: NormalizedModelRequest[] } {
  return new FakeModelAdapter(turns, options);
}
