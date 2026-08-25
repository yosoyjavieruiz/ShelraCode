import type { ToolCall } from "../providers/types.js";

function toolCallFromRecord(
  value: unknown,
  turn: number,
  index: number,
): ToolCall | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return undefined;
  const record = value as Record<string, unknown>;
  const allowedKeys = new Set(["id", "name", "arguments"]);
  if (Object.keys(record).some((key) => !allowedKeys.has(key)))
    return undefined;
  if (typeof record.name !== "string" || !record.name.trim()) return undefined;
  const rawArguments = record.arguments ?? {};
  let argumentsText: string;
  if (typeof rawArguments === "string") {
    try {
      JSON.parse(rawArguments || "{}");
    } catch {
      return undefined;
    }
    argumentsText = rawArguments || "{}";
  } else {
    try {
      argumentsText = JSON.stringify(rawArguments);
    } catch {
      return undefined;
    }
  }
  return {
    id:
      typeof record.id === "string" && record.id
        ? record.id
        : `recovered-${turn}-${index + 1}`,
    name: record.name,
    arguments: argumentsText,
  };
}

function parseJsonToolEnvelope(
  text: string,
  turn: number,
): ToolCall[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const values = Array.isArray(parsed) ? parsed : [parsed];
  if (values.length === 0) return undefined;
  const calls = values.map((value, index) =>
    toolCallFromRecord(value, turn, index),
  );
  return calls.every((call): call is ToolCall => Boolean(call))
    ? calls
    : undefined;
}

function parseDelimitedToolEnvelope(
  text: string,
  turn: number,
  start: string,
  end: string,
): ToolCall[] | undefined {
  const calls: ToolCall[] = [];
  let cursor = 0;
  const whitespace = new Set([" ", "\t", "\r", "\n"]);
  while (cursor < text.length) {
    while (cursor < text.length && whitespace.has(text[cursor] ?? "")) {
      cursor += 1;
    }
    if (!text.startsWith(start, cursor)) return undefined;
    const bodyStart = cursor + start.length;
    const bodyEnd = text.indexOf(end, bodyStart);
    if (bodyEnd < 0) return undefined;
    const call = parseJsonToolEnvelope(
      text.slice(bodyStart, bodyEnd).trim(),
      turn,
    );
    if (!call) return undefined;
    calls.push(...call);
    cursor = bodyEnd + end.length;
  }
  return calls.length > 0 ? calls : undefined;
}

function parseFencedToolEnvelope(
  text: string,
  turn: number,
): ToolCall[] | undefined {
  if (!text.startsWith("```")) return undefined;
  const firstLineEnd = text.indexOf("\n");
  if (firstLineEnd < 0 || !text.endsWith("```")) return undefined;
  const language = text.slice(3, firstLineEnd).trim().toLowerCase();
  if (language && language !== "json" && language !== "xml") return undefined;
  const body = text.slice(firstLineEnd + 1, -3).trim();
  return (
    parseJsonToolEnvelope(body, turn) ??
    parseDelimitedToolEnvelope(body, turn, "<response>", "</response>") ??
    parseDelimitedToolEnvelope(body, turn, "<xml>", "</xml>")
  );
}

function parseEmbeddedFencedToolEnvelope(
  text: string,
  turn: number,
): ToolCall[] | undefined {
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf("```", cursor);
    if (start < 0) return undefined;
    const lineEnd = text.indexOf("\n", start + 3);
    if (lineEnd < 0) return undefined;
    const end = text.indexOf("```", lineEnd + 1);
    if (end < 0) return undefined;
    const parsed = parseFencedToolEnvelope(text.slice(start, end + 3), turn);
    if (parsed) return parsed;
    cursor = end + 3;
  }
  return undefined;
}

/**
 * Recover a complete textual tool envelope emitted by runtimes that do not
 * produce native OpenAI `tool_calls`. The same parser is used by the agent
 * loop and capability probes so routing measures the actual executable path.
 */
export function recoverTextToolCalls(
  text: string,
  turn: number,
): ToolCall[] | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return (
    parseJsonToolEnvelope(trimmed, turn) ??
    parseDelimitedToolEnvelope(
      trimmed,
      turn,
      "[TOOL_REQUEST]",
      "[END_TOOL_REQUEST]",
    ) ??
    parseDelimitedToolEnvelope(
      trimmed,
      turn,
      "<tool_request>",
      "</tool_request>",
    ) ??
    parseDelimitedToolEnvelope(trimmed, turn, "<response>", "</response>") ??
    parseDelimitedToolEnvelope(trimmed, turn, "<xml>", "</xml>") ??
    parseDelimitedToolEnvelope(trimmed, turn, "<tools>", "</tools>") ??
    parseDelimitedToolEnvelope(trimmed, turn, "<tool_call>", "</tool_call>") ??
    parseFencedToolEnvelope(trimmed, turn) ??
    parseEmbeddedFencedToolEnvelope(trimmed, turn)
  );
}
