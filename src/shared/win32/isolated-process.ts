import type { Pointer } from "bun:ffi";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  kernel32,
  wstr,
  ptrOf,
  asPointer,
  readHandle,
  EXTENDED_STARTUPINFO_PRESENT,
  CREATE_UNICODE_ENVIRONMENT,
  CREATE_NO_WINDOW,
  STARTF_USESTDHANDLES,
  GENERIC_WRITE,
  FILE_SHARE_READ,
  FILE_SHARE_WRITE,
  FILE_SHARE_DELETE,
  CREATE_ALWAYS,
  FILE_ATTRIBUTE_NORMAL,
  PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
  inheritableSecurityAttributes,
} from "./ffi.js";
import { WindowsJob } from "./job-object.js";
import {
  getAppContainerSid,
  grantWorkspaceAccess,
  buildZeroCapabilitySecurityCapabilities,
} from "./app-container.js";

export interface IsolatedSpawnOptions {
  cwd: string;
  env: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  maxOutputChars: number;
  onOutput?: (chunk: { stream: "stdout" | "stderr"; text: string }) => void;
  /** Apply the zero-capability AppContainer for real network denial. When
   * false, only Job Object lifecycle containment is applied. */
  denyNetwork: boolean;
}

export interface IsolatedSpawnResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  timedOut: boolean;
  mechanism: "job_object" | "job_object+app_container";
}

/** Quotes one argv element per the MSVCRT/CommandLineToArgvW convention
 * that CreateProcessW's callees parse their command line with. */
