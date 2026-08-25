# LocalCode UI V3 information architecture

## Default experience

The conversation is the product surface. The default shell contains only quiet chrome, the transcript, the composer, and compact route/privacy status. It does not reserve a sidebar or inspector.

```text
conversation
  top chrome
  transcript
    user / assistant / markdown
    grouped tool activity
    route and error events
    streaming tail
  composer
  status footer
```

## Depth model

| Capability                 | Current entry               | V3 placement                                                                         | Exit                        |
| -------------------------- | --------------------------- | ------------------------------------------------------------------------------------ | --------------------------- |
| Commands, navigation, help | `Ctrl+P`, `/`               | One command palette and slash query                                                  | `Esc`, execute, or choose   |
| Frequent model switch      | `Ctrl+X M`, `/model`        | Searchable model overlay                                                             | `Esc`, choose               |
| Models inventory and fit   | `/models`                   | Full temporary Models workspace                                                      | `Esc`, conversation command |
| Providers and health       | `Ctrl+X P`, `/providers`    | Full temporary Providers workspace                                                   | `Esc`, retry command        |
| Routing explanation        | `Ctrl+X R`, `/routing`      | Full temporary Routing workspace                                                     | `Esc`                       |
| Usage/quota                | `Ctrl+X Q`, `/quota`        | Full temporary Usage workspace                                                       | `Esc`                       |
| Privacy                    | `Ctrl+X V`, `/privacy`      | Full temporary policy workspace                                                      | `Esc`                       |
| Settings and keybindings   | `Ctrl+X ,`, `/settings`     | Searchable Settings workspace                                                        | `Esc`                       |
| Changes / Diff             | `Ctrl+X D`, `/diff`         | Full temporary native Diff workspace                                                 | `Esc`                       |
| Sessions                   | `Ctrl+X S`, `/sessions`     | Searchable history workspace; current list is SQLite-backed                          | `Esc`, open                 |
| Context and plan           | `/context`, `/plan`         | Contextual temporary workspace                                                       | `Esc`                       |
| Checkpoint / rollback      | `/checkpoints`, `/rollback` | Explicit safe-restore workspace                                                      | `Esc`                       |
| Approval                   | permission event boundary   | Dialog when emitted; deterministic fixture exists until core emits an approval event | Enter approve, Esc deny     |

## Ownership boundary

`AppShell` owns presentation state, overlay depth, selection, composer draft, task lifecycle, and route view models. Components render state and emit intent. Provider adapters, routing, privacy, storage, agent execution, checkpoints, and repository context remain outside leaf TUI components.

## One command model

`src/tui/commands/registry.ts` is the source of truth for palette rows, slash aliases, keybinding labels, help output, recent actions, and command execution. A visible command must call a working action. `Retry provider health` was added to remove the previous misleading provider-error affordance.
