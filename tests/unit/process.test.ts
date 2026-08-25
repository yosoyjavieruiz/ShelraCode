import { expect, test } from "bun:test";
import { runCommand } from "../../src/shared/process.js";
import { createLogger, type LogRecord } from "../../src/shared/logging.js";

test("a missing executable resolves with a shell-style 127 exit code instead of throwing", async () => {
  const result = await runCommand("localcode-definitely-not-a-real-binary", [
    "--version",
  ]);
  expect(result.exitCode).toBe(127);
  expect(result.stderr).toContain("localcode-definitely-not-a-real-binary");
});

test("a real command still resolves normally", async () => {
  const result = await runCommand(process.execPath, ["--version"]);
  expect(result.exitCode).toBe(0);
});

test("process lifecycle logs expose command outcome without command output", async () => {
  const records: LogRecord[] = [];
  const logger = createLogger({
    level: "debug",
    sink: { write: (record) => records.push(record) },
  });

  const result = await runCommand(process.execPath, ["--version"], {
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
      signal: controller.signal,
    },
  );
  controller.abort();
  await expect(promise).rejects.toMatchObject({ name: "AbortError" });
});

test("a timed out process is distinguishable from user cancellation", async () => {
  await expect(
    runCommand(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], {
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
    { onOutput: (chunk) => chunks.push(chunk.text) },
  );
  expect(result.stdout).toBe("first-second");
  expect(chunks.join("")).toBe("first-second");
});

test("an omitted onOutput changes nothing about the resolved result", async () => {
  const result = await runCommand(process.execPath, [
    "-e",
    "process.stdout.write('ok')",
  ]);
  expect(result.stdout).toBe("ok");
  expect(result.exitCode).toBe(0);
});
