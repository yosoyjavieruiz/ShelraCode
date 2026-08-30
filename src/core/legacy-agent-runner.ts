import { runAgent } from "../agent/loop.js";
import type {
  AgentLoopOptions,
  AgentRunResult,
  AgentTask,
} from "../agent/types.js";
import type {
  SweDriverRequest,
  SweExecutionOutcome,
  SweTaskExecutor,
} from "./types.js";

export interface LegacyAgentRunnerOptions {
  /** Build the prepared legacy task outside the Core lifecycle. */
  createTask(request: SweDriverRequest): AgentTask | Promise<AgentTask>;
  /** Supply provider/tools/verification adapters outside the Core lifecycle. */
  createOptions(
    request: SweDriverRequest,
    signal: AbortSignal,
  ): AgentLoopOptions | Promise<AgentLoopOptions>;
  /** Lets an application service consume the rich normalized result. */
  onResult?: (
    result: AgentRunResult,
    request: SweDriverRequest,
  ) => void | Promise<void>;
}

function boundedSummary(text: string): string | undefined {
  const normalized = text.trim();
  if (normalized.length === 0) return undefined;
  return normalized.length > 500
    ? `${normalized.slice(0, 500)}…[truncated]`
    : normalized;
}

/**
 * Compatibility adapter for the existing whole-run agent loop. It deliberately
 * does not expose a fake one-turn `step()` implementation: `runAgent` owns a
 * complete state machine and its local continuation state is not resumable at
 * an arbitrary turn boundary yet.
 */
export class LegacyAgentRunner implements SweTaskExecutor {
  constructor(private readonly options: LegacyAgentRunnerOptions) {}

  async run(request: SweDriverRequest): Promise<SweExecutionOutcome> {
    const task = await this.options.createTask(request);
    const loopOptions = await this.options.createOptions(
      request,
      request.signal,
    );
    const result = await runAgent(task, loopOptions, request.signal);
    await this.options.onResult?.(result, request);
    return {
      status: result.status,
      progressed:
        result.turns > 0 ||
        result.toolRuns.length > 0 ||
        result.ledger.filesChanged.length > 0,
      verified: result.verified,
      ...(boundedSummary(result.text)
        ? { summary: boundedSummary(result.text) }
        : {}),
      ...(result.failure?.code ? { failureCode: result.failure.code } : {}),
    };
  }
}

export function createLegacyAgentRunner(
  options: LegacyAgentRunnerOptions,
): LegacyAgentRunner {
  return new LegacyAgentRunner(options);
}
