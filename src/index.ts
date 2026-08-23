import { cliUsage, parseCliArgs } from "./cli/args.js";

const VERSION = "0.1.0";

async function main(): Promise<void> {
  const parsed = parseCliArgs(process.argv.slice(2));

  switch (parsed.command) {
    case "help":
      console.log(cliUsage);
      return;
    case "version":
      console.log(`LocalCode ${VERSION}`);
      return;
    case "tui": {
      const { launchTui } = await import("./tui/launch.js");
      await launchTui();
      return;
    }
    case "setup":
    case "doctor":
    case "models":
    case "providers":
    case "config":
      console.log(
        `${parsed.command} is being wired into the LocalCode control plane.`,
      );
      return;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`LocalCode error: ${message}`);
  process.exitCode = 1;
});
