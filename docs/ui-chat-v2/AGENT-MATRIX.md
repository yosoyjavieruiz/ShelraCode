# AgentMatrixPulse — ShelraCode's Signature Working Indicator

Implemented 2026-08-24. `src/tui/components/AgentMatrixPulse.tsx`.

## What it renders

```
● · · Agent · Exploring repository
2s · Esc interrupt
```

Revised after direct user feedback on the first version (a bordered 3×3 grid, 5 rows tall — see "Revision" below). One violet dot cycles across 3 inline positions, one step per tick, no border, two lines total. Label line: `Agent · {verb}`. Meta line: `{elapsed} · Esc interrupt` (elapsed omitted until it's meaningfully nonzero — same rule as `StatusBar`'s elapsed readout). Matches the Codex CLI precedent's shape (RESEARCH.md) with ShelraCode's own verbs instead of a single generic "Working".

Reduced-motion mode and terminals under 32 columns both collapse to the same two-line text, minus the animated dots — same information, no motion, no dependency on width for legibility.

### Revision — original design was too heavy

The first implementation boxed the dots in a bordered, padded 3×3 grid (`╭───────╮` … 5 rows tall, 9 columns wide) with the dot orbiting the grid's perimeter. Direct feedback after seeing it rendered next to real conversation text: solid gray border should go, and the whole thing needed to be roughly a third the size — "es enorme". Fixed by dropping the box/border/padding entirely and flattening the 3×3 grid to 3 inline dots on the same line as the label (2 rows total, down from 5; no fixed-width frame at all, so it wraps/shrinks with the terminal like any other transcript line instead of holding a fixed footprint). The compact/reduced-motion fallback also moved from a row layout to a column layout — two unconstrained `<text>` elements in a row both tried to word-wrap independently at narrow widths and produced interleaved, unreadable output (caught by the same test suite before it could ship, see Verification).

## Where the state comes from — real, not invented

`AgentTaskLedger.phase` (`src/agent/task-state.ts`) already tracked a real state machine (`frame → discover → analyze → plan → act → observe → reflect → verify → review → complete/blocked/failed/cancelled`), driven by actual `setTaskPhase` calls throughout `src/agent/loop.ts`. It was never surfaced past the loop before this pass — nothing read `ledger.phase`.

The only domain change made (spec §99-100, smallest safe change):

- `loop.ts`: every `setTaskPhase(ledger, phase)` call now goes through a new `transitionPhase(ledger, phase, options)` wrapper that also does `emit(options, { type: "phase.changed", phase })`. `setTaskPhase`'s own transition invariants (no leaving a terminal phase, no skipping to `complete`) are untouched — this only adds a notification after a transition that was already happening.
- `agent/types.ts` / `shared/events.ts`: both `AgentEvent` and `AppEvent` gained the same `{ type: "phase.changed"; phase: AgentPhase }` case (kept structurally identical — `emit()` passes an `AgentEvent` straight into `AppEventBus.emit(AppEvent)`, so the two unions must stay assignable).
- `presentation/adapter.ts`: `presentAppEvent` now tracks `TranscriptPresentation.agentPhase`. Only "abstract" phases (`frame/discover/analyze/plan/observe/reflect/verify/review`) are kept — `act` is filtered out (`isAbstractAgentPhase`) because it fires immediately before `tool.started`, so showing it would flash the matrix for one tick right before real activity takes over. `tool.started` also clears `agentPhase` directly, and `task.completed`/`task.failed`/`route.failed` clear it too, so nothing can linger into the next idle state.

This is the concrete fix for spec §90 ("never derive agent state from prose") — before this, the only host-visible busy signal was the free-text `notice` string built by ad hoc `setNotice("Preparing repository context…")` calls scattered through `app.tsx`.

## No duplicate indicator

`app.tsx` computes one shared accessor, `agentMatrixPhase = () => taskBusy() && presentation().agentPhase`, and both consumers read it:

