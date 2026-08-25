import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { ChangesView } from "../../src/tui/views/Centers.js";
import { getTheme } from "../../src/tui/theme/tokens.js";

const renderers: Array<{ destroy: () => void }> = [];
afterEach(() => {
  for (const renderer of renderers) renderer.destroy();
  renderers.length = 0;
});

test("invalid diff payload gets a readable raw fallback", async () => {
  const setup = await testRender(
    () => (
      <ChangesView
        theme={getTheme(true)}
        diff="not a unified diff"
        lines={[]}
      />
    ),
    { width: 80, height: 24 },
  );
  renderers.push(setup.renderer);
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("Diff preview unavailable");
  expect(frame).toContain("not a unified diff");
});
