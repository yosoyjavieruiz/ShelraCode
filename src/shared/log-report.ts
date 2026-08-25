import type { LogLevel, LogRecord } from "./logging.js";

const LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLogRecord(value: unknown): value is LogRecord {
  if (!isRecord(value)) return false;
  return (
    typeof value.timestamp === "string" &&
    typeof value.event === "string" &&
    LEVELS.includes(value.level as LogLevel)
  );
}

export interface ParsedLogLines {
  records: LogRecord[];
  malformedLines: number;
}

export interface LogSummary {
  totalRecords: number;
  byLevel: Record<LogLevel, number>;
  byEvent: Record<string, number>;
  taskIds: string[];
  failureEvents: string[];
  warningEvents: string[];
  firstTimestamp?: string;
  lastTimestamp?: string;
}

export function parseLogLines(text: string): ParsedLogLines {
  const records: LogRecord[] = [];
  let malformedLines = 0;
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (!isLogRecord(parsed)) {
        malformedLines += 1;
        continue;
      }
      records.push(parsed);
    } catch {
      malformedLines += 1;
    }
  }
  return { records, malformedLines };
}

export function summarizeLogRecords(records: readonly LogRecord[]): LogSummary {
  const byLevel: Record<LogLevel, number> = {
    debug: 0,
    info: 0,
    warn: 0,
    error: 0,
  };
  const byEvent: Record<string, number> = {};
  const taskIds: string[] = [];
  const seenTaskIds = new Set<string>();
  const failureEvents: string[] = [];
  const seenFailureEvents = new Set<string>();
  const warningEvents: string[] = [];
  const seenWarningEvents = new Set<string>();

  for (const record of records) {
    byLevel[record.level] += 1;
    byEvent[record.event] = (byEvent[record.event] ?? 0) + 1;
    const taskId = record.context?.taskId;
    if (taskId && !seenTaskIds.has(taskId)) {
      seenTaskIds.add(taskId);
      taskIds.push(taskId);
    }
    if (record.level === "error" && !seenFailureEvents.has(record.event)) {
      seenFailureEvents.add(record.event);
      failureEvents.push(record.event);
    }
    if (record.level === "warn" && !seenWarningEvents.has(record.event)) {
      seenWarningEvents.add(record.event);
      warningEvents.push(record.event);
    }
  }

  return {
    totalRecords: records.length,
    byLevel,
    byEvent,
    taskIds,
    failureEvents,
    warningEvents,
    firstTimestamp: records[0]?.timestamp,
    lastTimestamp: records.at(-1)?.timestamp,
  };
}
