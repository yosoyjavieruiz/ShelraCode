import type {
  ModelCandidate,
  QuotaSnapshot,
  SourceKind,
} from "../shared/types.js";
import type { LocalCodeLogger } from "../shared/logging.js";

export type FetchLike = (
  input: Request | string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface NormalizedMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCallId?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export type ProviderEvent =
  | { type: "text.delta"; text: string }
  | { type: "reasoning.delta"; text: string }
  | { type: "tool.call"; call: ToolCall }
  | { type: "usage"; usage: Usage }
  | { type: "done" }
  | { type: "error"; error: ProviderFailure };

export type ProviderFailureCode =
  | "AUTH_INVALID"
  | "AUTH_MISSING"
  | "RATE_LIMIT_BURST"
  | "DAILY_QUOTA_EXHAUSTED"
  | "MONTHLY_QUOTA_EXHAUSTED"
  | "PAID_PLAN_REQUIRED"
  | "FREE_TIER_EXHAUSTED"
  | "MODEL_NOT_FOUND"
  | "MODEL_DEPRECATED"
  | "MODEL_UNAVAILABLE"
  | "UNSUPPORTED_CAPABILITY"
  | "CONTEXT_TOO_LARGE"
  | "CAPACITY"
  | "TIMEOUT"
  | "NETWORK"
  | "BAD_REQUEST"
  | "CANCELLED"
  | "PRIVACY_NOT_ALLOWED"
  | "UNKNOWN";

export interface ProviderFailure {
  code: ProviderFailureCode;
  message: string;
  status?: number;
  retryAt?: string;
}

export interface ProviderHealth {
  state: "healthy" | "degraded" | "down" | "unknown";
  latencyMs?: number;
  failure?: ProviderFailure;
}

export interface NormalizedModelRequest {
  modelId: string;
  messages: NormalizedMessage[];
  tools?: unknown[];
  toolChoice?: "none" | "auto" | "required";
  temperature?: number;
  maxOutputTokens?: number;
  stream: boolean;
}

export interface ProviderAdapter {
  readonly id: string;
  readonly displayName: string;
  discoverModels(signal: AbortSignal): Promise<ModelCandidate[]>;
  health(signal: AbortSignal): Promise<ProviderHealth>;
  quota(signal: AbortSignal): Promise<QuotaSnapshot>;
  stream(
    request: NormalizedModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent>;
  classifyError(error: unknown): ProviderFailure;
}

export interface ProviderProfile {
  id: string;
  displayName: string;
  baseUrl: string;
  source: SourceKind;
  freeStatus: ModelCandidate["free"];
  privacy: ModelCandidate["privacy"];
  apiKey?: string;
  fetchImpl?: FetchLike;
  isFreeModel?: (model: unknown) => boolean;
  /** When true, models rejected by isFreeModel are omitted from discovery. */
  freeOnly?: boolean;
  logger?: LocalCodeLogger;
}
