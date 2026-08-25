import { cliUsage, parseCliArgs } from "./cli/args.js";
import { hasRepositorySetup } from "./config/settings.js";
import {
  runConfig,
  runAgentDoctor,
  runDoctor,
  runModels,
  runProviders,
  runSetup,
} from "./cli/commands.js";

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
      const initialScreen = (await hasRepositorySetup(process.cwd()))
        ? "conversation"
        : "setup";
      await launchTui(initialScreen);
      return;
    }
    case "setup": {
      if (parsed.args.includes("--non-interactive")) {
        await runSetup(process.cwd(), parsed.args);
        return;
      }
      const { launchTui } = await import("./tui/launch.js");
      await launchTui("setup");
      return;
    }
    case "doctor":
      if (parsed.args.includes("--agent")) await runAgentDoctor(process.cwd());
      else await runDoctor(process.cwd());
      return;
    case "models":
      await runModels(process.cwd());
      return;
    case "providers":
      await runProviders(process.cwd());
      return;
    case "config":
      await runConfig(process.cwd());
      return;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`LocalCode error: ${message}`);
  process.exitCode = 1;
});
