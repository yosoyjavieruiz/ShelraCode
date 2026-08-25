# LocalCode UI V3 responsive contract

The contract is tested with deterministic frames at 80x24, 100x30, 120x40, 160x50, and 200x60. The priority order is conversation, composer, current task, errors/approval, route/model, then secondary metadata.

| Terminal | Profile | Preserve                                                                           | Remove/reduce                                                                         |
| -------- | ------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| 80x24    | Compact | Conversation labels, grouped activity, composer, send/newline/clear, route/privacy | Model name in top chrome, extended descriptions, optional hints, secondary timestamps |
| 100x30   | Compact | Same primary flow; two-row composer                                                | Extra palette descriptions and redundant metadata                                     |
| 120x40   | Medium  | Transcript, full composer context, status model/context                            | Decorative spacing and long secondary labels                                          |
| 160x50   | Wide    | Shared 112-cell conversation/composer column                                       | No permanent sidebar/inspector is introduced                                          |
| 200x60   | Wide    | Same information hierarchy with more breathing room                                | Extra width does not become a dashboard                                               |

## Surface rules

- Overlays own the full frame with an opaque layer; their panels are bounded by current width/height.
- Narrow model picker rows put provider/runtime metadata on a second line.
- Narrow settings rows put the setting value under the title and remove the category rail.
- Streaming moves into the transcript ScrollBox and compact mode reserves space for the composer.
- Center workspaces remain full width; they do not inherit the conversation column cap.
- Decorative information, timestamps, metrics, provider labels, and hints are removed before conversation, composer, errors, or approvals.

## Verification boundary

Character-frame captures prove the layout for those deterministic sizes. They do not prove terminal emulator glyph width, live resize events, mouse hit testing, or ConPTY restoration. Those remain explicit release checks.
