import { afterEach, expect, test } from "bun:test";
import type { Renderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { AppShell } from "../../src/tui/app.js";

type RenderTreeNode = {
  id?: string;
  y?: number;
  getChildren?: () => unknown[];
};

function findRenderable(node: unknown, id: string): Renderable | undefined {
  const current = node as RenderTreeNode;
  if (current.id === id) return node as Renderable;
  for (const child of current.getChildren?.() ?? []) {
    const match = findRenderable(child, id);
    if (match) return match;
  }
  return undefined;
}

let renderer: { destroy: () => void } | undefined;
afterEach(() => {
  renderer?.destroy();
  renderer = undefined;
});

// The empty-conversation "hero" state groups Home and the composer together,
// centered as one block (ChatGPT/Claude.ai/OpenCode's landing pattern),
// instead of Home anchored top with the composer separately pinned to the
// bottom. Confirmed against the real AppShell, not an isolated component,
// since the centering is driven by layout state app.tsx owns directly.
test("composer sits away from the bottom edge while the conversation is empty", async () => {
  const setup = await testRender(() => <AppShell />, {
    width: 100,
    height: 30,
  });
  renderer = setup.renderer;
  await setup.renderOnce();
  const composer = findRenderable(setup.renderer.root, "core-composer-column");
  const status = findRenderable(setup.renderer.root, "core-status");
  expect(composer).toBeDefined();
  expect(status).toBeDefined();
  // Bottom-pinned sits immediately above the 1-row status bar (a gap of
  // 0-1 rows, exactly what the post-transition test below asserts).
  // Centered in a 30-row viewport must leave a real, visible gap instead.
  const gap = (status?.y ?? 0) - (composer?.y ?? 0);
  expect(gap).toBeGreaterThan(5);
});

test("composer keeps the transcript column geometry before and after the first message", async () => {
  const setup = await testRender(() => <AppShell />, {
    width: 100,
    height: 30,
  });
  renderer = setup.renderer;
  await setup.renderOnce();
  const emptyComposer = findRenderable(
    setup.renderer.root,
    "core-composer-column",
  ) as { x?: number; width?: number } | undefined;
  const emptyContent = findRenderable(
    setup.renderer.root,
    "core-content-column",
  ) as { x?: number; width?: number } | undefined;
  const emptyWidth = emptyComposer?.width ?? 0;
  expect(emptyWidth).toBeGreaterThan(0);
  expect(emptyComposer?.x).toBe(emptyContent?.x);
  expect(emptyComposer?.width).toBe(emptyContent?.width);

  await setup.mockInput.typeText("hola");
  setup.mockInput.pressEnter();
  await setup.renderOnce();
  await new Promise((resolve) => setTimeout(resolve, 400));
  await setup.renderOnce();
  const fullContent = findRenderable(
    setup.renderer.root,
    "core-content-column",
  ) as { x?: number; width?: number } | undefined;
  const fullComposer = findRenderable(
    setup.renderer.root,
    "core-composer-column",
  ) as { x?: number; width?: number } | undefined;

  expect(fullComposer?.x).toBe(fullContent?.x);
  expect(fullComposer?.width).toBe(fullContent?.width);
});

// Direct, repeated user feedback ("cuando el input de chat baja se pierde y
// no queda visible" / "no aparece el input, una vez que baja ya no es
// visible"): an imperative position-flip animation for this transition
// (position: absolute → animate top/left/width via createTimeline →
// position: relative) made the composer disappear in real interactive use
// on two separate attempts, in ways this repo's headless test renderer
// couldn't reliably reproduce or verify fixed. It's been removed —
// isEmptyConversation() flipping false (below) now just lets the reactive
// flex layout snap the composer to its correct position directly, no
// animation, but never wrong or invisible. This asserts that holds at
// every point after submit, immediately and shortly after.
test("the composer stays fully on-screen and visible right after the first message is sent", async () => {
  const setup = await testRender(() => <AppShell />, {
    width: 100,
    height: 30,
  });
  renderer = setup.renderer;
  await setup.renderOnce();

  await setup.mockInput.typeText("hola");
  setup.mockInput.pressEnter();
  await setup.renderOnce();

  await new Promise((resolve) => setTimeout(resolve, 120));
  await setup.renderOnce();

  const composer = findRenderable(
    setup.renderer.root,
    "core-composer-column",
  ) as { x?: number; width?: number } | undefined;
  expect(composer).toBeDefined();
  const x = composer?.x ?? -1;
  const boxWidth = composer?.width ?? 0;
  expect(x).toBeGreaterThanOrEqual(0);
  expect(x + boxWidth).toBeLessThanOrEqual(100);

  const frame = setup.captureCharFrame();
  expect(frame).toContain("Ask ShelraCode");
});

test("composer ends up bottom-anchored once the first message is sent", async () => {
  const setup = await testRender(() => <AppShell />, {
    width: 100,
    height: 30,
  });
  renderer = setup.renderer;
  await setup.renderOnce();

  await setup.mockInput.typeText("hola");
  setup.mockInput.pressEnter();
  await setup.renderOnce();

  const composer = findRenderable(setup.renderer.root, "core-composer-column");
  const status = findRenderable(setup.renderer.root, "core-status");
  expect(composer).toBeDefined();
  expect(status).toBeDefined();
  // Bottom-anchored: sits immediately above the 1-row status bar. No
  // animation anymore (see the test above) — the reactive layout snaps
  // here on the very next render, nothing to wait for.
  const gap =
    (status?.y ?? 0) -
    ((composer?.y ?? 0) +
      (composer as { height?: number } | undefined)?.height!);
  expect(gap).toBeGreaterThanOrEqual(0);
  expect(gap).toBeLessThanOrEqual(1);
});

test("the transcript replaces the hero and shows the sent message after the first submit", async () => {
  const setup = await testRender(() => <AppShell />, {
    width: 100,
    height: 30,
  });
  renderer = setup.renderer;
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain("Try");

  await setup.mockInput.typeText("hola");
  setup.mockInput.pressEnter();
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("You");
  expect(frame).toContain("hola");
  expect(frame).not.toContain("Try");
});
