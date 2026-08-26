# LocalCode UI inventory

## Audit context

Audited on 2026-08-23 from the current dirty checkout (`main`, `4cc7ba7`)
and the user-facing bundle:

```text
bun run dist/index.js --tui
```

The real terminal surface was observed at 80x24. The current bundle launches,
accepts input, renders the composer and can open the models center. This is
runtime evidence for the existing V1 surface, not a claim that the UI meets
the V2 visual bar.

## Existing visible surfaces

| Surface                | Current behavior                                                                                                                                                                               | V2 destination                                                                                                                                                                                 |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Startup / conversation | Two static assistant/event messages, a thin top bar, one bordered input and a terse footer. It reads as an empty implementation shell.                                                         | Designed workspace landing state with project context, local readiness, policy state and adaptive starter actions.                                                                             |
| Top bar                | `LocalCode`, `workspace / main`, route and privacy are rendered as one bordered row. Model and mode are absent.                                                                                | Quiet location bar: brand, repository/branch, mode, route/model and privacy, with responsive omission rules.                                                                                   |
| Transcript             | User, assistant and event messages are all plain two-line blocks. No markdown, scroll viewport, activity grouping or completion summary.                                                       | Editorial transcript with distinct message types, markdown/code rendering, stable streaming, compact activity groups and route events.                                                         |
| Composer               | Single-line focused input inside a full border. Slash text overlays a static list but does not provide selection, descriptions or a unified command model.                                     | Multiline composer with focus state, route/mode context, slash autocomplete, `@` references where backed by context, history and action hints.                                                 |
| Command palette        | A visual overlay appears when the composer starts with `/` or after Ctrl+K, but it is only a filtered string list. No fuzzy search, categories, cursor, keybindings or separate overlay focus. | Central command registry powering palette, slash autocomplete, help and keybinding presentation. Fuzzy search, grouped actions, recent/context-aware ordering and deterministic overlay focus. |
| Status bar             | One notice and static Ctrl+K/Ctrl+C hint. No model, context, cost, git, task or route detail.                                                                                                  | Quiet dense operational footer with route/model, context, cost, privacy, task state and context-specific shortcuts.                                                                            |
| Models                 | Flat text list mixing llmfit recommendations, local models and hundreds of cloud records. No active model, cards, search, details or capability/quota/privacy hierarchy.                       | Models workspace with active model, recommendation cards, local/free-cloud sections, model picker and detail inspector.                                                                        |
| Providers              | Flat status lines with endpoint, free state and privacy note.                                                                                                                                  | Provider workspace with connection, health, freshness, quota, privacy classification and backed actions.                                                                                       |
| Quota                  | Raw request/token values, no meters, reset emphasis or confidence explanation.                                                                                                                 | Free-capacity view with readable meters, reset times, confidence and provider/model grouping.                                                                                                  |
| Routing                | Text lines describing gates and rejection reasons.                                                                                                                                             | Visual decision inspector: task, privacy, capability, cost, quota, selected route and rejected candidates, using structured explanations already supplied by the router.                       |
| Privacy                | Raw policy/config lines and path patterns.                                                                                                                                                     | Privacy center with plain-language policy choices, consequences, blocked context summary and explicit confirmation for loosening policy.                                                       |
| Context                | Counts and comma-separated file names; no grouping, truncation strategy or sensitivity presentation.                                                                                           | Context inspector with pinned/task/automatic/system groups and blocked-secret path indicators without revealing content.                                                                       |
| Plan                   | Task-analysis metrics only. There is no step list or current-progress treatment.                                                                                                               | Plan inspector with done/current/pending/failed steps and compact inline plan updates.                                                                                                         |
| Diff / changes         | `git diff --stat` rendered as truncated text. No file tree, diff renderer, hunk navigation or review actions.                                                                                  | Changes workspace with file list, added/removed counts, OpenTUI Diff/Code rendering and unified/split presentation.                                                                            |
| Checkpoint / rollback  | Text-only status; no approval/conflict presentation.                                                                                                                                           | Checkpoint and rollback surfaces with ownership, conflict scope and explicit safe actions.                                                                                                     |
| Doctor                 | Raw diagnostic lines.                                                                                                                                                                          | System center with grouped hardware/runtime/provider/storage checks and safe recovery actions.                                                                                                 |
| Help                   | All slash commands printed as nearly identical lines.                                                                                                                                          | Searchable help grouped by navigation, composer, session, models, review and system, with shortcuts.                                                                                           |
| Setup                  | Existing functionality is non-interactive/non-visual from the CLI path; no V2 wizard shell.                                                                                                    | Product-like staged onboarding using the same shell, surfaces and semantic status components.                                                                                                  |
| Sessions               | No TUI session switcher even though session persistence exists in storage.                                                                                                                     | Session picker only where existing storage can back it; current session clearly marked, no fake actions.                                                                                       |
| Settings               | Repository privacy/routing/permission are available through config services but no TUI settings workspace.                                                                                     | Presentation settings workspace: Appearance, Layout, Interaction, Composer, Agent Display, Models & Routing, Providers, Privacy, Diff & Code and Keybindings, limited to backed settings.      |

