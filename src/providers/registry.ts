import {
  EnvironmentCredentialStore,
  envBoolean,
  type CredentialStore,
} from "../config/credentials.js";
import { GenericOpenAICompatibleProvider } from "./openai-compatible.js";
import type { FetchLike, ProviderAdapter, ProviderProfile } from "./types.js";
import type { LocalCodeLogger } from "../shared/logging.js";

export interface ProviderStatus {
  id: string;
  displayName: string;
  configured: boolean;
  source: "free_cloud" | "paid_cloud";
  freeStatus: string;
  privacy: string;
  endpoint: string;
  note: string;
}

export interface ProviderRegistry {
  adapters: ProviderAdapter[];
  statuses: ProviderStatus[];
}

function freshness(
  env: Record<string, string | undefined>,
  confirmationKey: string,
): ProviderProfile["freeStatus"] {
  if (!envBoolean(env, confirmationKey)) return { status: "unknown" };
  return expiringFreeStatus("verified_free", 24 * 60 * 60 * 1_000);
}

function expiringFreeStatus(
  status: "verified_free" | "free_quota",
  ttlMs: number,
): ProviderProfile["freeStatus"] {
  const verifiedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();
  return { status, verifiedAt, expiresAt };
}

function privacy(
  env: Record<string, string | undefined>,
  confirmationKey: string,
): ProviderProfile["privacy"] {
  if (!envBoolean(env, confirmationKey)) {
    return { classification: "unknown", retentionKnown: false };
  }
  return {
    classification: "zdr_capable",
    retentionKnown: true,
    zdrAvailable: true,
    trainsOnInputs: false,
    verifiedAt: new Date().toISOString(),
  };
}

function openRouterFreeModel(model: unknown): boolean {
  if (typeof model !== "object" || model === null || Array.isArray(model))
    return false;
  const value = model as Record<string, unknown>;
  const id = typeof value.id === "string" ? value.id : "";
  const pricing =
    typeof value.pricing === "object" && value.pricing !== null
      ? (value.pricing as Record<string, unknown>)
      : undefined;
  const promptPrice =
    typeof pricing?.prompt === "string" ? Number(pricing.prompt) : Number.NaN;
  const completionPrice =
    typeof pricing?.completion === "string"
      ? Number(pricing.completion)
      : Number.NaN;
  return (
    id === "openrouter/free" ||
    id.endsWith(":free") ||
    (Number.isFinite(promptPrice) &&
      promptPrice === 0 &&
      Number.isFinite(completionPrice) &&
      completionPrice === 0)
  );
}

function freeStatusFor(
  env: Record<string, string | undefined>,
  id: string,
  source: ProviderProfile["source"],
  apiKey: string | undefined,
): ProviderProfile["freeStatus"] {
  if (source !== "free_cloud") return { status: "paid_required" };
  if (!apiKey) return { status: "unknown" };

  // OpenRouter's free variants are model-level guarantees. A configured key
  // is enough to expose only those variants; no paid model is ever catalogued.
  if (id === "openrouter")
    return expiringFreeStatus("verified_free", 24 * 60 * 60 * 1_000);

  // Groq has a no-payment Free plan, but its request/token allowance is
  // volatile and account dependent. Treat it as quota-bearing, not unlimited.
  // An explicit confirmation can promote the status to verified_free while
  // retaining the same strict-zero and privacy gates.
  if (id === "groq") {
    return envBoolean(env, "GROQ_FREE_CONFIRMED")
      ? freshness(env, "GROQ_FREE_CONFIRMED")
      : expiringFreeStatus("free_quota", 15 * 60 * 1_000);
  }

  const freeConfirmation = `${id.toUpperCase()}_FREE_CONFIRMED`;
  return freshness(env, freeConfirmation);
}

function profile(
  env: Record<string, string | undefined>,
  id: string,
  displayName: string,
  baseUrl: string,
  source: ProviderProfile["source"],
  key: string,
  apiKey?: string,
): ProviderProfile {
  const zdrConfirmation = `${id.toUpperCase()}_ZDR_CONFIRMED`;
  const resolvedApiKey = apiKey ?? (env[key]?.trim() || undefined);
  return {
    id,
    displayName,
    baseUrl,
    source,
    freeStatus: freeStatusFor(env, id, source, resolvedApiKey),
    privacy:
      source === "free_cloud"
        ? privacy(env, zdrConfirmation)
        : { classification: "unknown", retentionKnown: false },
    ...(resolvedApiKey ? { apiKey: resolvedApiKey } : {}),
    ...(id === "openrouter"
      ? { isFreeModel: openRouterFreeModel, freeOnly: true }
      : {}),
  };
}

export async function createProviderRegistry(
  env: Record<string, string | undefined> = process.env,
  credentials: CredentialStore = new EnvironmentCredentialStore(env),
  fetchImpl?: FetchLike,
  logger?: LocalCodeLogger,
): Promise<ProviderRegistry> {
  const definitions = [
    {
      id: "groq",
      displayName: "Groq",
      baseUrl: "https://api.groq.com/openai/v1",
      source: "free_cloud" as const,
      key: "GROQ_API_KEY",
    },
    {
      id: "openrouter",
      displayName: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      source: "free_cloud" as const,
      key: "OPENROUTER_API_KEY",
    },
    {
      id: "opencode",
      displayName: "OpenCode / Zen",
      baseUrl: "https://api.opencode.ai/v1",
      source: "paid_cloud" as const,
      key: "OPENCODE_API_KEY",
    },
  ];
  const adapters: ProviderAdapter[] = [];
  const statuses: ProviderStatus[] = [];
  for (const definition of definitions) {
    const apiKey = await credentials.get(definition.id);
    const configuredProfile = profile(
      env,
      definition.id,
      definition.displayName,
      definition.baseUrl,
      definition.source,
      definition.key,
      apiKey,
    );
    const providerProfile = {
      ...configuredProfile,
      ...(logger ? { logger } : {}),
    };
    statuses.push({
      id: definition.id,
      displayName: definition.displayName,
      configured: Boolean(apiKey),
      source: definition.source,
      freeStatus: providerProfile.freeStatus.status,
      privacy: providerProfile.privacy.classification,
      endpoint: definition.baseUrl,
      note:
        definition.id === "opencode"
          ? "Paid per-request service; never selected by strict-zero."
          : !apiKey
            ? "Not configured; set the provider API key. No paid account is required for this route."
            : definition.id === "openrouter"
              ? "Only OpenRouter models explicitly marked free are exposed; paid variants and fallback are filtered out."
              : "Groq Free tier enabled; rate limits may stop the route and no paid upgrade or fallback is automatic.",
    });
    if (apiKey)
      adapters.push(new GenericOpenAICompatibleProvider(providerProfile));
  }
  if (fetchImpl) {
    for (const adapter of adapters) {
      // Recreate adapters with the injected transport so contract and offline tests never need network access.
      const status = statuses.find((item) => item.id === adapter.id);
      if (!status) continue;
      const definition = definitions.find((item) => item.id === adapter.id);
      if (!definition) continue;
      const apiKey = await credentials.get(definition.id);
      adapters[adapters.indexOf(adapter)] = new GenericOpenAICompatibleProvider(
        {
          ...profile(
            env,
            definition.id,
            definition.displayName,
            definition.baseUrl,
            definition.source,
            definition.key,
            apiKey,
          ),
          ...(logger ? { logger } : {}),
          fetchImpl,
        },
      );
    }
  }
  return { adapters, statuses };
}
