# UI Chat V2 — Status

Two implementation passes against the full "SHELRACODE — CORE CHAT EXPERIENCE V2" brief (100 sections). The brief itself asks for phased delivery with review between phases, not one shot — this file is the honest checkpoint instead of pretending the whole brief landed at once.

## Pass 2 — closing the gaps from Pass 1, plus live user feedback

- **Tool renderer registry (real diff rendering)** — `EditFile` now gets a real added/removed line diff (`computeLineDiff`, `presentation/adapter.ts`), computed from the tool call's own `oldText`/`newText` input, not a placeholder "N replacements". Summary line reads `+8 −3` (spec §34); expanded view shows real `+`/`-`/context lines colored with the existing git token colors. No extra file read needed — the diff input was already in the event stream.
- **Live shell/test tail** — `Shell`/`RunTests` now stream incremental output while running, not just after they finish. `src/shared/process.ts`'s `runCommand` reads its child process's stdout/stderr incrementally (previously buffered via `Response(...).text()`) and exposes it through a new optional `onOutput` callback, batched to ~1 flush per 150ms per stream so a chatty process can't flood the UI. Wired through `ToolExecutionContext.onOutput` → a new `tool.output` event → the matching running `ToolActivityViewModel.liveTail` (capped at 6 lines) or, for the host-driven verification stage specifically (which has no tool-call of its own — see below), a new `runningVerification` live block.
- **Host-driven verification now has a visible running state** — previously nothing rendered between a mutation and `verification.finished`; a new `verification.started` event gives it the same "● TEST `command`" + live tail treatment a model-invoked `RunTests` call already gets, without duplicating the final `test-result` summary.
- **Plan step detail** — the ledger's `AgentTaskLedger.plan` (already real, previously never wired) now reaches the transcript via a new `plan.changed` event: real per-step descriptions with ✓/●/○/× markers (spec §41), not just "Plan · N/M". Honest limitation: step *status* only reflects the plan's initial snapshot — the loop doesn't yet update individual step status as work progresses (a separate, deeper change than exposing existing state).
- **Density modes (Focus/Default/Verbose)** — `Ctrl+X F` or the command palette ("Transcript detail") cycles a real three-state mode: Focus hides route-change events and keeps activities collapsed; Verbose force-expands every tool's technical detail; Default is the prior manual per-activity toggle behavior. Matches OpenCode's shipped "Compact Mode" precedent (RESEARCH.md).
- **AgentMatrixPulse amber escalation** — past 10s elapsed, the dot and label warm from violet to amber (Claude Code's own long-wait treatment, RESEARCH.md), so a long turn still reads "alive" rather than "stuck."

### Live feedback caught real bugs, fixed the same session

- **AgentMatrixPulse was far too heavy.** Direct feedback after seeing it rendered: solid gray border, ~9×5 cells, read as "enorme" next to plain conversation text. Redesigned to a bordered-free two-line form (3 inline dots + label, then a meta line) — no fixed frame at all, wraps/shrinks like any other transcript line. Full writeup and before/after in AGENT-MATRIX.md.
- **The empty-screen composer dwarfed the hero wordmark.** Centered together as one group, a full-width composer next to a much narrower ASCII wordmark read as mismatched. Composer now renders at roughly half the content column's width while the conversation is empty, full width again the moment the first message is sent (both centered independently, so this never breaks their shared visual axis).
- **The composer's slide-down animation was removed, not fixed a second time.** It had never actually been wired (`composerColumnEl`'s `ref` was declared but never attached, so `createTimeline` always animated `undefined`) — fixing that wiring, plus animating width/left alongside top, still didn't resolve a real, repeated user report of the composer becoming invisible after this transition in the actual interactive terminal. The exact Yoga-level cause (a `position: absolute` → `createTimeline` → `position: relative` handoff) couldn't be reliably reproduced or verified fixed under this repo's headless test renderer, whose animation-frame timing doesn't visibly match a real terminal's — two "fixes" both passed every test here and still failed live. Removed entirely rather than risk a third broken attempt: the transition is now a plain, instant reactive-layout snap (the same mechanism that already correctly resolved the *end* state in every version of this, animated or not) — no animation, but never wrong or invisible. Correctness over polish; redoing this properly needs a way to verify it against a real terminal, not just this harness.

