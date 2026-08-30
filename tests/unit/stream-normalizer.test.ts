import { expect, test } from "bun:test";
import { normalizeProviderEvents } from "../../src/providers/stream-normalizer.js";
import type { ProviderEvent } from "../../src/providers/types.js";

async function* events(
  ...items: ProviderEvent[]
): AsyncIterable<ProviderEvent> {
  for (const item of items) yield item;
}

async function collect(
  source: AsyncIterable<ProviderEvent>,
): Promise<ProviderEvent[]> {
  const output: ProviderEvent[] = [];
  for await (const event of source) output.push(event);
  return output;
}

test("flushes a genuine tool call as text when it does not match a legal envelope shape", async () => {
  const text =
    'Here is the schema for a tool call:\n```json\n{"name": "example", "tool_calls": []}\n```\nUse it as shown above.';
  const output = await collect(
    normalizeProviderEvents(
      events({ type: "text.delta", text }, { type: "done" }),
      0,
    ),
  );

  expect(output.some((event) => event.type === "error")).toBe(false);
  const rendered = output
    .filter(
      (event): event is Extract<ProviderEvent, { type: "text.delta" }> =>
        event.type === "text.delta",
    )
    .map((event) => event.text)
    .join("");
  expect(rendered).toContain("Use it as shown above.");
  expect(rendered).toContain('"tool_calls"');
});

test("still reports a protocol error for genuinely malformed/truncated tool-shaped text", async () => {
  const text = '{"name": "EditFile", "arguments": {"path": "a.ts"';
  const output = await collect(
    normalizeProviderEvents(
      events({ type: "text.delta", text }, { type: "done" }),
      0,
    ),
  );

  expect(output.some((event) => event.type === "error")).toBe(true);
});

test("still recovers a genuine bare JSON tool call", async () => {
  const text = '{"name": "ReadFile", "arguments": {"path": "a.ts"}}';
  const output = await collect(
    normalizeProviderEvents(
      events({ type: "text.delta", text }, { type: "done" }),
      0,
    ),
  );

  expect(output.some((event) => event.type === "tool.call")).toBe(true);
  expect(output.some((event) => event.type === "error")).toBe(false);
});

test("flushes a non-fenced (bare backtick-free) tool-shaped example embedded in prose", async () => {
  const text =
    'The schema looks like {"name": "example", "tool_calls": []} for reference.';
  const output = await collect(
    normalizeProviderEvents(
      events({ type: "text.delta", text }, { type: "done" }),
      0,
    ),
  );

  expect(output.some((event) => event.type === "error")).toBe(false);
  const rendered = output
    .filter(
      (event): event is Extract<ProviderEvent, { type: "text.delta" }> =>
        event.type === "text.delta",
    )
    .map((event) => event.text)
    .join("");
  expect(rendered).toContain("for reference.");
});

test("flushes an XML-tag-wrapped documentation example embedded in prose", async () => {
  const text =
    'Example: <tool_call>{"name": "example", "tool_calls": []}</tool_call> shows the shape. Done.';
  const output = await collect(
    normalizeProviderEvents(
      events({ type: "text.delta", text }, { type: "done" }),
      0,
    ),
  );

  expect(output.some((event) => event.type === "error")).toBe(false);
});

test("still reports a protocol error for a bare, standalone tool-shaped JSON attempt with no surrounding text", async () => {
  const text = '{"name": "example", "tool_calls": []}';
  const output = await collect(
    normalizeProviderEvents(
      events({ type: "text.delta", text }, { type: "done" }),
      0,
    ),
  );

  expect(output.some((event) => event.type === "error")).toBe(true);
});
