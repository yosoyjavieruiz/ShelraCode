import type { ProviderAdapter } from "../../providers/types.js";
import type { LocalCodeLogger } from "../../shared/logging.js";
import type {
  ToolDefinition,
  ToolExecutionContext,
} from "../../tools/types.js";
import type { AgentTask } from "../types.js";

export type SubagentTerminalStatus =
  "completed" | "blocked" | "failed" | "cancelled";

export interface SubagentContextRequest {
  /** Explicit source IDs are the only repository content a child may receive. */
  sourceIds: readonly string[];
  evidence?: readonly {
    source: string;
    summary: string;
  }[];
  maxChars?: number;
}

export interface SubagentRequest {
  id?: string;
  objective: string;
  allowedTools: readonly string[];
  context: SubagentContextRequest;
  /** Use a clean detached disposable worktree for this read-only child. */
  isolated?: boolean;
}

export interface SubagentEvidence {
  sourceId: string;
  kind: string;
  summary: string;
}

export interface SubagentResult {
  id: string;
  objective: string;
  status: SubagentTerminalStatus;
  text: string;
  evidence: SubagentEvidence[];
  sourceIds: string[];
  toolRuns: number;
  error?: string;
}

export interface SubagentParentContext {
  task: AgentTask;
  signal: AbortSignal;
  createExecutionContext: (task: AgentTask) => Promise<ToolExecutionContext>;
}

export interface SubagentCoordinatorOptions {
  provider: ProviderAdapter;
  tools: readonly ToolDefinition<unknown, unknown>[];
  maxTurns?: number;
  maxContextChars?: number;
  logger?: LocalCodeLogger;
}

export interface SubagentCoordinator {
  run(
    request: SubagentRequest,
    parent: SubagentParentContext,
  ): Promise<SubagentResult>;
}

export interface DelegationToolInput {
  objective: string;
  allowedTools: string[];
  sourceIds: string[];
  isolated?: boolean;
}

export type DelegationToolResult = SubagentResult;

/** A bounded batch of independent read-only investigations. */
export interface ParallelDelegationRequest {
  objective: string;
  allowedTools: string[];
  sourceIds: string[];
  isolated?: boolean;
}

export interface ParallelDelegationToolInput {
  requests: ParallelDelegationRequest[];
}

export interface ParallelDelegationToolResult {
  status: "completed" | "partial";
  results: SubagentResult[];
}
