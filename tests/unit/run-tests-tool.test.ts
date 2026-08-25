import { expect, test } from "bun:test";
import { runTestsTool, shellTool } from "../../src/tools/workspace.js";

test("RunTests returns a structured verification result for a passing command", async () => {
  const result = await runTestsTool.execute(
    { command: "bun --version" },
    {
      root: process.cwd(),
      permissionMode: "EDIT",
      signal: new AbortController().signal,
      env: process.env,
    },
  );

  expect(result.exitCode).toBe(0);
  expect(result.command).toBe("bun --version");
  expect(result.failures).toEqual([]);
  expect(result.durationMs).toBeGreaterThanOrEqual(0);
  expect(result.output).toContain("1.3");
});

test("RunTests preserves concise failure evidence for a failing command", async () => {
  const result = await runTestsTool.execute(
    { command: "cmd /c exit 1" },
    {
      root: process.cwd(),
      permissionMode: "EDIT",
      signal: new AbortController().signal,
      env: process.env,
    },
  );

  expect(result.exitCode).not.toBe(0);
  expect(result.failures.length).toBeGreaterThan(0);
});

test("Shell returns host-owned command, cwd, timing and timeout evidence", async () => {
  const result = await shellTool.execute(
    { command: "cmd /c echo hello" },
    {
      root: process.cwd(),
      permissionMode: "EDIT",
      signal: new AbortController().signal,
      env: process.env,
    },
  );

  expect(result.command).toBe("cmd /c echo hello");
  expect(result.cwd).toBe(process.cwd());
  expect(result.exitCode).toBe(0);
  expect(result.stdout.toLowerCase()).toContain("hello");
  expect(result.durationMs).toBeGreaterThanOrEqual(0);
  expect(result.timedOut).toBe(false);
});
