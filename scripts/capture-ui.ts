import { mkdir } from "node:fs/promises";
import path from "node:path";
import { testRender } from "@opentui/solid";
import { AppShell } from "../src/tui/app.js";
import { readUIFixture } from "../src/tui/state/fixtures.js";

const outputDirectory = path.resolve(
  process.argv[2] ?? "docs/ui-v3/baseline/current",
);
const sizes = [
  [80, 24],
  [100, 30],
  [120, 40],
  [140, 45],
  [160, 50],
  [200, 60],
] as const;

await mkdir(outputDirectory, { recursive: true });
for (const [width, height] of sizes) {
  const setup = await testRender(() => AppShell({ fixture: readUIFixture() }), {
    width,
    height,
  });
  try {
    await setup.renderOnce();
    await new Promise((resolve) => setTimeout(resolve, 25));
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    await Bun.write(
      path.join(outputDirectory, `${width}x${height}.txt`),
      `${frame.replace(/\n+$/, "")}\n`,
    );
  } finally {
    setup.renderer.destroy();
  }
}

console.log(`Captured ${sizes.length} UI frames in ${outputDirectory}`);
