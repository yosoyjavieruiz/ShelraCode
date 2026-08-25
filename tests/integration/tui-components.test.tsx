import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { createUICommands } from "../../src/tui/commands/registry.js";
import { Composer } from "../../src/tui/components/Composer.js";
import { CommandPalette } from "../../src/tui/components/CommandPalette.js";
import { StatusBar } from "../../src/tui/components/StatusBar.js";
import { TopBar } from "../../src/tui/components/TopBar.js";
import { Transcript } from "../../src/tui/components/Transcript.js";
import { getTheme } from "../../src/tui/theme/tokens.js";

let renderers: Array<{ destroy: () => void }> = [];
afterEach(() => {
  for (const renderer of renderers) renderer.destroy();
  renderers = [];
});
const theme = getTheme(true);

for (const [name, component] of [
  [
    "top",
    () => <TopBar theme={theme} width={80} route="LOCAL" privacy="PRIVATE" />,
  ],
  [
    "status",
    () => <StatusBar theme={theme} notice={() => "Ready"} width={() => 80} />,
  ],
  [
    "composer",
    () => <Composer theme={theme} value={() => ""} onInput={() => undefined} />,
  ],
  [
    "palette",
    () => (
      <CommandPalette
        theme={theme}
        query=""
        commands={createUICommands(() => undefined)}
        selectedIndex={0}
        onInput={() => undefined}
        onSubmit={() => undefined}
      />
    ),
  ],
  [
    "transcript",
    () => (
      <Transcript
        theme={theme}
        messages={[{ role: "assistant", text: "Hello" }]}
        width={80}
      />
    ),
  ],
] as const) {
  test(`renders ${name}`, async () => {
    const setup = await testRender(component, { width: 80, height: 24 });
    renderers.push(setup.renderer);
    await setup.renderOnce();
  });
}

test("composer forwards input and submit", async () => {
  let inputValue = "";
  let submitted = "";
  // Wire value/onInput through a real signal, matching how app.tsx actually
  // uses Composer — a `value` prop disconnected from `onInput` (e.g. an
  // always-"" constant) doesn't reflect real usage and can race with the
  // component's own value->buffer sync effect.
  const [composerValue, setComposerValue] = createSignal("");
  const setup = await testRender(
    () => (
      <Composer
        theme={theme}
        value={composerValue}
        onInput={(value) => {
          inputValue = value;
          setComposerValue(value);
        }}
        onSubmit={(value) => {
          submitted = value;
        }}
      />
    ),
    { width: 30, height: 5 },
  );
  renderers.push(setup.renderer);
  await setup.mockInput.typeText("hello");
  await setup.renderOnce();
  expect(inputValue).toBe("hello");

  setup.mockInput.pressEnter();
  await setup.renderOnce();
  // onSubmit fires with the value at submit time, before the buffer clears.
  expect(submitted).toBe("hello");
  // Clearing the buffer after submit is itself a content change, so onInput
  // fires again with "" — inputValue reflecting the now-empty box is
  // correct, not stale.
  expect(inputValue).toBe("");
});

test("composer forwards keydown", async () => {
  let received = false;
  let keyName = "";
  let ctrl = false;
  const setup = await testRender(
    () => (
      <Composer
        theme={theme}
        value={() => ""}
        onInput={() => undefined}
        onKeyDown={(event) => {
          received = true;
          keyName = event.name;
          ctrl = event.ctrl;
        }}
      />
    ),
    { width: 30, height: 5 },
  );
  renderers.push(setup.renderer);
  setup.mockInput.pressKey("k", { ctrl: true });
  expect(received).toBe(true);
  expect(keyName.toLowerCase()).toBe("k");
  expect(ctrl).toBe(true);
});