function quoteWindowsArgument(argument: string): string {
  if (argument.length > 0 && !/[\s"]/u.test(argument)) return argument;
  let result = '"';
  let backslashes = 0;
  for (const char of argument) {
    if (char === "\\") {
      backslashes += 1;
      continue;
    }
    if (char === '"') {
      result += "\\".repeat(backslashes * 2 + 1) + '"';
      backslashes = 0;
      continue;
    }
    result += "\\".repeat(backslashes) + char;
    backslashes = 0;
  }
  result += "\\".repeat(backslashes * 2) + '"';
  return result;
}

function buildCommandLine(command: string, args: readonly string[]): string {
  return [command, ...args].map(quoteWindowsArgument).join(" ");
}

/**
 * Windows programs (including `bun.exe` itself) rely on a handful of
 * OS-level variables being present in their environment to initialize at
 * all -- omitting them isn't a graceful "feature not configured" failure,
 * it crashes the child with an access violation (verified: a caller-scoped
 * env containing only `PATH` reliably produced exit code `0xC0000005`).
 * None of these are secret, so folding in the host's real values is safe
 * regardless of what the caller filtered out of `env` for credential
 * redaction purposes.
 */
const ESSENTIAL_WINDOWS_ENV_NAMES = [
  "SystemRoot",
  "windir",
  "ComSpec",
  "TEMP",
  "TMP",
  "LOCALAPPDATA",
  "APPDATA",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "USERNAME",
  "USERDOMAIN",
];

function withEssentialWindowsEnv(
  env: Record<string, string>,
): Record<string, string> {
  const merged = { ...env };
  const haveUpper = new Set(
    Object.keys(merged).map((key) => key.toUpperCase()),
  );
  for (const name of ESSENTIAL_WINDOWS_ENV_NAMES) {
    const value = process.env[name];
    if (value !== undefined && !haveUpper.has(name.toUpperCase()))
      merged[name] = value;
  }
  return merged;
}

/** Double-null-terminated `NAME=VALUE\0...\0\0` block for
 * `CREATE_UNICODE_ENVIRONMENT`. */
function buildEnvironmentBlock(env: Record<string, string>): Uint8Array {
  const entries = Object.entries(withEssentialWindowsEnv(env)).map(
    ([key, value]) => `${key}=${value}`,
  );
  const text = entries.length > 0 ? `${entries.join("\0")}\0\0` : "\0\0";
  const buf = new Uint8Array(text.length * 2);
  const view = new DataView(buf.buffer);
  for (let index = 0; index < text.length; index += 1)
    view.setUint16(index * 2, text.charCodeAt(index), true);
  return buf;
}

function createInheritableFile(filePath: string): Pointer | null {
  const sa = inheritableSecurityAttributes();
  const handle = kernel32.CreateFileW(
    ptrOf(wstr(filePath)),
    GENERIC_WRITE,
    FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
    ptrOf(sa),
    CREATE_ALWAYS,
    FILE_ATTRIBUTE_NORMAL,
    null,
  );
  if (!handle) return null;
  const asNumber = Number(handle);
  return asNumber !== -1 ? asPointer(asNumber) : null;
}

class GrowingFileReader {
  private position = 0;
  private decoder = new TextDecoder();
  private full = "";
  private truncated = false;

  constructor(
    private readonly filePath: string,
    private readonly stream: "stdout" | "stderr",
    private readonly maxChars: number,
    private readonly onOutput: IsolatedSpawnOptions["onOutput"],
  ) {}

  async poll(): Promise<void> {
    if (this.truncated) return;
    let size: number;
    try {
      size = (await stat(this.filePath)).size;
    } catch {
      return;
    }
    if (size <= this.position) return;
    const handle = await Bun.file(this.filePath).arrayBuffer();
    const bytes = new Uint8Array(handle).subarray(this.position);
    this.position = size;
    this.append(this.decoder.decode(bytes, { stream: true }));
  }

  async finish(): Promise<{ text: string; truncated: boolean }> {
    try {
      const finalBytes = await readFile(this.filePath);
      if (finalBytes.length > this.position) {
        const tail = finalBytes.subarray(this.position);
        this.position = finalBytes.length;
        this.append(this.decoder.decode(tail, { stream: true }));
      }
    } catch {
      // File may be gone if the process never actually wrote to it.
    }
    this.append(this.decoder.decode());
    return { text: this.full, truncated: this.truncated };
  }

  private append(text: string): void {
    if (!text || this.truncated) return;
    const remaining = Math.max(0, this.maxChars - this.full.length);
    if (remaining <= 0) {
      this.truncated = true;
      return;
    }
    const accepted = text.slice(0, remaining);
    this.full += accepted;
    if (accepted.length < text.length) this.truncated = true;
    if (accepted) this.onOutput?.({ stream: this.stream, text: accepted });
  }
}

function abortError(): DOMException {
  return new DOMException("Process aborted", "AbortError");
}

function timeoutError(): DOMException {
  return new DOMException("Process timed out", "TimeoutError");
}

/**
 * Spawns a command with real OS containment on Windows: Job Object
 * lifecycle containment always, plus a zero-capability AppContainer (no
 * `internetClient`/`internetClientServer`/`privateNetworkClientServer`
 * capability) when `denyNetwork` is set, which blocks outbound network
 * access at the Windows Filtering Platform layer -- verified with `ping`
 * and `curl` against a real host, both denied inside the container while
 * succeeding outside it.
 *
 * Returns `null` when isolation cannot be set up for this call (no
 * AppContainer support, ACL grant failed, ...); the caller must fall back
 * to the existing `Bun.spawn` path rather than treat that as a command
 * failure.
 */
export async function spawnIsolatedWindows(
  command: string,
  args: readonly string[],
  options: IsolatedSpawnOptions,
): Promise<IsolatedSpawnResult | null> {
  if (options.signal?.aborted) throw abortError();

  const job = WindowsJob.create();
  if (!job) return null;

  let mechanism: IsolatedSpawnResult["mechanism"] = "job_object";
  let attributeList: Uint8Array | null = null;
  let startupInfo: Uint8Array;

  const sid = options.denyNetwork ? getAppContainerSid() : null;
  const appContainerReady =
    sid !== null &&
    options.denyNetwork &&
    (await grantWorkspaceAccess(options.cwd));

  if (appContainerReady && sid !== null) {
    const secCap = buildZeroCapabilitySecurityCapabilities(sid);
    const sizeBuf = new Uint8Array(8);
    kernel32.InitializeProcThreadAttributeList(null, 1, 0, ptrOf(sizeBuf));
    const requiredSize = Number(
      new DataView(sizeBuf.buffer).getBigUint64(0, true),
    );
    attributeList = new Uint8Array(requiredSize);
    if (
      !kernel32.InitializeProcThreadAttributeList(
        ptrOf(attributeList),
        1,
        0,
        ptrOf(sizeBuf),
      )
    ) {
      job.close();
      return null;
    }
    const updated = kernel32.UpdateProcThreadAttribute(
      ptrOf(attributeList),
      0,
      PROC_THREAD_ATTRIBUTE_SECURITY_CAPABILITIES,
      ptrOf(secCap),
      24,
      null,
      null,
    );
    if (!updated) {
      kernel32.DeleteProcThreadAttributeList(ptrOf(attributeList));
      job.close();
      return null;
    }
    mechanism = "job_object+app_container";
    startupInfo = new Uint8Array(112);
    new DataView(startupInfo.buffer).setUint32(0, 112, true);
  } else {
    startupInfo = new Uint8Array(104);
    new DataView(startupInfo.buffer).setUint32(0, 104, true);
  }

  const tempDir = await mkdtemp(path.join(os.tmpdir(), "shelra-isolated-"));
  const stdoutPath = path.join(tempDir, "stdout.bin");
  const stderrPath = path.join(tempDir, "stderr.bin");
  const hStdOutput = createInheritableFile(stdoutPath);
  const hStdError = createInheritableFile(stderrPath);
  if (hStdOutput === null || hStdError === null) {
    if (hStdOutput !== null) kernel32.CloseHandle(hStdOutput);
    if (hStdError !== null) kernel32.CloseHandle(hStdError);
    if (attributeList)
      kernel32.DeleteProcThreadAttributeList(ptrOf(attributeList));
    job.close();
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    return null;
  }

  const siView = new DataView(startupInfo.buffer);
  siView.setUint32(60, STARTF_USESTDHANDLES, true);
  siView.setBigUint64(80, 0n, true);
  siView.setBigUint64(88, BigInt(hStdOutput), true);
  siView.setBigUint64(96, BigInt(hStdError), true);
  if (attributeList)
    siView.setBigUint64(104, BigInt(ptrOf(attributeList)), true);

  const commandLine = wstr(buildCommandLine(command, args));
  const cwdBuf = wstr(options.cwd);
  const envBlock = buildEnvironmentBlock(options.env);
  const piBuf = new Uint8Array(24);

  const flags =
    (attributeList ? EXTENDED_STARTUPINFO_PRESENT : 0) |
    CREATE_UNICODE_ENVIRONMENT |
    CREATE_NO_WINDOW;

  const created = kernel32.CreateProcessW(
    null,
    ptrOf(commandLine),
    null,
    null,
    1,
    flags,
    ptrOf(envBlock),
    ptrOf(cwdBuf),
    ptrOf(startupInfo),
    ptrOf(piBuf),
  );

  kernel32.CloseHandle(hStdOutput);
  kernel32.CloseHandle(hStdError);
  if (attributeList)
    kernel32.DeleteProcThreadAttributeList(ptrOf(attributeList));

  if (!created) {
    const lastError = kernel32.GetLastError();
    job.close();
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    const ERROR_FILE_NOT_FOUND = 2;
    if (lastError === ERROR_FILE_NOT_FOUND)
      return {
        exitCode: 127,
        stdout: "",
        stderr: `${command}: command not found`,
        stdoutTruncated: false,
        stderrTruncated: false,
        timedOut: false,
        mechanism,
      };
    return null;
  }

  const piView = new DataView(piBuf.buffer);
  const hProcess = readHandle(piView, 0);
  const hThread = readHandle(piView, 8);
  job.assign(hProcess);
  kernel32.CloseHandle(hThread);

  const stdoutReader = new GrowingFileReader(
    stdoutPath,
    "stdout",
    options.maxOutputChars,
    options.onOutput,
  );
  const stderrReader = new GrowingFileReader(
    stderrPath,
    "stderr",
    options.maxOutputChars,
    options.onOutput,
  );

  let timedOut = false;
  let aborted = false;
  const deadline =
    options.timeoutMs !== undefined
      ? Date.now() + options.timeoutMs
      : undefined;

  try {
    for (;;) {
      const waitMs = 150;
      const signaled = kernel32.WaitForSingleObject(hProcess, waitMs);
      await Promise.all([stdoutReader.poll(), stderrReader.poll()]);
      if (signaled === 0) break;
      if (options.signal?.aborted) {
        aborted = true;
        break;
      }
      if (deadline !== undefined && Date.now() >= deadline) {
        timedOut = true;
        break;
      }
    }
  } finally {
    if (timedOut || aborted) job.terminate();
  }

  const exitCodeBuf = new Uint8Array(4);
  kernel32.GetExitCodeProcess(hProcess, ptrOf(exitCodeBuf));
  const exitCode = new DataView(exitCodeBuf.buffer).getUint32(0, true);

  const [stdout, stderr] = await Promise.all([
    stdoutReader.finish(),
    stderrReader.finish(),
  ]);

  job.close();
  kernel32.CloseHandle(hProcess);
  await rm(tempDir, { recursive: true, force: true }).catch(() => {});

  if (timedOut) throw timeoutError();
  if (aborted) throw abortError();

  return {
    exitCode,
    stdout: stdout.text,
    stderr: stderr.text,
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
    timedOut: false,
    mechanism,
  };
}
