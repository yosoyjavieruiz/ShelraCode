import type { LocalCodeLogger } from "./logging.js";
import {
  commandRequiresNetwork,
  ProcessPolicyError,
  type ProcessNetworkPolicy,
} from "./process-policy.js";

export { ProcessPolicyError } from "./process-policy.js";

export interface ProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  /** Wall-clock duration measured by the host, when a process was spawned. */
  durationMs?: number;
  /** True only when the host timeout terminated the process. */
  timedOut?: boolean;
}

export interface ProcessOutputChunk {
  stream: "stdout" | "stderr";
  text: string;
}

export interface ProcessOptions {
  cwd?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  env?: Record<string, string | undefined>;
  /** Lower-level egress policy for process wrappers. */
  network?: ProcessNetworkPolicy;
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
  'const encoded = process.argv[1];',
  'if (!encoded) throw new Error("Missing encoded shell command");',
  'const command = Buffer.from(encoded, "base64").toString("utf8");',
  'const rawCommand = { raw: command };',
  'const result = await $`${rawCommand}`.nothrow();',
  'process.exit(result.exitCode);',
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
): Promise<string> {
  if (!stream) return "";
  const batcher = createOutputBatcher(streamName, onOutput);
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let full = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const text = decoder.decode(value, { stream: true });
      full += text;
      batcher.push(text);
    }
    full += decoder.decode();
  } finally {
    batcher.flush();
  }
  return full;
}

function spawnProcess(
  command: string,
  args: string[],
  options: ProcessOptions,
) {
  return Bun.spawn([command, ...args], {
    cwd: options.cwd,
    env: options.env,
    stdout: "pipe",
    stderr: "pipe",
  });
}

export async function runCommand(
  command: string,
  args: string[] = [],
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  if (options.signal?.aborted) throw abortError();
  const policyCommand = options.policyCommand ?? [command, ...args].join(" ");
  if (options.network === "deny" && commandRequiresNetwork(policyCommand))
    throw new ProcessPolicyError(policyCommand);

  const started = performance.now();
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
      readAndTrack(child.stdout, "stdout", options.onOutput),
      readAndTrack(child.stderr, "stderr", options.onOutput),
    ]);
    if (timedOut) throw timeoutError();
    if (aborted || options.signal?.aborted) throw abortError();
    const result = {
      exitCode,
      stdout,
      stderr,
      durationMs: Math.round(performance.now() - started),
      timedOut: false,
    };
    const data = {
      command,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: false,
      stdoutLength: result.stdout.length,
      stderrLength: result.stderr.length,
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
  options: ProcessOptions = {},
): Promise<ProcessResult> {
  const encoded = Buffer.from(command, "utf8").toString("base64");
  return runCommand(
    process.execPath,
    ["-e", PORTABLE_SHELL_RUNNER, encoded],
    { ...options, policyCommand: options.policyCommand ?? command },
  );
}
