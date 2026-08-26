import type {
  ModelCandidate,
  PermissionMode,
  RepositoryPrivacy,
} from "../shared/types.js";
import type {
  ProviderAdapter,
  ProviderFailure,
  ProviderEvent,
  NormalizedMessage,
} from "../providers/types.js";
import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolRisk,
  ToolResult,
} from "../tools/types.js";
import type { AppEventBus } from "../shared/events.js";
import type { CompletionDecision } from "./completion-gate.js";
import type { AgentPhase, AgentTaskLedger } from "./task-state.js";
import type { TurnMode } from "./turn-policy.js";
import type { IndependentVerificationResult } from "./verifier.js";
import type { AgentTraceRecorder } from "./trace.js";
import type { VerificationCommand } from "./verification-plan.js";
import type { LocalCodeLogger } from "../shared/logging.js";
import type { AdaptiveExecutionProfile } from "./execution-profile.js";
import type { TaskContract } from "./task-contract.js";
import type { ObjectiveProofAssessment } from "./objective-proof.js";
import type {
  TaskInFlightMarker,
  TaskRuntimeSnapshot,
} from "./task-runtime-state.js";
import type { InstructionTrust } from "../instructions/trust-policy.js";

export interface AgentTaskInstruction {
  source: string;
  text: string;
  trust?: InstructionTrust;
  precedence?: number;
  scope?: string;
  relevance?: number;
}

export interface AgentTask {
  id: string;
  objective: string;
  root: string;
  candidate: ModelCandidate;
  repositoryPolicy: RepositoryPrivacy;
  permissionMode: PermissionMode;
  mode?: TurnMode;
  /** Host-selected adaptive strategy. Semantic planning remains LLM-owned. */
  executionProfile?: AdaptiveExecutionProfile;
  /** Model planning is explicit; compatibility keeps legacy callers stable. */
  planningMode?: "none" | "model" | "compatibility";
  /** Optional contract compiled by an application service. */
  taskContract?: TaskContract;
  /** Make the compiled contract's criteria part of completion authority. */
  enforceTaskContract?: boolean;
  /** Versioned state restored by a durable resume operation. */
  runtimeSnapshot?: TaskRuntimeSnapshot;
  successCriteria?: string[];
  /** Host-framed constraints retained in the authoritative task ledger. */
  constraints?: string[];
  context?: string;
  /** Host-composed trusted instructions kept separate from repository data. */
  instructions?: AgentTaskInstruction[];
  /** Host discovery result used by the write gate; it is not model authority. */
  contextEvidenceState?: "SUFFICIENT" | "INSUFFICIENT" | "CONFLICTING";
  /** Host-observed repository shape used to distinguish greenfield work. */
  repositoryState?: "empty" | "non_empty" | "unknown";
  /** Generic compiler signal; only authorizes empty-workspace bootstrap work. */
  greenfieldIntent?: boolean;
  containsHighConfidenceSecret?: boolean;
  /** @deprecated Use verificationCommands for new callers. */
  verificationCommand?: string;
  /** Host-owned commands required before a coding task can complete. */
  verificationCommands?: VerificationCommand[];
  /** Explicitly distinguishes unavailable checks from a task that needs none. */
  verificationPolicy?: "required" | "unavailable" | "not_required";
  maxTurns?: number;
  /** Host-controlled generation cap; prevents an unbounded provider turn. */
  maxOutputTokens?: number;
  /** Host-controlled sampling temperature; coding defaults to 0.2. */
  temperature?: number;
  contextBudgetChars?: number;
  /** Host-selected bounded work-unit targets; never a capability downgrade. */
  stagedPaths?: string[];
  /**
   * Which system-prompt profile to assemble for this turn. Defaults to
   * "coding" (the historical single hardcoded prompt) when unset, so
   * existing callers that don't classify turns keep their prior behavior.
   * Conversational/knowledge turns should use "minimal" to avoid nudging a
   * model toward repository tools it has no reason to touch.
   */
  systemPromptProfile?: "minimal" | "workspace" | "coding";
}

