import type { LocalCodeLogger } from "./logging.js";
import {
  assertProcessPolicy,
  safeProcessEnvironment,
  type ProcessIntent,
  type ProcessNetworkPolicy,
} from "./process-policy.js";
import {
  enforceProcessIsolation,
  statusFromIsolatedSpawn,
  type ProcessIsolationMode,
  type ProcessIsolationStatus,
} from "./process-isolation.js";

export { ProcessPolicyError } from "./process-policy.js";
export { ProcessIsolationError } from "./process-isolation.js";

export const DEFAULT_PROCESS_OUTPUT_CHARS = 100_000;
export const MAX_PROCESS_OUTPUT_CHARS = 1_000_000;

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Wall-clock duration measured by the host, when a process was spawned. */
  durationMs?: number;
  /** True only when the host timeout terminated the process. */
  timedOut?: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  isolation: ProcessIsolationStatus;
}

export interface ProcessOutputChunk {
  stream: "stdout" | "stderr";
  text: string;
}

export interface ProcessOptions {
  /** Host-declared operation class required before a child is spawned. */
  intent: ProcessIntent;
  cwd?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  /** Lower-level egress policy for process wrappers. */
  network?: ProcessNetworkPolicy;
  allowDestructive?: boolean;
  isolation?: ProcessIsolationMode;
  /** Explicit opt-in for environments where an OS sandbox is unavailable. */
  allowWeakIsolation?: boolean;
  /** Maximum retained characters per output stream. */
  maxOutputChars?: number;
  /** Original user/model command when `command` is a shell executable. */
  policyCommand?: string;
  /**
   * Fired with output as the process produces it, batched to roughly one
   * flush every ~150ms per stream rather than once per OS pipe read — a
   * long `bun test` can otherwise write dozens of tiny chunks a second,
   * and a UI callback firing that often would be its own performance
   * problem (see docs/ui-chat-v2/STATUS.md, "no full transcript rerender
   * per token"). The final `stdout`/`stderr` returned by `runCommand` is
   * unaffected either way — this is purely an additional, optional live
   * view of output that's already being collected.
   */
  onOutput?: (chunk: ProcessOutputChunk) => void;
  /** Structured lifecycle logging; command output is never logged verbatim. */
  logger?: LocalCodeLogger;
}

const PORTABLE_SHELL_RUNNER = [
  'import { $ } from "bun";',
  "const encoded = process.argv[1];",
  'if (!encoded) throw new Error("Missing encoded shell command");',
  'const command = Buffer.from(encoded, "base64").toString("utf8");',
  "const rawCommand = { raw: command };",
  "const result = await $`${rawCommand}`.nothrow();",
  "process.exit(result.exitCode);",
].join("\n");

function abortError(): DOMException {
  return new DOMException("Process aborted", "AbortError");
}

function timeoutError(): DOMException {
  return new DOMException("Process timed out", "TimeoutError");
}

function isMissingExecutable(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

// Batches onOutput calls to ~1 per 150ms per stream instead of one per raw
// pipe read, so a chatty process can't turn into a UI-update flood. Buffers
// text between flushes; a caller with no onOutput pays nothing extra.
function createOutputBatcher(
  stream: ProcessOutputChunk["stream"],
  onOutput: ProcessOptions["onOutput"],
): { push: (text: string) => void; flush: () => void } {
  if (!onOutput) return { push: () => {}, flush: () => {} };
  let buffer = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (buffer) {
      onOutput({ stream, text: buffer });
      buffer = "";
    }
  };
  return {
    push: (text: string) => {
      if (!text) return;
      buffer += text;
      if (!timer) timer = setTimeout(flush, 150);
    },
    flush,
  };
}

async function readAndTrack(
  stream: ReadableStream<Uint8Array> | null | undefined,
  streamName: ProcessOutputChunk["stream"],
  onOutput: ProcessOptions["onOutput"],
  maxChars: number,
): Promise<{ text: string; truncated: boolean }> {
  if (!stream) return { text: "", truncated: false };
  const batcher = createOutputBatcher(streamName, onOutput);
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let truncated = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      const remaining = Math.max(0, maxChars - full.length);
      if (remaining > 0) {
        const accepted = text.slice(0, remaining);
        full += accepted;
        batcher.push(accepted);
        if (accepted.length < text.length) truncated = true;
      } else truncated = true;
    }
    const tail = decoder.decode();
    const remaining = Math.max(0, maxChars - full.length);
    if (remaining > 0) {
      const accepted = tail.slice(0, remaining);
      full += accepted;
      batcher.push(accepted);
      if (accepted.length < tail.length) truncated = true;
    } else if (tail.length > 0) truncated = true;
  } finally {
    batcher.flush();
  }
  return { text: full, truncated };
}

