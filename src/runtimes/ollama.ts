import type { FetchLike } from "../providers/types.js";
import type { ModelCandidate } from "../shared/types.js";
import type { LocalCodeLogger } from "../shared/logging.js";
import type {
  LocalRuntimeAdapter,
  RuntimeDetection,
  RuntimeHealth,
} from "./types.js";
import { isGenerativeModelId } from "./model-filter.js";
import { estimateModelQuality } from "../shared/model-quality.js";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export class OllamaRuntime implements LocalRuntimeAdapter {
  readonly id = "ollama";

  constructor(
    private readonly baseUrl = "http://127.0.0.1:11434",
    private readonly fetchImpl: FetchLike = (input, init) => fetch(input, init),
    private readonly logger?: LocalCodeLogger,
  ) {}

  private endpoint(path: string): string {
    return `${this.baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  }

  async detect(signal?: AbortSignal): Promise<RuntimeDetection> {
    const health = await this.health(signal);
    return {
      id: this.id,
      displayName: "Ollama",
      installed: health.state === "healthy",
      endpoint: this.baseUrl,
      ...(health.detail ? { detail: health.detail } : {}),
    };
  }

  async health(signal?: AbortSignal): Promise<RuntimeHealth> {
    const started = performance.now();
    this.logger?.debug("runtime.health.started", { endpoint: "api/tags" });
    try {
      const response = await this.fetchImpl(this.endpoint("api/tags"), {
        signal,
      });
      const result: RuntimeHealth = response.ok
        ? {
            state: "healthy",
            latencyMs: Math.round(performance.now() - started),
          }
        : {
            state: "down",
            latencyMs: Math.round(performance.now() - started),
            detail: `HTTP ${response.status}`,
          };
      this.logger?.info("runtime.health.finished", {
        state: result.state,
        latencyMs: result.latencyMs,
        status: response.status,
      });
      return result;
    } catch (error) {
      const result: RuntimeHealth = {
        state: "down",
        latencyMs: Math.round(performance.now() - started),
        detail: error instanceof Error ? error.message : "Ollama unavailable",
      };
      this.logger?.warn("runtime.health.failed", {
        state: result.state,
        latencyMs: result.latencyMs,
        errorType: error instanceof Error ? error.name : "unknown",
        reason: result.detail,
      });
      return result;
    }
  }

  async listModels(signal?: AbortSignal): Promise<ModelCandidate[]> {
    this.logger?.debug("runtime.models.started", {});
    try {
      const response = await this.fetchImpl(this.endpoint("api/tags"), {
        signal,
      });
      if (!response.ok) {
        this.logger?.warn("runtime.models.failed", { status: response.status });
        return [];
      }
      const body = record(await response.json());
      const models = Array.isArray(body?.models) ? body.models : [];
      const candidates = models.flatMap((entry): ModelCandidate[] => {
        const model = record(entry);
        const name = text(model?.name) ?? text(model?.model);
        if (!name || !isGenerativeModelId(name)) return [];
        const details = record(model?.details);
        return [
          {
            id: `${this.id}/${name}`,
            providerId: this.id,
            modelId: name,
            displayName: name,
            source: "local",
            capabilities: {
              tools: true,
              structuredOutput: true,
              reasoning: false,
              vision: false,
            },
            free: { status: "verified_free" },
            privacy: {
              classification: "local",
              retentionKnown: true,
              trainsOnInputs: false,
            },
            quality: estimateModelQuality({
              modelId: name,
              displayName: name,
              parameters: text(details?.parameter_size),
            }),
            health: { state: "healthy" },
            local: {
              runtime: this.id,
              ...(text(details?.quantization_level)
                ? { quant: text(details?.quantization_level) }
                : {}),
            },
          },
        ];
      });
      this.logger?.info("runtime.models.finished", {
        count: candidates.length,
      });
      return candidates;
    } catch {
      this.logger?.warn("runtime.models.failed", { reason: "discovery error" });
      return [];
    }
  }

  capabilities(): {
    tools: boolean;
    structuredOutput: boolean;
    streaming: boolean;
  } {
    return { tools: true, structuredOutput: true, streaming: true };
  }
}
