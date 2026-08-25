import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  readRepositorySettings,
  readSettings,
  type LocalCodeSettings,
} from "../config/settings.js";
import { LlmfitHardwareIntelligence } from "../hardware/llmfit.js";
import type {
  HardwareInspection,
  LocalModelRecommendation,
} from "../hardware/types.js";
import {
  createProviderRegistry,
  type ProviderRegistry,
} from "../providers/registry.js";
import type { FetchLike, ProviderAdapter } from "../providers/types.js";
import {
  discoverLocalRuntimes,
  createLocalRuntimeAdapters,
  type RuntimeDiscoveryResult,
} from "../runtimes/discovery.js";
import type { ModelCandidate } from "../shared/types.js";
import { runCommand } from "../shared/process.js";
import { createLogger, type LocalCodeLogger } from "../shared/logging.js";
import { LocalCodeDatabase } from "../storage/database.js";
import {
  AGENT_CAPABILITY_PROBE_VERSION,
  probeLocalModelCapabilities,
} from "../agent/capability-probe.js";
import { isCapabilityProbeCurrent } from "../agent/capability-cache.js";
import type {
  QuotaSnapshot,
  RepositoryPrivacy,
  RoutingMode,
} from "../shared/types.js";

export interface ControlPlane {
  root: string;
  statePath: string;
  settings: LocalCodeSettings;
  db: LocalCodeDatabase;
  hardware: LlmfitHardwareIntelligence;
  providers: ProviderRegistry;
  logger: LocalCodeLogger;
  inspectHardware(signal?: AbortSignal): Promise<HardwareInspection>;
  discoverRuntimes(signal?: AbortSignal): Promise<RuntimeDiscoveryResult>;
  discoverModels(
    signal?: AbortSignal,
    options?: { probeLocalCapabilities?: boolean },
  ): Promise<{
    recommendations: LocalModelRecommendation[];
    models: ModelCandidate[];
    runtime: RuntimeDiscoveryResult;
    quotas: Record<string, QuotaSnapshot>;
  }>;
  close(): void;
}

export interface ControlPlaneOptions {
  env?: Record<string, string | undefined>;
  dbFilename?: string;
  fetchImpl?: FetchLike;
}

async function stateLocation(
  env: Record<string, string | undefined>,
): Promise<string> {
  const directory =
    env.LOCALCODE_STATE_DIR?.trim() || path.join(os.homedir(), ".localcode");
  await mkdir(directory, { recursive: true });
  return path.join(directory, "state.sqlite");
}

function recommendationCandidate(
  recommendation: LocalModelRecommendation,
): ModelCandidate {
  return {
    id: `llmfit/${recommendation.id}`,
    providerId: "llmfit",
    displayName: recommendation.displayName,
    source: "local",
    capabilities: {
      tools: recommendation.toolCapability ?? true,
      structuredOutput: true,
      reasoning: false,
      vision: false,
      ...(recommendation.context === undefined
        ? {}
        : { maxContext: recommendation.context }),
    },
    free: { status: "verified_free" },
    privacy: {
      classification: "local",
      retentionKnown: true,
      trainsOnInputs: false,
    },
    quality: {
      coding: recommendation.fit === "BEST" ? 0.9 : 0.65,
      toolUse: 0.65,
      confidence: "reported",
    },
    health: { state: "unknown" },
    local: {
      runtime: recommendation.runtime ?? "llmfit",
      ...(recommendation.quantization
        ? { quant: recommendation.quantization }
        : {}),
      ...(recommendation.estimatedMemoryGb === undefined
        ? {}
        : { memoryRequiredGb: recommendation.estimatedMemoryGb }),
      ...(recommendation.estimatedTps === undefined
        ? {}
        : { estimatedTps: recommendation.estimatedTps }),
      ...(recommendation.fit ? { fit: recommendation.fit } : {}),
    },
  };
}

