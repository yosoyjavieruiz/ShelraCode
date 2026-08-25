import { expect, test } from "bun:test";
import {
  groupTranscriptItems,
  reuseUnchangedGroups,
  type TurnGroup,
} from "../../src/tui/components/Transcript.js";
import type { TranscriptItem } from "../../src/tui/presentation/types.js";

// Direct user feedback: "cada vez que escribe en el streaming de texto
// parpadea, se renderiza mucho". Root cause: `groupTranscriptItems` is
// pure/stateless — every call rebuilds every TurnGroup object fresh, even
// for turns whose items didn't change. `<For each={groups()}>`
// (Transcript.tsx) diffs by object identity, so a fresh object for every
// turn on every streamed token meant it could not tell 40 finished turns
// apart from the one turn actually streaming, and re-rendered all of them.
// `reuseUnchangedGroups` is the fix: it hands back the *same* TurnGroup
// object reference for any turn whose items are unchanged, so `<For>` can
// correctly skip it.
//
// A second pass (see tests/integration/tui-streaming-no-remount.test.tsx
// for the full three-layer story, and PresentationItem's own comments)
// went further: even the turn that's *actively* streaming now keeps its
// group object stable — a same-id assistant-text item's text differing is
// no longer enough to invalidate group identity, because the whole point
// is to let Transcript's `<Index>` keep that turn's own rendered elements
// mounted too, not just leave every *other* turn alone. The live text for
// that one item is read separately, through Transcript's
// `streamingAssistantItem`, not off this (now potentially stale-on-text)
// snapshot — these tests reflect that: identity is stable, this file
// doesn't re-verify the live-text bridge itself.

function userTurn(turnId: string, id: string): TranscriptItem {
  return { kind: "user-turn", id, turnId, text: "hi" };
}

function assistantText(
  turnId: string,
  id: string,
  text: string,
): TranscriptItem {
  return { kind: "assistant-text", id, turnId, text, streaming: true };
}

test("an unrelated, unchanged turn keeps the exact same TurnGroup object across a re-group", () => {
  const items: TranscriptItem[] = [
    userTurn("turn-1", "user-1"),
    assistantText("turn-1", "a-1", "Finished reply."),
    userTurn("turn-2", "user-2"),
    assistantText("turn-2", "a-2", "Stream"),
  ];
  const first = groupTranscriptItems(items);
  const previousById = new Map(first.map((group) => [group.id, group]));

  // Simulate one more streamed token landing on turn-2 only — turn-1's
  // items keep the exact same references, matching how
  // presentation/adapter.ts's appendAssistantText only replaces the one
  // item actually being appended to.
  const nextItems: TranscriptItem[] = [
    items[0]!,
    items[1]!,
    items[2]!,
    assistantText("turn-2", "a-2", "Streaming…"),
  ];
  const second = reuseUnchangedGroups(
    groupTranscriptItems(nextItems),
    previousById,
  );

  const turn1Before = first.find((group) => group.id === "turn-1");
  const turn1After = second.find((group) => group.id === "turn-1");
  const turn2Before = first.find((group) => group.id === "turn-2");
  const turn2After = second.find((group) => group.id === "turn-2");

  // Both are the *exact same object* — turn-1 because nothing in it
  // changed at all, turn-2 (the one actively streaming) because a same-id
  // assistant-text item's text differing is deliberately not enough to
  // invalidate a group's identity (see this file's top comment). Neither
  // group's own JSX needs to be torn down and rebuilt for this update.
  expect(turn1After).toBe(turn1Before!);
  expect(turn2After).toBe(turn2Before!);
});

test("a brand new turn (first message of a fresh conversation) is not mistaken for a reused one", () => {
  const previousById = new Map<string, TurnGroup>();
  const items: TranscriptItem[] = [userTurn("turn-1", "user-1")];
  const result = reuseUnchangedGroups(
    groupTranscriptItems(items),
    previousById,
  );
  expect(result).toHaveLength(1);
  expect(result[0]?.id).toBe("turn-1");
});

test("a genuinely new item arriving in a turn (not just a same-id text edit) still invalidates that group", () => {
  const items: TranscriptItem[] = [assistantText("turn-1", "a-1", "Hello")];
  const first = groupTranscriptItems(items);
  const previousById = new Map(first.map((group) => [group.id, group]));

  const nextItems: TranscriptItem[] = [
    items[0]!,
    assistantText("turn-1", "a-2", " and more"),
  ];
  const second = reuseUnchangedGroups(
    groupTranscriptItems(nextItems),
    previousById,
  );

  expect(second[0]).not.toBe(first[0]!);
  expect(second[0]?.assistant).toHaveLength(2);
});
