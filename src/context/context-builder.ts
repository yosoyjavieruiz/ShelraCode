import type { RepositorySnapshot } from "./repository-snapshot.js";
import type { LocalCodeLogger } from "../shared/logging.js";
import type { MemoryFact } from "../shared/memory.js";
import type {
  RepositoryIntelligence,
  RepositoryIntelligenceSelection,
} from "./repository-intelligence.js";
import type {
  LoadedSkill,
  SkillMetadata,
} from "../instructions/skill-loader.js";
import type { TrustedInstruction } from "../instructions/trust-policy.js";
import type {
  CapabilityActivationDecision,
  CapabilityActivationMode,
  CapabilityTaskContext,
} from "../agent/dynamic-capabilities.js";
import type { ModelDriverProfile } from "../driver/profile.js";
import type { PairedCapabilityEvaluationReport } from "../evals/paired-capability.js";

export interface ContextBudgetInput {
  advertisedContext: number;
  safetyMargin: number;
}

export interface ContextBudget {
  advertisedContext: number;
  reservedTokens: number;
  usableTokens: number;
}

export function buildContextBudget(input: ContextBudgetInput): ContextBudget {
  if (
    !Number.isFinite(input.advertisedContext) ||
    input.advertisedContext <= 0
  ) {
    throw new Error("advertised context must be positive");
  }
  if (input.safetyMargin < 0 || input.safetyMargin >= 1) {
    throw new Error("safety margin must be between 0 and 1");
  }
  const reservedTokens = Math.ceil(
    input.advertisedContext * input.safetyMargin,
  );
  return {
    advertisedContext: input.advertisedContext,
    reservedTokens,
    usableTokens: input.advertisedContext - reservedTokens,
  };
}

export interface RepositoryContextOptions {
  root: string;
  objective: string;
  explicitPaths?: string[];
  maxChars?: number;
  signal?: AbortSignal;
  snapshot?: RepositorySnapshot;
  /** Historical facts used only as bounded retrieval hints. */
  memoryFacts?: readonly MemoryFact[];
  /** Memory IDs retained by a resumed task; still subject to freshness gates. */
  memoryIds?: readonly string[];
  /** Instruction paths retained by a resumed task. */
  instructionSources?: readonly string[];
  /** Build bounded structural repository evidence for the current objective. */
  buildIntelligence?: boolean;
  /** Historical alias: true is an explicit opt-in for matching Skill bodies. */
  loadSkills?: boolean;
  /** Host policy for runtime Skill activation; defaults to disabled. */
  skillActivation?: CapabilityActivationMode;
  /** Exact certified Driver profile used for Skill compatibility decisions. */
  skillProfile?: ModelDriverProfile;
  /** Exact tool/context configuration digest paired evidence was measured with. */
  skillConfigurationDigest?: string;
  /** Host-derived task tags used by the Dynamic Capability System. */
  skillTask?: CapabilityTaskContext;
  /** Host-owned paired reports produced by Shelra Lab; repository text cannot supply these. */
  skillEvaluations?: readonly PairedCapabilityEvaluationReport[];
  logger?: LocalCodeLogger;
}

export interface RepositoryContext {
  snapshot?: RepositorySnapshot;
  instructions?: string[];
  files: string[];
  /** Files whose contents matched meaningful terms from the objective. */
  relevantMatches?: string[];
  prompt: string;
  containsHighConfidenceSecret: boolean;
  secretPaths: string[];
  /** Controller-visible evidence gate for the current objective. */
  evidenceState: "SUFFICIENT" | "INSUFFICIENT" | "CONFLICTING";
  /** Bounded memory hints included in the compiled context, never authority. */
  memoryFacts?: MemoryFact[];
  /** Host-built structural index; it is evidence, not an objective oracle. */
  intelligence?: RepositoryIntelligence;
  /** Objective-selected files/symbol sources included in the packet. */
  intelligenceSources?: string[];
  /** Structured selection retained for host-side consumers and diagnostics. */
  intelligenceSelection?: RepositoryIntelligenceSelection;
  /** Trusted project instructions supplied separately from repository data. */
  trustedInstructions?: TrustedInstruction[];
  /** All Skill metadata is bounded; selected bodies are loaded lazily. */
  skillMetadata?: SkillMetadata[];
  selectedSkills?: LoadedSkill[];
  /** Host-owned activation decisions for objective-selected Skills. */
  skillActivationDecisions?: CapabilityActivationDecision[];
  instructionSources?: string[];
  searchBackend:
    "rg" | "fallback" | "no_matches" | "unavailable" | "not_needed";
}
