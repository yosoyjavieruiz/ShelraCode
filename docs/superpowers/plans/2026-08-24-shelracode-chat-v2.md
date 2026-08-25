# Plan: ShelraCode Core Chat Experience V2

## Intent

Bring the primary ShelraCode terminal interaction to a calm, conversation-first
experience while preserving the existing Bun, SolidJS, OpenTUI, agent-kernel,
router, and tool-execution architecture. UI changes must consume structured
events; they must not infer lifecycle state from assistant prose or rewrite
agent intelligence.

## Current evidence and boundaries

- Active source path: `src/index.ts --tui` -> `src/tui/launch.tsx` ->
  `src/tui/app.tsx`.
- User artifact path: `dist/index.js`; the artifact is not proof of a source
  change until it is rebuilt and exercised through the real PTY journey.
- Current renderer is OpenTUI 0.5.7 with the CLI renderer's alternate-screen
  default and a 30 FPS target.
- The 2026-08-24 audit and product research live in
  `docs/ui-chat-v2/AUDIT.md` and `docs/ui-chat-v2/RESEARCH.md`.
- Pre-existing dirty work is preserved. No reset, checkout, blanket staging,
  or unrelated refactor is in scope.

## Execution phases

### 1. Rendering foundation

Test first, then implement:

- adaptive reading-column geometry shared by transcript and composer;
- non-overlapping fixed vertical regions;
- independent transcript scrolling with sticky-follow only at the bottom;
- a compact `↓ New activity` affordance that never pulls a user-scrolled
  viewport down;
- resize and 80-column safety;
- no-color and color-enabled rendering checks.

Exit evidence: focused unit/integration tests, layout assertions, deterministic
captures at the required widths, and an interactive artifact check showing a
stationary composer.

### 2. Chat hierarchy and streaming

- Keep one visual group per assistant turn.
- Improve editorial user/assistant spacing without chat bubbles.
- Batch assistant deltas at a controlled cadence and update only the affected
  presentation slice.
- Preserve partial text, scroll ownership, interrupt availability, and stable
  composer geometry while streaming.

Exit evidence: streaming fixture tests, long-response stress coverage, and a
real PTY stream/cancel journey.

### 3. AgentMatrixPulse

- Add the 3x3 matrix signature only for abstract structured agent activity.
- Transition immediately to concrete tool activity.
- Use actual state-derived labels, elapsed time, interrupt hint, 6–10 FPS
  localized animation, reduced-motion fallback, and ASCII-safe semantics.

Exit evidence: component tests, frame snapshots, reduced-motion/`NO_COLOR`
captures, and proof that animation does not rerender the transcript tree.

### 4. Structured tool presentation

- Add a presentation registry with specialized READ, SEARCH, EDIT/WRITE,
  SHELL, TEST, GIT, and generic fallback renderers.
- Render explicit pending/running/success/failure/cancelled states.
- Group repetitive activity, collapse completed output, preserve expandable
  details, render real diffs, and bound live shell/test tails.
- Keep raw tool payloads outside normal transcript density.

Exit evidence: structured-event tests, malformed-metadata safety tests,
expand/collapse and scroll assertions, fixture captures, and real tool/test
acceptance.

### 5. Interaction and secondary states

- Refine the fixed multiline composer, history, interrupt, `@` file picker,
  `/` commands, and the shared command palette.
- Add compact plan, meaningful route-change, human-first error/recovery,
  approval, and completion presentations.
- Keep one dominant active-state signal and no permanent sidebar.

Exit evidence: keyboard/mouse tests, modal approval flow, 80x24 and resize
journeys, and cancellation coverage for thinking, streaming, shell, and tests.

### 6. Visual QA, documentation, and release proof

- Maintain deterministic fixture states and the required before/final captures.
- Run three review passes: motion/structure, information hierarchy, and
  premium polish.
- Complete the `docs/ui-chat-v2` design, interaction, responsive, streaming,
  tool-presentation, pass, before/after, and final-audit documents.
- Run formatting, typecheck, focused tests, full suite, build, smoke, and the
  real rebuilt `.exe`/PTY path; report source, bundle, and interactive evidence
  separately.

## Working rules

- Every behavior change starts with a failing test or deterministic fixture.
- Keep domain state outside leaf TUI components and adapt existing event
  contracts rather than duplicating the agent kernel.
- Preserve user scroll, focus, cancellation, terminal restoration, and
  responsive geometry as invariants.
- Do not declare Chat V2 complete while artifact rebuild or real user-visible
  acceptance is missing.
