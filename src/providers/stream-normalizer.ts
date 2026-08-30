import { ToolError } from "../tools/errors.js";
import { recoverTextToolCalls } from "./tool-envelope.js";
import type { ProviderEvent } from "./types.js";

const TOOL_MARKERS = [
  "{",
  "[",
  "<tools>",
  "<response>",
  "<tool_request>",
  "<tool_response>",
  "<tool_call>",
  "<xml>",
  "[TOOL_REQUEST]",
  "```",
] as const;

const TOOL_SHAPED_TEXT =
  /^\s*(?:[\[{<`]|```)[\s\S]*(?:"(?:name|tool|tool_calls)"\s*:)/u;

/** Find the first `{`/`[` in text and return the substring up to its matching close, respecting string content. */
function extractBalancedJson(
  text: string,
): { body: string; start: number; end: number } | undefined {
  const start = text.search(/[[{]/u);
  if (start < 0) return undefined;
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
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
    if (character === open) depth += 1;
    else if (character === close) {
      depth -= 1;
      if (depth === 0)
        return { body: text.slice(start, index + 1), start, end: index + 1 };
    }
  }
  return undefined;
}

const FENCE_EDGE_PATTERN = /^```[a-z]*\r?\n?|\r?\n?```$/giu;
const ENVELOPE_TAG_EDGE_PATTERN =
  /^(?:<\/?(?:tools|response|tool_request|tool_response|tool_call|xml)>|\[\/?(?:END_)?TOOL_REQUEST\])\s*|\s*(?:<\/?(?:tools|response|tool_request|tool_response|tool_call|xml)>|\[\/?(?:END_)?TOOL_REQUEST\])$/giu;

/**
 * recoverTextToolCalls already rejected this text as a legal tool-call
 * envelope. That rejection has two very different causes: the JSON is
 * genuinely broken (often a truncated stream, a real malformed attempt), or
 * the JSON parses fine but simply is not shaped like a tool call (a model
 * explaining the tool schema with `{"name": "example", "tool_calls": []}` as
 * a documentation example). Only the first case is a protocol defect worth
 * aborting the turn for; the second is ordinary text that happens to
 * contain JSON — but ONLY when there is other content around the JSON blob
 * (prose, a fence, an envelope tag) showing it's embedded in an explanation.
 * A bare, standalone JSON blob with nothing else is far more likely to be a
 * genuine (if malformed) tool-call attempt, so that case still errors.
 */
function isUnparseableToolShapedText(text: string): boolean {
  if (!TOOL_SHAPED_TEXT.test(text)) return false;
  const trimmed = text.trim();
  const extracted = extractBalancedJson(trimmed);
  if (!extracted) return true;
  const before = trimmed
    .slice(0, extracted.start)
    .replace(FENCE_EDGE_PATTERN, "")
    .replace(ENVELOPE_TAG_EDGE_PATTERN, "")
    .trim();
  const after = trimmed
    .slice(extracted.end)
    .replace(FENCE_EDGE_PATTERN, "")
    .replace(ENVELOPE_TAG_EDGE_PATTERN, "")
    .trim();
  if (!before && !after) return true;
  try {
    JSON.parse(extracted.body);
    return false;
  } catch {
    return true;
  }
}

function isBoundary(text: string, index: number): boolean {
  return (
    index === 0 || new Set([" ", "\t", "\r", "\n"]).has(text[index - 1] ?? "")
  );
}

function findMarker(text: string, partial: boolean): number {
  let found = -1;
  for (let index = 0; index < text.length; index += 1) {
    if (!isBoundary(text, index)) continue;
    const tail = text.slice(index);
    if (
      TOOL_MARKERS.some((marker) =>
        partial ? marker.startsWith(tail) : tail.startsWith(marker),
      )
    ) {
      found = index;
      break;
    }
  }
  return found;
}

function flushText(buffer: string): ProviderEvent | undefined {
  return buffer ? { type: "text.delta", text: buffer } : undefined;
}

function protocolFailure(error: unknown): ProviderEvent {
  return {
    type: "error",
    error: {
      // This is a model/runtime protocol defect discovered while normalizing
      // an otherwise successful response. It is distinct from an HTTP 400
      // request rejected by the provider and can therefore be recovered by
      // the agent loop without pretending the provider is unavailable.
      code: "MODEL_PROTOCOL_ERROR",
      message:
        error instanceof ToolError
          ? error.message
          : "The provider emitted an invalid textual tool envelope; retry the current decision using one native tool call or plain text.",
    },
  };
}

/**
 * Normalizes provider text before it reaches the agent kernel. Tool-shaped
 * text is quarantined until the envelope is complete; only a normalized
 * `tool.call` or ordinary assistant text can leave this boundary.
 */
export async function* normalizeProviderEvents(
  events: AsyncIterable<ProviderEvent>,
  turn = 0,
): AsyncIterable<ProviderEvent> {
  let quarantined = "";

  for await (const event of events) {
    if (event.type === "text.delta") {
      const combined = quarantined + event.text;
      const marker = findMarker(combined, false);
      if (marker >= 0) {
        if (marker > 0) {
          const visible = flushText(combined.slice(0, marker));
          if (visible) yield visible;
        }
        quarantined = combined.slice(marker);
        try {
          const calls = recoverTextToolCalls(quarantined, turn);
          if (calls) {
            for (const call of calls) yield { type: "tool.call", call };
            quarantined = "";
          }
        } catch (error) {
          yield protocolFailure(error);
          return;
        }
        continue;
      }

      const partialMarker = findMarker(combined, true);
      if (partialMarker >= 0) {
        if (partialMarker > 0) {
          const visible = flushText(combined.slice(0, partialMarker));
          if (visible) yield visible;
        }
        quarantined = combined.slice(partialMarker);
      } else {
        const visible = flushText(combined);
        if (visible) yield visible;
        quarantined = "";
      }
      continue;
    }

    if (event.type === "tool.call" && quarantined) {
      // Native tool events have already been normalized by the provider. A
      // preceding text fragment is ordinary prose unless it is a complete
      // envelope; never leak a malformed tool-shaped payload.
      try {
        const calls = recoverTextToolCalls(quarantined, turn);
        if (calls) {
          for (const call of calls) yield { type: "tool.call", call };
        } else if (!isUnparseableToolShapedText(quarantined)) {
          const visible = flushText(quarantined);
          if (visible) yield visible;
        }
      } catch (error) {
        yield protocolFailure(error);
        return;
      }
      quarantined = "";
    }

    if (event.type !== "done") yield event;
    else {
      if (quarantined) {
        try {
          const calls = recoverTextToolCalls(quarantined, turn);
          if (calls) {
            for (const call of calls) yield { type: "tool.call", call };
          } else if (!isUnparseableToolShapedText(quarantined)) {
            const visible = flushText(quarantined);
            if (visible) yield visible;
          } else {
            yield protocolFailure(new Error("malformed tool envelope"));
            return;
          }
        } catch (error) {
          yield protocolFailure(error);
          return;
        }
        quarantined = "";
      }
      yield event;
    }
  }
}
