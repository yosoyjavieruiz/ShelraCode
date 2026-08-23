import solidPlugin from "@opentui/solid/bun-plugin";

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "bun",
  plugins: [solidPlugin],
  sourcemap: "external",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("LocalCode build failed");
}

console.log("Built current source to dist/");
