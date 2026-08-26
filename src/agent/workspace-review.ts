import type { AgentTaskLedger } from "./task-state.js";
import { runCommand } from "../shared/process.js";
import type { LocalCodeLogger } from "../shared/logging.js";

export interface WorkspaceReviewInput {
  root: string;
  ledger: AgentTaskLedger;
  signal?: AbortSignal;
  logger?: LocalCodeLogger;
}

function isNotGitRepository(result: {
  exitCode: number;
  stdout: string;
  stderr: string;
}): boolean {
  return (
    (result.exitCode === 128 || result.exitCode === 129) &&
    /(?:not a git repository|no es un repositorio(?: de)? git)/iu.test(
      `${result.stderr}\n${result.stdout}`,
    )
  );
}

/**
 * Review the final workspace state without making Git a prerequisite for a
 * coding task. Git gives the strongest diff evidence when available. A
 * disposable or newly initialized workspace has no Git diff to inspect, so
 * the host-owned mutation ledger is the fallback evidence; arbitrary command
 * failures still fail the review.
 */
export async function reviewWorkspaceChange(
  input: WorkspaceReviewInput,
): Promise<boolean> {
  if (input.signal?.aborted) return false;
  let diff: Awaited<ReturnType<typeof runCommand>>;
  let status: Awaited<ReturnType<typeof runCommand>>;
  try {
    [diff, status] = await Promise.all([
      runCommand("git", ["diff", "--"], {
        intent: "read",
        cwd: input.root,
        signal: input.signal,
        timeoutMs: 10_000,
        logger: input.logger,
      }),
      runCommand("git", ["status", "--short"], {
        intent: "read",
        cwd: input.root,
        signal: input.signal,
        timeoutMs: 10_000,
        logger: input.logger,
      }),
    ]);
  } catch (error) {
    if (
      input.signal?.aborted ||
      (error instanceof DOMException && error.name === "AbortError")
    )
      return false;
    throw error;
  }
  if (diff.exitCode === 0 && status.exitCode === 0) return true;
  if (!isNotGitRepository(diff) || !isNotGitRepository(status)) return false;
  return input.ledger.filesChanged.length > 0;
}
