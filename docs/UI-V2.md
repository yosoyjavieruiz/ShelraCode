# LocalCode UI V2 — Obsidian Violet

## Status

The V2 terminal surface is implemented in `src/tui/`. This document describes
the implemented presentation contract; it does not change routing, provider,
hardware, agent, persistence, privacy, or billing behavior.

## Visual system

- Canvas: `#000000` exactly.
- Surfaces: `#08080A`, `#0D0D10`, `#111114`, with `#17121F` for the current focus.
- Primary accent: `#8B5CF6`; strong accent `#7C3AED`; soft accent `#A78BFA`.
- State colors remain semantic: green success, amber warning, rose danger, cyan info.
- Tokens live in `src/tui/theme/tokens.ts`; components consume semantic tokens
  instead of owning arbitrary theme values.
- `NO_COLOR` removes color values while retaining labels, symbols, spacing and
  state text.
- Terminal typography remains the user's monospace font. Weight, dim state,
  spacing and capitalization create hierarchy; no web font is bundled.

## Shell

The shell is composed of:

1. top bar: repository, branch, mode, route/model and privacy;
2. responsive navigation rail;
3. conversation or full-screen center view;
4. optional task inspector;
5. multiline composer;
6. quiet status bar.

The layout profile is deterministic:

| Width    | Layout                                                           |
| -------- | ---------------------------------------------------------------- |
| 150+     | navigation + conversation + inspector                            |
| 110–149  | collapsed navigation + conversation; inspector is a drawer state |
| 80–109   | conversation and composer only                                   |
| under 80 | narrow conversation/composer mode                                |

`src/tui/state/layout.ts` owns these thresholds. Secondary information is
removed before task state, route, privacy, errors, approvals, or composer.

## Navigation and commands

`src/tui/commands/registry.ts` is the source of truth for slash commands,
palette entries, descriptions, categories and discoverable shortcuts. The
palette supports filtering, grouping and selection. The application launcher
uses OpenTUI's keymap with a timed `<leader>` token for `Ctrl+X` sequences.

Important defaults:

- `Ctrl+P`: command palette;
- `Ctrl+X M/P/R/Q/V/D`: Models, Providers, Routing, Usage, Privacy, Changes;
- `Ctrl+X B`: toggle navigation;
- `Ctrl+X ,`: Settings;
- `Escape`: close the highest overlay or return to idle;
- `Ctrl+C`: cancel active work, or exit while idle.

## Conversation

The transcript uses `ScrollBox` with sticky-bottom behavior and viewport
culling. Assistant content renders through OpenTUI Markdown, including an
incremental Markdown block for active streaming. Tool, route, verification and
error events use compact semantic rows with status text and details instead of
raw log walls.

The empty state is an intentional workspace landing surface that shows project,
hardware readiness, local/free path and useful first tasks.

## Centers

The current views are presentation adapters over existing domain data:

- Models: active model, local recommendations, local runtime rows and free
  cloud catalog rows;
- Providers: readiness, endpoint, free status, privacy classification and note;
- Usage: quota meters, confidence and reset metadata;
- Routing: pipeline stages, selected route, score signals and decision log;
- Privacy: repository policy and remote-secret guardrails;
- Changes: unified OpenTUI Diff renderer with semantic add/remove colors;
- Settings: Obsidian Violet, density, motion, layout, interaction and privacy
  presentation state;
- Setup: staged onboarding for welcome, hardware, local model, free cloud,
  privacy, routing and ready state, backed by the existing control plane;
- Context, Plan, Doctor, Sessions, Checkpoints and Help: existing service data
  rendered as focused centers.

No user-facing provider, model action or setting is advertised unless the
existing application service provides the underlying state/action.

## Interaction and lifecycle

- The composer uses OpenTUI `Textarea`; Enter submits and Shift+Enter adds a
  line break.
- `localcode setup` opens the staged setup view; Enter advances, P cycles
  privacy, R cycles routing and the final step persists through existing
  repository/database settings services.
- Every no-argument `shelra`/`localcode` launch enters the conversation
  workspace consistently, even when the repository has no persisted policy
  decisions. `shelra setup`/`localcode setup` opens the setup view explicitly.
- Overlays own focus and close highest-first with Escape.
- Long-running task work continues to use `AbortSignal`.
- The renderer owns alternate-screen cleanup; the interactive path uses
  `renderer.destroy()` and never calls `process.exit()`.
- The UI remains usable without color because route, privacy, cost, health and
  errors are written as text/icons as well as color.

## Validation contract

The V2 surface is validated at 80, 100, 120 and 160 columns in renderer tests,
with real bundle checks through `bun run dist/index.js --tui` and
`bun run dist/index.js setup`. The acceptance matrix also covers the palette,
timed leader navigation, Markdown transcript, setup progression, NO_COLOR
rendering and terminal cleanup.
