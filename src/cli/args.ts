export type CliCommand =
  | "tui"
  | "setup"
  | "doctor"
  | "models"
  | "providers"
  | "config"
  | "help"
  | "version";

export interface ParsedCliArgs {
  command: CliCommand;
  args: string[];
}

const supportedCommands = new Set<CliCommand>([
  "tui",
  "setup",
  "doctor",
  "models",
  "providers",
  "config",
  "help",
  "version",
]);

export function parseCliArgs(argv: readonly string[]): ParsedCliArgs {
  const [first, ...rest] = argv;

  if (!first || first === "--tui") {
    return { command: "tui", args: [] };
  }

  if (first === "--help" || first === "-h") {
    return { command: "help", args: rest };
  }

  if (first === "--version" || first === "-v") {
    return { command: "version", args: rest };
  }

  if (!supportedCommands.has(first as CliCommand)) {
    throw new Error(`Unknown command: ${first}`);
  }

  return { command: first as CliCommand, args: rest };
}

export const cliUsage = `LocalCode - local-first coding agent

Usage:
  localcode [command]

Commands:
  setup       reopen onboarding intentionally
  doctor      print safe diagnostics
              use --agent for model/tool capability diagnostics
  models      list normalized model state
  providers   list provider readiness and health
  config      show effective policy configuration
  (no args)   onboarding on first run, then open the interactive TUI

Global flags:
  -h, --help       show this help
  -v, --version    show the version
`;
