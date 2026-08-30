import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

// The zero-capability AppContainer network-denial mechanism (see
// src/shared/win32/app-container.ts and isolated-process.ts) is
// implemented and verified here directly, but NOT yet wired into the
// default runCommand/runShellCommand path -- see the TODO in
// src/shared/process.ts. `git.exe` fails with "unable to get current
// working directory: Permission denied" inside this AppContainer even in
// a fresh directory, for a reason not yet root-caused; these tests
// deliberately avoid git to cover the mechanism that IS confirmed working
// (network denial, workspace file-read ACL grant) without asserting
// around the open bug.

async function isolatedWorkspace(prefix: string): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  await writeFile(
    path.join(root, "marker.txt"),
    "workspace-file-contents\n",
    "utf8",
  );
  return root;
}

test("a zero-capability AppContainer genuinely blocks outbound network access", async () => {
  if (process.platform !== "win32") return;
  const { spawnIsolatedWindows } =
    await import("../../src/shared/win32/isolated-process.js");
  const root = await isolatedWorkspace("shelra-appcontainer-network-");
  const result = await spawnIsolatedWindows(
    "cmd.exe",
    ["/c", "ping -n 2 -w 1500 8.8.8.8"],
    {
      cwd: root,
      env: { PATH: process.env.PATH ?? "" },
      timeoutMs: 10_000,
      maxOutputChars: 4_000,
      denyNetwork: true,
    },
  );
  expect(result).not.toBeNull();
  expect(result?.mechanism).toBe("job_object+app_container");
  // ping.exe's own message when the container denies it raw-socket/ICMP
  // access; a real network failure (unreachable host, timeout) reads
  // differently ("Request timed out", "Destination host unreachable").
  expect(result?.stdout).toContain("Unable to contact IP driver");
}, 20_000);

test("workspace files are readable inside the AppContainer once the ACL grant runs", async () => {
  if (process.platform !== "win32") return;
  const { spawnIsolatedWindows } =
    await import("../../src/shared/win32/isolated-process.js");
  const root = await isolatedWorkspace("shelra-appcontainer-read-");
  const result = await spawnIsolatedWindows(
    "cmd.exe",
    ["/c", "type marker.txt"],
    {
      cwd: root,
      env: { PATH: process.env.PATH ?? "" },
      timeoutMs: 10_000,
      maxOutputChars: 4_000,
      denyNetwork: true,
    },
  );
  expect(result?.exitCode).toBe(0);
  expect(result?.stdout).toContain("workspace-file-contents");
}, 20_000);
