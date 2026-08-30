import { readProductEnv } from "../product/identity.js";

export interface AgentTraceEvent {
  timestamp: string;
  taskId: string;
  type:
    | "task.started"
    | "context.built"
    | "route.selected"
    | "turn.started"
    | "tool.observed"
    | "verification.observed"
    | "task.completed"
    | "task.blocked"
    | "task.failed"
    | "task.cancelled";
  phase?: string;
  data?: Record<string, unknown>;
}

export type AgentTraceSink = (event: AgentTraceEvent) => void;

const SECRET_KEY =
  /(api[_-]?key|token|secret|password|passwd|credential|cookie|private[_-]?key)/iu;

function redact(value: unknown, key = ""): unknown {
  if (SECRET_KEY.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    return value
      .replace(/(Bearer\s+)[A-Za-z0-9._-]+/giu, "$1[REDACTED]")
      .replace(/([?&](?:token|api_key|secret)=)[^&\s]+/giu, "$1[REDACTED]");
  }
  if (Array.isArray(value)) return value.map((item) => redact(item));
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redact(entryValue, entryKey),
      ]),
    );
  return value;
}

export interface AgentTraceRecorder {
  enabled: boolean;
  record(event: Omit<AgentTraceEvent, "timestamp">): void;
}

/** Developer-only trace; raw prompts and hidden model reasoning are excluded. */
export function createAgentTraceRecorder(
  enabled = readProductEnv(process.env, "AGENT_TRACE") === "1",
  sink: AgentTraceSink = (event) => console.error(JSON.stringify(event)),
): AgentTraceRecorder {
  return {
    enabled,
    record(event) {
      if (!enabled) return;
      sink({
        ...event,
        timestamp: new Date().toISOString(),
        ...(event.data
          ? { data: redact(event.data) as Record<string, unknown> }
          : {}),
      });
    },
  };
}
