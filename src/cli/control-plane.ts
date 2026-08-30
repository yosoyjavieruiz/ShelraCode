import { mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  readRepositorySettings,
  readSettings,
  type LocalCodeSettings,
} from "../config/settings.js";
import {
  PRODUCT_STATE_DIR_NAME,
  readProductEnv,
} from "../product/identity.js";
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
  driverProfileFromCapabilityProbe,
  probeFreeCloudModelCapabilities,
  probeLocalModelCapabilities,
} from "../agent/capability-probe.js";
import {
  isCapabilityProbeCurrent,
  isCapabilityProbeFailure,
} from "../agent/capability-cache.js";
import type {
  AgentCapabilityClass,
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
    options?: {
      probeLocalCapabilities?: boolean;
      /**
       * Run the slower disposable edit/test exercise. Normal route discovery
       * only needs the protocol probe; the host still verifies every real
       * mutation. Keep this opt-in so a local task does not spend its entire
       * startup budget proving an advanced role it may not need.
       */
      probeLocalExecutableCapabilities?: boolean;
      /** Probe a bounded set of verified-free remote candidates for tools. */
      probeFreeCloudCapabilities?: boolean;
      requiredCapability?: AgentCapabilityClass;
      preferredModelId?: string;
    },
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
    readProductEnv(env, "STATE_DIR") ||
    path.join(os.homedir(), PRODUCT_STATE_DIR_NAME);
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

const CAPABILITY_RANK: Record<AgentCapabilityClass, number> = {
  chat_only: 0,
  workspace_reader: 1,
  coding_agent: 2,
  advanced_coding_agent: 3,
};

function hasRequiredCapability(
  candidate: ModelCandidate,
  required: AgentCapabilityClass | undefined,
): boolean {
  if (!required || required === "chat_only") return true;
  const actual = candidate.agentProbe?.agentCapabilityClass;
  return (
    actual !== undefined && CAPABILITY_RANK[actual] >= CAPABILITY_RANK[required]
  );
}

function isPreferredModel(
  candidate: ModelCandidate,
  preferredModelId: string | undefined,
): boolean {
  if (!preferredModelId?.trim()) return false;
  const preferred = preferredModelId.trim();
  return candidate.id === preferred || candidate.modelId === preferred;
}

function selectFreeCloudProbeTargets(
  candidates: readonly ModelCandidate[],
  required: AgentCapabilityClass | undefined,
  preferredModelId: string | undefined,
): ModelCandidate[] {
  if (
    candidates.some(
      (candidate) =>
        candidate.source === "local" &&
        hasRequiredCapability(candidate, required),
    )
  )
    return [];

  const ordered = candidates
    .filter(
      (candidate) =>
        candidate.source === "free_cloud" &&
        (candidate.free.status === "verified_free" ||
          candidate.free.status === "free_quota"),
    )
    .sort((left, right) => {
      const leftPreferred =
        left.id === preferredModelId || left.modelId === preferredModelId;
      const rightPreferred =
        right.id === preferredModelId || right.modelId === preferredModelId;
      if (leftPreferred !== rightPreferred) return leftPreferred ? -1 : 1;
      return (
        (right.quality.coding ?? 0) - (left.quality.coding ?? 0) ||
        left.id.localeCompare(right.id)
      );
    });
  const selected: ModelCandidate[] = [];
  const providers = new Set<string>();
  for (const candidate of ordered) {
    // One probe per provider keeps a model catalog refresh bounded and avoids
    // burning a free quota on every catalog entry.
    if (providers.has(candidate.providerId)) continue;
    providers.add(candidate.providerId);
    selected.push(candidate);
  }
  return selected;
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
    permissionRules:
      repositorySettings.permissionRules ?? environmentSettings.permissionRules,
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
        probeLocalExecutableCapabilities:
          options.probeLocalExecutableCapabilities === true,
        probeFreeCloudCapabilities: options.probeFreeCloudCapabilities === true,
        requiredCapability: options.requiredCapability,
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
        const lastKnown = new Map<string, ModelCandidate["agentProbe"]>();
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
          if (stored) lastKnown.set(candidate.id, stored.probe);
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
        // Probe loaded models in parallel. A sequential probe let one
        // unsuitable loaded model consume the entire shared budget before a
        // second loaded model with real tool support was ever measured. Do
        // not JIT-load the whole catalog just to score a route: when nothing
        // is loaded, probe only a small preferred prefix and let the runtime
        // decide whether it can serve those candidates.
        const orderedPending = [...pending].sort((left, right) => {
          const leftPreferred = isPreferredModel(left, options.preferredModelId)
            ? 0
            : 1;
          const rightPreferred = isPreferredModel(
            right,
            options.preferredModelId,
          )
            ? 0
            : 1;
          if (leftPreferred !== rightPreferred)
            return leftPreferred - rightPreferred;
          const leftLoaded = left.local?.loaded === true ? 0 : 1;
          const rightLoaded = right.local?.loaded === true ? 0 : 1;
          return leftLoaded - rightLoaded;
        });
        const loadedPending = orderedPending.filter(
          (candidate) => candidate.local?.loaded === true,
        );
        const hasReusableCodingRoute = [...cached.values()].some(
          (probe) => probe?.agenticCodingEligible === true,
        );
        // An explicit picker choice is a request to measure that exact
        // model, not merely a display preference. A reusable coding route may
        // still remain the safe fallback if the selected candidate cannot be
        // served, but it must not suppress the selected candidate's probe.
        const preferredPending = orderedPending.find((candidate) =>
          isPreferredModel(candidate, options.preferredModelId),
        );
        // A loaded but never-probed model must be measured even when a
        // cached unloaded model already looks like a coding route. Otherwise
        // the currently loaded model (e.g. qwen3-8b) stays UNPROBED while the
        // router keeps advertising a stale cached model that is not resident,
        // producing the intermittent "capability evidence is unavailable" STOP
        // when the user picks the loaded model.
        const loadedUnprobed = loadedPending.filter(
          (candidate) => !cached.has(candidate.id),
        );
        const defaultProbeTargets =
          loadedUnprobed.length > 0
            ? loadedUnprobed
            : hasReusableCodingRoute
              ? []
              : loadedPending.length > 0
                ? loadedPending
                : orderedPending.slice(0, 3);
        const probeTargets = [
          ...(preferredPending ? [preferredPending] : []),
          ...defaultProbeTargets,
        ].filter(
          (candidate, index, all) =>
            all.findIndex((item) => item.id === candidate.id) === index,
        );
        const probed = (
          await Promise.all(
            probeTargets.map((candidate) =>
              probeLocalModelCapabilities(
                [candidate],
                localProviders,
                probeSignal,
                options.probeLocalExecutableCapabilities ? root : undefined,
                { hardware: hardwareInspection?.profile, logger },
              ),
            ),
          )
        ).flat();
        // A transport failure is not a capability result. Keep failed probes
        // out of the fresh catalog as well as out of SQLite; otherwise the
        // later merge would still turn a timeout into a synthetic
        // `chat_only` candidate and the router would stop a local task before
        // the safe discovery route can run.
        const fresh = new Map(
          probed
            .filter(
              (candidate) => !isCapabilityProbeFailure(candidate.agentProbe),
            )
            .map((candidate) => [candidate.id, candidate]),
        );
        const recovered = new Map<string, ModelCandidate["agentProbe"]>();
        for (const candidate of probed)
          if (candidate.source === "local" && candidate.agentProbe) {
            if (isCapabilityProbeFailure(candidate.agentProbe)) {
              const previous = lastKnown.get(candidate.id);
              if (
                previous &&
                isCapabilityProbeCurrent(
                  candidate,
                  previous,
                  hardwareInspection?.profile,
                )
              ) {
                recovered.set(candidate.id, {
                  ...previous,
                  notes: [
                    ...previous.notes,
                    "Current capability probe failed; using last-known measured evidence and retrying later.",
                  ],
                });
                logger.warn("capability.probe.last_known_reused", {
                  candidateId: candidate.id,
                  providerId: candidate.providerId,
                  reason: "transient_probe_failure",
                });
              } else {
                logger.warn("capability.probe.not_persisted", {
                  candidateId: candidate.id,
                  providerId: candidate.providerId,
                  reason: "transient_probe_failure_without_compatible_history",
                });
              }
              continue;
            }
            db.saveModelCapability(
              candidate.providerId,
              candidate.modelId ?? candidate.displayName,
              candidate.agentProbe,
            );
            // Closes the gap that made write authority permanently
            // unreachable: `driverProfileCanWrite` requires a
            // `status: "certified"` profile, and nothing ever produced
            // one -- every real EditFile/WriteFile/CreateFile failed with
            // "requires a current certified Driver profile" for every
            // model, always, regardless of how capable the model actually
            // was. See driverProfileFromCapabilityProbe's doc comment.
            try {
              const driverProfile = driverProfileFromCapabilityProbe(
                candidate,
                candidate.agentProbe,
              );
              if (driverProfile) db.saveModelDriverProfile(driverProfile);
            } catch (error) {
              logger.warn("driver_profile.certification_failed", {
                candidateId: candidate.id,
                providerId: candidate.providerId,
                error: error instanceof Error ? error.message : String(error),
              });
            }
          }
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
          const recoveredProbe = recovered.get(candidate.id);
          if (recoveredProbe)
            return {
              ...candidate,
              agentProbe: recoveredProbe,
              quality: {
                ...candidate.quality,
                toolUse: recoveredProbe.readTool ? 1 : 0,
                confidence: "measured" as const,
              },
            };
          return fresh.get(candidate.id) ?? candidate;
        });
      }
      if (options.probeFreeCloudCapabilities) {
        const targets = selectFreeCloudProbeTargets(
          models,
          options.requiredCapability,
          options.preferredModelId,
        );
        if (targets.length > 0) {
          const cached = new Map<string, ModelCandidate["agentProbe"]>();
          const pending: ModelCandidate[] = [];
          const cacheMaxAgeMs = 24 * 60 * 60 * 1_000;
          for (const candidate of targets) {
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
              isCapabilityProbeCurrent(candidate, stored.probe)
            )
              cached.set(candidate.id, stored.probe);
            else pending.push(candidate);
          }
          const probed = await probeFreeCloudModelCapabilities(
            pending,
            providers.adapters,
            probeSignal,
            { logger },
          );
          const fresh = new Map(
            probed.map((candidate) => [candidate.id, candidate]),
          );
          for (const candidate of probed)
            if (candidate.source === "free_cloud" && candidate.agentProbe)
              db.saveModelCapability(
                candidate.providerId,
                candidate.modelId ?? candidate.displayName,
                candidate.agentProbe,
              );
          models = models.map((candidate) => {
            const cachedProbe = cached.get(candidate.id);
            const probedCandidate = fresh.get(candidate.id);
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
            return probedCandidate ?? candidate;
          });
          logger.info("capability.free_cloud.finished", {
            candidateCount: targets.length,
            probedCount: pending.length,
            cachedCount: cached.size,
          });
        } else {
          logger.debug("capability.free_cloud.skipped", {
            reason: "eligible_local_route_or_no_verified_free_candidate",
          });
        }
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
      intent: "read",
      timeoutMs: 3_000,
    });
    return result.exitCode === 0;
  } catch {
    return false;
  }
}
