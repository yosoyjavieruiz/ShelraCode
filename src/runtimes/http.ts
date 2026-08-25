import type { ModelCandidate } from "../shared/types.js";
import type { LocalCodeLogger } from "../shared/logging.js";
import { GenericOpenAICompatibleProvider } from "../providers/openai-compatible.js";
import type { FetchLike, ProviderAdapter } from "../providers/types.js";
import type {
  LocalRuntimeAdapter,
  RuntimeDetection,
  RuntimeHealth,
} from "./types.js";
import { isGenerativeModelId } from "./model-filter.js";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export class OpenAICompatibleLocalRuntime implements LocalRuntimeAdapter {
  readonly id: string;
  private readonly fetchImpl: FetchLike;
  private readonly logger?: LocalCodeLogger;

  constructor(
    id: string,
    private readonly displayName: string,
    private readonly baseUrl: string,
    fetchImpl: FetchLike = (input, init) => fetch(input, init),
    logger?: LocalCodeLogger,
  ) {
    this.id = id;
    this.fetchImpl = fetchImpl;
    this.logger = logger?.child({
      component: "runtime.openai-compatible",
      providerId: id,
    });
  }

  private endpoint(path: string): string {
    return `${this.baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  }

  private nativeLmStudioEndpoint(): string {
    return new URL("/api/v1/models", this.baseUrl).toString();
  }

  /**
   * LM Studio exposes richer model identity and hardware metadata outside its
   * OpenAI-compatible surface. Treat this endpoint as an optional enrichment:
   * an unavailable or non-native response must leave the generic fallback
   * usable for other OpenAI-compatible runtimes and older LM Studio versions.
   */
  private async listLmStudioModels(
    signal?: AbortSignal,
  ): Promise<ModelCandidate[] | undefined> {
    if (this.id !== "lm-studio") return undefined;

    try {
      const response = await this.fetchImpl(this.nativeLmStudioEndpoint(), {
        signal,
      });
      if (!response.ok) return undefined;
      const body = record(await response.json());
      if (!Array.isArray(body?.models)) return undefined;

      return body.models.flatMap((entry): ModelCandidate[] => {
        const model = record(entry);
        if (text(model?.type) !== "llm") return [];

        const modelId = text(model?.key) ?? text(model?.id);
        if (!modelId || !isGenerativeModelId(modelId)) return [];

        const quantization = record(model?.quantization);
        const capabilities = record(model?.capabilities);
        const sizeBytes = finiteNumber(model?.size_bytes);
        const maxContext = finiteNumber(model?.max_context_length);
        const quant = text(quantization?.name) ?? text(model?.quantization);
        const architecture = text(model?.architecture);
        const parameters = text(model?.params_string);
        const trainedForToolUse = booleanValue(
          capabilities?.trained_for_tool_use,
        );

        return [
          {
            id: `${this.id}/${modelId}`,
            providerId: this.id,
            modelId,
            displayName: text(model?.display_name) ?? modelId,
            source: "local",
            capabilities: {
              tools: true,
              structuredOutput: true,
              reasoning: false,
              vision: false,
              ...(maxContext === undefined ? {} : { maxContext }),
            },
            free: { status: "verified_free" },
            privacy: {
              classification: "local",
              retentionKnown: true,
              trainsOnInputs: false,
            },
            quality: { coding: 0.6, toolUse: 0.6, confidence: "unknown" },
            health: { state: "healthy", latencyMs: 0 },
            local: {
              runtime: this.id,
              ...(quant ? { quant } : {}),
              ...(architecture ? { architecture } : {}),
              ...(parameters ? { parameters } : {}),
              ...(sizeBytes === undefined ? {} : { sizeBytes }),
              ...(trainedForToolUse === undefined ? {} : { trainedForToolUse }),
              ...(sizeBytes === undefined
                ? {}
                : { memoryRequiredGb: sizeBytes / 1024 ** 3 }),
            },
          },
        ];
      });
    } catch {
      return undefined;
    }
  }

  async detect(signal?: AbortSignal): Promise<RuntimeDetection> {
    const health = await this.health(signal);
    return {
      id: this.id,
      displayName: this.displayName,
      installed: health.state === "healthy",
      endpoint: this.baseUrl,
      ...(health.detail ? { detail: health.detail } : {}),
    };
  }

  async health(signal?: AbortSignal): Promise<RuntimeHealth> {
    const started = performance.now();
    this.logger?.debug("runtime.health.started", { endpoint: "models" });
    try {
      const response = await this.fetchImpl(this.endpoint("models"), {
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
        detail: error instanceof Error ? error.message : "endpoint unavailable",
      };
      this.logger?.warn("runtime.health.failed", {
        state: result.state,
        latencyMs: result.latencyMs,
        errorType: error instanceof Error ? error.name : "unknown",
      });
      return result;
    }
  }

  async listModels(signal?: AbortSignal): Promise<ModelCandidate[]> {
    this.logger?.debug("runtime.models.started", {});
    try {
      const nativeModels = await this.listLmStudioModels(signal);
      if (nativeModels !== undefined) {
        this.logger?.info("runtime.models.finished", {
          count: nativeModels.length,
          source: "lm-studio-native",
        });
        return nativeModels;
      }

      const response = await this.fetchImpl(this.endpoint("models"), {
        signal,
      });
      if (!response.ok) {
        this.logger?.warn("runtime.models.failed", {
          status: response.status,
        });
        return [];
      }
      const body = record(await response.json());
      const models = Array.isArray(body?.data) ? body.data : [];
      const candidates = models.flatMap((entry): ModelCandidate[] => {
        const model = record(entry);
        const modelId = text(model?.id);
        if (!modelId || !isGenerativeModelId(modelId)) return [];
        const maxContext =
          typeof model?.context_length === "number"
            ? model.context_length
            : undefined;
        return [
          {
            id: `${this.id}/${modelId}`,
            providerId: this.id,
            modelId,
            displayName: modelId,
            source: "local",
            capabilities: {
              tools: true,
              structuredOutput: true,
              reasoning: false,
              vision: false,
              ...(maxContext === undefined ? {} : { maxContext }),
            },
            free: { status: "verified_free" },
            privacy: {
              classification: "local",
              retentionKnown: true,
              trainsOnInputs: false,
            },
            quality: { coding: 0.6, toolUse: 0.6, confidence: "unknown" },
            health: { state: "healthy", latencyMs: 0 },
            local: { runtime: this.id },
          },
        ];
      });
      this.logger?.info("runtime.models.finished", {
        count: candidates.length,
        source: "openai-compatible",
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

  provider(): ProviderAdapter {
    return new GenericOpenAICompatibleProvider({
      id: this.id,
      displayName: this.displayName,
      baseUrl: this.baseUrl,
      source: "local",
      freeStatus: { status: "verified_free" },
      privacy: {
        classification: "local",
        retentionKnown: true,
        trainsOnInputs: false,
      },
      fetchImpl: this.fetchImpl,
      logger: this.logger,
    });
  }
}
