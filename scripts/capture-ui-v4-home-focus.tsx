import { mkdir } from "node:fs/promises";
import path from "node:path";
import { testRender } from "@opentui/solid";
import { HomeView } from "../src/tui/views/HomeView.js";
import { getTheme } from "../src/tui/theme/tokens.js";

const outputDirectory = path.resolve("docs/ui-v4/stages/stage-b-home-focused");
await mkdir(outputDirectory, { recursive: true });

for (const [width, height] of [
  [80, 18],
  [120, 28],
] as const) {
  const setup = await testRender(
    () => (
      <HomeView
        theme={getTheme()}
        width={width - 2}
        dirty
        selectedIndex={() => 0}
        onSelect={() => undefined}
        onSuggestion={() => undefined}
      />
    ),
    { width, height },
  );
  try {
    await setup.renderOnce();
    const frame = setup.captureCharFrame().replace(/\n+$/, "");
    await Bun.write(
      path.join(outputDirectory, `${width}x${height}.txt`),
      `${frame}\n`,
    );
  } finally {
    setup.renderer.destroy();
  }
}
