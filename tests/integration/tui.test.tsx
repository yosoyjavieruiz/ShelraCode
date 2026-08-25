import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { AppShell } from "../../src/tui/app.js";

let renderer: { destroy: () => void } | undefined;
afterEach(() => {
  renderer?.destroy();
  renderer = undefined;
});

for (const width of [80, 100, 120, 160, 200]) {
  test(`renders the ShelraCode shell at ${width} columns`, async () => {
    const setup = await testRender(() => <AppShell />, {
      width,
      height: width === 80 ? 24 : width === 200 ? 60 : 30,
    });
    renderer = setup.renderer;
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("ShelraCode");
    expect(frame).toContain("Private");
    expect(frame).toContain("Ask ShelraCode…");
  });
}

test("wide conversation does not reserve dashboard navigation or inspector", async () => {
  const setup = await testRender(() => <AppShell />, {
    width: 160,
    height: 50,
  });
  renderer = setup.renderer;
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).not.toContain("WORKSPACE");
  expect(frame).not.toContain("INSPECTOR");
  expect(frame).toContain("Ask ShelraCode…");
});
