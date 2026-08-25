export interface InteractiveTerminalOptions {
  env: Record<string, string | undefined>;
  platform: string;
  isInteractive: boolean;
}

/**
 * Prepare the host terminal before OpenTUI starts its capability negotiation.
 *
 * Some Windows terminal hosts expose TERM=dumb even though they support ANSI
 * and alternate-screen control sequences. OpenTUI treats that value as a
 * non-interactive capability and can wait indefinitely before its first draw.
 * Modern Windows consoles support the xterm capability set used by LocalCode.
 */
export function prepareInteractiveTerminal(
  options: InteractiveTerminalOptions,
): void {
  if (!options.isInteractive) {
    throw new Error(
      "LocalCode TUI requires an interactive terminal. Run it from a real terminal or PTY.",
    );
  }

  if (options.platform !== "win32") {
    return;
  }

  const term = options.env.TERM?.trim().toLowerCase();
  if (!term || term === "dumb") {
    options.env.TERM = "xterm-256color";
  }
}
