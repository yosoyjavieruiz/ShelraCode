export type SourceKind = "local" | "free_cloud" | "paid_cloud";

export type FreeStatus =
  | "verified_free"
  | "free_quota"
  | "unknown"
  | "stale"
  | "paid"
  | "paid_required";

export type PrivacyClass =
  "local" | "public_only" | "zdr_capable" | "private_allowed" | "unknown";

export type HealthState = "healthy" | "degraded" | "down" | "unknown";

export type RepositoryPrivacy =
  | "local_only"
  | "private_zdr_only"
  | "private"
  | "trusted_cloud"
  | "public_free";

export type RoutingMode = "strict-zero" | "ask-before-paid";

/**
 * Permission policy for workspace actions.
 * ASK is the interactive default: every workspace action is presented to the
 * user once before execution. The other modes remain available for users who
 * explicitly choose a less interactive policy.
 */
export type PermissionMode = "ASK" | "PLAN" | "EDIT" | "AUTO";

export type TaskClass =
  | "SEARCH"
  | "EXPLAIN"
  | "SMALL_EDIT"
  | "MULTI_FILE_EDIT"
  | "TEST_GENERATION"
  | "DEBUGGING"
  | "REFACTOR"
  | "ARCHITECTURE"
  | "REVIEW"
  | "COMMAND";

export type AgentCapabilityClass =
  "chat_only" | "workspace_reader" | "coding_agent" | "advanced_coding_agent";

export interface CapabilityResult {
  status: "pass" | "fail" | "unmeasured";
  notes: string[];
}

export interface AgentCapabilityProfile {
  modelId: string;
  runtimeId: string;
  conversation: CapabilityResult;
  noToolDiscipline: CapabilityResult;
  toolSelection: CapabilityResult;
  toolArguments: CapabilityResult;
  multiTurnTools: CapabilityResult;
  errorRecovery: CapabilityResult;
  repositoryReasoning: CapabilityResult;
  editReliability: CapabilityResult;
  verificationBehavior: CapabilityResult;
  overall: AgentCapabilityClass;
}

export interface AgentProbeExecutionEvidence {
  editApplied: boolean;
  testIteration: boolean;
  notes: string[];
}

export interface AgentProbeHardwareSnapshot {
  os: string;
  platform: string;
  arch: string;
  cpuModel: string;
  cpuCores: number;
  memoryGb: number;
  accelerator: string;
  storageFreeGb?: number;
}

/** Reproducibility metadata for an exact model/runtime capability result. */
export interface AgentProbeEnvironment {
  modelId: string;
  runtimeId: string;
  task: string;
  modelRevision?: string;
  quantization?: string;
  contextLength?: number;
  runtimeVersion?: string;
  chatTemplate?: string;
  toolParser?: string;
  generation: {
    temperature: number;
    maxOutputTokens: number;
  };
  hardware?: AgentProbeHardwareSnapshot;
}

export type OpportunityCost =
  "low_value" | "normal" | "high_value" | "critical";

export interface ModelCapabilities {
  tools: boolean;
  structuredOutput: boolean;
  reasoning: boolean;
  vision: boolean;
  maxContext?: number;
}

