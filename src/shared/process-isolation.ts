/**
 * Describes the boundary that protects a child process.
 *
 * On Windows, `src/shared/win32/isolated-process.ts` drives `CreateProcessW`
 * directly (bypassing `Bun.spawn`) to assign every spawned process to a Job
 * Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` (real OS-enforced process
 * lifecycle containment: descendants die with the job, not just the one
 * process a caller holds a handle to) and, when network must be denied, a
 * zero-capability AppContainer token (real OS-enforced network denial via
 * Windows Filtering Platform's built-in AppContainer rule -- verified with
 * `ping`/`curl` against a live host). `osEnforced` reflects the lifecycle
 * guarantee; `networkEnforced` reflects the network guarantee specifically,
 * since a workspace whose ACL grant fails (see `grantWorkspaceAccess`) can
 * still get lifecycle containment without network denial. Non-Windows hosts
 * and any host where the adapter itself fails to initialize keep the
 * previous fully-honest `mechanism: "none"` status.
 */
export interface ProcessIsolationStatus {
  applicationPolicy: "enforced";
  osEnforced: boolean;
  networkEnforced: boolean;
  mechanism: "none" | "job_object" | "job_object+app_container";
  reason: string;
}

export type ProcessIsolationMode = "best_effort" | "required";

export class ProcessIsolationError extends Error {
  readonly code = "OS_ISOLATION_UNAVAILABLE" as const;

  constructor(readonly status: ProcessIsolationStatus) {
    super(
      "OS-enforced process isolation is required, but this host has no configured isolation adapter.",
    );
    this.name = "ProcessIsolationError";
  }
}

const NONE_STATUS: ProcessIsolationStatus = {
  applicationPolicy: "enforced",
  osEnforced: false,
  networkEnforced: false,
  mechanism: "none",
  reason: "No OS sandbox adapter is configured for this runtime.",
};

/**
 * Best-known status before a specific command is spawned. On win32 this
 * reports the Job Object mechanism optimistically (it has no per-call
 * failure mode besides the Win32 API itself being unavailable); network
 * enforcement is NOT claimed here because it depends on a per-workspace ACL
 * grant that can only be resolved against an actual `cwd` at spawn time --
 * see `statusFromIsolatedSpawn` for the status a real spawn attempt
 * produces, which is what `ProcessResult.isolation` reports.
 */
export function inspectProcessIsolation(): ProcessIsolationStatus {
  if (process.platform !== "win32") return NONE_STATUS;
  return {
    applicationPolicy: "enforced",
    osEnforced: true,
    networkEnforced: false,
    mechanism: "job_object",
    reason:
      "Windows Job Object process-lifecycle containment is active for this host; " +
      "network denial additionally requires a per-workspace AppContainer ACL grant, " +
      "resolved when a command actually spawns.",
  };
}

/** The real status produced by an actual spawn attempt through
 * `spawnIsolatedWindows`, or the fallback when that adapter was unavailable
 * for this call and `Bun.spawn` ran instead. */
export function statusFromIsolatedSpawn(
  mechanism: "none" | "job_object" | "job_object+app_container",
): ProcessIsolationStatus {
  if (mechanism === "none") return NONE_STATUS;
  return {
    applicationPolicy: "enforced",
    osEnforced: true,
    networkEnforced: mechanism === "job_object+app_container",
    mechanism,
    reason:
      mechanism === "job_object+app_container"
        ? "Job Object lifecycle containment and a zero-capability AppContainer (network denied by Windows Filtering Platform) are both active."
        : "Job Object lifecycle containment is active; network denial was not applied for this call.",
  };
}

export function enforceProcessIsolation(input: {
  mode?: ProcessIsolationMode;
  allowWeak?: boolean;
}): ProcessIsolationStatus {
  const status = inspectProcessIsolation();
  if (input.mode === "required" && !status.osEnforced && !input.allowWeak)
    throw new ProcessIsolationError(status);
  return status;
}
