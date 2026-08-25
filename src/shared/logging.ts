import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogLevelSetting = LogLevel | "off";

export interface LogContext {
  component?: string;
  sessionId?: string;
  taskId?: string;
  turnId?: string;
  requestId?: string;
  providerId?: string;
  modelId?: string;
  phase?: string;
}

export interface LogRecord {
  timestamp: string;
  level: LogLevel;
  event: string;
  context?: LogContext;
  message?: string;
  data?: Record<string, unknown>;
}

export interface LogSink {
  write(record: LogRecord): void;
  flush?: () => void | Promise<void>;
}

export interface LocalCodeLogger {
  readonly enabled: boolean;
  readonly level: LogLevelSetting;
  child(context: LogContext): LocalCodeLogger;
  debug(event: string, data?: Record<string, unknown>): void;
  info(event: string, data?: Record<string, unknown>): void;
  warn(event: string, data?: Record<string, unknown>): void;
  error(event: string, data?: Record<string, unknown>): void;
  flush(): Promise<void>;
}

export interface LoggerOptions {
  level?: LogLevelSetting;
  enabled?: boolean;
  sink?: LogSink;
  filePath?: string;
  stderr?: boolean;
  context?: LogContext;
  clock?: () => Date;
  env?: Record<string, string | undefined>;
}

const LEVEL_WEIGHT: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const SECRET_KEY =
  /(api[_-]?key|access[_-]?token|authorization|token|secret|password|passwd|credential|cookie|private[_-]?key)/iu;
const REDACTED = "[REDACTED]";
const MAX_STRING_LENGTH = 2_000;
const MAX_ARRAY_ITEMS = 50;
const MAX_OBJECT_KEYS = 100;

function parseLevel(value: string | undefined): LogLevelSetting {
  switch (value?.trim().toLowerCase()) {
    case "debug":
    case "info":
    case "warn":
    case "error":
    case "off":
      return value.trim().toLowerCase() as LogLevelSetting;
    default:
      return "off";
  }
}

function redactString(value: string): string {
  const redacted = value
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/giu, `$1${REDACTED}`)
    .replace(/([?&](?:token|api_key|secret)=)[^&\s]+/giu, `$1${REDACTED}`)
    .replace(/\b(?:sk|gh[pousr]|AIza)[-_A-Za-z0-9]{16,}\b/gu, REDACTED);
  if (redacted.length <= MAX_STRING_LENGTH) return redacted;
  return `${redacted.slice(0, MAX_STRING_LENGTH)}…[truncated ${redacted.length - MAX_STRING_LENGTH} chars]`;
}

/** Redacts secret-shaped values before they reach a log sink. */
export function redactLogValue(
  value: unknown,
  key = "",
  seen = new WeakSet<object>(),
): unknown {
  if (SECRET_KEY.test(key)) return REDACTED;
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  if (Array.isArray(value))
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => redactLogValue(item, "", seen));
  return Object.fromEntries(
    Object.entries(value)
      .slice(0, MAX_OBJECT_KEYS)
      .map(([entryKey, entryValue]) => [
        entryKey,
        redactLogValue(entryValue, entryKey, seen),
      ]),
  );
}

function safeRecord(record: LogRecord): LogRecord {
  return {
    ...record,
    ...(record.context
      ? { context: redactLogValue(record.context) as LogContext }
      : {}),
    ...(record.message ? { message: redactString(record.message) } : {}),
    ...(record.data
      ? { data: redactLogValue(record.data) as Record<string, unknown> }
      : {}),
  };
}

function jsonLine(record: LogRecord): string {
  try {
    return JSON.stringify(safeRecord(record));
  } catch {
    return JSON.stringify({
      timestamp: record.timestamp,
      level: record.level,
      event: "logger.serialization_failed",
    });
  }
}

function fileSink(filePath: string): LogSink | undefined {
  try {
    mkdirSync(path.dirname(filePath), { recursive: true });
    return {
      write(record) {
        appendFileSync(filePath, `${jsonLine(record)}\n`, "utf8");
      },
    };
  } catch {
    return undefined;
  }
}

function stderrSink(): LogSink {
  return {
    write(record) {
      process.stderr.write(`${jsonLine(record)}\n`);
    },
  };
}

function combineSinks(sinks: readonly LogSink[]): LogSink {
  return {
    write(record) {
      for (const sink of sinks) {
        try {
          sink.write(record);
        } catch {
          // Logging must never take down the coding agent.
        }
      }
    },
    async flush() {
      for (const sink of sinks) {
        try {
          await sink.flush?.();
        } catch {
          // Logging must never take down shutdown or cancellation.
        }
      }
    },
  };
}

class StructuredLogger implements LocalCodeLogger {
  readonly enabled: boolean;

  constructor(
    readonly level: LogLevelSetting,
    private readonly sink: LogSink,
    private readonly context: LogContext,
    private readonly clock: () => Date,
    enabled = level !== "off",
  ) {
    this.enabled = enabled && level !== "off";
  }

  child(context: LogContext): LocalCodeLogger {
    return new StructuredLogger(
      this.level,
      this.sink,
      { ...this.context, ...context },
      this.clock,
      this.enabled,
    );
  }

  debug(event: string, data?: Record<string, unknown>): void {
    this.write("debug", event, data);
  }

  info(event: string, data?: Record<string, unknown>): void {
    this.write("info", event, data);
  }

  warn(event: string, data?: Record<string, unknown>): void {
    this.write("warn", event, data);
  }

  error(event: string, data?: Record<string, unknown>): void {
    this.write("error", event, data);
  }

  async flush(): Promise<void> {
    await this.sink.flush?.();
  }

  private write(
    level: LogLevel,
    event: string,
    data?: Record<string, unknown>,
  ): void {
    if (!this.enabled) return;
    if (this.level !== "debug" && this.level !== "off") {
      if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.level]) return;
    }
    this.sink.write(
      safeRecord({
        timestamp: this.clock().toISOString(),
        level,
        event,
        ...(Object.keys(this.context).length > 0
          ? { context: this.context }
          : {}),
        ...(data === undefined ? {} : { data }),
      }),
    );
  }
}

export function createLogger(options: LoggerOptions = {}): LocalCodeLogger {
  const env = options.env ?? process.env;
  const level =
    options.level ??
    parseLevel(
      env.LOCALCODE_LOG_LEVEL ??
        (env.LOCALCODE_AGENT_TRACE === "1" ? "debug" : undefined),
    );
  const enabled = options.enabled ?? level !== "off";
  const sinks: LogSink[] = [];
  if (options.sink) sinks.push(options.sink);
  const configuredPath = options.filePath ?? env.LOCALCODE_LOG_PATH;
  if (configuredPath) {
    const sink = fileSink(configuredPath);
    if (sink) sinks.push(sink);
  }
  const writeStderr =
    options.stderr ??
    (env.LOCALCODE_LOG_STDERR === "1" ||
      (env.LOCALCODE_LOG_STDERR !== "0" &&
        (env.LOCALCODE_LOG_LEVEL !== undefined ||
          env.LOCALCODE_AGENT_TRACE === "1") &&
        !configuredPath));
  if (writeStderr) sinks.push(stderrSink());
  return new StructuredLogger(
    level,
    combineSinks(sinks),
    options.context ?? {},
    options.clock ?? (() => new Date()),
    enabled,
  );
}