export interface ModelCandidate {
  id: string;
  providerId: string;
  /** Provider/runtime identifier used on the wire; displayName is user-facing. */
  modelId?: string;
  displayName: string;
  source: SourceKind;
  capabilities: ModelCapabilities;
  free: {
    status: FreeStatus;
    verifiedAt?: string;
    expiresAt?: string;
  };
  privacy: {
    classification: PrivacyClass;
    trainsOnInputs?: boolean;
    retentionKnown: boolean;
    zdrAvailable?: boolean;
    verifiedAt?: string;
  };
  quality: {
    coding?: number;
    toolUse?: number;
    confidence: "measured" | "reported" | "unknown";
  };
  health: {
    state: HealthState;
    latencyMs?: number;
  };
  local?: {
    runtime: string;
    /** Whether the runtime currently reports a loaded inference instance. */
    loaded?: boolean;
    quant?: string;
    modelRevision?: string;
    runtimeVersion?: string;
    chatTemplate?: string;
    toolParser?: string;
    architecture?: string;
    parameters?: string;
    sizeBytes?: number;
    trainedForToolUse?: boolean;
    estimatedTps?: number;
    memoryRequiredGb?: number;
    fit?: string;
  };
  /**
   * Result of running `probeAgentCapability` against this exact
   * model+runtime combination, if it has been probed. Optional and
   * opt-in for discovery. The result is routing evidence and a capability
   * admission boundary for any task that needs more than conversation. A
   * weaker or unmeasured route may still be used for a smaller role when its
   * required capability is lower; it must not be promoted by score alone.
   * Actual tool support, permissions, workspace boundaries, and verification
   * remain enforced independently by the host.
   */
  agentProbe?: {
    /** Algorithm revision for persisted capability evidence. */
    probeVersion?: number;
    conversation: boolean;
    readTool: boolean;
    multiTurnTools: boolean;
    agenticCodingEligible: boolean;
    agentCapabilityClass: AgentCapabilityClass;
    profile?: AgentCapabilityProfile;
    execution?: AgentProbeExecutionEvidence;
    environment?: AgentProbeEnvironment;
    notes: string[];
  };
}

export interface TaskAnalysis {
  class: TaskClass;
  complexity: number;
  contextNeed: number;
  toolNeed: boolean;
  risk: number;
  opportunityCost: OpportunityCost;
  requiredCapability?: AgentCapabilityClass;
}

export interface QuotaSnapshot {
  providerId: string;
  modelId?: string;
  requestsRemaining?: number;
  requestsLimit?: number;
  tokensRemaining?: number;
  tokensLimit?: number;
  resetAt?: string;
  confidence: "provider_reported" | "locally_estimated" | "unknown";
  observedAt: string;
}

export interface RouteRejection {
  candidateId: string;
  providerId: string;
  reasons: string[];
}

export interface RouteScoreBreakdown {
  taskFit: number;
  predictedSuccess: number;
  quotaHeadroom: number;
  reliability: number;
  latency: number;
  contextHeadroom: number;
  toolReliability: number;
  quotaOpportunityCost: number;
  total: number;
}

export interface RouteSelection {
  candidate: ModelCandidate;
  score: number;
  breakdown: RouteScoreBreakdown;
}

export interface RouteDecision {
  selected?: RouteSelection;
  rejections: RouteRejection[];
  explanation: string;
  generatedAt: string;
  task?: TaskAnalysis;
  repositoryPolicy?: RepositoryPrivacy;
  routingMode?: RoutingMode;
}

export interface RouteRequest {
  now: Date;
  task: TaskAnalysis;
  repositoryPolicy: RepositoryPrivacy;
  routingMode: RoutingMode;
  contextTokens: number;
  candidates: ModelCandidate[];
  /** User-selected model is a preference, never a hard candidate filter. */
  preferredCandidateId?: string;
  /**
   * A complex parent objective may be executed as a sequence of host-owned,
   * verified work units. This does not promote a weak model: it changes the
   * admission floor only for a non-empty bounded scope and still requires a
   * measured coding-agent capability for mutation.
   */
  execution?: {
    /**
     * `discovery` is a read-only preparation stage for complex objectives
     * whose mutation scope has not been proven yet. It must never be treated
     * as a capability downgrade for workspace writes.
     */
    strategy: "direct" | "progressive" | "discovery";
    boundedScope?: string[];
  };
  quotas?: Record<string, QuotaSnapshot | undefined>;
  quotaMaxAgeMs?: number;
  containsHighConfidenceSecret?: boolean;
  paidApproved?: boolean;
  circuitBreaker?: {
    canRequest(providerId: string, modelId: string): boolean;
  };
}
