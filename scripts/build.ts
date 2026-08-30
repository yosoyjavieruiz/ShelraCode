import path from "node:path";
import solidPlugin from "@opentui/solid/bun-plugin";
import { installExecutable } from "../src/cli/installation.js";
import { CLI_NAME, PRODUCT_NAME, VERSION } from "../src/version.js";

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

const projectRoot = path.resolve(import.meta.dir, "..");
const distDirectory = path.join(projectRoot, "dist");
const entrypoint = path.join(projectRoot, "src", "index.ts");

const result = await Bun.build({
  entrypoints: [entrypoint],
  outdir: distDirectory,
  target: "bun",
  conditions: ["browser"],
  plugins: [solidPlugin],
  external: opentuiNativePackages,
  sourcemap: "external",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  throw new Error("ShelraCode build failed");
}

const executableName =
  process.platform === "win32" ? `${CLI_NAME}.exe` : CLI_NAME;
const executablePath = path.join(distDirectory, executableName);
const compileTarget =
  process.platform === "win32"
    ? process.arch === "x64"
      ? "bun-windows-x64"
      : process.arch === "arm64"
        ? "bun-windows-arm64"
        : undefined
    : undefined;

if (process.platform === "win32" && compileTarget === undefined) {
  throw new Error(
    `Standalone Shelra builds do not support Windows architecture ${process.arch}.`,
  );
}

const compileOptions: Bun.CompileBuildOptions = {
  outfile: executablePath,
  // A compiled app already contains its JSX preload and native OpenTUI assets.
  // Loading the repository's bunfig from an arbitrary caller directory would
  // make the installed executable depend on that project's node_modules.
  autoloadBunfig: false,
  autoloadDotenv: true,
  autoloadPackageJson: false,
  ...(compileTarget === undefined ? {} : { target: compileTarget }),
  ...(process.platform === "win32"
    ? {
        windows: {
          hideConsole: false,
          title: PRODUCT_NAME,
          publisher: PRODUCT_NAME,
          version: VERSION,
          description: "Local-first autonomous coding agent",
          copyright: "Copyright ShelraCode",
        },
      }
    : {}),
};

const executableResult = await Bun.build({
  entrypoints: [entrypoint],
  target: "bun",
  conditions: ["browser"],
  plugins: [solidPlugin],
  // The standalone binary must carry OpenTUI's platform runtime and all
  // JavaScript dependencies; unlike the development bundle it cannot resolve
  // packages from a checkout after installation.
  packages: "bundle",
  compile: compileOptions,
});

if (!executableResult.success) {
  for (const log of executableResult.logs) console.error(log);
  throw new Error(`${PRODUCT_NAME} standalone build failed`);
}

console.log(
  `Built bundle: ${path.relative(projectRoot, path.join(distDirectory, "index.js"))}`,
);
console.log(
  `Built standalone executable: ${path.relative(projectRoot, executablePath)}`,
);

if (process.env.SHELRA_BUILD_SKIP_INSTALL === "1") {
  console.log("Skipped per-user installation (SHELRA_BUILD_SKIP_INSTALL=1).");
} else {
  try {
    const installed = await installExecutable({
      sourcePath: executablePath,
      version: VERSION,
      platform: process.platform,
      architecture: process.arch,
    });
    console.log(
      `Installed active ${PRODUCT_NAME} ${installed.manifest.version}.`,
    );
    console.log(`Global command: ${CLI_NAME}`);
    console.log(`Install directory: ${installed.paths.binDir}`);
    if (installed.pathPersisted)
      console.log(
        "User PATH updated. Open a new terminal to use shelra everywhere.",
      );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isLock =
      message.includes("still running or locked") ||
      message.includes("EPERM") ||
      message.includes("EBUSY");
    if (isLock) {
      console.warn(
        `Warning: Could not update the active executable in %USERPROFILE%\\.shelra\\bin — it is locked (EPERM). The bundle in dist/ was built successfully.`,
      );
      console.warn(`  ${message}`);
      console.warn(
        `Close any running shelra processes and run 'bun run scripts/build.ts' again, or use 'SHELRA_BUILD_SKIP_INSTALL=1 bun run scripts/build.ts' to skip installation.`,
      );
    } else {
      throw error;
    }
  }
}
