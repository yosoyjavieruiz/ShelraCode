# Production chat and TUI event audit

## Current architecture

The source path maps agent domain events through
src/tui/presentation/adapter.ts and event-buffer.ts into structured
transcript items. The TUI source does not need to parse provider JSON or
decide tool permission/completion.

The inspected presentation path includes separate assistant text deltas,
tool/activity groups, plan/test/route/error/completion items and coalesced
stream updates. Tool start replaces abstract activity in the active
presentation state.

## Fresh evidence

| Journey                   | Result                                                                          |
| ------------------------- | ------------------------------------------------------------------------------- |
| Automated TUI suite       | Full suite passes with one unrelated skipped test                               |
| Source TUI launch         | Home layout rendered in a real PTY                                              |
| Streaming/activity start  | Hola showed running state and AgentMatrixPulse                                  |
| Cancellation/lifecycle    | Ctrl+C returned exit 0 and restored terminal control                            |
| Raw tool JSON             | Regression assertion passes                                                     |
| 80/100/120/160 PTY widths | Not all exercised live in this audit                                            |
| Resize while streaming    | Not captured live                                                               |
| NO_COLOR/reduced motion   | Unit/source evidence exists; semantic color suppression not fully proven in PTY |

## Residual UI risks

The live model response did not arrive before cancellation, so this run proves
launch and lifecycle wiring rather than a successful production conversation.
The user-facing event model is substantially structured, but the release gate
still needs real narrow-terminal, resize, scroll-follow, cancellation and
terminal-restoration journeys on the exact artifact users will run.
