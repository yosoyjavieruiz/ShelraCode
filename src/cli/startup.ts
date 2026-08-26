/**
 * The command without an explicit subcommand always opens the main TUI.
 * Repository setup remains available through the explicit `setup` command so
 * the active screen does not change merely because the caller changed folders.
 */
export function defaultTuiScreen(): "conversation" {
  return "conversation";
}
