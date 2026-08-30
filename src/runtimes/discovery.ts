import type { FetchLike } from "../providers/types.js";
import { readProductEnv } from "../product/identity.js";
import { OllamaRuntime } from "./ollama.js";
import { OpenAICompatibleLocalRuntime } from "./http.js";
import type { LocalRuntimeAdapter, RuntimeDetection } from "./types.js";
import type { LocalCodeLogger } from "../shared/logging.js";

export interface RuntimeDiscoveryResult {
  adapters: LocalRuntimeAdapter[];
  detections: RuntimeDetection[];
  models: import("../shared/types.js").ModelCandidate[];
}

export function createLocalRuntimeAdapters(
  env: Record<string, string | undefined> = process.env,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  logger?: LocalCodeLogger,
): LocalRuntimeAdapter[] {
  const ollamaUrl =
    readProductEnv(env, "OLLAMA_URL") ?? "http://127.0.0.1:11434";
  const openAiBaseUrl = readProductEnv(env, "OPENAI_BASE_URL");
  const lmStudioUrl =
    readProductEnv(env, "LM_STUDIO_URL") ?? "http://127.0.0.1:1234/v1";
  const llamaCppUrl =
    readProductEnv(env, "LLAMA_CPP_URL") ?? "http://127.0.0.1:8080/v1";
  const adapters: LocalRuntimeAdapter[] = [
    new OllamaRuntime(ollamaUrl, fetchImpl, logger),
  ];
  if (openAiBaseUrl) {
    adapters.push(
      new OpenAICompatibleLocalRuntime(
        "local-openai",
        "OpenAI-compatible local endpoint",
        openAiBaseUrl,
        fetchImpl,
        logger,
      ),
    );
  }
  adapters.push(
    new OpenAICompatibleLocalRuntime(
      "lm-studio",
      "LM Studio",
      lmStudioUrl,
      fetchImpl,
      logger,
    ),
  );
  adapters.push(
    new OpenAICompatibleLocalRuntime(
      "llama.cpp",
      "llama.cpp server",
      llamaCppUrl,
      fetchImpl,
      logger,
    ),
  );
  return adapters;
}

export async function discoverLocalRuntimes(
  adapters: LocalRuntimeAdapter[],
  signal?: AbortSignal,
  logger?: LocalCodeLogger,
): Promise<RuntimeDiscoveryResult> {
  logger?.debug("runtime.discovery.started", {
    adapterCount: adapters.length,
  });
  const results = await Promise.all(
    adapters.map(async (adapter) => ({
      adapter,
      detection: await adapter.detect(signal),
      models: await adapter.listModels(signal),
    })),
  );
  const result = {
    adapters,
    detections: results.map((result) => result.detection),
    models: results.flatMap((result) => result.models),
  };
  logger?.info("runtime.discovery.finished", {
    installedCount: result.detections.filter((item) => item.installed).length,
    modelCount: result.models.length,
  });
  return result;
}