## Existing command inventory

Currently handled by the V1 app:

```text
/models /routing /quota /privacy /providers /doctor
/context /plan /diff /checkpoint /rollback /explain-route
/permissions
/help /clear /exit /quit
```

`/permissions` opens the backed safety center. It lists session and project
permission rules, allows revoking an individual rule with Enter, and clears
project rules with X; it does not weaken workspace, network, or process policy.

These are the commands that have current UI/service destinations. V2 may add
`/new`, `/sessions`, `/changes`, `/settings`, `/theme`, `/keybinds`,
`/layout`, `/permissions`, `/status` only when their actions are backed by
existing state or a presentation-only action. Unsupported actions must stay
out of the production registry.

## Existing interaction inventory

- Composer is focused at startup.
- Enter submits through the OpenTUI input component.
- Ctrl+K writes `/` into the composer; it is not a separate command overlay.
- Escape clears the composer and aborts an active task.
- Ctrl+C aborts an active task or destroys the renderer while idle.
- Terminal dimensions are read reactively, but only a small set of text widths
  is adapted; there is no layout mode or focus-region model.
- Mouse capture is provided by OpenTUI but no product-level mouse actions are
  exposed.
- There is no centralized keymap, leader sequence, modal stack or focus
  management abstraction.

## Existing visual debt

- Theme tokens use a blue-gray palette (`#0d1117`, `#8ab4f8`) rather than the
  required Obsidian Violet system and the canvas is not `#000000`.
- Semantic state is encoded mainly as colored text; no-color mode loses much
  of the hierarchy.
- Borders surround the top bar and composer while major content has no useful
  spatial structure.
- `AppShell` owns domain loading, task execution, routing, transcript state,
  command parsing and rendering in one 654-line component.
- Command strings, help text and keyboard behavior are duplicated rather than
  generated from one registry.
- Centers render arrays of strings, preventing reusable cards, lists, meters,
  inspectors, empty states and error states.
- Tool events are reduced to messages and cannot be collapsed, grouped or
  expanded.
- Streaming text has no markdown boundary, scroll policy or user-scroll pause.
- No settings, session, changes, model-detail or provider-detail product
  surface exists.

## V2 information architecture

The rebuilt TUI will use these presentation regions:

```text
TopBar
  Navigation rail (wide) / overlay (medium) / hidden (narrow)
  Main viewport
    Conversation or full-screen workspace
  Inspector (wide) / drawer (medium) / hidden (narrow)
  Composer
  StatusBar
  Overlay stack (palette, picker, approval, detail, confirmation)
```

Core state remains sourced from the existing control plane, router, provider
registry, context builder, tools and storage services. The UI layer will add
only presentation state: active surface, overlay stack, focus region,
expanded activity, layout preference, display settings and command selection.

## Audit conclusion

The V1 interface is not a foundation that needs cosmetic polish. Its main
failure is a missing information architecture and interaction layer. V2 must
replace the string-centered presentation with a semantic component system and
one navigation/command model while keeping the domain services intact.
