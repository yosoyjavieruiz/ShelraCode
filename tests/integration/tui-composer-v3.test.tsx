import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { Composer } from "../../src/tui/components/Composer.js";
import { getTheme } from "../../src/tui/theme/tokens.js";

let renderer: { destroy: () => void } | undefined;
afterEach(() => {
  renderer?.destroy();
  renderer = undefined;
});

test("focused composer communicates submit, newline and clear actions", async () => {
  const setup = await testRender(
    () => (
      <Composer
        theme={getTheme(true)}
        value={() => ""}
        onInput={() => undefined}
        focused
        width={70}
      />
    ),
    { width: 70, height: 6 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("Enter");
  expect(frame).toContain("Shift+Enter");
  expect(frame).toContain("newline");
  expect(frame).toContain("Esc");
  expect(frame).toContain("clear");
});

// Regression #1: `TextareaRenderable.initialValue` (@opentui/core) is
// write-once — it silently no-ops after the first render. Composer
// previously used it to clear the field on submit and to sync external
// value changes after mount, so typed text visually stayed in the box after
// sending. Fixed by switching to the live-buffer API (`clear()`/`setText()`).
test("composer visually clears its own buffer after submit", async () => {
  const setup = await testRender(
    () => (
      <Composer
        theme={getTheme(true)}
        value={() => ""}
        onInput={() => undefined}
        onSubmit={() => undefined}
        focused
        width={40}
      />
    ),
    { width: 40, height: 6 },
  );
  renderer = setup.renderer;
  await setup.mockInput.typeText("hola mundo");
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain("hola mundo");

  setup.mockInput.pressEnter();
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).not.toContain("hola mundo");
  expect(frame).toContain("Ask ShelraCode");
});

// Regression #2: passing an already-invoked value (`value={signal()}`)
// instead of the raw accessor (`value={signal}`) freezes this render
// pipeline's reactivity at whatever the value was on the first render —
// confirmed by direct experiment (an isolated `<text>{signal()}</text>`
// never updates here, while `<text>{signal}</text>` does; both go through
// the same @opentui/solid transform used for `bun test` and for the real
// production bundle, since `bunfig.toml`'s preload registers the identical
// plugin `scripts/build.ts` uses). `app.tsx` passed `composerValue()`
// (invoked) into `<Composer value={...}>`, so every programmatic
// content-restore path other than submit (Esc restoring a draft, cancelling
// a task, an unknown slash command) silently failed to update the visible
// buffer. Composer's `value` prop is now typed as an accessor
// (`() => string`) specifically to make this mistake a type error, not just
// a runtime one.
test("composer syncs its buffer when the value prop changes after mount", async () => {
  const [value, setValue] = createSignal("first draft");
  const setup = await testRender(
    () => (
      <Composer
        theme={getTheme(true)}
        value={value}
        onInput={setValue}
        focused
        width={40}
      />
    ),
    { width: 40, height: 6 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain("first draft");

  setValue("restored draft");
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("restored draft");
  expect(frame).not.toContain("first draft");
});
