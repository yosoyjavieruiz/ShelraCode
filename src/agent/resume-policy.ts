/**
 * Host-owned resume decision for a task whose process may have stopped while
 * the working tree was changing. A changed tree is not automatically unsafe:
 * it can be the durable result of the task itself. The policy only allows
 * that case when Git can enumerate the changed paths and every path is within
 * the task's already recorded mutation scope (or its interrupted target).
 * The next agent turn must still re-read the affected files; this policy never
 * replays an interrupted mutation.
 */

export type ResumeWorkspaceStatus =
  "compatible" | "task_changes_detected" | "blocked";

export interface ResumeWorkspaceInput {
  savedRepositoryRevision?: string;
  currentRepositoryRevision?: string;
  savedWorkingTreeRevision?: string;
  currentWorkingTreeRevision?: string;
  currentWorkingTreePaths?: readonly string[];
  taskPaths?: readonly string[];
  inFlightTarget?: string;
}

export interface ResumeWorkspaceAssessment {
  status: ResumeWorkspaceStatus;
  reason: string;
  changedPaths: string[];
  unexpectedPaths: string[];
}

function normalizePath(value: string): string {
  const normalized = value
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function uniquePaths(values: readonly string[] | undefined): string[] {
  return [
    ...new Set(
      (values ?? []).map(normalizePath).filter((value) => value.length > 0),
    ),
  ].sort();
}

function blocked(
  reason: string,
  changedPaths: string[] = [],
  unexpectedPaths: string[] = [],
): ResumeWorkspaceAssessment {
  return { status: "blocked", reason, changedPaths, unexpectedPaths };
}

/**
 * Assess whether a persisted task may continue from the current checkout.
 * HEAD changes always block. Working-tree changes are attributable only when
 * the current path inventory is available and is fully contained by the
 * recorded task scope.
 */
export function assessResumeWorkspace(
  input: ResumeWorkspaceInput,
): ResumeWorkspaceAssessment {
  if (
    input.savedRepositoryRevision !== undefined &&
    input.currentRepositoryRevision !== input.savedRepositoryRevision
  )
    return blocked(
      "Cannot resume because the repository revision changed or is unavailable.",
    );

  if (
    input.savedWorkingTreeRevision === undefined ||
    input.currentWorkingTreeRevision === input.savedWorkingTreeRevision
  )
    return {
      status: "compatible",
      reason:
        input.savedWorkingTreeRevision === undefined
          ? "No prior working-tree fingerprint was recorded; fresh observations are required."
          : "The repository and working tree match the persisted resume state.",
      changedPaths: [],
      unexpectedPaths: [],
    };

  if (input.currentWorkingTreePaths === undefined)
    return blocked(
      "Cannot attribute the working-tree change because changed paths are unavailable.",
    );

  const changedPaths = uniquePaths(input.currentWorkingTreePaths);
  if (changedPaths.length === 0)
    return blocked(
      "Cannot attribute the working-tree change because no changed paths were enumerated.",
    );

  const ownedPaths = new Set(
    uniquePaths([
      ...(input.taskPaths ?? []),
      ...(input.inFlightTarget ? [input.inFlightTarget] : []),
    ]),
  );
  const unexpectedPaths = changedPaths.filter(
    (value) => !ownedPaths.has(value),
  );
  if (unexpectedPaths.length > 0)
    return blocked(
      "Cannot resume because the working tree contains changes outside the task scope.",
      changedPaths,
      unexpectedPaths,
    );

  return {
    status: "task_changes_detected",
    reason:
      "The working tree differs only in task-owned paths; fresh observations are required before continuing.",
    changedPaths,
    unexpectedPaths: [],
  };
}
