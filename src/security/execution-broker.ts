import { randomUUID } from "node:crypto";
import {
  realpath,
  rename,
  unlink as fsUnlink,
  writeFile as fsWriteFile,
} from "node:fs/promises";
import path from "node:path";
import {
  ProcessPolicyError,
  runCommand as hostRunCommand,
  runShellCommand as hostRunShellCommand,
  type ProcessOptions,
  type ProcessOutputChunk,
  type ProcessResult,
} from "../shared/process.js";
import {
  assertProcessPolicy,
  commandRequiresNetwork,
} from "../shared/process-policy.js";
import { assertWorkspacePath } from "../shared/paths.js";
import { redactEvaluationValue } from "../evals/redaction.js";
import { isNeverRemotePath, scanSecrets } from "../privacy/policy.js";
import {
  isKnownSafeShellCommand,
  shellCommandEscapesWorkspace,
} from "../tools/permissions.js";
import { ToolError } from "../tools/errors.js";
import type { CheckpointService } from "../checkpoint/checkpoint.js";
import {
  driverProfileCanWrite,
  type ExactModelIdentity,
  type ModelDriverProfile,
  type WriteAuthority,
} from "../driver/profile.js";

/** Network authority understood by the host boundary, not by model text. */
export type ExecutionNetworkMode = "strict-zero" | "allow";

export interface ExecutionBrokerOptions {
  root: string;
  networkMode?: ExecutionNetworkMode;
  /** Host-declared mutation authority; model callers must opt into none until certified. */
  writeAuthority?: WriteAuthority;
  /** Permit opaque process entrypoints only for trusted host callers. */
  allowUnverifiedProcesses?: boolean;
  /** Optional exact profile used to derive bounded model write authority. */
  driverProfile?: ModelDriverProfile;
  driverIdentity?: ExactModelIdentity;
  /** Host-discovered command used when RunTests is called without arguments;
   * allowed verbatim through the strict-zero local process allowlist. */
  defaultTestCommand?: string;
}

export interface BrokerWriteOptions {
  checkpoint?: CheckpointService;
  checkpointId?: string;
  /** Use an exclusive create operation instead of allowing replacement. */
  exclusive?: boolean;
}

export interface BrokerDeleteOptions {
  checkpoint?: CheckpointService;
  checkpointId?: string;
}

export interface BrokerObservationOptions {
  protectedPath?: boolean;
}

// Catches a `..` traversal segment anywhere in the argument (bounded by a
// separator or the string edge on both sides), not only a leading one --
// `sub/../../secret.txt` must be rejected exactly like `../secret.txt`.
const OUTSIDE_ARGUMENT_PATTERN =
  /(?:^|[\\/])\.\.(?:[\\/]|$)|^[A-Za-z]:[\\/]|^[\\/]/u;

