import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { MarkdownBlock } from "../../src/tui/components/Transcript.js";
import { getTheme } from "../../src/tui/theme/tokens.js";

let renderer: { destroy: () => void } | undefined;
afterEach(() => {
  renderer?.destroy();
  renderer = undefined;
});

const CONTENT =
  "Here's the guard:\n\n```ts\nfunction refreshGuard(token: Token): boolean {\n  return !token.expired;\n}\n```\n\nIt checks `token.expired` before continuing.";

// Direct regression guard for a confirmed upstream OpenTUI bug: a message
// containing a fenced code block rendered through the combined
// `<markdown>` renderable came back with either the code block blank
// (streaming=true) or the surrounding prose blank (streaming=false) —
// never both. Same framework has open, unresolved upstream issues for this
// exact failure in OpenCode. Fixed by splitting fenced code out and
// rendering it through the standalone `<code>` (CodeRenderable) component
// instead of asking `<markdown>` to handle it.
test("a code block renders its content and the surrounding prose, not streaming", async () => {
  const setup = await testRender(
    () => (
      <MarkdownBlock
        theme={getTheme(true)}
        content={() => CONTENT}
        streaming={() => false}
      />
    ),
    { width: 90, height: 16 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("Here's the guard:");
  expect(frame).toContain("function refreshGuard");
  expect(frame).toContain("return !token.expired;");
  expect(frame).toContain("It checks token.expired before continuing.");
});

test("a code block renders correctly while still streaming too", async () => {
  const setup = await testRender(
    () => (
      <MarkdownBlock
        theme={getTheme(true)}
        content={() => CONTENT}
        streaming={() => true}
      />
    ),
    { width: 90, height: 16 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("Here's the guard:");
  expect(frame).toContain("function refreshGuard");
  expect(frame).toContain("return !token.expired;");
});

test("the language tag shows above the code block", async () => {
  const setup = await testRender(
    () => (
      <MarkdownBlock
        theme={getTheme(true)}
        content={() => CONTENT}
        streaming={() => false}
      />
    ),
    { width: 90, height: 16 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain("ts");
});

test("plain prose with no code fence is unaffected", async () => {
  const setup = await testRender(
    () => (
      <MarkdownBlock
        theme={getTheme(true)}
        content={() => "Just a plain reply, nothing fancy."}
        streaming={() => false}
      />
    ),
    { width: 90, height: 8 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain(
    "Just a plain reply, nothing fancy.",
  );
});

test("an unterminated fence mid-stream still shows the prose that arrived so far", async () => {
  const setup = await testRender(
    () => (
      <MarkdownBlock
        theme={getTheme(true)}
        content={() => "Here's the start:\n\n```ts\nconst x ="}
        streaming={() => true}
      />
    ),
    { width: 90, height: 10 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain("Here's the start:");
});
