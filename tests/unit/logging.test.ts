import { expect, test } from "bun:test";
import { readFile, mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createLogger,
  type LogRecord,
  type LogSink,
} from "../../src/shared/logging.js";

function memorySink(records: LogRecord[]): LogSink {
  return {
    write(record) {
      records.push(record);
    },
  };
}

test("logger filters by level and preserves correlation context in child logs", () => {
  const records: LogRecord[] = [];
  const logger = createLogger({
    level: "info",
    sink: memorySink(records),
    context: { sessionId: "session-1", component: "test" },
  });

  logger.debug("debug.hidden", { value: 1 });
  logger.info("task.started", { mode: "coding" });
  logger.child({ taskId: "task-1", turnId: "turn-2" }).warn("tool.failed", {
    code: "PATH_IS_FILE",
  });

  expect(records.map((record) => record.event)).toEqual([
    "task.started",
    "tool.failed",
  ]);
  expect(records[1]?.context).toEqual({
    sessionId: "session-1",
    component: "test",
    taskId: "task-1",
    turnId: "turn-2",
  });
});

test("logger redacts secrets and never writes raw prompt-shaped fields", () => {
  const records: LogRecord[] = [];
  const logger = createLogger({ level: "debug", sink: memorySink(records) });

  logger.info("provider.request", {
    apiKey: "sk-live-should-not-appear",
    authorization: "Bearer abc.def.ghi",
    prompt: { length: 123, preview: "summary only" },
    messageCount: 4,
  });

  const rendered = JSON.stringify(records);
  expect(rendered).not.toContain("sk-live-should-not-appear");
  expect(rendered).not.toContain("abc.def.ghi");
  expect(rendered).toContain("REDACTED");
  expect(rendered).toContain("summary only");
});

test("logger writes inspectable JSONL records when a file path is configured", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-logs-"));
  const logPath = path.join(root, "nested", "agent.jsonl");
  const logger = createLogger({
    level: "debug",
    filePath: logPath,
    stderr: false,
  });

  logger.info("task.started", { mode: "workspace_question" });
  logger.error("task.failed", { code: "MODEL_ERROR" });
  await logger.flush();

  const lines = (await readFile(logPath, "utf8"))
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line) as LogRecord);
  expect(lines).toHaveLength(2);
  expect(lines[0]?.event).toBe("task.started");
  expect(lines[1]?.level).toBe("error");
  expect(lines.every((line) => line.timestamp.length > 0)).toBe(true);
});

test("disabled logger does not invoke its sink", () => {
  let writes = 0;
  const logger = createLogger({
    level: "off",
    sink: {
      write() {
        writes += 1;
      },
    },
  });

  logger.error("should.not.write", { value: true });

  expect(logger.enabled).toBe(false);
  expect(writes).toBe(0);
});
