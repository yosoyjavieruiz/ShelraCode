import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { userenv, wstr, ptrOf, HRESULT_ALREADY_EXISTS } from "./ffi.js";

const execFileAsync = promisify(execFile);

/** Fixed profile name: one AppContainer identity reused across all tasks. */
const PROFILE_NAME = "ShelraCode.ExecutionBroker";

/** Well-known "ALL APPLICATION PACKAGES" SID -- every AppContainer token
 * carries this group, so granting access to it (rather than to the one
 * derived per-profile SID) works for any AppContainer identity. */
const ALL_APPLICATION_PACKAGES_SID = "*S-1-15-2-1";

let cachedSidPointer: number | null | undefined;

/**
 * Returns a pointer to the PSID for the fixed ShelraCode AppContainer
 * profile, creating it on first use. Returns null if AppContainer support
 * is unavailable (pre-Windows 8, or a policy blocks profile creation) --
 * callers must treat that as "no OS network isolation available" rather
 * than fail the calling task.
 */
export function getAppContainerSid(): number | null {
  if (cachedSidPointer !== undefined) return cachedSidPointer;
  const nameBuf = wstr(PROFILE_NAME);
  const sidOut = new Uint8Array(8);
  let hr = userenv.CreateAppContainerProfile(
    ptrOf(nameBuf),
    ptrOf(wstr("ShelraCode Execution Broker")),
    ptrOf(wstr("Zero-capability sandbox for strict-zero process execution")),
    null,
    0,
    ptrOf(sidOut),
  );
  if (hr !== 0 && hr === HRESULT_ALREADY_EXISTS)
    hr = userenv.DeriveAppContainerSidFromAppContainerName(
      ptrOf(nameBuf),
      ptrOf(sidOut),
    );
  if (hr !== 0) {
    cachedSidPointer = null;
    return null;
  }
  cachedSidPointer = Number(new DataView(sidOut.buffer).getBigUint64(0, true));
  return cachedSidPointer;
}

const grantedRoots = new Set<string>();

/**
 * Grants the AppContainer group read/execute/list access to a workspace
 * root, recursively over existing files, so a zero-capability AppContainer
 * process can read (but not write) it. Without this, every file read
 * inside the sandbox fails with ACCESS_DENIED -- verified empirically: an
 * AppContainer process could run `cmd.exe`/`ping`/`curl` from system paths
 * with no grant, but reading an ordinary workspace file failed until this
 * ACE was present.
 *
 * Idempotent per process lifetime (cached by root) since `/T` walks the
 * whole tree and repeating it on every command would be prohibitively slow
 * on a large repository. Failure is non-fatal: callers must fall back to
 * "isolation unavailable" for that command rather than throw, since a
 * workspace on a filesystem/ACL configuration `icacls` can't touch (e.g. a
 * network share with unusual permissions) is a plausible, recoverable case.
 */
export async function grantWorkspaceAccess(root: string): Promise<boolean> {
  if (grantedRoots.has(root)) return true;
  try {
    await execFileAsync(
      "icacls",
      [
        root,
        "/grant",
        `${ALL_APPLICATION_PACKAGES_SID}:(OI)(CI)RX`,
        "/T",
        "/C",
        "/Q",
      ],
      { timeout: 120_000 },
    );
    grantedRoots.add(root);
    return true;
  } catch {
    return false;
  }
}

/** Best-effort revoke; failures are swallowed since this only ever narrows
 * access back toward the pre-grant state and must never block shutdown. */
export async function revokeWorkspaceAccess(root: string): Promise<void> {
  if (!grantedRoots.has(root)) return;
  try {
    await execFileAsync(
      "icacls",
      [root, "/remove", ALL_APPLICATION_PACKAGES_SID, "/T", "/C", "/Q"],
      { timeout: 120_000 },
    );
  } catch {
    // Best-effort: leaving the grant in place is safe (it only ever widens
    // local read access to a group every other AppContainer app already
    // carries) and strictly safer than throwing during cleanup.
  } finally {
    grantedRoots.delete(root);
  }
}

/** SECURITY_CAPABILITIES with CapabilityCount = 0: no internetClient,
 * internetClientServer, or privateNetworkClientServer capability, so
 * Windows Filtering Platform's built-in AppContainer rule denies both
 * inbound and outbound network access. Verified with `ping`/`curl` against
 * a real host: both failed inside the container while succeeding outside
 * it. */
export function buildZeroCapabilitySecurityCapabilities(
  sid: number,
): Uint8Array {
  const buf = new Uint8Array(24);
  const view = new DataView(buf.buffer);
  view.setBigUint64(0, BigInt(sid), true); // AppContainerSid
  view.setBigUint64(8, 0n, true); // Capabilities = NULL
  view.setUint32(16, 0, true); // CapabilityCount = 0
  view.setUint32(20, 0, true); // Reserved
  return buf;
}