export async function openControlPlane(
  root = process.cwd(),
  options: ControlPlaneOptions = {},
): Promise<ControlPlane> {
  const env = options.env ?? process.env;
  const logger = createLogger({
    env,
    context: { component: "control-plane" },
  });
  const statePath = options.dbFilename ?? (await stateLocation(env));
  const db = new LocalCodeDatabase(statePath, logger);
  const hardware = new LlmfitHardwareIntelligence(undefined, logger);
  const providers = await createProviderRegistry(
    env,
    undefined,
    options.fetchImpl,
    logger,
  );
  const runtimeAdapters = createLocalRuntimeAdapters(
    env,
    options.fetchImpl,
    logger,
  );
  const environmentSettings = readSettings(env);
  const repositorySettings = await readRepositorySettings(root);
  const storedPrivacy = db.getSetting("privacy.policy");
  const storedRouting = db.getSetting("routing.mode");
  const settings = {
    ...environmentSettings,
    privacy:
      repositorySettings.privacy ??
      (storedPrivacy === "local_only" ||
      storedPrivacy === "private_zdr_only" ||
      storedPrivacy === "private" ||
      storedPrivacy === "trusted_cloud" ||
      storedPrivacy === "public_free"
        ? (storedPrivacy as RepositoryPrivacy)
        : environmentSettings.privacy),
    routingMode:
      repositorySettings.routingMode ??
      (storedRouting === "strict-zero" || storedRouting === "ask-before-paid"
        ? (storedRouting as RoutingMode)
        : environmentSettings.routingMode),
    permissionMode:
      repositorySettings.permissionMode ?? environmentSettings.permissionMode,
  };
  logger.info("control-plane.opened", {
    root,
    statePath,
    privacy: settings.privacy,
    routingMode: settings.routingMode,
  });
  return {
    root,
    statePath,
    settings,
    db,
    hardware,
    providers,
    logger,
    async inspectHardware(signal) {
      logger.debug("hardware.inspect.started", {});
      try {
        const result = await hardware.inspect(signal);
        logger.info("hardware.inspect.finished", {
          llmfitAvailable: result.llmfitAvailable,
          memoryGb: result.profile.memoryGb,
          accelerator: result.profile.accelerator,
        });
        return result;
      } catch (error) {
        logger.error("hardware.inspect.failed", {
          errorType: error instanceof Error ? error.name : "unknown",
        });
        throw error;
      }
    },
    async discoverRuntimes(signal) {
      logger.debug("runtime.discovery.started", {
        adapterCount: runtimeAdapters.length,
      });
      const result = await discoverLocalRuntimes(
        runtimeAdapters,
        signal,
        logger,
      );
      logger.info("runtime.discovery.finished", {
        installedCount: result.detections.filter((item) => item.installed)
          .length,
        modelCount: result.models.length,
      });
      return result;
    },
    async discoverModels(signal, options = {}) {
      logger.info("models.discovery.started", {
        probeLocalCapabilities: options.probeLocalCapabilities === true,
      });
      const probeSignal = signal ?? AbortSignal.timeout(2_000);
      const [recommendations, runtime, hardwareInspection] = await Promise.all([
        hardware.recommendCodingModels(
          { useCase: "coding", limit: 10 },
          probeSignal,
        ),
        discoverLocalRuntimes(runtimeAdapters, probeSignal, logger),
        options.probeLocalCapabilities
          ? hardware.inspect(probeSignal)
          : Promise.resolve(undefined),
      ]);
      const remoteModels: ModelCandidate[] = [];
      const quotas: Record<string, QuotaSnapshot> = {};
      await Promise.all(
        providers.adapters.map(async (provider) => {
          try {
            const [models, health, quota] = await Promise.all([
              provider.discoverModels(probeSignal),
              provider.health(probeSignal),
              provider.quota(probeSignal),
            ]);
            db.recordQuota(quota);
            quotas[provider.id] = quota;
            remoteModels.push(
              ...models.map((model) => ({
                ...model,
                health: {
                  state: health.state,
                  ...(health.latencyMs === undefined
                    ? {}
                    : { latencyMs: health.latencyMs }),
                },
              })),
            );
          } catch (error) {
            logger.warn("provider.discovery.failed", {
              providerId: provider.id,
              errorType: error instanceof Error ? error.name : "unknown",
            });
            // Provider readiness remains visible through `providers`; a failed optional probe must not crash models.
          }
        }),
      );
      const discoveredModels = [
        ...recommendations.map(recommendationCandidate),
        ...runtime.models,
        ...remoteModels,
      ];
      let models = discoveredModels;
      if (options.probeLocalCapabilities) {
        const localProviders = runtime.adapters.flatMap((adapter) => {
          const provider = adapter.provider?.();
          return provider ? [provider] : [];
        });
        const cached = new Map<string, ModelCandidate["agentProbe"]>();
        const pending: ModelCandidate[] = [];
        const cacheMaxAgeMs = 24 * 60 * 60 * 1_000;
        for (const candidate of discoveredModels) {
          if (candidate.source !== "local") {
            pending.push(candidate);
            continue;
          }
          const stored = db.getModelCapability(
            candidate.providerId,
            candidate.modelId ?? candidate.displayName,
          );
          const observedAt = stored
            ? new Date(stored.observedAt).getTime()
            : Number.NaN;
          if (
            stored &&
            stored.version === AGENT_CAPABILITY_PROBE_VERSION &&
            Number.isFinite(observedAt) &&
            Date.now() - observedAt <= cacheMaxAgeMs &&
            isCapabilityProbeCurrent(
              candidate,
              stored.probe,
              hardwareInspection?.profile,
            )
          )
            cached.set(candidate.id, stored.probe);
          else pending.push(candidate);
        }
        const probed = await probeLocalModelCapabilities(
          pending,
          localProviders,
          probeSignal,
          root,
          { hardware: hardwareInspection?.profile, logger },
        );
        const fresh = new Map(
          probed.map((candidate) => [candidate.id, candidate]),
        );
        for (const candidate of probed)
          if (candidate.source === "local" && candidate.agentProbe)
            db.saveModelCapability(
              candidate.providerId,
              candidate.modelId ?? candidate.displayName,
              candidate.agentProbe,
            );
        models = discoveredModels.map((candidate) => {
          const cachedProbe = cached.get(candidate.id);
          if (cachedProbe)
            return {
              ...candidate,
              agentProbe: cachedProbe,
              quality: {
                ...candidate.quality,
                toolUse: cachedProbe.readTool ? 1 : 0,
                confidence: "measured" as const,
              },
            };
          return fresh.get(candidate.id) ?? candidate;
        });
      }
      logger.info("models.discovery.finished", {
        recommendationCount: recommendations.length,
        modelCount: models.length,
        localCount: models.filter((model) => model.source === "local").length,
        remoteCount: models.filter((model) => model.source !== "local").length,
        quotaProviderCount: Object.keys(quotas).length,
      });
      return {
        recommendations,
        models,
        runtime,
        quotas,
      };
    },
    close() {
      db.close();
    },
  };
}

export async function commandAvailable(command: string): Promise<boolean> {
  try {
    const result = await runCommand(command, ["--version"], {
      timeoutMs: 3_000,
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
