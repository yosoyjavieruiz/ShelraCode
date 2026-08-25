import { expect, test } from "bun:test";
import type { AppEvent } from "../../src/shared/events.js";
import { createPresentationEventBuffer } from "../../src/tui/presentation/event-buffer.js";

test("batches consecutive assistant deltas into one presentation event", () => {
  const delivered: AppEvent[] = [];
  let scheduled: (() => void) | undefined;
  const buffer = createPresentationEventBuffer(
    (event) => delivered.push(event),
    {
      schedule: (callback) => {
        scheduled = callback;
        return undefined;
      },
      cancel: () => undefined,
    },
  );

  buffer.push({ type: "assistant.delta", text: "first" });
  buffer.push({ type: "assistant.delta", text: " second" });

  expect(delivered).toEqual([]);
  expect(scheduled).toBeDefined();
  scheduled?.();

  expect(delivered).toEqual([
    { type: "assistant.delta", text: "first second" },
  ]);
  buffer.dispose();
});

test("flushes text before ordered events and on disposal", () => {
  const delivered: AppEvent[] = [];
  const buffer = createPresentationEventBuffer(
    (event) => delivered.push(event),
    {
      schedule: () => undefined,
      cancel: () => undefined,
    },
  );
  const phase: AppEvent = { type: "phase.changed", phase: "discover" };

  buffer.push({ type: "assistant.delta", text: "before tool" });
  buffer.push(phase);
  buffer.push({ type: "assistant.delta", text: "before dispose" });
  buffer.dispose();
  buffer.push({ type: "assistant.delta", text: "ignored" });

  expect(delivered).toEqual([
    { type: "assistant.delta", text: "before tool" },
    phase,
    { type: "assistant.delta", text: "before dispose" },
  ]);
});

test("coalesces a long token stream into one bounded presentation update", () => {
  const delivered: Array<{ type: string; text?: string }> = [];
  let scheduled: (() => void) | undefined;
  const buffer = createPresentationEventBuffer(
    (event) => delivered.push(event),
    {
      schedule: (callback) => {
        scheduled = callback;
        return 1;
      },
      cancel: () => undefined,
    },
  );
  for (let index = 0; index < 1_000; index += 1) {
    buffer.push({ type: "assistant.delta", text: "x" });
  }
  expect(delivered).toHaveLength(0);
  scheduled?.();
  expect(delivered).toEqual([
    { type: "assistant.delta", text: "x".repeat(1_000) },
  ]);
  buffer.dispose();
});
