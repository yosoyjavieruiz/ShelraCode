import type { ModelCandidate } from "../shared/types.js";
import type { ProviderAdapter } from "../providers/types.js";

export interface RuntimeDetection {
  id: string;
  displayName: string;
  installed: boolean;
  endpoint?: string;
  version?: string;
  detail?: string;
}

export interface RuntimeHealth {
  state: "healthy" | "down" | "unknown";
  latencyMs?: number;
  detail?: string;
}

export interface RunningEndpoint {
  id: string;
  baseUrl: string;
  modelId?: string;
}

export interface LocalRuntimeAdapter {
  readonly id: string;
  detect(signal?: AbortSignal): Promise<RuntimeDetection>;
  health(signal?: AbortSignal): Promise<RuntimeHealth>;
  listModels(signal?: AbortSignal): Promise<ModelCandidate[]>;
  capabilities(): {
    tools: boolean;
    structuredOutput: boolean;
    streaming: boolean;
  };
  provider?(): ProviderAdapter;
}
