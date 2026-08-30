import { createHash } from "node:crypto";
import type { EvaluationRunStore } from "./artifact-store.js";
import type {
  NormalizedModelRequest,
  ProviderAdapter,
  ProviderEvent,
} from "../providers/types.js";

function toolSurface(request: NormalizedModelRequest): {
  digest: string;
  names: string[];
  count: number;
} {
  const serialized = JSON.stringify(request.tools ?? []);
  const names = (request.tools ?? []).flatMap((tool) => {
    if (typeof tool !== "object" || tool === null || Array.isArray(tool))
      return [];
    const value = tool as Record<string, unknown>;
    const fn = value.function;
    if (typeof fn !== "object" || fn === null || Array.isArray(fn)) return [];
    const name = (fn as Record<string, unknown>).name;
    return typeof name === "string" ? [name] : [];
  });
  return {
    digest: createHash("sha256").update(serialized).digest("hex"),
    names,
    count: (request.tools ?? []).length,
  };
}

function recordableProviderEvent(event: ProviderEvent): unknown {
  if (event.type === "reasoning.delta")
    return { type: event.type, chars: event.text.length };
  return event;
}

export function evaluationProviderRequestPayload(
  request: NormalizedModelRequest,
): unknown {
  return {
    modelId: request.modelId,
    messages: request.messages,
    toolChoice: request.toolChoice ?? null,
    temperature: request.temperature ?? null,
    maxOutputTokens: request.maxOutputTokens ?? null,
    reasoningEffort: request.reasoningEffort ?? null,
    stream: request.stream,
    toolSurface: toolSurface(request),
  };
}

export function recordProviderAdapter(
  provider: ProviderAdapter,
  store: EvaluationRunStore,
): ProviderAdapter {
  return {
    id: provider.id,
    displayName: provider.displayName,
    discoverModels: (signal) => provider.discoverModels(signal),
    health: (signal) => provider.health(signal),
    quota: (signal) => provider.quota(signal),
    classifyError: (error) => provider.classifyError(error),
    async *stream(request, signal) {
      await store.appendObservation({
        origin: "provider",
        kind: "provider.request",
        payload: evaluationProviderRequestPayload(request),
      });
      try {
        const events = provider.stream(request, signal);
        for await (const event of events) {
          await store.appendObservation({
            origin: "provider",
            kind: "provider.event",
            payload: recordableProviderEvent(event),
          });
          yield event;
        }
      } catch (error) {
        await store.appendObservation({
          origin: "provider",
          kind: "provider.exception",
          payload: {
            name: error instanceof Error ? error.name : "UnknownError",
            message: error instanceof Error ? error.message : String(error),
          },
        });
        throw error;
      }
    },
  };
}
