import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { openControlPlane } from "../src/cli/control-plane.js";

const root = process.cwd();
const outputPath =
  process.env.LOCALCODE_CATALOG_PATH?.trim() ||
  path.join(root, ".localcode", "model-catalog.json");
const controlPlane = await openControlPlane(root);

try {
  const result = await controlPlane.discoverModels(AbortSignal.timeout(10_000));
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        recommendations: result.recommendations,
        models: result.models,
        quotas: result.quotas,
      },
      null,
      2,
    )}\n`,
    "utf8",
  );
  console.log(
    `Refreshed ${result.models.length} normalized models to ${outputPath}`,
  );
} finally {
  controlPlane.close();
}