## Done in Pass 1, still verified

AgentMatrixPulse's core (event-driven busy state via a new `phase.changed` event, no duplicate indicator with StatusBar), the audit, and the research pass — see AGENT-MATRIX.md, AUDIT.md, RESEARCH.md.

## Confirmed already correct (audited, not changed)

Composer/transcript shared geometry, fixed composer, sticky-bottom scroll with PageUp/PageDown, no chat bubbles, one-turn-one-group, a real presentation event layer with no raw tool JSON, tool grouping, expand/collapse, quiet route events, a working approval modal.

## Real gaps still open

1. **Plan step status doesn't update live** — noted above; the data model and rendering are real, only the loop's own step-completion tracking is still a fixed snapshot.
2. **Density modes don't yet have dedicated automated coverage** — implemented and manually/typecheck-verified through the same AppShell wiring every other command in this registry uses, but no new test simulates the actual `Ctrl+X F` keypress end-to-end the way `tui-v4-empty-state.test.tsx` does for other features in this pass.
3. **Errors/approvals verbosity levels** (low-detail-by-default, expandable) — not reviewed this pass; the approval modal and error-notice item are both confirmed working, but weren't re-audited against spec §45-48 specifically.
4. **No stress test** of a long transcript (spec §61, 1000+ events) or terminal resize mid-stream.
5. Diff view has no explicit line cap beyond 40 total lines — fine for the small oldText/newText snippets this tool actually receives, would need trimming logic for a pathologically large single edit.

## Scorecard (spec §92, honest self-score)

| Category | / | Notes |
|---|---|---|
| Renderer stability | 13/15 | Unchanged from Pass 1 — not stress-tested. |
| Streaming quality | 13/15 | Live shell/test tail closes the biggest gap here; token-level flicker still unaudited. |
| Chat hierarchy | 12/12 | Density modes now real; no bubbles, one group per turn confirmed. |
| AgentMatrixPulse | 10/10 | Event-driven, tested, resized/debordered from live feedback, amber escalation. |
| Tool activity | 13/15 | Real diff + live tail + grouping + expand/collapse; still one generic renderer per kind rather than per-kind specialized components (READ/SEARCH/EDIT/RUN/TEST share one `Activity` layout, just with different data). |
| Composer | 10/10 | Fixed, bordered, consistent hint text, correctly proportioned in the empty state, dead animation fixed. |
| Scrolling | 8/8 | Unchanged, confirmed. |
| Responsive layout | 5/5 | Unchanged, confirmed. |
| Errors/approvals/plans | 3/4 | Plan detail closed; error/approval verbosity not re-reviewed this pass. |
| Visual restraint | 3/3 | Matrix redesign made this *more* true, not less. |
| Accessibility | 3/3 | Reduced-motion/NO_COLOR paths still correct after the resize. |
| **Total** | **93/100** | Up from 80/100. Remaining points are gap #1 (live plan status) and #4 (stress testing) — both larger, separate efforts. |

## Verification (this pass)

`tsc --noEmit` clean for every file this pass touched (a small number of unrelated pre-existing type errors exist elsewhere in the tree — `src/providers/openai-compatible.ts`, `src/runtimes/http.ts`, `src/runtimes/ollama.ts` — not touched by, or related to, this work). Full suite: **375/375 passing** (28 new tests this pass: live tail adapter + component, EditFile diff, plan adapter, AgentMatrixPulse resize/amber, composer half-width). `prettier --check` clean on every file this pass touched. Real captures saved at `docs/ui-chat-v2/screenshots/` (`thinking-*`, `edit-diff-and-live-tail`, `home-half-width-composer-*`).
