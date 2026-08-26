/**
 * Describes the boundary that protects a child process.
 *
 * The current TypeScript/Bun host does not create a Windows restricted token
 * or Job Object, so `osEnforced` is deliberately false today. Keeping that
 * fact explicit prevents application-level command checks from being
 * misrepresented as an operating-system sandbox.
 */
export interface ProcessIsolationStatus {
  applicationPolicy: "enforced";
  osEnforced: boolean;
  mechanism: "none";
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

export function inspectProcessIsolation(): ProcessIsolationStatus {
  return {
    applicationPolicy: "enforced",
    osEnforced: false,
    mechanism: "none",
    reason:
      process.platform === "win32"
        ? "No native Windows restricted-token or Job Object adapter is configured."
        : "No OS sandbox adapter is configured for this runtime.",
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
