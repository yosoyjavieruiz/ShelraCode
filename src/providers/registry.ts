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
  const verifiedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000).toISOString();
  return { status: "verified_free", verifiedAt, expiresAt };
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
  return (
    id.endsWith(":free") ||
    (pricing?.prompt === "0" && pricing?.completion === "0")
  );
}

function profile(
  env: Record<string, string | undefined>,
  id: string,
  displayName: string,
  baseUrl: string,
  source: ProviderProfile["source"],
  key: string,
): ProviderProfile {
  const freeConfirmation = `${id.toUpperCase()}_FREE_CONFIRMED`;
  const zdrConfirmation = `${id.toUpperCase()}_ZDR_CONFIRMED`;
  return {
    id,
    displayName,
    baseUrl,
    source,
    freeStatus:
      source === "free_cloud"
        ? freshness(env, freeConfirmation)
        : { status: "paid_required" },
    privacy:
      source === "free_cloud"
        ? privacy(env, zdrConfirmation)
        : { classification: "unknown", retentionKnown: false },
    apiKey: env[key]?.trim() || undefined,
    ...(id === "openrouter" ? { isFreeModel: openRouterFreeModel } : {}),
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
    );
    const providerProfile = {
      ...configuredProfile,
      ...(logger ? { logger } : {}),
      ...(apiKey ? { apiKey } : {}),
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
          : apiKey
            ? "Credential configured; free and privacy confirmations remain explicit."
            : "Not configured; set the provider API key to enable discovery.",
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
          ),
          ...(logger ? { logger } : {}),
          ...(apiKey ? { apiKey } : {}),
          fetchImpl,
        },
      );
    }
  }
  return { adapters, statuses };
}
