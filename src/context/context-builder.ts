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
  /** Build bounded structural repository evidence for the current objective. */
  buildIntelligence?: boolean;
  /** Load project Skill metadata and only bodies matching the objective. */
  loadSkills?: boolean;
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
  instructionSources?: string[];
  searchBackend:
    "rg" | "fallback" | "no_matches" | "unavailable" | "not_needed";
}
