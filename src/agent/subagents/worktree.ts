import { mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "../../shared/process.js";

export interface IsolatedSubagentWorkspace {
  root: string;
  revision: string;
  cleanup: () => Promise<void>;
}

export type IsolatedWorkspacePreparation =
  | { ok: true; workspace: IsolatedSubagentWorkspace }
  | { ok: false; reason: string };

/**
 * A read-only child can use a detached disposable worktree only when the
 * parent repository is clean. Refusing dirty roots avoids silently dropping
 * uncommitted user changes from the child's view and avoids any merge claim.
 */
export async function prepareIsolatedSubagentWorkspace(
  root: string,
  signal: AbortSignal,
): Promise<IsolatedWorkspacePreparation> {
  const absoluteRoot = await realpath(root).catch(() => path.resolve(root));
  const status = await runCommand(
    "git",
    ["status", "--porcelain", "--untracked-files=all"],
    {
      intent: "read",
      cwd: absoluteRoot,
      network: "deny",
      signal,
      timeoutMs: 5_000,
      maxOutputChars: 20_000,
    },
  );
  if (status.exitCode === 127)
    return { ok: false, reason: "Isolated child worktrees require Git." };
  if (status.exitCode !== 0)
    return {
      ok: false,
      reason: "The parent repository could not be inspected for isolation.",
    };
  if (status.stdout.trim())
    return {
      ok: false,
      reason:
        "The parent repository has uncommitted user or agent changes; isolation was refused to preserve them.",
    };
  const revisionResult = await runCommand("git", ["rev-parse", "HEAD"], {
    intent: "read",
    cwd: absoluteRoot,
    network: "deny",
    signal,
    timeoutMs: 5_000,
    maxOutputChars: 1_000,
  });
  const revision = revisionResult.stdout.trim();
  if (revisionResult.exitCode !== 0 || !revision)
    return {
      ok: false,
      reason: "An isolated child requires a committed parent revision.",
    };
  const temporaryParent = await mkdtemp(
    path.join(os.tmpdir(), "localcode-subagent-worktree-"),
  );
  const worktreeRoot = path.join(temporaryParent, "worktree");
  const added = await runCommand(
    "git",
    ["worktree", "add", "--detach", "--quiet", worktreeRoot, revision],
    {
      intent: "execute",
      cwd: absoluteRoot,
      network: "deny",
      signal,
      timeoutMs: 15_000,
      maxOutputChars: 20_000,
    },
  );
  if (added.exitCode !== 0) {
    await rm(temporaryParent, { recursive: true, force: true }).catch(() => {});
    return {
      ok: false,
      reason:
        `Git could not create the disposable child worktree: ${added.stderr || added.stdout}`.trim(),
    };
  }
  let cleaned = false;
  return {
    ok: true,
    workspace: {
      root: worktreeRoot,
      revision,
      cleanup: async () => {
        if (cleaned) return;
        cleaned = true;
        await runCommand(
          "git",
          ["worktree", "remove", "--force", worktreeRoot],
          {
            intent: "execute",
            cwd: absoluteRoot,
            network: "deny",
            allowDestructive: true,
            timeoutMs: 15_000,
            maxOutputChars: 20_000,
          },
        ).catch(() => {});
        await rm(temporaryParent, { recursive: true, force: true }).catch(
          () => {},
        );
      },
    },
  };
}
