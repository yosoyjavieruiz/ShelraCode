# UI Chat V2 — Audit of the Current ShelraCode Chat Experience

Read-only audit performed 2026-08-24, before the AgentMatrixPulse work below it. Scope: `src/tui/**`, `src/agent/loop.ts`, `src/agent/task-state.ts`, `src/shared/events.ts`.

## Framework

OpenTUI (`@opentui/core` + `@opentui/solid`), SolidJS reconciler. **Keep it** — this is the same core that powers OpenCode in production ([opentui/core on npm](https://www.npmjs.com/package/@opentui/core)), so it is not the ceiling on quality here. No migration considered or needed.

## What already works well

- **Composer/transcript column share one geometry.** `getCoreContentGeometry`/`getCoreVerticalLayout` (`src/tui/state/layout.ts`) compute `x`/`width` once and both `Composer` and `Transcript` consume it — the `composer.x === transcript.x` invariant the spec asks for already holds structurally, not by convention.
- **Composer is genuinely fixed.** It's a sibling box below the transcript `<scrollbox>`, both governed by `getCoreVerticalLayout`'s disjoint `viewport`/`composer` y-regions — nothing about transcript content length can push the composer.
- **Scroll is already sticky-to-bottom with escape.** `Transcript`'s `<scrollbox stickyScroll stickyStart="bottom">` auto-follows new content; PageUp/PageDown are wired at both the transcript and the app-root level.
- **No chat bubbles.** Messages are editorial: a bare `You`/`Shelra Code` label line + prose, matching spec §11 already.
- **One turn = one visual group.** `groupTranscriptItems` (`Transcript.tsx`) buckets every `TranscriptItem` by `turnId` and renders one `Shelra Code` label per turn, not per event — spec §12 already holds.
- **A real presentation layer already exists.** `src/tui/presentation/{types.ts,adapter.ts}` is exactly the "don't let components consume arbitrary backend objects" layer spec §87 asks for: `AppEvent` → `presentAppEvent` → typed `TranscriptItem` union (`user-turn`, `assistant-text`, `activity-group`, `test-result`, `route-event`, `plan-update`, `file-change`, `error-notice`, `approval-request`, `completion-notice`). Nothing renders raw tool JSON — `activityMetadata()` maps every known tool name to a `{kind, label, target}` triple, unknown tools fall back to a generic label.
- **Tool grouping already exists.** Consecutive `tool.started` events in the same turn merge into one `activity-group` item (`startTool` in `adapter.ts`) with a derived label ("Inspecting repository" / "Updating files" / "Running verification") — spec §27's "READ 5 files" grouping principle is applied at the group level, not yet within a single tool kind (see Gaps).
- **Expand/collapse exists** (`Activity` component, click/Enter toggles `expandedActivityIds`), and failed activities force-expand their `details` regardless of collapse state.
- **Errors are already low-verbosity by default** (`! {title}` + optional one-line detail; the design carries `recoverable` as a real field on `error-notice`, though nothing branches on it yet visually — see Gaps).
- **Route events are already rare and quiet**, deduped by `routesEqual()` so the same candidate handling consecutive turns never re-announces itself.

## Gaps found against the spec (root cause, not just symptom)

1. **No structured "agent is thinking" event existed.** `AgentTaskLedger.phase` (`task-state.ts`) already tracks a real state machine — `frame → discover → analyze → plan → act → observe → reflect → verify → review → complete/blocked/failed/cancelled` — driven by real loop transitions, not invented. It was **never surfaced** past the loop: no `AgentEvent`/`AppEvent` case read it, so the UI had no way to render an abstract working state without inferring it from `notice` prose (a global status string built out of `setNotice("Preparing repository context…")`-style calls) — exactly the "derive agent state from prose" anti-pattern spec §90 forbids. **Fixed in this pass** — see AGENT-MATRIX.md.
2. **StatusBar and the (new) AgentMatrixPulse would have duplicated the busy indicator.** Before the fix, `StatusBar` rendered its own spinner + notice + elapsed + "Esc interrupt" whenever `taskBusy()`, with no awareness that a richer indicator might already be showing the same information. This is the exact "multiple global spinners" hard-failure condition (spec §93). Fixed by gating `StatusBar`'s busy prop on `agentMatrixPhase() === undefined` — the two now hand off rather than overlap, confirmed by a live capture (see AGENT-MATRIX.md).
3. **The composer's own busy hint disagreed with the rest of the UI.** `Composer.tsx` showed `"Ctrl+C cancel"` while `StatusBar` already said `"Esc interrupt"` — and only `Escape` is actually wired to `activeTaskAbort.abort()` (`app.tsx`, the `event.name === "escape"` handlers). `Ctrl+C` cancelling was never true in this codebase. Fixed to `"Esc interrupt"` everywhere.
4. **Tool renderers are one generic list renderer, not a per-kind registry.** `Activity` (`Transcript.tsx`) renders every `ActivityKind` (`read/search/edit/write/list/run/test/diff/status/tool`) through the same layout — label + target + trailing detail/duration, details expand as plain wrapped text. This satisfies "never show raw JSON" and "known tools get a real label" but not spec §30/§34's "EDIT gets real diff rendering" — an edit's `details` are opaque strings today, not a structured added/removed diff view. No `ToolRendererRegistry` module exists.
5. **No live shell/test tail.** `RunTests`/`Shell` results only appear once `tool.finished` fires (`resultPresentation` in `adapter.ts` slices the final output to 40 lines); there is no incremental streaming of command output while it's still running, so a 60-second test run currently shows nothing but (now) AgentMatrixPulse/StatusBar's elapsed timer until it completes. Matches spec §36's named failure mode exactly.
6. **No density modes.** `density` only takes `"comfortable" | "compact"` (spacing only, `Transcript.tsx`), not the FOCUS/DEFAULT/VERBOSE hierarchy from spec §29 — there's no mode that hides tool detail down to one-line diffstats.
7. **Plan/task-list state exists in the ledger (`TaskPlan`/`PlanStep`, `task-state.ts`, `setTaskPlan`) but the presentation item (`plan-update`) only ever renders `Plan · {completed}/{total}` — none of the ledger's per-step labels/state reach the transcript.** The data is there; the adapter never wires `AppEvent` → `plan-update` for it (no `AppEvent` case reads `ledger.plan` today — the same "built but never wired to production" pattern flagged in the 2026-08-24 autonomy audit).
8. **The approval transcript item is a single quiet text line** (`Approval required · {description}`) — that part is correct per spec §47's "keep it out of normal chat verbosity". The actual decision surface is a separate, already-wired modal (`ApprovalDialog.tsx`, driven by the `activeApproval` signal, both fed by the same `approval.requested` event) which already matches spec §47's focused-modal shape (action, impact, Deny/Allow). Not a gap — confirmed working as designed, just not obvious from the transcript item alone.
9. **NO_COLOR / reduced-motion are inconsistently plumbed.** `getTheme(noColor)` already exists and most components read `theme.colorsEnabled`; `reducedMotion` is a real signal in `app.tsx` (`Settings` can toggle it) but before this pass nothing animated read it — AgentMatrixPulse is the first consumer.

## Not touched in this pass (explicitly out of scope per spec §99-100)

Agent reasoning, model router, context engine, tool execution semantics, verification logic. The one domain change made — `phase.changed` on `AgentEvent`/`AppEvent` — is additive only: it does not alter `setTaskPhase`'s transition invariants, only notifies a host when a transition already happened.

## Fresh re-audit — 2026-08-24

This section is the current-checkout audit. The earlier sections preserve the
historical AgentMatrix pass and should not be read as proof that the complete
V2 brief is finished.

### Active path and artifact

- Source entry: `src/index.ts` → `--tui` → `src/tui/launch.tsx` → `AppShell`.
- User artifact exercised: `dist/index.js`, launched with
  `bun --conditions=browser dist/index.js --tui`.
- The launcher creates an OpenTUI renderer with `targetFps: 30` and relies on
  OpenTUI 0.5.7's default alternate-screen mode. It destroys the renderer on
  exit and signal handling is kept outside the view tree.
- The current bundle was present before this audit at 2,382,607 bytes,
  SHA-256 `FAC2BFD9434C9CC43C4657BE5431D15945E87FCDA054D6132CE527E904AFDF8D`.
  It was not rebuilt during this read-only source audit.
- The checkout is intentionally dirty with pre-existing source, generated
  documentation, tests and untracked UI work. No unrelated files were reset,
  staged or cleaned.

### Fresh evidence

- `bun run typecheck`: pass.
- `bun run test -- --reporter dots`: **379 pass, 0 fail, 1,235 expectations**.
  The package script pins `--conditions=browser`; a bare `bun test` is not a
  valid comparison because it loads a different Solid/OpenTUI condition and
  produced false static-signal failures in the same tests.
- `bun run smoke`: source and bundle help/version/doctor all pass.
- `bun run format:check`: fails on the pre-existing
  `docs/ui-chat-v2/AGENT-MATRIX.md`, `RESEARCH.md` and `STATUS.md` formatting
  warnings. This is a documentation gate failure, not a type or runtime
  failure.
- The real bundle was launched in a PTY at 80×24. Focus, typing, submit,
  assistant response, alternate-screen teardown and idle exit were observed.
  A long coding-tool/cancellation journey and resize/mouse journey remain
  unverified against the bundle.
- Deterministic text captures for the current UI are in
  `docs/ui-chat-v2/before/` for home, conversation, thinking, streaming,
  tools, test, route, error, approval, palette and context-picker states at
  80/100/120/140/160/200 columns. They are fixture evidence, not production
  agent evidence.

### Confirmed foundation strengths

- The conversation transcript and composer are sibling regions with a
  disjoint vertical layout. The box-level `x`/`width` invariant is tested at
  80, 100, 120, 140, 160 and 200 columns.
- The transcript uses OpenTUI `ScrollBox` with `stickyScroll`, bottom sticky
  start and viewport culling. PageUp/PageDown are routed at the app level so
  the focused textarea does not swallow transcript navigation.
- The event adapter is typed and does not render normal tool JSON. It already
  supports assistant deltas, abstract phases, tool output tails, verification,
  plans, route changes, errors, approvals and completion.
- The current live shell/test tail is bounded to six lines and is removed when
  the tool completes. The current test and diff summaries are compact.

### Current product gaps that block the requested foundation

1. `getCoreContentGeometry()` is `terminalWidth - 2` at every width. The
   conversation therefore remains a nearly full-width log at 120–200 columns;
   the requested adaptive reading column has not been implemented.
2. Home renders a large `ascii_font` wordmark from 57 columns upward. This
   conflicts with the brief's no-giant-logo, conversation-first direction and
   consumes most of the useful 80-column home screen.
3. The composer is a rounded, fully bordered box with a visible footer on every
   turn. It is structurally stable, but the capture shows it dominating the
   lower screen and it has not yet been reviewed against a quieter
   surface-only treatment.
4. There is no visible `↓ New activity` affordance when a user scrolls away
   from the bottom. Sticky scrolling exists, but the user-scroll state and
   return-to-bottom action are not exposed as a presentation state.
5. Every `assistant.delta` creates a new presentation array and maps the full
   item list. The agent loop emits deltas directly from the provider stream;
   there is no UI-level batching cadence or dedicated streaming buffer, so the
   no-whole-tree-per-token invariant is not yet demonstrated.
6. `@` typed into the composer does not open the context/file picker. The
   current input handler opens the command palette for `/`; context selection
   is exposed through a separate action. The picker uses substring filtering,
   not the requested fuzzy reference flow.
7. `activityMetadata()` is a data lookup inside the adapter, not a
   `ToolRendererRegistry` with specialized READ/SEARCH/EDIT/RUN/TEST
   renderers. EDIT has a bounded line diff, but the transcript still renders
   all known tools through one generic `Activity` layout.
8. Presentation always starts a tool as `running`; finished failures are
   marked `failed`, but there is no event path that visibly represents
   `pending` or `cancelled` tool states. Active tool rows have no independent
   small animation after the abstract matrix hands off.
9. Plan step status is emitted from the initial snapshot; the loop does not
   currently publish live per-step transitions. The plan can also expand into
   more transcript rows than the compact brief calls for.
10. Error details are present as a second line whenever supplied, but there is
    no technical-detail expansion interaction. Route events still render the
    first selected route in the transcript instead of remaining entirely in
    quiet status unless a meaningful change occurs.
11. The fixture switch is `LOCALCODE_UI_FIXTURE`; the requested
    `SHELRACODE_UI_FIXTURE` contract and the numbered fixture catalogue do not
    exist yet.

### Audit conclusion

The current implementation is a credible OpenTUI event-driven prototype with
working tests and a real basic PTY path. It is not yet the requested Chat V2
completion: the highest-risk work is still the reading geometry, scroll-state
ownership, batched streaming presentation and composer/reference interaction.
The next implementation slice should be Phase 1 only, followed by fresh PTY
and capture review before tool-renderer or AgentMatrix polish continues.

## Superseding implementation audit — 2026-08-24

The historical sections above describe the pre-implementation audit. The
following is the authoritative state after the Chat V2 implementation slices.

### Active path

- Source: `src/index.ts` → `src/tui/launch.tsx` → `AppShell`.
- Renderer: OpenTUI 0.5.7, explicit `screenMode: "alternate-screen"`,
  `targetFps: 30`.
- Transcript: `src/tui/components/Transcript.tsx` owns a culling `ScrollBox`
  with independent sticky-bottom state and a `↓ New activity` resume affordance.
- Composer: `src/tui/components/Composer.tsx`, a sibling of the transcript,
  always sized from `getCoreContentGeometry()`.
- Presentation: `src/tui/presentation/adapter.ts` plus
  `event-buffer.ts`; components consume typed view models, never raw tool
  payloads.

### Implemented and verified locally

- Adaptive reading geometry at 80/100/120/140/160/200 columns.
- Empty and active conversation states share the same composer/content
  geometry; the composer stays outside transcript scrolling.
- Assistant deltas are batched at a 32 ms presentation cadence. Tool and
  lifecycle events flush the text buffer first, preserving order.
- Abstract phases render `AgentMatrixPulse`; concrete tool activity clears it.
- The matrix uses an eight-position 3×3 perimeter orbit at the existing
  ~8.3 fps host tick, with reduced-motion and narrow-width fallbacks.
- Known tool kinds use `ToolRendererRegistry`; unknown or malformed kinds use
  the generic renderer. Tool states are explicit, details are expandable, and
  repetitive homogeneous groups collapse to summaries such as `✓ READ 3
  files · 43ms`.
- Shell/test live tails are bounded to six lines and disappear on completion.
- Initial route selections stay in quiet status; only meaningful route changes
  enter the transcript.
- `@` references use fuzzy file ranking; `/` and Ctrl+P share the command
  registry; prompt history is stored outside leaf components.
- NO_COLOR keeps state legible through labels, layout and symbols. The status
  bar suppresses its animated spinner when matrix/tool activity is the more
  useful active signal.

### Known boundaries

- The deterministic capture harness proves source-level UI states, not a
  production model response. The manually built `dist/index.js` must be
  rebuilt before artifact claims.
- The current repository is intentionally dirty. No unrelated changes were
  reset, staged or cleaned.
- PTY evidence still needs a fresh post-build long-tool, cancellation, resize
  and mouse-scroll journey before release claims.