export type AgentEvent =
  | { type: "assistant.delta"; text: string }
  /** Provider-reported internal progress is exposed only as safe metadata;
   * private chain-of-thought text is never forwarded to the transcript. */
  | {
      type: "model.progress";
      phase: "reasoning";
      chars: number;
      streaming: boolean;
    }
  // Surfaces AgentTaskLedger.phase (task-state.ts) as it advances through
  // the loop's frame/discover/analyze/plan/act/observe/reflect/verify/
  // review pipeline. This is the structured signal a host UI needs to
  // render abstract "agent is thinking" states without inferring them from
  // prose (see AgentActivityEvent in the UI chat v2 design) — it did not
  // exist before because nothing outside the loop ever read `ledger.phase`.
  | { type: "phase.changed"; phase: AgentPhase }
  // Incremental output from a long-running Shell/RunTests call — the live
  // shell/test tail (docs/ui-chat-v2 §36). Batched by runCommand
  // (src/shared/process.ts) to ~1 emission per 150ms per stream, so this
  // can never flood the UI with one event per OS pipe read.
  | {
      type: "tool.output";
      callId: string;
      tool: string;
      stream: "stdout" | "stderr";
      text: string;
    }
  // The host-driven verification stage (independent of any model tool
  // call) starting a planned command — lets the UI show the same "a test
  // is running" activity + live tail it already shows for a model-invoked
  // RunTests call, instead of nothing until verification.finished.
  | {
      type: "verification.started";
      id: string;
      stage?: string;
      command: string;
    }
  // Surfaces AgentTaskLedger.plan (task-state.ts, setTaskPlan) — real
  // per-step descriptions instead of only a "Plan · N/M" count. Step
  // *status* currently only reflects the plan's initial snapshot: the loop
  // does not yet update individual step status as work progresses (a
  // separate, larger change — see docs/ui-chat-v2/STATUS.md).
  | {
      type: "plan.changed";
      steps: Array<{
        id: string;
        description: string;
        status: "pending" | "active" | "done" | "failed" | "skipped";
      }>;
    }
  | {
      type: "tool.started";
      callId: string;
      tool: string;
      input: unknown;
      risk?: ToolRisk;
    }
  | {
      type: "tool.finished";
      callId: string;
      tool: string;
      result: ToolResult;
    }
  | {
      type: "verification.finished";
      stage?: string;
      command?: string;
      exitCode: number;
      output: string;
    }
  | { type: "checkpoint.created"; id: string }
  | { type: "task.completed"; result: AgentRunResult }
  | { type: "task.blocked"; error: string }
  | { type: "task.cancelled"; error: string }
  | { type: "task.failed"; error: string };

export interface AgentRunResult {
  text: string;
  verified: boolean;
  status: "completed" | "blocked" | "failed" | "cancelled";
  /** Structured provider/runtime evidence when execution failed before completion. */
  failure?: ProviderFailure;
  completion: CompletionDecision;
  /** Host-owned objective proof used by the completion decision. */
  objectiveProof?: ObjectiveProofAssessment;
  evidenceCount: number;
  ledger: AgentTaskLedger;
  turns: number;
  toolRuns: ToolResult[];
  messages: NormalizedMessage[];
}

export interface SuccessCriteriaVerification {
  pass: boolean;
  satisfiedCriterionIds?: string[];
  issues?: string[];
  nextPaths?: string[];
  nextActions?: string[];
}

export interface AgentLoopOptions {
  provider: ProviderAdapter;
  tools: readonly ToolDefinition<unknown, unknown>[];
  /**
   * "none" forbids tool use for the entire run: the provider is told not to
   * offer tools, and as defense-in-depth the loop refuses to execute a tool
   * call even if a misbehaving model attempts one anyway. Defaults to
   * "auto" for backward compatibility with callers that manage tool
   * availability entirely through `tools`.
   */
  toolChoice?: "none" | "auto" | "required";
  events?: AppEventBus;
  onEvent?: (event: AgentEvent) => void;
  /**
   * Persist the authoritative ledger. When an operation is about to cross a
   * process boundary, the optional marker makes restart recovery explicit;
   * callers must clear it with a subsequent marker-less persistence call.
   */
  persistTask?: (
    ledger: AgentTaskLedger,
    inFlight?: TaskInFlightMarker,
  ) => void;
  /**
   * Host-owned preservation check. The kernel must not assume that the
   * workspace remained untouched merely because a mutation returned without
   * throwing.
   */
  checkUserWorkPreserved?: (
    checkpointId: string | undefined,
  ) => boolean | Promise<boolean>;
  reviewFinalDiff?: (
    task: AgentTask,
    ledger: AgentTaskLedger,
  ) => boolean | Promise<boolean>;
  independentVerifier?: (
    task: AgentTask,
    ledger: AgentTaskLedger,
  ) => IndependentVerificationResult | Promise<IndependentVerificationResult>;
  /**
   * Read-only host verification for explicit task success criteria. The
   * completion gate must not infer semantic success from a mutation and a
   * green test alone.
   */
  verifySuccessCriteria?: (
    task: AgentTask,
    ledger: AgentTaskLedger,
  ) => SuccessCriteriaVerification | Promise<SuccessCriteriaVerification>;
  trace?: AgentTraceRecorder;
  /** Structured lifecycle logging; prompts and raw tool output stay excluded. */
  logger?: LocalCodeLogger;
  createExecutionContext(task: AgentTask): Promise<ToolExecutionContext>;
}

export type AgentProviderEvent = ProviderEvent;
