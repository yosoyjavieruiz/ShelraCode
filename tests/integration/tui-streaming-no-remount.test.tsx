import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { Transcript } from "../../src/tui/components/Transcript.js";
import {
  beginTranscriptTurn,
  createTranscriptPresentation,
  presentAppEvent,
  type TranscriptPresentation,
} from "../../src/tui/presentation/adapter.js";
import { getTheme } from "../../src/tui/theme/tokens.js";

let renderer: { destroy: () => void } | undefined;
afterEach(() => {
  renderer?.destroy();
  renderer = undefined;
});

// Direct user feedback: "el renderizado parpadeando de streaming mientras
// escribe continua". Root cause was three independent layers, each
// confirmed by directly probing this render pipeline (not assumed):
//
// 1. Transcript's inner list used `<For>`, which keys by item *value*.
//    appendAssistantText (adapter.ts) returns a new object for the
//    streaming item on every token, so `<For>` saw a remove+add and fully
//    unmounted/remounted it every keystroke. Fixed: `<Index>`, keyed by
//    position instead.
// 2. Even with `<Index>`, MarkdownBlock's own top-level conditional
//    (code-block vs plain vs markdown) recreated its *entire* returned
//    branch on every re-evaluation, confirmed by probing an isolated
//    reproduction — a genuine limitation of this render pipeline, not a
//    misuse: a `{() => cond() ? A : B}` here does not patch in place when
//    the branch taken is unchanged, unlike vanilla Solid-DOM. Fixed:
//    `createMemo` on the branch conditions so they only actually notify
//    when the boolean itself flips, not on every character.
// 3. Above *that*, `<For each={groups()}>` still tore down the whole
//    per-turn group (and, cascading down, `<Index>` itself) every token,
//    because the streaming item's own object reference changing meant
//    reuseUnchangedGroups' *own* comparison judged that turn's group
//    "changed". Fixed: group identity now ignores a same-id assistant-text
//    item's text differences; the live text is read separately through
//    Transcript's `streamingAssistantItem`, a plain (unmemoized, meant to
//    be read every token) accessor — see reuseUnchangedGroups' and
//    PresentationItem's own comments for the full reasoning.
//
// This is the direct regression guard for all three: the rendered text
// element for a streaming reply must be the *same object* from the first
// token to the last, not just show the right characters at the end.
test("a streaming assistant message keeps the same rendered text element from first token to last", async () => {
  let state: TranscriptPresentation = beginTranscriptTurn(
    createTranscriptPresentation(),
    { turnId: "turn-1", text: "Explain the guard." },
  );
  state = presentAppEvent(state, { type: "assistant.delta", text: "H" });
  const [items, setItems] = createSignal(state.items);

  const setup = await testRender(
    () => <Transcript theme={getTheme(true)} items={items} width={90} />,
    { width: 90, height: 20 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();

  const first = setup.renderer.root.findDescendantById("markdown-plain-text");
  expect(first).toBeDefined();

  for (const chunk of ["e", "l", "l", "o", " ", "w", "o", "r", "l", "d"]) {
    state = presentAppEvent(state, { type: "assistant.delta", text: chunk });
    setItems(state.items);
    await setup.renderOnce();
  }

  const last = setup.renderer.root.findDescendantById("markdown-plain-text");
  expect(last).toBe(first);
  expect(setup.captureCharFrame()).toContain("Hello world");
});

// A second, unrelated, already-finished turn earlier in the conversation
// must keep showing its own content correctly while a *later* turn
// streams — the reuseUnchangedGroups layer's own concern (also covered,
// with real `toBe` reference-equality assertions, by
// tui-transcript-group-stability.test.ts), exercised here end to end
// through the real Transcript render instead of the reducer alone.
test("an earlier finished turn's content is unaffected while a later turn streams", async () => {
  let state: TranscriptPresentation = beginTranscriptTurn(
    createTranscriptPresentation(),
    { turnId: "turn-1", text: "First question." },
  );
  state = presentAppEvent(state, {
    type: "assistant.delta",
    text: "First finished reply.",
  });
  state = beginTranscriptTurn(state, {
    turnId: "turn-2",
    text: "Second question.",
  });
  state = presentAppEvent(state, { type: "assistant.delta", text: "S" });
  const [items, setItems] = createSignal(state.items);

  const setup = await testRender(
    () => <Transcript theme={getTheme(true)} items={items} width={90} />,
    { width: 90, height: 20 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();

  for (const chunk of ["t", "r", "e", "a", "m", "i", "n", "g"]) {
    state = presentAppEvent(state, { type: "assistant.delta", text: chunk });
    setItems(state.items);
    await setup.renderOnce();
  }

  const frame = setup.captureCharFrame();
  expect(frame).toContain("First finished reply.");
  expect(frame).toContain("Streaming");
});
