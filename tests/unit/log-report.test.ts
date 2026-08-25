import { expect, test } from "bun:test";
import {
  parseLogLines,
  summarizeLogRecords,
} from "../../src/shared/log-report.js";

test("log report parses JSONL and counts events, levels, tasks and failures", () => {
  const parsed = parseLogLines(
    [
      JSON.stringify({
        timestamp: "2026-08-24T10:00:00.000Z",
        level: "info",
        event: "task.started",
        context: { taskId: "task-1" },
      }),
      "not-json",
      JSON.stringify({
        timestamp: "2026-08-24T10:00:01.000Z",
        level: "error",
        event: "task.failed",
        context: { taskId: "task-1" },
        data: { code: "MODEL_ERROR" },
      }),
      JSON.stringify({
        timestamp: "2026-08-24T10:00:02.000Z",
        level: "warn",
        event: "tool.permission.denied",
        context: { taskId: "task-2" },
      }),
    ].join("\n"),
  );

  const summary = summarizeLogRecords(parsed.records);

  expect(parsed.malformedLines).toBe(1);
  expect(summary.totalRecords).toBe(3);
  expect(summary.byLevel).toEqual({ debug: 0, info: 1, warn: 1, error: 1 });
  expect(summary.byEvent["task.failed"]).toBe(1);
  expect(summary.taskIds).toEqual(["task-1", "task-2"]);
  expect(summary.failureEvents).toEqual(["task.failed"]);
  expect(summary.firstTimestamp).toBe("2026-08-24T10:00:00.000Z");
  expect(summary.lastTimestamp).toBe("2026-08-24T10:00:02.000Z");
});
