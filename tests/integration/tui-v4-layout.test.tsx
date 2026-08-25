import { afterEach, expect, test } from "bun:test";
import type { Renderable } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { AppShell } from "../../src/tui/app.js";

let renderer: { destroy: () => void } | undefined;
afterEach(() => {
  renderer?.destroy();
  renderer = undefined;
  delete process.env.LOCALCODE_UI_FIXTURE;
});

type RenderTreeNode = {
  id?: string;
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

function requiredRenderable(root: unknown, id: string): Renderable {
  const renderable = findRenderable(root, id);
  expect(renderable, `missing renderable ${id}`).toBeDefined();
  return renderable as Renderable;
}

for (const [width, height] of [
  [80, 24],
  [100, 30],
  [120, 40],
  [140, 45],
  [160, 50],
  [200, 60],
] as const) {
  test(`transcript and composer share one column at ${width}x${height}`, async () => {
    process.env.LOCALCODE_UI_FIXTURE = "conversation";
    const setup = await testRender(() => <AppShell fixture="conversation" />, {
      width,
      height,
    });
    renderer = setup.renderer;
    await setup.renderOnce();

    const content = requiredRenderable(
      setup.renderer.root,
      "core-content-column",
    );
    const composer = requiredRenderable(
      setup.renderer.root,
      "core-composer-column",
    );
    const transcriptContent = requiredRenderable(
      setup.renderer.root,
      "core-transcript-content",
    );
    const composerInput = requiredRenderable(
      setup.renderer.root,
      "core-composer-input",
    );
    const status = requiredRenderable(setup.renderer.root, "core-status");

    expect(composer.x).toBe(content.x);
    expect(composer.width).toBe(content.width);
    // The composer box itself still aligns edge-to-edge with the transcript
    // (asserted above/below via `composer`/`content`) — the *textarea*
    // inside it now sits 2 columns further right than transcript body text,
    // for a leading "› " prompt glyph (docs/ui-chat-v2, visual composer
    // pass). That's a deliberate difference in the composer's own internal
    // layout, not a regression of the box-level invariant this test exists
    // to guard.
    const promptGlyphWidth = 2;
    expect(composerInput.x).toBe(transcriptContent.x + promptGlyphWidth);
    expect(composerInput.width).toBe(
      transcriptContent.width - promptGlyphWidth,
    );
    expect(content.x).toBeGreaterThanOrEqual(0);
    expect(content.x + content.width).toBeLessThanOrEqual(width);
    expect(composer.y + composer.height).toBeLessThanOrEqual(status.y);
    expect(status.x + status.width).toBeLessThanOrEqual(width);

    const frame = setup.captureCharFrame();
    expect(frame).not.toContain("Conversation workspace");
    expect(frame).not.toContain("Focus transcript");
    expect(frame).not.toContain("strict-zero");
    expect(frame).not.toContain("$0");
    expect(frame).toContain("Ask ShelraCode…");
  });
}
