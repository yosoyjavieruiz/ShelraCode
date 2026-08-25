# ShelraCode Chat V2 — Streaming and Scroll Contract

## Event path

```text
Agent/AppEventBus
  → presentation event buffer
  → presentAppEvent
  → typed TranscriptPresentation
  → Transcript / Composer / StatusBar
```

`src/tui/presentation/event-buffer.ts` coalesces adjacent
`assistant.delta` events for 32 ms by default. A tool, route, plan, approval,
verification or lifecycle event flushes pending text before it is delivered.
`dispose()` flushes once, so the final partial response is not lost.

The buffer is a presentation concern. It does not alter provider streaming,
agent turns, tool execution or cancellation semantics.

## Layout stability

- `Transcript` owns the `ScrollBox`; `Composer` is a sibling outside it.
- Both derive width from `getCoreContentGeometry()`.
- `getCoreVerticalLayout()` reserves disjoint header, viewport, composer and
  status regions.
- Assistant deltas update a stable `For` child rather than recreating every
  rendered assistant node.
- Tool output updates only the matching bounded live tail.

## Scroll behavior

At the bottom, `stickyScroll` follows new content. After PageUp, PageDown or
mouse scrolling moves the user away from the bottom, following stops and new
content leaves the viewport where the user placed it. The transcript shows a
small `↓ New activity` action; selecting it resumes at the bottom.

## Invariants and evidence

Covered by `tests/integration/tui-v4-layout.test.tsx`,
`tui-v4-scroll.test.tsx`, `tui-v4-empty-state.test.tsx` and
`tests/unit/tui-presentation-buffer.test.ts`:

- composer position is independent of transcript growth;
- transcript/composer x and width match at 80, 100, 120, 140, 160 and 200;
- user scroll is not reset by new activity;
- 1,000 assistant deltas become one presentation update;
- tool events remain ordered after a text flush;
- the composer remains interruptible while a task is active.

The deterministic captures under `docs/ui-chat-v2/final/` are source fixture
evidence. They do not replace a post-build PTY journey.
