import { mkdir } from "node:fs/promises";
import path from "node:path";
import { testRender } from "@opentui/solid";
import {
  CoreConceptV4,
  type CoreConceptKind,
  type CoreConceptState,
} from "../src/tui/concepts/CoreConceptsV4.js";

const outputRoot = path.resolve(process.argv[2] ?? "docs/ui-v4/concepts");
const sizes = [
  [80, 24],
  [120, 40],
  [160, 50],
] as const;
const concepts: CoreConceptKind[] = ["editorial", "timeline", "command-canvas"];
const states: CoreConceptState[] = ["home", "conversation"];

for (const concept of concepts) {
  const directory = path.join(outputRoot, concept);
  await mkdir(directory, { recursive: true });
  for (const state of states) {
    for (const [width, height] of sizes) {
      const setup = await testRender(
        () => CoreConceptV4({ kind: concept, state, width, height }),
        { width, height },
      );
      try {
        await setup.renderOnce();
        const frame = setup.captureCharFrame();
        await Bun.write(
          path.join(directory, `${state}-${width}x${height}.txt`),
          `${frame.replace(/\n+$/, "")}\n`,
        );
      } finally {
        setup.renderer.destroy();
      }
    }
  }
}

console.log(
  `Captured ${concepts.length} V4 concepts across ${states.length} states and ${sizes.length} sizes in ${outputRoot}`,
);
