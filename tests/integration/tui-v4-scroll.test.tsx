import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import {
  beginTranscriptTurn,
  createTranscriptPresentation,
  presentAppEvent,
} from "../../src/tui/presentation/adapter.js";
import { Transcript } from "../../src/tui/components/Transcript.js";
import { getTheme } from "../../src/tui/theme/tokens.js";

let renderer: { destroy: () => void } | undefined;

afterEach(() => {
  renderer?.destroy();
  renderer = undefined;
});

test("new transcript activity does not fight a user-scrolled viewport", async () => {
  let presentation = beginTranscriptTurn(createTranscriptPresentation(), {
    turnId: "scroll-turn",
    text: "Review the repository history.",
  });
  for (let index = 0; index < 12; index += 1) {
    presentation = presentAppEvent(presentation, {
      type: "assistant.delta",
      text: `Evidence line ${index} explains the current state.`,
    });
  }
  const [items, setItems] = createSignal(presentation.items);
  const setup = await testRender(
    () => (
      <Transcript
        theme={getTheme()}
        items={items}
        width={60}
        height={8}
      />
    ),
    { width: 60, height: 8 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();

  const viewport = setup.renderer.root.findDescendantById("core-transcript");
  expect(viewport).toBeDefined();
  await setup.mockMouse.scroll(viewport?.x ?? 0, viewport?.y ?? 0, "up");
  await setup.mockMouse.scroll(viewport?.x ?? 0, viewport?.y ?? 0, "up");
  await setup.mockMouse.scroll(viewport?.x ?? 0, viewport?.y ?? 0, "up");
  await setup.renderOnce();
  const scrollTopBeforeActivity = (viewport as { scrollTop?: number }).scrollTop;

  setItems([
    ...items(),
    {
      id: "scroll-turn-assistant-2",
      turnId: "scroll-turn",
      kind: "assistant-text" as const,
      text: "A new observation arrived while you were reading above.",
      streaming: true,
    },
  ]);
  await setup.renderOnce();

  expect((viewport as { scrollTop?: number }).scrollTop).toBe(
    scrollTopBeforeActivity,
  );
  expect(setup.captureCharFrame()).toContain("↓ New activity");

  const activity = setup.renderer.root.findDescendantById(
    "transcript-new-activity",
  );
  expect(activity).toBeDefined();
  await setup.mockMouse.click(activity?.x ?? 0, activity?.y ?? 0);
  await setup.renderOnce();
  expect(setup.captureCharFrame()).not.toContain("↓ New activity");
  expect((viewport as { scrollTop?: number }).scrollTop).toBeGreaterThanOrEqual(
    ((viewport as { scrollHeight?: number }).scrollHeight ?? 0) -
      ((viewport as { height?: number }).height ?? 0) -
      1,
  );
});