function isStrictZeroProcessAllowlisted(
  command: string,
  defaultTestCommand?: string,
): boolean {
  const normalized = command.trim();
  // The allowlist is only meaningful for one simple command. Shell control
  // operators could append an arbitrary second process after an otherwise
  // harmless prefix (for example `rg --files; whoami`). A native OS adapter
  // is required before permitting compound shell syntax.
  if (/[;&|<>`\r\n]/u.test(normalized)) return false;
  // The project's own configured test command (host-discovered per task,
  // not model-chosen) is allowed verbatim regardless of language/toolchain
  // -- otherwise strict-zero's fixed Bun-specific patterns below reject
  // RunTests for every non-Bun target project, contradicting the
  // documented "configured local test commands are allowed" guarantee.
  if (
    defaultTestCommand !== undefined &&
    normalized === defaultTestCommand.trim()
  )
    return true;
  // Repository search and read-only Git inspection reuse the single
  // shared "safe command" source of truth (src/tools/permissions.ts)
  // instead of a second, independently-maintained pattern set that could
  // silently drift from it -- this list previously omitted `cat`/`ls`/
  // `dir`/`pwd`/`grep`, which permissions.ts already treated as safe.
  if (isKnownSafeShellCommand(normalized)) return true;
  // Genuinely broker-specific allowances beyond "safe to classify without
  // approval": version probes and no-op commands that don't read
  // workspace content, so they don't belong in permissions.ts's read/
  // safe-execute classification. `bun|npm|pnpm|yarn test`/`run
  // typecheck|lint|format:check` are already covered by
  // isKnownSafeShellCommand above via its safeExecutePatterns.
  return (
    /(?:^|[\\/\s])(?:node|nodejs|deno|bun)(?:\.exe)?\s+--version(?:\s|$)/iu.test(
      normalized,
    ) || /^(?:cmd(?:\.exe)?\s+\/c\s+(?:echo|exit)\b|echo\b)/iu.test(normalized)
  );
}

function boundaryError(relativePath: string, message: string): ToolError {
  return new ToolError("OUTSIDE_WORKSPACE", message, {
    path: relativePath,
    recoverable: false,
    suggestedAction: "Use a workspace-relative path inside the repository.",
  });
}

function processPolicyError(error: ProcessPolicyError): ToolError {
  return new ToolError(
    "PERMISSION_DENIED",
    "The host process policy denied this command.",
    {
      recoverable: false,
      suggestedAction:
        error.code === "DESTRUCTIVE_PROCESS_DISABLED"
          ? "Use a non-destructive command or request explicit approval."
          : "Use a command that does not require network access in strict-zero mode.",
      details: { processPolicyCode: error.code },
    },
  );
}

function redactProcessResult(
  result: ProcessResult,
  redact: (text: string) => string,
): ProcessResult {
  return {
    ...result,
    stdout: redact(result.stdout),
    stderr: redact(result.stderr),
  };
}

/**
 * Host-side side-effect boundary for model-requested workspace operations.
 *
 * The broker deliberately owns no task or UI state. It only enforces the
 * workspace, process, network, checkpoint, and observation boundaries before
 * delegating to the existing tested host primitives.
 */
export class ExecutionBroker {
  readonly root: string;
  readonly networkMode: ExecutionNetworkMode;
  readonly writeAuthority: WriteAuthority;
  readonly allowUnverifiedProcesses: boolean;
  private readonly defaultTestCommand: string | undefined;

  constructor(options: ExecutionBrokerOptions) {
    this.root = path.resolve(options.root);
    this.networkMode = options.networkMode ?? "strict-zero";
    this.allowUnverifiedProcesses = options.allowUnverifiedProcesses ?? true;
    this.writeAuthority =
      options.writeAuthority ??
      (options.driverProfile
        ? driverProfileCanWrite(options.driverProfile, options.driverIdentity)
          ? "bounded"
          : "none"
        : "bounded");
    this.defaultTestCommand = options.defaultTestCommand;
  }

  /** Resolve and symlink-check a model-provided workspace-relative path. */
  async resolvePath(relativePath: string): Promise<string> {
    if (typeof relativePath !== "string" || relativePath.trim().length === 0)
      throw new ToolError(
        "INVALID_ARGUMENT",
        "A non-empty workspace path is required.",
        {
          recoverable: true,
          field: "path",
        },
      );
    return assertWorkspacePath(this.root, relativePath);
  }

  /**
   * Check both the model-provided path and its canonical target. A junction
   * can make a harmless-looking alias resolve into `.env`, `secrets/`, or a
   * private-key directory, so lexical classification alone is insufficient.
   */
  async isProtectedPath(relativePath: string): Promise<boolean> {
    const absolute = await this.resolvePath(relativePath);
    if (isNeverRemotePath(relativePath)) return true;
    const root = await realpath(this.root);
    try {
      const target = await realpath(absolute);
      return isNeverRemotePath(path.relative(root, target));
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        try {
          const parent = await realpath(path.dirname(absolute));
          return isNeverRemotePath(
            path.relative(root, path.join(parent, path.basename(absolute))),
          );
        } catch (parentError) {
          if (
            parentError instanceof Error &&
            "code" in parentError &&
            (parentError as NodeJS.ErrnoException).code === "ENOENT"
          )
            return false;
          throw parentError;
        }
      }
      throw error;
    }
  }

  private async resolveCwd(cwd: string | undefined): Promise<string> {
    const root = await realpath(this.root);
    const requested = cwd === undefined ? root : path.resolve(root, cwd);
    const relative = path.relative(root, requested);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw boundaryError(
        cwd ?? ".",
        "The process working directory is outside the workspace.",
      );
    return assertWorkspacePath(root, relative || ".");
  }

  private async canonicalParent(absolute: string): Promise<string> {
    const root = await realpath(this.root);
    const parent = await realpath(path.dirname(absolute));
    const relative = path.relative(root, parent);
    if (relative.startsWith("..") || path.isAbsolute(relative))
      throw boundaryError(
        path.dirname(absolute),
        "The canonical file parent is outside the workspace boundary.",
      );
    return parent;
  }

  private async canonicalWriteTarget(
    relativePath: string,
    absolute: string,
  ): Promise<string> {
    const parent = await this.canonicalParent(absolute);
    try {
      const target = await realpath(absolute);
      const root = await realpath(this.root);
      const relative = path.relative(root, target);
      if (relative.startsWith("..") || path.isAbsolute(relative))
        throw boundaryError(
          relativePath,
          "The canonical file target is outside the workspace boundary.",
        );
      return target;
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      )
        return path.join(parent, path.basename(absolute));
      throw error;
    }
  }

  private assertCommandBoundary(
    args: readonly string[],
    policyCommand: string,
    options: Pick<ProcessOptions, "intent" | "allowDestructive">,
  ): void {
    if (shellCommandEscapesWorkspace(policyCommand))
      throw boundaryError(
        ".",
        "The command attempts to leave the workspace boundary.",
      );
    const outsideArgument = args.find((argument) =>
      OUTSIDE_ARGUMENT_PATTERN.test(argument.trim()),
    );
    if (outsideArgument !== undefined)
      throw boundaryError(
        outsideArgument,
        "The command contains a path outside the workspace boundary.",
      );
    // Destructiveness is orthogonal to network policy, so this must run
    // regardless of networkMode: nesting it under the strict-zero branch
    // let a destructive command through unchecked by the broker itself
    // whenever network was allowed (masked only by tool-layer
    // classification in shellTool/runTestsTool, which the broker cannot
    // assume every caller replicates).
    try {
      assertProcessPolicy({
        command: policyCommand,
        intent: options.intent,
        network: this.networkMode === "strict-zero" ? "deny" : "allow",
        allowDestructive: options.allowDestructive,
      });
    } catch (error) {
      if (error instanceof ProcessPolicyError) throw processPolicyError(error);
      throw error;
    }
    if (
      this.networkMode === "strict-zero" &&
      commandRequiresNetwork(policyCommand)
    )
      throw new ToolError(
        "PERMISSION_DENIED",
        "Network-capable process execution is disabled in strict-zero mode.",
        {
          recoverable: false,
          suggestedAction:
            "Use a local command or an explicitly network-enabled host policy.",
          details: { processPolicyCode: "NETWORK_DISABLED" },
        },
      );
    if (
      this.networkMode === "strict-zero" &&
      !this.allowUnverifiedProcesses &&
      !isStrictZeroProcessAllowlisted(policyCommand, this.defaultTestCommand)
    )
      throw new ToolError(
        "PERMISSION_DENIED",
        "This process is not in the strict-zero local allowlist and no OS isolation adapter is available.",
        {
          recoverable: false,
          suggestedAction:
            "Use a repository tool or a certified host process adapter before executing this command.",
          details: { processPolicyCode: "UNVERIFIED_PROCESS" },
        },
      );
  }

  private effectiveNetwork(options: ProcessOptions): ProcessOptions["network"] {
    if (this.networkMode === "strict-zero") return "deny";
    return options.network;
  }

  private redactChunk(
    onOutput: ProcessOptions["onOutput"],
  ): ProcessOptions["onOutput"] {
    if (!onOutput) return undefined;
    return (chunk: ProcessOutputChunk) =>
      onOutput({ stream: chunk.stream, text: this.redactText(chunk.text) });
  }

  /** Execute an argv command after host-side cwd, path, and network checks. */
  async runCommand(
    command: string,
    args: string[] = [],
    options: ProcessOptions,
  ): Promise<ProcessResult> {
    const policyCommand = options.policyCommand ?? [command, ...args].join(" ");
    this.assertCommandBoundary(args, policyCommand, options);
    const cwd = await this.resolveCwd(options.cwd);
    try {
      const result = await hostRunCommand(command, args, {
        ...options,
        cwd,
        policyCommand,
        network: this.effectiveNetwork(options),
        onOutput: this.redactChunk(options.onOutput),
      });
      return redactProcessResult(result, (text) => this.redactText(text));
    } catch (error) {
      if (error instanceof ProcessPolicyError) throw processPolicyError(error);
      throw error;
    }
  }

  /** Execute shell text through the same host policy as argv commands. */
  async runShellCommand(
    command: string,
    options: ProcessOptions,
  ): Promise<ProcessResult> {
    const policyCommand = options.policyCommand ?? command;
    if (/^(?:[A-Za-z]:[\\/]|[\\/])/u.test(policyCommand.trim()))
      throw boundaryError(
        policyCommand.trim().slice(0, 256),
        "The shell command starts with an absolute path outside the workspace boundary.",
      );
    this.assertCommandBoundary([], policyCommand, options);
    const cwd = await this.resolveCwd(options.cwd);
    try {
      const result = await hostRunShellCommand(command, {
        ...options,
        cwd,
        policyCommand,
        network: this.effectiveNetwork(options),
        onOutput: this.redactChunk(options.onOutput),
      });
      return redactProcessResult(result, (text) => this.redactText(text));
    } catch (error) {
      if (error instanceof ProcessPolicyError) throw processPolicyError(error);
      throw error;
    }
  }

  /** Write one workspace file only after path and checkpoint checks. */
  async writeFile(
    relativePath: string,
    content: string,
    options: BrokerWriteOptions = {},
  ): Promise<string> {
    this.assertWriteAuthority();
    const absolute = await this.resolvePath(relativePath);
    if (!options.checkpoint || !options.checkpointId)
      throw new ToolError(
        "CONFLICT",
        "Workspace writes require an active checkpoint.",
        {
          recoverable: true,
          path: relativePath,
          suggestedAction:
            "Create or restore the active checkpoint before writing.",
        },
      );
    await options.checkpoint.assertNoExternalChange(
      options.checkpointId,
      relativePath,
    );
    // canonicalWriteTarget re-derives the canonical path with its own
    // fresh realpath calls immediately below, so a newly introduced
    // symlink is still caught right before the side effect without a
    // separate discarded-result resolvePath() call first.
    const target = await this.canonicalWriteTarget(relativePath, absolute);
    if (options.exclusive) {
      // O_EXCL refuses an existing link on supported hosts, so a concurrent
      // alias cannot turn a create into an outside write.
      await fsWriteFile(target, content, { encoding: "utf8", flag: "wx" });
    } else {
      // Replacements are staged beside the target and committed with rename.
      // The rename never follows a target symlink, and the canonical parent
      // prevents a parent-directory swap from redirecting the temporary file.
      const temporary = path.join(
        path.dirname(target),
        `.${path.basename(target)}.shelra-${randomUUID()}.tmp`,
      );
      try {
        await fsWriteFile(temporary, content, {
          encoding: "utf8",
          flag: "wx",
        });
        await rename(temporary, target);
      } finally {
        await fsUnlink(temporary).catch(() => {});
      }
    }
    return absolute;
  }

  /** Delete one workspace file only after path and checkpoint checks. */
  async deleteFile(
    relativePath: string,
    options: BrokerDeleteOptions = {},
  ): Promise<void> {
    this.assertWriteAuthority();
    const absolute = await this.resolvePath(relativePath);
    if (!options.checkpoint || !options.checkpointId)
      throw new ToolError(
        "CONFLICT",
        "Workspace deletes require an active checkpoint.",
        {
          recoverable: true,
          path: relativePath,
          suggestedAction:
            "Create or restore the active checkpoint before deleting.",
        },
      );
    await options.checkpoint.assertNoExternalChange(
      options.checkpointId,
      relativePath,
    );
    // canonicalParent re-derives the canonical parent with a fresh
    // realpath call immediately below, so a newly introduced symlink is
    // still caught right before the unlink without a separate
    // discarded-result resolvePath() call first.
    const parent = await this.canonicalParent(absolute);
    // Unlinking the canonical parent/name removes a link itself instead of
    // following its target, while preventing a parent symlink escape.
    await fsUnlink(path.join(parent, path.basename(absolute)));
  }

  /** Reject model mutations before checkpoint or filesystem work begins. */
  assertWriteAuthority(): void {
    if (this.writeAuthority !== "none") return;
    throw new ToolError(
      "PERMISSION_DENIED",
      "Workspace mutation requires a current certified Driver profile.",
      {
        recoverable: false,
        suggestedAction:
          "Calibrate the exact model/runtime configuration before requesting a write.",
        details: { authority: "none", reason: "driver_profile_uncertified" },
      },
    );
  }

  /**
   * Redact a value before it becomes model-visible or persistable.
   *
   * `scanSecrets` and `redactEvaluationValue` use different pattern sets: a
   * private key needs both a BEGIN and END marker in the same string to be
   * redacted, but `scanSecrets` flags the BEGIN marker alone. When a live
   * output chunk is split across that boundary (see the ~150ms batcher in
   * `src/shared/process.ts`), `redactEvaluationValue` finds nothing to
   * redact even though `scanSecrets` correctly flagged the chunk as
   * sensitive — relabeling a literal `"[REDACTED]"` token that was never
   * inserted is then a no-op, and the raw chunk passes through untouched.
   * Redacting the whole value in that case, instead of only relabeling
   * whatever `redactEvaluationValue` already touched, closes that gap.
   */
  redactText(value: string, options: BrokerObservationOptions = {}): string {
    if (options.protectedPath) return "[REDACTED: protected path]";
    const redacted = redactEvaluationValue(value);
    const text = typeof redacted === "string" ? redacted : String(redacted);
    if (scanSecrets(value).length === 0) return text;
    return text.includes("[REDACTED]")
      ? text.replaceAll("[REDACTED]", "[REDACTED SENSITIVE TOOL OUTPUT]")
      : "[REDACTED SENSITIVE TOOL OUTPUT]";
  }
}

export function createExecutionBroker(
  options: ExecutionBrokerOptions,
): ExecutionBroker {
  return new ExecutionBroker(options);
}
