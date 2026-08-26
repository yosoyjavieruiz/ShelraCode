import type { ToolCall } from "./types.js";
import { ToolError } from "../tools/errors.js";

/** Maximum number of textual calls that one normalized provider response may carry. */
export const MAX_TOOL_CALLS_PER_RESPONSE = 8;

function enforceToolBatchLimit(calls: ToolCall[]): ToolCall[] {
  if (calls.length <= MAX_TOOL_CALLS_PER_RESPONSE) return calls;
  throw new ToolError(
    "TOOL_BATCH_TOO_LARGE",
    `The model requested ${calls.length} tool calls in one response; the maximum tool calls per response is ${MAX_TOOL_CALLS_PER_RESPONSE}.`,
    {
      recoverable: true,
      suggestedAction:
        "Use the result of the current observation and request a smaller next tool batch.",
      details: {
        requested: calls.length,
        maximum: MAX_TOOL_CALLS_PER_RESPONSE,
      },
    },
  );
}

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

function parseConcatenatedJsonToolEnvelope(
  text: string,
  turn: number,
): ToolCall[] | undefined {
  const calls: ToolCall[] = [];
  const whitespace = new Set([" ", "\t", "\r", "\n"]);
  let cursor = 0;

  while (cursor < text.length) {
    while (cursor < text.length && whitespace.has(text[cursor] ?? ""))
      cursor += 1;
    if (cursor >= text.length) break;
    if (text[cursor] !== "{") return undefined;

    const start = cursor;
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (; cursor < text.length; cursor += 1) {
      const character = text[cursor] ?? "";
      if (inString) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') inString = false;
        continue;
      }
      if (character === '"') {
        inString = true;
        continue;
      }
      if (character === "{") depth += 1;
      else if (character === "}") {
        depth -= 1;
        if (depth === 0) {
          end = cursor + 1;
          break;
        }
        if (depth < 0) return undefined;
      }
    }
    if (end < 0 || inString || depth !== 0) return undefined;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text.slice(start, end));
    } catch {
      return undefined;
    }
    const call = toolCallFromRecord(parsed, turn, calls.length);
    if (!call) return undefined;
    calls.push(call);
    cursor = end;
  }

  const readOnlyTextTools = new Set([
    "ListFiles",
    "GlobFiles",
    "SearchText",
    "ReadFile",
    "GitStatus",
    "GitDiff",
  ]);
  return calls.length > 1 &&
    calls.every((call) => readOnlyTextTools.has(call.name))
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
    while (cursor < text.length && whitespace.has(text[cursor] ?? ""))
      cursor += 1;
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

function parseValidatedToolResponseEnvelope(
  text: string,
  turn: number,
): ToolCall[] | undefined {
  const calls: ToolCall[] = [];
  let cursor = 0;
  const whitespace = new Set([" ", "\t", "\r", "\n"]);

  while (cursor < text.length) {
    while (cursor < text.length && whitespace.has(text[cursor] ?? ""))
      cursor += 1;
    if (!text.startsWith("<tool_response>", cursor)) return undefined;

    const bodyStart = cursor + "<tool_response>".length;
    const bodyEnd = text.indexOf("</tool_response>", bodyStart);
    if (bodyEnd < 0) return undefined;

    let parsed: unknown;
    try {
      parsed = JSON.parse(text.slice(bodyStart, bodyEnd).trim());
    } catch {
      return undefined;
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return undefined;

    const response = parsed as Record<string, unknown>;
    const responseKeys = new Set(["id", "tool", "ok", "output"]);
    if (Object.keys(response).some((key) => !responseKeys.has(key)))
      return undefined;
    if (response.tool !== "EditFile" || response.ok !== true) return undefined;
    if (
      typeof response.output !== "object" ||
      response.output === null ||
      Array.isArray(response.output)
    )
      return undefined;

    const output = response.output as Record<string, unknown>;
    const outputKeys = new Set(["path", "oldText", "newText", "replaceAll"]);
    if (Object.keys(output).some((key) => !outputKeys.has(key)))
      return undefined;
    if (
      typeof output.path !== "string" ||
      typeof output.oldText !== "string" ||
      typeof output.newText !== "string"
    )
      return undefined;
    if (
      output.replaceAll !== undefined &&
      typeof output.replaceAll !== "boolean"
    )
      return undefined;

    const call = toolCallFromRecord(
      {
        ...(typeof response.id === "string" && response.id
          ? { id: response.id }
          : {}),
        name: "EditFile",
        arguments: {
          path: output.path,
          oldText: output.oldText,
          newText: output.newText,
          ...(output.replaceAll === undefined
            ? {}
            : { replaceAll: output.replaceAll }),
        },
      },
      turn,
      calls.length,
    );
    if (!call) return undefined;
    calls.push(call);
    cursor = bodyEnd + "</tool_response>".length;
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

export function recoverTextToolCalls(
  text: string,
  turn: number,
): ToolCall[] | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const calls =
    parseJsonToolEnvelope(trimmed, turn) ??
    parseConcatenatedJsonToolEnvelope(trimmed, turn) ??
    parseValidatedToolResponseEnvelope(trimmed, turn) ??
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
    parseEmbeddedFencedToolEnvelope(trimmed, turn);
  return calls ? enforceToolBatchLimit(calls) : undefined;
}
