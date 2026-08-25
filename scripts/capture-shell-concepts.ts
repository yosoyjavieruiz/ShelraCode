import { mkdir } from "node:fs/promises";
import path from "node:path";
import { testRender } from "@opentui/solid";
import {
  ShellConcept,
  type ShellConceptKind,
} from "../src/tui/concepts/ShellConcepts.js";

const outputRoot = path.resolve(
  process.argv[2] ?? "docs/ui-v3/concepts/captures",
);
const sizes = [
  [80, 24],
  [120, 40],
  [160, 50],
] as const;
const concepts: ShellConceptKind[] = [
  "minimal-canvas",
  "context-ribbon",
  "adaptive-edge",
];

for (const concept of concepts) {
  const directory = path.join(outputRoot, concept);
  await mkdir(directory, { recursive: true });
  for (const [width, height] of sizes) {
    const setup = await testRender(
      () => ShellConcept({ kind: concept, width, height }),
      { width, height },
    );
    try {
      await setup.renderOnce();
      const frame = setup.captureCharFrame();
      await Bun.write(
        path.join(directory, `${width}x${height}.txt`),
        `${frame}\n`,
      );
    } finally {
      setup.renderer.destroy();
    }
  }
}

console.log(
  `Captured ${concepts.length} shell concepts at ${sizes.length} sizes in ${outputRoot}`,
);
