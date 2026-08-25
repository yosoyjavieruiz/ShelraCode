import solidPlugin from "@opentui/solid/bun-plugin";

const opentuiNativePackages = [
  "@opentui/core-darwin-x64",
  "@opentui/core-darwin-arm64",
  "@opentui/core-linux-x64",
  "@opentui/core-linux-arm64",
  "@opentui/core-linux-x64-musl",
  "@opentui/core-linux-arm64-musl",
  "@opentui/core-win32-x64",
  "@opentui/core-win32-arm64",
];

const result = await Bun.build({
  entrypoints: ["./src/index.ts"],
  outdir: "./dist",
  target: "bun",
  conditions: ["browser"],
  plugins: [solidPlugin],
  external: opentuiNativePackages,
  sourcemap: "external",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("LocalCode build failed");
}

console.log("Built current source to dist/");
