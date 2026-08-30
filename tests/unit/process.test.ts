import { expect, test } from "bun:test";
import {
  runCommand,
  runShellCommand,
  ProcessIsolationError,
  ProcessPolicyError,
  type ProcessOutputChunk,
} from "../../src/shared/process.js";
import { createLogger, type LogRecord } from "../../src/shared/logging.js";

test("a missing executable resolves with a shell-style 127 exit code instead of throwing", async () => {
  const result = await runCommand(
    "localcode-definitely-not-a-real-binary",
    ["--version"],
    { intent: "read" },
  );
  expect(result.exitCode).toBe(127);
  expect(result.stderr).toContain("localcode-definitely-not-a-real-binary");
});

test("a real command still resolves normally", async () => {
  const result = await runCommand(process.execPath, ["--version"], {
    intent: "read",
  });
  expect(result.exitCode).toBe(0);
});

test("process lifecycle logs expose command outcome without command output", async () => {
  const records: LogRecord[] = [];
  const logger = createLogger({
    level: "debug",
    sink: { write: (record) => records.push(record) },
  });

  const result = await runCommand(process.execPath, ["--version"], {
    intent: "read",
    logger,
  });

  expect(result.exitCode).toBe(0);
  expect(records.map((record) => record.event)).toEqual([
    "process.started",
    "process.finished",
  ]);
  expect(records[0]?.data).toMatchObject({
    command: process.execPath,
    argumentCount: 1,
  });
  expect(records[0]?.data).not.toHaveProperty("args");
  expect(records[0]?.data).not.toHaveProperty("stdout");
  expect(records[1]?.data).toMatchObject({ exitCode: 0, timedOut: false });
});

test("an aborted process reports an AbortError and terminates the child", async () => {
  const controller = new AbortController();
  const promise = runCommand(
    process.execPath,
    ["-e", "setTimeout(() => {}, 10000)"],
    {
      intent: "execute",
      signal: controller.signal,
    },
  );
  controller.abort();
  await expect(promise).rejects.toMatchObject({ name: "AbortError" });
});

test("a timed out process is distinguishable from user cancellation", async () => {
  await expect(
    runCommand(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], {
      intent: "execute",
      timeoutMs: 1,
    }),
  ).rejects.toMatchObject({ name: "TimeoutError" });
});

// The live shell/test tail (docs/ui-chat-v2, AGENT-MATRIX.md "live tail")
// depends on onOutput seeing everything runCommand's own return value does —
// this is the regression guard that streaming reads via a manual reader
// loop produce byte-for-byte the same text as the old `Response(...).text()`
// approach, just observable incrementally too.
test("onOutput chunks concatenate to exactly the same text runCommand itself returns", async () => {
  const chunks: string[] = [];
  const result = await runCommand(
    process.execPath,
    [
      "-e",
      "process.stdout.write('first-'); setTimeout(() => { process.stdout.write('second'); }, 30);",
    ],
    { intent: "read", onOutput: (chunk) => chunks.push(chunk.text) },
  );
  expect(result.stdout).toBe("first-second");
  expect(chunks.join("")).toBe("first-second");
});

test("an omitted onOutput changes nothing about the resolved result", async () => {
  const result = await runCommand(
    process.execPath,
    ["-e", "process.stdout.write('ok')"],
    { intent: "read" },
  );
  expect(result.stdout).toBe("ok");
  expect(result.exitCode).toBe(0);
});

test("the central policy rejects network indirection before spawning PowerShell", async () => {
  await expect(
    runCommand(
      "powershell.exe",
      ["-NoProfile", "-Command", "curl https://example.com"],
      {
        intent: "network",
        network: "deny",
      },
    ),
  ).rejects.toBeInstanceOf(ProcessPolicyError);
});

test("the central policy rejects destructive command text even when intent is mislabeled", async () => {
  await expect(
    runCommand("git", ["reset", "--hard"], { intent: "execute" }),
  ).rejects.toBeInstanceOf(ProcessPolicyError);
});

test("the process layer bounds both returned output and live output", async () => {
  const chunks: ProcessOutputChunk[] = [];
  const result = await runCommand(
    process.execPath,
    [
      "-e",
      "process.stdout.write('x'.repeat(10000)); process.stderr.write('y'.repeat(10000))",
    ],
    {
      intent: "test",
      maxOutputChars: 1_024,
      onOutput: (chunk) => chunks.push(chunk),
    },
  );

  expect(result.stdout.length).toBeLessThanOrEqual(1_024);
  expect(result.stdoutTruncated).toBe(true);
  expect(result.stderr.length).toBeLessThanOrEqual(1_024);
  expect(result.stderrTruncated).toBe(true);
  expect(
    chunks
      .filter((chunk) => chunk.stream === "stdout")
      .map((chunk) => chunk.text)
      .join("").length,
  ).toBeLessThanOrEqual(1_024);
  expect(
    chunks
      .filter((chunk) => chunk.stream === "stderr")
      .map((chunk) => chunk.text)
      .join("").length,
  ).toBeLessThanOrEqual(1_024);
  expect(result.isolation.applicationPolicy).toBe("enforced");
  // Windows now has a real Job Object adapter (see src/shared/win32/); this
  // call doesn't request network denial, so only lifecycle containment
  // applies, not the AppContainer network guarantee.
  expect(result.isolation.osEnforced).toBe(process.platform === "win32");
  expect(result.isolation.networkEnforced).toBe(false);
});

test("child processes receive no credential variables", async () => {
  const result = await runCommand(
    process.execPath,
    [
      "-e",
      "console.log(JSON.stringify({openai:process.env.OPENAI_API_KEY ?? null,database:process.env.DATABASE_URL ?? null}))",
    ],
    {
      intent: "read",
      env: {
        PATH: process.env.PATH,
        OPENAI_API_KEY: "secret-openai-key",
        DATABASE_URL: "postgres://secret",
      },
    },
  );

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toContain('"openai":null');
  expect(result.stdout).toContain('"database":null');
  expect(result.stdout).not.toContain("secret-openai-key");
  expect(result.stdout).not.toContain("postgres://secret");
});

test("required OS isolation fails closed when no native adapter is available", async () => {
  if (process.platform === "win32") {
    // Windows now has a real Job Object adapter, so "required" isolation is
    // satisfiable and must succeed rather than fail closed -- see the next
    // test for the platform-specific positive assertion.
    return;
  }
  await expect(
    runShellCommand("echo isolated", {
      intent: "execute",
      isolation: "required",
      allowWeakIsolation: false,
    }),
  ).rejects.toBeInstanceOf(ProcessIsolationError);
});

test("required OS isolation succeeds on Windows via the Job Object adapter", async () => {
  if (process.platform !== "win32") return;
  const result = await runShellCommand("echo isolated", {
    intent: "execute",
    isolation: "required",
    allowWeakIsolation: false,
  });
  expect(result.exitCode).toBe(0);
  expect(result.isolation.osEnforced).toBe(true);
});
