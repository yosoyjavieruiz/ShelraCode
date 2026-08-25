import { expect, test } from "bun:test";
import { segmentMarkdown } from "../../src/tui/components/Transcript.js";

test("plain prose with no code fence stays a single text segment", () => {
  const segments = segmentMarkdown("Just a plain sentence.");
  expect(segments).toEqual([
    { kind: "text", content: "Just a plain sentence." },
  ]);
});

test("a fenced code block with a language tag is split out on its own", () => {
  const segments = segmentMarkdown(
    "Before.\n\n```ts\nconst x = 1;\n```\n\nAfter.",
  );
  expect(segments).toEqual([
    { kind: "text", content: "Before.\n\n" },
    { kind: "code", content: "const x = 1;", lang: "ts" },
    { kind: "text", content: "\n\nAfter." },
  ]);
});

test("a fenced code block with no language tag has an undefined lang", () => {
  const segments = segmentMarkdown("```\nplain output\n```");
  expect(segments).toEqual([
    { kind: "code", content: "plain output", lang: undefined },
  ]);
});

test("multiple code blocks in one message each become their own segment", () => {
  const segments = segmentMarkdown("```js\na();\n```\nmiddle\n```py\nb()\n```");
  expect(segments.map((s) => s.kind)).toEqual(["code", "text", "code"]);
  expect(segments[0]).toEqual({ kind: "code", content: "a();", lang: "js" });
  expect(segments[2]).toEqual({ kind: "code", content: "b()", lang: "py" });
});

test("an unterminated fence (still streaming in) is left as plain text, not dropped", () => {
  const segments = segmentMarkdown("Here's the start:\n\n```ts\nconst x =");
  expect(segments).toEqual([
    { kind: "text", content: "Here's the start:\n\n```ts\nconst x =" },
  ]);
});

test("an empty string still returns one (empty) text segment, never zero", () => {
  expect(segmentMarkdown("")).toEqual([{ kind: "text", content: "" }]);
});
