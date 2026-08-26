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
        } else if (!TOOL_SHAPED_TEXT.test(quarantined)) {
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
          } else if (!TOOL_SHAPED_TEXT.test(quarantined)) {
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