- `Transcript` only mounts `<AgentMatrixPulse>` (as the last item in its scroll content, after every turn group — not an overlay, so it can never overlap the composer) when `agentMatrixPhase()` is set.
- `StatusBar`'s `busy` prop is `() => taskBusy() && agentMatrixPhase() === undefined` — it only shows its own spinner/elapsed/interrupt readout when AgentMatrixPulse *isn't* already showing one (i.e. while a concrete tool is actually running, or in the brief gap around `act`). Before this both could show at once — a real instance of the spec's named "multiple global spinners" hard-failure condition, caught by inspecting a real capture (see below), not by inference.

`Composer.tsx`'s own busy hint also said `"Ctrl+C cancel"` while everything else said `"Esc interrupt"` — and only `Escape` is actually wired to abort the active task (`app.tsx`, `activeTaskAbort.abort()` in the `event.name === "escape"` handlers). Fixed to `"Esc interrupt"` for consistency; `Ctrl+C` cancelling was never true in this codebase.

## One ticking source, not two

`AgentMatrixPulse` does not own a timer. It takes `tick: () => number` and reads the app's existing `spinnerTick` signal (already incrementing every 120ms while busy, previously only feeding `StatusBar`'s braille spinner) — `activeCell = tick() % 3`. 1000ms / 120ms ≈ 8.3 animation-frames/second, inside spec §17's 6–10fps target with zero new timers.

## Verification

- `tests/unit/tui-agent-phase-adapter.test.ts` — 6 tests on the reducer: abstract-phase filtering, `act` exclusion, `tool.started` clearing, a later abstract phase (e.g. `reflect` after a tool finishes) bringing the matrix back, and `task.completed`/`task.failed` clearing.
- `tests/integration/tui-agent-matrix.test.tsx` — 7 component tests via `testRender`/`captureCharFrame`, including a direct regression guard that the orbit **actually animates** across `tick` changes (this project has hit "looks reactive, isn't" bugs in this exact render pipeline before — see `localcode-audit-2026-08-24` memory — so this was verified empirically, not assumed).
- Full suite: 346/346 passing, `tsc --noEmit` clean, after every step in this pass.
- Real capture evidence (`scripts/capture-ui.ts`, new `thinking`/`thinking-long` fixtures) at 80×24 and 100×30, saved at `docs/ui-chat-v2/screenshots/` — first capture caught the StatusBar/matrix duplication live (`⠋ Ready · 2s` next to the matrix's own `2s · Esc interrupt`), second capture after the fix confirms it's gone (`StatusBar` reads a plain `Ready`, matrix owns the busy readout alone).

## Not done in this pass

## Current Chat V2 revision — supersedes the historical revision above

The current component is a real borderless 3×3 matrix, not the earlier
three-inline-dot version:

```text
● · ·   Agent · Exploring repository
· · ·   2s · Esc interrupt
· · ·
```

The active dot follows the perimeter cells `[0, 1, 2, 5, 8, 7, 6, 3]` using
the app's existing 120 ms `spinnerTick`, approximately 8.3 visual frames per
second. Only the matrix reads that animation source while an abstract phase
is active; the status bar suppresses its own spinner in that state. When a
concrete `tool.started` event arrives, the presentation adapter clears
`agentPhase` and the tool renderer becomes the dominant activity indicator.

Labels come from structured `phase.changed` events: Thinking, Exploring
repository, Understanding request, Planning, Reviewing results, Verifying,
and Reviewing changes. They are never inferred from assistant prose. Reduced
motion and widths below 32 columns render static text without animated cells.
At 10 seconds the active cell warms to amber without adding another loader.

Current component tests cover orbit changes, elapsed time, reduced motion,
narrow terminals, long-running warmth and `interruptible=false`:
`tests/integration/tui-agent-matrix.test.tsx`. Deterministic captures are in
`docs/ui-chat-v2/review/pass-1/thinking/` and the final capture set.

## Historical carry-over notes

- Claude Code's amber-after-10s color escalation (RESEARCH.md) — cheap follow-up, not implemented.
- `frame` (the very first phase, before `discover`) never gets an explicit `phase.changed` event — `createTaskLedger` sets it directly without going through `transitionPhase`. In practice this is a sub-tick gap before the first real transition fires; not worth the larger change of moving phase initialization into the emitting path for this pass.
