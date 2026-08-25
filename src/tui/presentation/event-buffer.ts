import type { AppEvent } from "../../shared/events.js";

export interface PresentationEventBufferOptions {
  delayMs?: number;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
}

export interface PresentationEventBuffer {
  push(event: AppEvent): void;
  flush(): void;
  dispose(): void;
}

const DEFAULT_DELAY_MS = 32;

/**
 * Coalesces adjacent assistant text deltas at the UI boundary. Ordering is
 * preserved: any non-text event flushes pending text before it is delivered.
 * The agent kernel still emits every event; only presentation updates are
 * batched.
 */
export function createPresentationEventBuffer(
  deliver: (event: AppEvent) => void,
  options: PresentationEventBufferOptions = {},
): PresentationEventBuffer {
  const delayMs = Math.max(1, Math.floor(options.delayMs ?? DEFAULT_DELAY_MS));
  const schedule =
    options.schedule ??
    ((callback: () => void, delay: number) => setTimeout(callback, delay));
  const cancel =
    options.cancel ??
    ((handle: unknown) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    });
  let pendingText = "";
  let timer: unknown;
  let disposed = false;

  const flush = (): void => {
    if (timer !== undefined) {
      cancel(timer);
      timer = undefined;
    }
    if (!pendingText) return;
    const text = pendingText;
    pendingText = "";
    deliver({ type: "assistant.delta", text });
  };

  const scheduleFlush = (): void => {
    if (timer !== undefined) return;
    timer = schedule(() => {
      timer = undefined;
      if (!disposed) flush();
    }, delayMs);
  };

  return {
    push(event): void {
      if (disposed) return;
      if (event.type === "assistant.delta") {
        pendingText += event.text;
        if (pendingText) scheduleFlush();
        return;
      }
      flush();
      deliver(event);
    },
    flush,
    dispose(): void {
      if (disposed) return;
      flush();
      disposed = true;
    },
  };
}
