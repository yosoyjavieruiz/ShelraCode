# LocalCode UI V3 baseline audit

Date: 2026-08-23. This is the observed state before the structural rebuild in this run. Evidence came from the active source path `src/index.ts -> launchTui() -> AppShell`, a real bundle PTY launch, and character-frame captures in `docs/ui-v3/baseline/audit-2026-08-23/`.

## Evidence-led failures

| Failure                                               | Evidence                                                                                                     | Impact                                                                        | Root cause                                                                                     | Correction selected                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Palette was unreadable at narrow and medium widths    | `palette/80x24.txt`, `palette/120x40.txt` contained merged landing text such as `Lo...Open...`               | The primary navigation surface could not support confident selection          | Absolute panel had no opaque ownership of the frame and its content exceeded the narrow height | Hide the underlying shell while an overlay is open; size the panel from rows and terminal dimensions |
| Wide conversation and composer used different columns | `conversation/160x50.txt` showed the transcript capped near 112 cells while the composer remained full width | Reading and writing required a horizontal eye jump                            | The width cap was applied only to transcript content                                           | Share one wide content width for transcript and composer                                             |
| Composer footer compressed the most important actions | `conversation/80x24.txt` packed context and all hints into one row                                           | Send/newline/clear actions were hard to scan                                  | Footer had no narrow contract                                                                  | Keep send, newline, and clear; move secondary context out of the narrow footer                       |
| Startup cancellation had a race                       | Source assigned `activeTaskAbort` after several awaited imports in `runTask`                                 | Ctrl+C could exit instead of cancelling while context preparation was visible | Abort controller was created too late                                                          | Create and publish the controller synchronously at task entry                                        |
| Transcript review was not keyboard-addressable        | `Transcript.tsx` hid scrollbars and had no focus/scroll handler                                              | Users could not reliably review a long task                                   | Sticky scrolling was treated as the whole interaction                                          | Make the viewport focusable and add PageUp/PageDown and Ctrl+Up/Down behavior                        |
| Settings category was static                          | `Centers.tsx` always highlighted Appearance                                                                  | Focus and category relationship could not be trusted                          | Rail state was hardcoded separately from selected row                                          | Derive the rail state from the selected setting; stack value under title at narrow widths            |
| Provider recovery pointed to the wrong command        | `provider-error/80x24.txt` said retry health or `Ctrl+X M`; that key opens model selection                   | Degraded state offered a misleading recovery path                             | Error copy was written without a command registry action                                       | Add the real `Retry provider health` command and retain local fallback                               |
| Center screens wasted available space                 | Models and Changes frames contained a small upper cluster and long unstructured blank region                 | Workspaces felt like prototype status pages                                   | Static rows were placed in flex-growing containers without next-action context                 | Use focused list/detail language, native Diff, and explicit action footers                           |

## Baseline scorecard

Scores are diagnostic, out of 10. Every score below 8 has a concrete reason above or in the functional audit.

| Dimension                  | Score | Why it failed                                                                                                       |
| -------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------- |
| Functionality              |   5.0 | Basic submit and palette paths existed, but cancellation, focus, and recovery actions were not dependable           |
| Information architecture   |   3.0 | Sidebar/inspector/centers competed with the conversation model                                                      |
| Layout                     |   4.0 | Wide composition split reading and writing; narrow overlays exceeded their safe area                                |
| Visual hierarchy           |   5.0 | Cards and status chrome competed with the transcript; hierarchy depended on spacing that collapsed at narrow widths |
| Spacing                    |   4.0 | Several fixed gaps and flex-growing views produced accidental blank regions                                         |
| Typography hierarchy       |   6.0 | Labels and content were distinguishable, but command/value rows collided                                            |
| Color discipline           |   6.0 | True black and violet tokens existed; selection/focus usage was not consistently restrained                         |
| Conversation UX            |   5.0 | Tool activity existed but the transcript and streaming behavior were underdeveloped                                 |
| Composer UX                |   5.0 | It was visible and functional, but the footer was overloaded and draft handling was unsafe                          |
| Tool activity              |   5.0 | Consecutive tools were not summarized with a strong, compact semantic label                                         |
| Navigation                 |   4.0 | Secondary navigation occupied too much conceptual space and Escape behavior was incomplete                          |
| Command discoverability    |   6.0 | A palette existed, but its visual failure made the central path unreliable                                          |
| Models                     |   4.0 | Models center showed inventory rather than a strong selection workflow                                              |
| Providers                  |   5.0 | Health/freshness data was visible, but degraded recovery was misleading                                             |
| Routing                    |   5.0 | Explainability existed, but the view was visually unstable and dashboard-like                                       |
| Settings                   |   3.0 | Static-looking rows and a false category rail weakened confidence                                                   |
| Diff                       |   5.0 | Native Diff integration existed, but invalid payload behavior needed a safe bounded fallback                        |
| Responsive behavior        |   3.0 | String-presence tests did not prove geometry or interaction at 80/100/120/160                                       |
| Keyboard/mouse UX          |   4.0 | Some mouse rows were not focusable and real PTY journeys were incomplete                                            |
| Loading/error/empty states |   5.0 | Some labels existed, but raw errors and passive degraded states remained                                            |
| Consistency/polish         |   5.0 | The token system was present, but the shell still read as a dashboard prototype                                     |

## Baseline total

The weighted baseline equivalent was 44/100 in the earlier UI V3 record. This run preserves that number as a historical baseline; it is not a claim about the current post-rebuild score.
