# LocalCode UI V3 - Refinement Pass 1

Review date: 2026-08-23

This was a structural and interaction pass after the initial live rebuild. Two
fresh read-only reviewers inspected the implementation and the generated
captures. They did not implement the corrections.

## Targeted research

The pass revisited current documentation for the interactions that were weak in
the first capture set:

- [Raycast Search Bar](https://manual.raycast.com/search-bar) and
  [Action Panel](https://manual.raycast.com/action-panel): one search entry point,
  fuzzy results, a primary Enter action, and contextual actions available
  without leaving the selected item.
- [OpenTUI ScrollBox](https://opentui.com/docs/components/scrollbox/): sticky
  bottom scrolling for chat/logs, pause-on-manual-scroll, viewport culling, and
  keyboard page navigation.
- [Zed Command Palette](https://zed.dev/docs/command-palette) and
  [Agent Panel](https://zed.dev/docs/ai/agent-panel): the palette is the gateway
  to actions, while the agent view keeps tool activity attached to streamed work.
- [Warp Block Basics](https://docs.warp.dev/terminal/blocks/block-basics) and
  [Command Palette](https://docs.warp.dev/terminal/command-palette): group
  activity into navigable units and keep selection/scroll actions discoverable.

The conclusion was to preserve the chosen conversation-first shell, but make
wide workspaces left-aligned, reserve every composer row explicitly, and use
bounded action columns rather than allowing long descriptions to compete with
shortcuts.

## Independent findings and corrections

| Priority | Problem and evidence                                                                                                                                                                         | Correction in this pass                                                                                                                                                                                                                                                                  |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0       | Wide center screens clipped their left edge in the 160-column captures. The cause was the wide `alignItems="center"` applied to the shared center wrapper, not to conversation content only. | Removed shared-wrapper centering and kept the 112-cell cap only around the conversation transcript/composer. Wide workspaces now receive full width and remain left-aligned. Evidence: `rebuild-2026-08-23/pass1-fixes/models/160x50.txt`, `settings/160x50.txt`, and `diff/160x50.txt`. |
| P1       | The composer used `rows + 2` even though it rendered textarea rows, a footer, and two borders. The footer overwrote the bottom border in streaming captures.                                 | Outer height is now `rows + 3`; busy state says `Ctrl+C cancel  Esc cancel`. Evidence: `pass1-fixes/streaming/80x24.txt` and `160x50.txt`.                                                                                                                                               |
| P1       | Palette descriptions and shortcuts shared an unconstrained flex child and collided at wide sizes; the prompt rendered as `?Search`.                                                          | Reserved label and shortcut columns, joined descriptions with a readable separator, and reserved `? ` before the input. Evidence: `pass1-debug-palette-2/80x24.txt` and `160x50.txt`.                                                                                                    |
| P1       | The model picker cleared the composer when opened, so Escape lost a draft.                                                                                                                   | Added a separate model-picker draft checkpoint; cancel restores it and successful selection leaves the draft intact.                                                                                                                                                                     |
| P1       | Composer submission had no busy guard and could start concurrent agent tasks, overwrite the abort handle, and misattribute cancellation.                                                     | `submit()` rejects a second non-empty submission with an explicit running-task notice. `runTask()` also clears busy/abort state if dynamic imports or control-plane startup fail before the inner task scope exists.                                                                     |
| P1       | Routing fixture showed a stop state while its decision log claimed a local selection.                                                                                                        | Fixtures now carry a consistent local `RouteDecision`; compact routing presents selected route, explanation, and signals without narrow-width overlap. Evidence: `pass1-routing-fix-2/80x24.txt`.                                                                                        |
| P2       | Provider recovery was a warning sentence with no distinct focusable actions.                                                                                                                 | Degraded providers now expose focusable `Retry provider health` and `Use local route` rows. The callbacks use the real refresh path or select the discovered local model.                                                                                                                |
| P2       | Compact model-picker entries spent two rows per model and separated metadata from the selected model.                                                                                        | Compact entries are single-line with bounded model/provider columns; the scrollbox scrolls the selected option into view. Evidence: `pass1-fixes/model-picker/80x24.txt`.                                                                                                                |
| P2       | Sidebar navigation rows had mouse activation but no keyboard activation.                                                                                                                     | Navigation rows are focusable and accept Enter/Space.                                                                                                                                                                                                                                    |
| P2       | Density and motion controls were exposed without any presentation effect.                                                                                                                    | Density now changes transcript/composer spacing. Reduced motion changes the streaming indicator to a static output label. Both remain session-only and are documented as such.                                                                                                           |
| P2       | Normal renderer cleanup existed, but interruption cleanup was not explicit.                                                                                                                  | The launch path now owns idempotent renderer teardown for normal exit, render failure, SIGINT, and SIGTERM, and removes signal listeners after renderer destruction.                                                                                                                     |

## Remaining findings carried forward

- Real keyboard-only journeys across every workspace are not yet proven by a
  ConPTY run; component and state tests are not a substitute for that evidence.
- Real mouse propagation, live resize while the renderer is running, and actual
  ANSI-free interaction remain release verification items.
- Approval is a deterministic fixture because the current agent core does not
  emit a live approval event into this shell; it is not represented as a live
  production capability.

## Pass 1 score

| Rubric                            | Baseline | Initial rebuild | Pass 1 |
| --------------------------------- | -------: | --------------: | -----: |
| Functional reliability /20        |        9 |              14 |     17 |
| Information architecture /10      |        3 |               8 |      9 |
| Layout / space usage /10          |        3 |               6 |      9 |
| Visual hierarchy /10              |        4 |               7 |      8 |
| Conversation UX /10               |        5 |               7 |      8 |
| Composer / input UX /8            |        5 |               7 |      8 |
| Navigation / command UX /8        |        4 |               6 |      7 |
| Responsive behavior /8            |        3 |               5 |      7 |
| Consistency / design system /6    |        4 |               5 |      5 |
| Error / empty / loading states /4 |        1 |               2 |      3 |
| Accessibility / keyboard /3       |        2 |               2 |      2 |
| Polish / delight /3               |        1 |               2 |      2 |
| **Total /100**                    |   **44** |          **71** | **84** |

This is an improvement, not a release score. Pass 2 must address visual
maturity, low-color hierarchy, and workspace density after the structural fixes.

## Verification

- `verified_local`: `bun run typecheck` passed.
- `verified_local`: `bun test` passed with 95 tests, 0 failures, and 240 expect
  calls.
- `verified_local`: targeted overlay tests passed 2/2.
- `verified_local`: 10 fixture states were recaptured at 80x24, 100x30, 120x40,
  160x50, and 200x60 under `docs/ui-v3/rebuild-2026-08-23/pass1-fixes/`.
- `verified_local`: the three shell concepts were recaptured under
  `docs/ui-v3/rebuild-2026-08-23/pass1-concepts/`.
- `NO VERIFICABLE`: full real-PTY keyboard/mouse/resize/NO_COLOR journey and
  fresh artifact provenance remain open for the release gate.
