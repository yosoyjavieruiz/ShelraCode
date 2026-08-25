import { parseQuotaHeaders } from "../quota/headers.js";
import type { ModelCandidate } from "../shared/types.js";
import type { LocalCodeLogger } from "../shared/logging.js";
import type {
  FetchLike,
  NormalizedModelRequest,
  ProviderAdapter,
  ProviderEvent,
  ProviderFailure,
  ProviderFailureCode,
  ProviderHealth,
  ProviderProfile,
  ToolCall,
  Usage,
} from "./types.js";

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function providerError(
  code: ProviderFailureCode,
  message: string,
  status?: number,
): ProviderFailure {
  return { code, message, ...(status === undefined ? {} : { status }) };
}

function serializeMessage(message: NormalizedModelRequest["messages"][number]) {
  if (message.role === "assistant" && message.toolCalls?.length) {
    return {
      role: message.role,
      content: message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })),
    };
  }
  if (message.role === "tool") {
    return {
      role: message.role,
      content: message.content,
      ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {}),
    };
  }
  return { role: message.role, content: message.content };
}

export class GenericOpenAICompatibleProvider implements ProviderAdapter {
  readonly id: string;
  readonly displayName: string;
  private readonly profile: ProviderProfile;
  private readonly fetchImpl: FetchLike;
  private readonly logger?: LocalCodeLogger;

  constructor(profile: ProviderProfile) {
    this.profile = profile;
    this.id = profile.id;
    this.displayName = profile.displayName;
    this.fetchImpl = profile.fetchImpl ?? ((input, init) => fetch(input, init));
    this.logger = profile.logger?.child({
      component: "provider.openai-compatible",
      providerId: profile.id,
    });
  }

