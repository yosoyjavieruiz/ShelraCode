# LocalCode UI V3 commands

The implementation source of truth is `src/tui/commands/registry.ts` and `src/tui/commands/keybindings.ts`.

| Command               | Slash alias     | Shortcut           | Where                   | Result                                                    |
| --------------------- | --------------- | ------------------ | ----------------------- | --------------------------------------------------------- |
| Command palette       | —               | `Ctrl+P`           | Everywhere              | Search and execute visible commands                       |
| Open workspace        | `/chat`         | `Ctrl+X C`         | Palette/leader          | Return to conversation                                    |
| Switch model          | `/model`        | `Ctrl+X M`         | Palette/leader/composer | Search Auto, local, and verified free-cloud candidates    |
| Models                | `/models`       | —                  | Palette                 | Open model inventory and fit workspace                    |
| Providers             | `/providers`    | `Ctrl+X P`         | Palette/leader          | Inspect configured providers and freshness                |
| Retry provider health | `/retry-health` | —                  | Palette/provider error  | Probe the current provider/model catalog                  |
| Routing               | `/routing`      | `Ctrl+X R`         | Palette/leader          | Explain task, privacy, capability, cost, quota, selection |
| Usage                 | `/quota`        | `Ctrl+X Q`         | Palette/leader          | Show quota snapshots and confidence                       |
| Privacy               | `/privacy`      | `Ctrl+X V`         | Palette/leader          | Review repository policy and remote guards                |
| Context               | `/context`      | —                  | Palette/composer        | Show included files and cloud eligibility                 |
| Plan                  | `/plan`         | —                  | Palette/composer        | Show task analysis and risk                               |
| Review changes        | `/diff`         | `Ctrl+X D`         | Palette/leader          | Open the current native unified Diff                      |
| Sessions              | `/sessions`     | `Ctrl+X S`         | Palette/leader          | Browse local session history                              |
| Settings              | `/settings`     | `Ctrl+X ,`         | Palette/leader          | Search and edit backed preferences                        |
| Keybindings           | `/keybinds`     | —                  | Palette                 | Open Settings keybinding view                             |
| Help                  | `/help`         | `Ctrl+X ?`         | Palette/leader          | Show registry-derived command help                        |
| New session           | `/new`          | —                  | Palette/composer        | Clear the visible task and draft                          |
| Clear conversation    | `/clear`        | —                  | Palette/composer        | Clear transcript without changing repository state        |
| Exit                  | `/exit`         | `Ctrl+C` when idle | Everywhere              | Restore the terminal and leave                            |

## Interaction contract

- Up/Down moves the active selection; Enter runs or chooses it.
- `Esc` closes the deepest surface first. In conversation it cancels an active task before clearing a draft.
- `Shift+Enter` inserts a newline. Enter submits from the composer.
- `Ctrl+X` is a timed leader; the leader can be configured in the keymap path and is not a hidden second command registry.
- Palette Escape restores the draft it opened over. A command that executes intentionally clears the palette draft.