function spawnProcess(
  command: string,
  args: string[],
  options: ProcessOptions,
) {
  return Bun.spawn([command, ...args], {
    cwd: options.cwd,
    env: safeProcessEnvironment(options.env),
    stdout: "pipe",
    stderr: "pipe",
  });
}

/**
 * Attempts the real Windows OS boundary (Job Object + AppContainer, see
 * `src/shared/win32/isolated-process.ts`) for this call. Returns `null`
 * when unavailable for this specific call (non-Windows, or the adapter
 * failed to initialize) so the caller falls back to the plain `Bun.spawn`
 * path unchanged.
 */
async function tryRunCommandIsolatedWindows(
  command: string,
  args: string[],
  options: ProcessOptions,
  policyCommand: string,
  maxOutputChars: number,
  started: number,
): Promise<ProcessResult | null> {
  if (process.platform !== "win32") return null;
  const { spawnIsolatedWindows } = await import("./win32/isolated-process.js");
  options.logger?.debug("process.started", {
    command,
    argumentCount: args.length,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
  });
  let isolated;
  try {
    isolated = await spawnIsolatedWindows(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: safeProcessEnvironment(options.env),
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      maxOutputChars,
      onOutput: options.onOutput,
      // TODO(phase-12): AppContainer network denial is implemented and
      // independently verified for ordinary commands (ping/curl genuinely
      // blocked; workspace ACL grant makes file reads work; the
      // ERROR_ENVVAR_NOT_FOUND CreateProcessW failure this had was fixed by
      // widening ESSENTIAL_WINDOWS_ENV_NAMES in isolated-process.ts). But
      // `git` still fails inside it -- "unable to get current working
      // directory: Permission denied" from git itself in a fresh empty
      // directory, or CreateProcessW itself failing with ERROR_DIRECTORY
      // (267) intermittently for a large real repository -- and neither
      // reproduces with cmd.exe/type/dir against the same paths, so it
      // isn't a plain ACL gap the workspace grant could close. Root cause
      // not yet isolated; disabled by default until it is. Job Object
      // containment (always on, no ACL side effects) still applies
      // unconditionally regardless of this flag.
      denyNetwork: false,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError")
      options.logger?.warn("process.timed_out", {
        command,
        durationMs: Math.round(performance.now() - started),
        timedOut: true,
      });
    else if (
      error instanceof DOMException &&
      (error.name === "AbortError" || options.signal?.aborted)
    )
      options.logger?.info("process.cancelled", {
        command,
        durationMs: Math.round(performance.now() - started),
      });
    else
      options.logger?.error("process.failed", {
        command,
        durationMs: Math.round(performance.now() - started),
        errorType: error instanceof Error ? error.name : "unknown",
      });
    throw error;
  }
  if (!isolated) return null;
  const isolation = statusFromIsolatedSpawn(isolated.mechanism);
  const result: ProcessResult = {
    exitCode: isolated.exitCode,
    stdout: isolated.stdout,
    stderr: isolated.stderr,
    durationMs: Math.round(performance.now() - started),
    timedOut: false,
    stdoutTruncated: isolated.stdoutTruncated,
    stderrTruncated: isolated.stderrTruncated,
    isolation,
  };
  const data = {
    command,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    timedOut: false,
    stdoutLength: result.stdout.length,
    stderrLength: result.stderr.length,
    stdoutTruncated: result.stdoutTruncated,
    stderrTruncated: result.stderrTruncated,
    processIntent: options.intent,
    osIsolation: result.isolation.osEnforced,
    isolationMechanism: result.isolation.mechanism,
  };
  if (result.exitCode === 0 || result.exitCode === 127)
    options.logger?.info("process.finished", data);
  else options.logger?.warn("process.finished", data);
  return result;
}

export async function runCommand(
  command: string,
  args: string[] = [],
  options: ProcessOptions,
): Promise<ProcessResult> {
  if (options.signal?.aborted) throw abortError();
  const policyCommand = options.policyCommand ?? [command, ...args].join(" ");
  assertProcessPolicy({
    command: policyCommand,
    intent: options.intent,
    network: options.network,
    allowDestructive: options.allowDestructive,
  });
  let isolation = enforceProcessIsolation({
    mode: options.isolation,
    allowWeak: options.allowWeakIsolation,
  });
  const requestedOutputChars = options.maxOutputChars;
  const maxOutputChars = Number.isFinite(requestedOutputChars)
    ? Math.min(
        MAX_PROCESS_OUTPUT_CHARS,
        Math.max(1_024, Math.floor(requestedOutputChars!)),
      )
    : DEFAULT_PROCESS_OUTPUT_CHARS;

  const started = performance.now();
  const isolatedResult = await tryRunCommandIsolatedWindows(
    command,
    args,
    options,
    policyCommand,
    maxOutputChars,
    started,
  );
  if (isolatedResult) return isolatedResult;
  // The win32 adapter was attempted and declined this call (rare -- see
  // tryRunCommandIsolatedWindows); the pre-check `isolation` above was
  // optimistic about Job Object availability and must not be reported for
  // the plain Bun.spawn fallback that actually ran.
  if (process.platform === "win32") isolation = statusFromIsolatedSpawn("none");
  options.logger?.debug("process.started", {
    command,
    argumentCount: args.length,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.timeoutMs === undefined
      ? {}
      : { timeoutMs: options.timeoutMs }),
  });

  let child: ReturnType<typeof spawnProcess>;
  try {
    child = spawnProcess(command, args, options);
  } catch (error) {
    // A missing executable is a normal, expected outcome for optional
    // tooling (e.g. ripgrep) — surface it the way a shell would (exit 127)
    // instead of throwing, so callers can fall back without every call
    // site needing its own try/catch around process spawning.
    if (isMissingExecutable(error)) {
      const result = {
        exitCode: 127,
        stdout: "",
        stderr: `${command}: command not found`,
        durationMs: Math.round(performance.now() - started),
        timedOut: false,
        stdoutTruncated: false,
        stderrTruncated: false,
        isolation,
      };
      options.logger?.warn("process.finished", {
        command,
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        timedOut: false,
        missingExecutable: true,
      });
      return result;
    }
    throw error;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  let aborted = false;
  let timedOut = false;
  const stop = (): void => {
    aborted = true;
    child.kill();
  };

  options.signal?.addEventListener("abort", stop, { once: true });
  if (options.timeoutMs !== undefined)
    timer = setTimeout(() => {
      timedOut = true;
      stop();
    }, options.timeoutMs);

  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      readAndTrack(child.stdout, "stdout", options.onOutput, maxOutputChars),
      readAndTrack(child.stderr, "stderr", options.onOutput, maxOutputChars),
    ]);
    if (timedOut) throw timeoutError();
    if (aborted || options.signal?.aborted) throw abortError();
    const result = {
      exitCode,
      stdout: stdout.text,
      stderr: stderr.text,
      durationMs: Math.round(performance.now() - started),
      timedOut: false,
      stdoutTruncated: stdout.truncated,
      stderrTruncated: stderr.truncated,
      isolation,
    };
    const data = {
      command,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: false,
      stdoutLength: result.stdout.length,
      stderrLength: result.stderr.length,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
      processIntent: options.intent,
      osIsolation: result.isolation.osEnforced,
    };
    if (result.exitCode === 0) options.logger?.info("process.finished", data);
    else options.logger?.warn("process.finished", data);
    return result;
  } catch (error) {
    if (error instanceof DOMException && error.name === "TimeoutError")
      options.logger?.warn("process.timed_out", {
        command,
        durationMs: Math.round(performance.now() - started),
        timedOut: true,
      });
    else if (
      error instanceof DOMException &&
      (error.name === "AbortError" || options.signal?.aborted)
    )
      options.logger?.info("process.cancelled", {
        command,
        durationMs: Math.round(performance.now() - started),
      });
    else
      options.logger?.error("process.failed", {
        command,
        durationMs: Math.round(performance.now() - started),
        errorType: error instanceof Error ? error.name : "unknown",
      });
    throw error;
  } finally {
    if (timer) clearTimeout(timer);
    options.signal?.removeEventListener("abort", stop);
  }
}

/**
 * Execute shell text through Bun's cross-platform parser. Transporting the
 * command as base64 avoids the nested-quote corruption caused by cmd.exe /c
 * on Windows while retaining the existing process policy, output, timeout,
 * and cancellation boundary.
 */
export async function runShellCommand(
  command: string,
  options: ProcessOptions,
): Promise<ProcessResult> {
  const encoded = Buffer.from(command, "utf8").toString("base64");
  return runCommand(process.execPath, ["-e", PORTABLE_SHELL_RUNNER, encoded], {
    ...options,
    policyCommand: options.policyCommand ?? command,
  });
}
