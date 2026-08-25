import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { AppShell } from "../../src/tui/app.js";

let renderer: { destroy: () => void } | undefined;
afterEach(() => {
  renderer?.destroy();
  renderer = undefined;
});

// Direct user feedback: "yo escribo el / y despues las letras se ponen
// delante ejemplo letras/" plus "cuando selecciono modelo me lleva a otro
// lugar ... no se queda el botonsheet en el chat". Root cause was three
// compounding layers, each confirmed by direct instrumentation (not
// assumed) before being fixed:
//
// 1. handleComposerInput (app.tsx) made several separate signal writes
//    per keystroke (setComposerValue, then setOverlay/setPaletteQuery/
//    setPaletteIndex) with no batch() — solid-js has no automatic
//    batching outside solid-js/web's DOM event delegation, which this
//    custom (opentui) renderer doesn't provide either, so each write
//    flushed *separately*. That let downstream reads observe a torn
//    intermediate state (composerValue already "/" but overlay still
//    "none"). Fixed: wrap the whole function body in batch().
// 2. app.tsx's root layout gate read `overlay() === "none" ||
//    overlay() === "slash"` directly inside a `{() => ... ? <>...</> :
//    null}` block, which — this render pipeline's own established,
//    proven limitation for exactly this pattern — recreates its *entire*
//    returned subtree on every re-invocation, not just what changed. Even
//    though the boolean stayed true across "none"→"slash", the raw
//    signal write was enough to retrigger it and remount the whole tree,
//    including a brand new Composer with a brand new TextareaRenderable.
//    Fixed: memoize that gate (`showMainContent`) so the transition no
//    longer changes its output.
// 3. Even so, other legitimate layout dependencies (composer row count
//    changing as the draft goes from empty to non-empty) can still cause
//    an occasional remount — and TextareaRenderable's `initialValue` prop
//    applies through a property setter that calls `setText()` (which
//    "completely resets the buffer state" per its own doc comment) e.g.
//    after `ref` has already fired, silently resetting the cursor to
//    position 0 on every fresh mount with non-empty text, so the next
//    keystroke inserted *before* it instead of after. Fixed in
//    Composer.tsx: reposition the cursor to buffer-end from the
//    createEffect that's guaranteed to observe the editor post-setup, not
//    from `ref` (confirmed too early via direct instrumentation), keyed
//    per editor instance so every fresh mount gets corrected, not just
//    the first.
//
// mockInput.typeText's default delayMs is 0 (all characters emitted in a
// tight loop with no yielding), which does NOT exercise any of this — a
// single renderOnce() after the whole string sees only the final,
// already-consistent state. flush() (waitForVisualIdle under the hood)
// between characters is what gives the renderer and the reactive graph a
// full settle per keystroke, matching how a real terminal delivers one
// keypress at a time.
async function typeSlowly(
  setup: Awaited<ReturnType<typeof testRender>>,
  text: string,
): Promise<void> {
  for (const char of text) {
    await setup.mockInput.typeText(char);
    await setup.flush();
  }
}

test("typing / then letters keeps them in order — / stays first, not last", async () => {
  const setup = await testRender(() => <AppShell />, {
    width: 100,
    height: 30,
  });
  renderer = setup.renderer;
  await setup.renderOnce();

  await typeSlowly(setup, "/model");

  const frame = setup.captureCharFrame();
  expect(frame).toContain("/model");
  expect(frame).not.toContain("model/");

  // The bottom sheet must still be open at the end — a corrupted
  // (non-"/"-prefixed) intermediate value would have made
  // handleComposerInput treat it as "the user backspaced the / away" and
  // close it early ("no se queda el botonsheet en el chat").
  expect(frame).toContain("Auto");
});

test("typing a longer phrase after / keeps every character in the order it was typed", async () => {
  const setup = await testRender(() => <AppShell />, {
    width: 100,
    height: 30,
  });
  renderer = setup.renderer;
  await setup.renderOnce();

  await typeSlowly(setup, "/permissions");

  const frame = setup.captureCharFrame();
  expect(frame).toContain("/permissions");
  expect(frame).not.toContain("permissions/");
});

// Direct user feedback: "cuando selecciono modelo me lleva a otro lugar ...
// no se queda el botonsheet en el chat y switch model nada". Selecting a
// model from inline "/model" mode must resolve entirely within the same
// bottom sheet — the composer/home stays mounted and focused, no separate
// ModelPicker screen ever appears.
test("selecting a model from inline /model mode never navigates away from the composer", async () => {
  const setup = await testRender(() => <AppShell />, {
    width: 100,
    height: 30,
  });
  renderer = setup.renderer;
  await setup.renderOnce();

  await typeSlowly(setup, "/model");
  expect(setup.captureCharFrame()).toContain("/model");

  await setup.mockInput.pressEnter();
  await setup.flush();

  const editor = setup.renderer.root.findDescendantById("core-composer-input");
  expect(editor).toBeDefined();
  expect(editor?.focused).toBe(true);
  // No separate ModelPicker overlay ever mounted.
  expect(
    setup.renderer.root.findDescendantById("model-option-0"),
  ).toBeUndefined();
  // The draft is cleared after a selection — back to a normal composer,
  // not stuck mid-command.
  expect(setup.captureCharFrame()).not.toContain("/model");
});
