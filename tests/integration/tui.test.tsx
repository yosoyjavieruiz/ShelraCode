import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { AppShell } from "../../src/tui/app.js";

let renderer: { destroy: () => void } | undefined;

afterEach(() => {
  renderer?.destroy();
  renderer = undefined;
});

test("renders the LocalCode shell at a narrow terminal width", async () => {
  const setup = await testRender(() => <AppShell />, {
    width: 80,
    height: 24,
  });
  renderer = setup.renderer;

  await setup.renderOnce();
  const frame = setup.captureCharFrame();

  expect(frame).toContain("LocalCode");
  expect(frame).toContain("PRIVATE");
  expect(frame).toContain("Ask anything");
});