  private endpoint(path: string): string {
    return `${this.profile.baseUrl.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  }

  private headers(): Headers {
    const headers = new Headers({ accept: "application/json" });
    if (this.profile.apiKey)
      headers.set("authorization", `Bearer ${this.profile.apiKey}`);
    return headers;
  }

  private async failureFromResponse(
    response: Response,
  ): Promise<ProviderFailure> {
    let message =
      response.statusText || `provider returned HTTP ${response.status}`;
    try {
      const body = asRecord(await response.json());
      const error = asRecord(body?.error);
      message = stringValue(error?.message) ?? message;
    } catch {
      // Error bodies are diagnostic only; status is enough for routing.
    }
    return this.classifyError({ status: response.status, message });
  }

  async discoverModels(signal: AbortSignal): Promise<ModelCandidate[]> {
    this.logger?.debug("provider.models.started", { endpoint: "models" });
    const response = await this.fetchImpl(this.endpoint("models"), {
      method: "GET",
      headers: this.headers(),
      signal,
    });
    if (!response.ok) throw await this.failureFromResponse(response);

    const body = asRecord(await response.json());
    const models = Array.isArray(body?.data) ? body.data : [];
    const candidates = models.flatMap((raw): ModelCandidate[] => {
      const model = asRecord(raw);
      const modelId = stringValue(model?.id);
      if (!modelId) return [];
      const context =
        numberValue(model?.context_length) ??
        numberValue(model?.max_context_length);
      const freeStatus =
        this.profile.source === "free_cloud" &&
        this.profile.isFreeModel &&
        !this.profile.isFreeModel(raw)
          ? { status: "paid_required" as const }
          : this.profile.freeStatus;
      return [
        {
          id: `${this.id}/${modelId}`,
          providerId: this.id,
          modelId,
          displayName: modelId,
          source: this.profile.source,
          capabilities: {
            tools: true,
            structuredOutput: true,
            reasoning: false,
            vision: false,
            ...(context === undefined ? {} : { maxContext: context }),
          },
          free: { ...freeStatus },
          privacy: { ...this.profile.privacy },
          quality: { confidence: "unknown" },
          health: { state: "unknown" },
        },
      ];
    });
    this.logger?.info("provider.models.finished", {
      count: candidates.length,
      responseCount: models.length,
    });
    return candidates;
  }

  async health(signal: AbortSignal): Promise<ProviderHealth> {
    const started = performance.now();
    this.logger?.debug("provider.health.started", { endpoint: "models" });
    try {
      const response = await this.fetchImpl(this.endpoint("models"), {
        method: "GET",
        headers: this.headers(),
        signal,
      });
      const latencyMs = Math.round(performance.now() - started);
      if (!response.ok) {
        const failure = await this.failureFromResponse(response);
        const result: ProviderHealth = {
          state: "down",
          latencyMs,
          failure,
        };
        this.logger?.warn("provider.health.finished", {
          state: result.state,
          latencyMs,
          status: response.status,
          failureCode: failure.code,
        });
        return result;
      }
      this.logger?.info("provider.health.finished", {
        state: "healthy",
        latencyMs,
      });
      return { state: "healthy", latencyMs };
    } catch (error) {
      const failure = this.classifyError(error);
      this.logger?.warn("provider.health.failed", {
        latencyMs: Math.round(performance.now() - started),
        code: failure.code,
        status: failure.status,
      });
      return {
        state: "down",
        latencyMs: Math.round(performance.now() - started),
        failure,
      };
    }
  }

  async quota(signal: AbortSignal) {
    const observedAt = new Date().toISOString();
    try {
      const response = await this.fetchImpl(this.endpoint("models"), {
        method: "GET",
        headers: this.headers(),
        signal,
      });
      if (!response.ok) throw await this.failureFromResponse(response);
      return parseQuotaHeaders(response.headers, {
        providerId: this.id,
        observedAt,
      });
    } catch {
      return {
        providerId: this.id,
        confidence: "unknown" as const,
        observedAt,
      };
    }
  }

  async *stream(
    request: NormalizedModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    const started = performance.now();
    this.logger?.info("provider.request.started", {
      endpoint: "chat/completions",
      modelId: request.modelId,
      messageCount: request.messages.length,
      toolCount: request.tools?.length ?? 0,
      toolChoice: request.toolChoice ?? "none",
      stream: request.stream,
    });
    try {
      const response = await this.fetchImpl(this.endpoint("chat/completions"), {
        method: "POST",
        headers: new Headers({
          ...Object.fromEntries(this.headers()),
          "content-type": "application/json",
        }),
        body: JSON.stringify({
          model: request.modelId,
          messages: request.messages.map(serializeMessage),
          ...(request.tools && request.tools.length > 0
            ? {
                tools: request.tools,
                ...(request.toolChoice
                  ? { tool_choice: request.toolChoice }
                  : {}),
              }
            : {}),
          ...(request.maxOutputTokens === undefined
            ? {}
            : { max_tokens: request.maxOutputTokens }),
          ...(request.temperature === undefined
            ? {}
            : { temperature: request.temperature }),
          stream: request.stream,
        }),
        signal,
      });
      this.logger?.info("provider.response.received", {
        endpoint: "chat/completions",
        modelId: request.modelId,
        status: response.status,
        ok: response.ok,
        durationMs: Math.round(performance.now() - started),
      });
      if (!response.ok) {
        const failure = await this.failureFromResponse(response);
        this.logger?.warn("provider.request.failed", {
          modelId: request.modelId,
          code: failure.code,
          status: failure.status,
        });
        yield {
          type: "error",
          error: failure,
        };
        return;
      }
      if (!response.body) {
        this.logger?.warn("provider.request.failed", {
          modelId: request.modelId,
          code: "UNKNOWN",
          reason: "missing response body",
        });
        yield {
          type: "error",
          error: providerError("UNKNOWN", "provider returned no stream body"),
        };
        return;
      }
      yield* this.readStream(response.body, signal);
      this.logger?.info("provider.stream.completed", {
        modelId: request.modelId,
        durationMs: Math.round(performance.now() - started),
      });
    } catch (error) {
      const failure = this.classifyError(error);
      this.logger?.warn("provider.request.failed", {
        modelId: request.modelId,
        code: failure.code,
        status: failure.status,
        durationMs: Math.round(performance.now() - started),
      });
      yield { type: "error", error: failure };
    }
  }

  private async *readStream(
    body: ReadableStream<Uint8Array>,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    const pendingToolCalls = new Map<number, ToolCall>();
    let buffer = "";
    let finished = false;

    try {
      while (!finished) {
        if (signal.aborted) {
          await reader.cancel();
          yield {
            type: "error",
            error: providerError("CANCELLED", "provider stream aborted"),
          };
          return;
        }
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value ?? new Uint8Array(), {
          stream: !chunk.done,
        });
        const frames = buffer.split(/\r?\n\r?\n/);
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          for (const event of this.parseFrame(frame, pendingToolCalls)) {
            if (event.type === "done") finished = true;
            yield event;
          }
        }
        if (chunk.done) {
          buffer += decoder.decode();
          if (buffer.trim()) {
            for (const event of this.parseFrame(buffer, pendingToolCalls))
              yield event;
          }
          for (const call of pendingToolCalls.values())
            yield { type: "tool.call", call };
          pendingToolCalls.clear();
          if (!finished) yield { type: "done" };
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private parseFrame(
    frame: string,
    pendingToolCalls: Map<number, ToolCall>,
  ): ProviderEvent[] {
    const events: ProviderEvent[] = [];
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trim())
      .join("\n");
    if (!data) return events;
    if (data === "[DONE]") {
      const calls = [...pendingToolCalls.values()].map((call) => ({
        type: "tool.call" as const,
        call,
      }));
      pendingToolCalls.clear();
      return [...calls, { type: "done" }];
    }

    let body: JsonRecord;
    try {
      const parsed: unknown = JSON.parse(data);
      const record = asRecord(parsed);
      if (!record)
        return [
          {
            type: "error",
            error: providerError(
              "BAD_REQUEST",
              "provider stream frame was not an object",
            ),
          },
        ];
      body = record;
    } catch {
      return [
        {
          type: "error",
          error: providerError(
            "BAD_REQUEST",
            "provider stream frame was malformed",
          ),
        },
      ];
    }

    const choices = Array.isArray(body.choices) ? body.choices : [];
    for (const choice of choices) {
      const delta = asRecord(asRecord(choice)?.delta);
      const text = stringValue(delta?.content);
      if (text) events.push({ type: "text.delta", text });
      const reasoning = stringValue(delta?.reasoning_content);
      if (reasoning) events.push({ type: "reasoning.delta", text: reasoning });
      const toolCalls = Array.isArray(delta?.tool_calls)
        ? delta.tool_calls
        : [];
      for (const rawTool of toolCalls) {
        const tool = asRecord(rawTool);
        const fn = asRecord(tool?.function);
        const index = numberValue(tool?.index) ?? pendingToolCalls.size;
        const previous = pendingToolCalls.get(index);
        const id = stringValue(tool?.id) ?? previous?.id;
        const name = stringValue(fn?.name) ?? previous?.name;
        const args =
          (previous?.arguments ?? "") + (stringValue(fn?.arguments) ?? "");
        if (id && name)
          pendingToolCalls.set(index, { id, name, arguments: args });
      }
      if (stringValue(asRecord(choice)?.finish_reason) === "tool_calls") {
        for (const call of pendingToolCalls.values())
          events.push({ type: "tool.call", call });
        pendingToolCalls.clear();
      }
    }

    const usageBody = asRecord(body.usage);
    if (usageBody) {
      const inputTokens = numberValue(usageBody.prompt_tokens) ?? 0;
      const outputTokens = numberValue(usageBody.completion_tokens) ?? 0;
      const totalTokens =
        numberValue(usageBody.total_tokens) ?? inputTokens + outputTokens;
      const usage: Usage = { inputTokens, outputTokens, totalTokens };
      events.push({ type: "usage", usage });
    }

    return events;
  }

  classifyError(error: unknown): ProviderFailure {
    if (this.isProviderFailure(error)) return error;
    if (error instanceof DOMException && error.name === "AbortError")
      return providerError("CANCELLED", "provider request aborted");
    const record = asRecord(error);
    const status = numberValue(record?.status);
    const message =
      stringValue(record?.message) ??
      (error instanceof Error ? error.message : "provider request failed");
    const lower = message.toLowerCase();

    if (status === 401)
      return providerError(
        this.profile.apiKey ? "AUTH_INVALID" : "AUTH_MISSING",
        message,
        status,
      );
    if (
      status === 402 ||
      lower.includes("payment") ||
      lower.includes("billing") ||
      lower.includes("paid plan")
    )
      return providerError("PAID_PLAN_REQUIRED", message, status);
    if (status === 403) return providerError("AUTH_INVALID", message, status);
    if (status === 404)
      return providerError("MODEL_NOT_FOUND", message, status);
    if (status === 408) return providerError("TIMEOUT", message, status);
    if (status === 413 || lower.includes("context"))
      return providerError("CONTEXT_TOO_LARGE", message, status);
    if (status === 429) {
      const code: ProviderFailureCode = lower.includes("daily")
        ? "DAILY_QUOTA_EXHAUSTED"
        : lower.includes("free")
          ? "FREE_TIER_EXHAUSTED"
          : "RATE_LIMIT_BURST";
      return providerError(code, message, status);
    }
    if (status !== undefined && status >= 500)
      return providerError("CAPACITY", message, status);
    if (error instanceof TypeError)
      return providerError("NETWORK", message, status);
    if (status !== undefined && status >= 400)
      return providerError("BAD_REQUEST", message, status);
    return providerError("UNKNOWN", message, status);
  }

  private isProviderFailure(error: unknown): error is ProviderFailure {
    const record = asRecord(error);
    return (
      typeof record?.code === "string" && typeof record.message === "string"
    );
  }
}
