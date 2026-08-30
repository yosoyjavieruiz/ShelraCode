import { expect, test } from "bun:test";
import { runCommand, runShellCommand } from "../../src/shared/process.js";

// These exercise the real Windows OS boundary in src/shared/win32/ -- no
// mocking, because the whole point is to prove an actual Job Object/
// AppContainer guarantee holds, not that our own code believes it does.
// They are inert on non-Windows hosts, matching the existing
// `process.platform === "win32"` branch convention in process.test.ts.

test("Job Object containment kills a grandchild process that outlives the direct child", async () => {
  if (process.platform !== "win32") return;
  const { WindowsJob } = await import("../../src/shared/win32/job-object.js");
  const { spawnIsolatedWindows } =
    await import("../../src/shared/win32/isolated-process.js");

  // cmd.exe spawns ping.exe as a real child and stays alive while it runs;
  // we only ever touch the outer process through the isolated spawn path,
  // never ping.exe's PID directly, so a killed grandchild proves job-wide
  // containment reaches descendants and not just the one process we hold a
  // handle to.
  const spawnPromise = spawnIsolatedWindows(
    "cmd.exe",
    ["/c", "ping -n 30 127.0.0.1 >nul"],
    {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "" },
      timeoutMs: 800,
      maxOutputChars: 4_000,
      denyNetwork: false,
    },
  );

  await expect(spawnPromise).rejects.toMatchObject({ name: "TimeoutError" });

  // Give WMI a moment to reflect the state after the timeout's
  // TerminateJobObject call.
  await Bun.sleep(500);
  const proc = Bun.spawn(
    [
      "powershell",
      "-NoProfile",
      "-Command",
      "(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'PING.EXE' }).Count",
    ],
    { stdout: "pipe" },
  );
  const output = await new Response(proc.stdout).text();
  await proc.exited;
  expect(parseInt(output.trim(), 10) || 0).toBe(0);

  // Sanity check that the mechanism actually being tested (WindowsJob)
  // still exposes the API this test exercises indirectly through
  // spawnIsolatedWindows -- guards against the import above silently
  // resolving to nothing if the module is ever renamed.
  expect(typeof WindowsJob.create).toBe("function");
});

test("runCommand reports real Job Object containment on Windows for an ordinary call", async () => {
  if (process.platform !== "win32") return;
  const result = await runCommand(process.execPath, ["--version"], {
    intent: "read",
  });
  expect(result.exitCode).toBe(0);
  expect(result.isolation.osEnforced).toBe(true);
  expect(result.isolation.mechanism).toBe("job_object");
  // Network denial via AppContainer is implemented (see
  // win32-app-container.test.ts) but not yet wired into the default
  // runCommand path -- see the TODO in src/shared/process.ts.
  expect(result.isolation.networkEnforced).toBe(false);
});

test("a missing executable still resolves with exit code 127 through the isolated path", async () => {
  if (process.platform !== "win32") return;
  const result = await runCommand(
    "shelra-definitely-not-a-real-binary",
    ["--version"],
    { intent: "read" },
  );
  expect(result.exitCode).toBe(127);
});

test("runShellCommand output, exit code, and onOutput streaming survive the isolated path", async () => {
  if (process.platform !== "win32") return;
  const chunks: string[] = [];
  const result = await runShellCommand("echo hello-isolated-shell", {
    intent: "execute",
    onOutput: (chunk) => chunks.push(chunk.text),
  });
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain("hello-isolated-shell");
  expect(chunks.join("")).toContain("hello-isolated-shell");
});
