# LocalCode UI V3 shell decision

## Decision

`Minimal Canvas` wins the static concept review. Capture evidence is in `docs/ui-v3/rebuild-2026-08-23/concepts4/`:

```text
concepts4/
  minimal-canvas/{80x24,120x40,160x50}.txt
  context-ribbon/{80x24,120x40,160x50}.txt
  adaptive-edge/{80x24,120x40,160x50}.txt
```

The selected concept is now the live shell in `src/tui/app.tsx`: quiet top line, readable conversation column, aligned composer, compact status footer, and transient workspaces.

## Comparative review

| Concept        | Clarity | Conversation focus | Composer quality | Space efficiency | Sophistication | Responsive | Total /60 | Decision |
| -------------- | ------: | -----------------: | ---------------: | ---------------: | -------------: | ---------: | --------: | -------- |
| Minimal Canvas |       9 |                 10 |                9 |                9 |              9 |          9 |        55 | Selected |
| Context Ribbon |       8 |                  8 |                9 |                7 |              8 |          8 |        48 | Rejected |
| Adaptive Edge  |       7 |                  8 |                9 |                8 |              7 |          8 |        47 | Rejected |

Scores are design-review judgments against the stated criteria, not market measurements. The selected shell makes the active task and input obvious within two seconds and does not make a user operate a dashboard.

## Rejected alternatives

### Context Ribbon

The ribbon makes task and route state immediately visible, but it permanently consumes a second horizontal band and turns status into navigation. Its useful information is retained in TopBar, Composer, StatusBar, and route events.

### Adaptive Edge

The edge markers are terminal-native and compact, but they introduce a persistent spatial affordance users must interpret before typing. They also make the shell read like a panel dashboard at 160 columns.

## Acceptance criteria

- Conversation and composer share a maximum content column at wide sizes.
- No permanent navigation or inspector is rendered in the default shell.
- Ctrl+P and Ctrl+X leader actions open transient depth.
- 80x24 preserves conversation, composer, route/privacy state, errors, and approval content.
- Escape reduces depth in the order overlay -> workspace -> active task -> draft.
