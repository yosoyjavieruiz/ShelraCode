import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { AppShell } from "../../src/tui/app.js";
import { readUIFixture } from "../../src/tui/state/fixtures.js";

const renderers: Array<{ destroy: () => void }> = [];
afterEach(() => {
  delete process.env.SHELRACODE_UI_FIXTURE;
  for (const renderer of renderers) renderer.destroy();
  renderers.length = 0;
});

test("command palette owns the narrow frame", async () => {
  process.env.SHELRACODE_UI_FIXTURE = "palette";
  const setup = await testRender(() => AppShell({ fixture: readUIFixture() }), {
    width: 80,
    height: 24,
  });
  renderers.push(setup.renderer);
  await setup.renderOnce();
  await new Promise((resolve) => setTimeout(resolve, 25));
  await setup.renderOnce();
  const narrow = setup.captureCharFrame();
  expect(narrow).toContain("NAVIGATION");
  expect(narrow).not.toContain("Intelligence that runs your way");
  expect(narrow).not.toContain("Ask ShelraCode");
  // The palette's own bordered panel already has a search field and an
  // "Esc close" hint — a second, redundant plain-text header row was
  // removed rather than duplicating that information.
  expect(narrow).not.toContain("COMMAND PALETTE");

  delete process.env.SHELRACODE_UI_FIXTURE;
});

test("model-picker fixture keeps narrow metadata on its own row", async () => {
  process.env.SHELRACODE_UI_FIXTURE = "model-picker";
  const setup = await testRender(() => AppShell({ fixture: readUIFixture() }), {
    width: 80,
    height: 24,
  });
  renderers.push(setup.renderer);
  await setup.renderOnce();
  await new Promise((resolve) => setTimeout(resolve, 25));
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("Qwen 2.5 Coder 7B");
  expect(frame).toContain("LM Studio");
  expect(frame).toContain("FREE CLOUD");
  delete process.env.SHELRACODE_UI_FIXTURE;
});
