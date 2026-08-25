# LocalCode Core UI — Baseline Audit

Date: 2026-08-23. Method: real renders via the existing `LOCALCODE_UI_FIXTURE` + `testRender`/
`captureCharFrame` pipeline (`scripts/capture-ui.ts`, already built by a prior session — reused,
not rebuilt), at 80×24 through 200×60, plus reading the actual failure output of every
pre-existing failing test in `tui.test.tsx` / `tui-composer-v3.test.tsx` / `tui-v3-overlay.test.tsx`
/ `tui-v4-overlays.test.tsx`. Captures live in `docs/ui-core/baseline/`.

## Important correction to prior status

The 10 "pre-existing TUI visual failures" deferred as out-of-scope during the functional-MVP
session are **not silent — reading their actual diffs matters, and most are not rendering bugs**:

- 6 of them fail on **stale copy assertions** only (test expects `"PRIVATE"`/`"Ask LocalCode
anything"`/`"Qwen Coder 7B"`, the real UI now correctly renders `"Private"`/`"Ask LocalCode…"`/
  `"Qwen 2.5 Coder 7B"`). The structural assertions in the same tests (no `WORKSPACE`/`INSPECTOR`
  sidebar text, dialog opens, etc.) **pass**. These will be superseded once this task's copy pass
  lands; not fixed separately.
- 3 are **real functional defects**, now confirmed and prioritized for Phase E/F:
  1. **Context picker filter is broken.** Typing "package" into `@` context search does not
     filter — the full unfiltered file list still renders (`src/tui/app.tsx`,
     `src/agent/loop.ts`, etc. all still shown). (`tests/integration/tui-v4-overlays.test.tsx`)
  2. **Approval dialog Escape-to-deny does not work.** Pressing Escape while the approval dialog
     is focused leaves the dialog open instead of denying and closing it.
     (`tests/integration/tui-v4-overlays.test.tsx`)
  3. **Composer does not surface the Shift+Enter hint** when focused — multiline entry is real
     (confirmed elsewhere) but not discoverable from the UI itself.
     (`tests/integration/tui-composer-v3.test.tsx`)

This matters for scope: a meaningful amount of what the new spec asks for **already exists and is
already close to on-spec** — this is not a from-zero rebuild.

## What's already close to the new spec (keep, don't rebuild)

- **Top bar** is already quiet: `◆ LocalCode   ~/shelra · main    Local · Private` — project,
  branch, mode, privacy only. Matches §7 almost exactly.
- **Tool grouping already renders as a tree**, not log lines:
  ```
  › Updating and verifying changes · 4 actions
   ├─ READ    src/auth/session.ts                               3 lines · 14ms
   ├─ SEARCH  refreshToken                                      1 match · 14ms
   ├─ EDIT    src/auth/session.ts                         1 replacement · 14ms
   └─ TEST    bun test auth                                   31 passed · 2.4s
  ```
  This is essentially §22's target already, including duration/result columns from §17.
- **Route-change presentation already matches §35's shape**: `Route changed` / `Local · Qwen 2.5
Coder 1.5B` / `↓` / `Free · Groq · Llama 3.3 70B` / plain-language reason — no quota/cost-gate
  language visible on either local or free routes (confirmed: `tests/unit/tui-v4-presentation.test.ts`
  already asserts local routes never mention quota, and the earlier session's own fix keeps the
  same route selected across turns from showing a spurious change).
  Free route already conditionally shows a quota line only in the status bar
  (`Free · Llama 3.3 70B`), not injected into the transcript event itself.
- **Composer uses a quiet top rule, not a heavy box** — already matches §37/§38's "subtle elevated
  surface, no thick border" philosophy, and transcript/composer already share identical x/width
  per a documented prior contract (`docs/ui-v4/CORE-CONCEPT.md`).
- **Home suggestions are already contextual** — dirty-git-workspace example
  (`Review my current changes / Run tests for changed files / Find likely regressions`) and clean
  new-repo example (`Explain this repository / Map the architecture / Find the main entry points`)
  both exist and match §9's examples closely.
- **Fixture/capture infrastructure for this entire task already exists**: `LOCALCODE_UI_FIXTURE`
  env var (§89), `scripts/capture-ui.ts` rendering all required widths, and
  `src/tui/state/fixtures.ts` already covers nearly every state §90 asks for (home, conversation,
  streaming, tool-group, tool-details, route-change, test-pass/failure, approval, error, palette,
  context-picker, model-picker, complete). This task reuses it rather than rebuilding it.
- **Approval dialog structure** already matches §47's shape (title, action, target, consequence,
  keyboard hint row) — content is right, only the Escape-deny wiring is broken (see above).
- **Semantic and purple color tokens already exactly match** the new mandatory hex values
  (`#8B5CF6`/`#7C3AED`/`#A78BFA` purple scale, `#4ADE80`/`#FBBF24`/`#FB7185`/`#38BDF8` semantic —
  confirmed by reading `src/tui/theme/tokens.ts` directly against the new spec's palette).

## Real gaps (score-affecting, prioritized for Phase E)

1. **Wide terminals (150+) are badly unbalanced.** At 160×50, Home's brand mark and suggestions
   sit in a narrow centered column starting at row 17 of 50, with the composer's rule spanning
   the _entire_ 160-column width beneath it — a visible width mismatch between content and
   composer, plus roughly 15 empty rows above and 15 below the content block. It reads as "a
   small phone screen floating in a large dead canvas," not a premium wide-terminal layout. This
   is the single biggest visual gap found.
2. **Neutral tokens (surface/border/text) are close but not exact** against the new spec's precise
   hex values (e.g. current `surface: #08080A` vs mandated `#09090B`; current `border.subtle:
#18181B` vs mandated `Border whisper #141416`). Low-risk, mechanical fix.
3. **Command palette is the weakest surface relative to the new bar.** Current implementation:
   a plain-text header row (`COMMAND PALETTE  shelra · conversation    Esc close`) instead of a
   floating overlay with the background visibly receding; commands show neither descriptions nor
   keybinding hints (§45's mockup wants both, right-aligned); grouping labels are bureaucratic
   (`NAVIGATION`, `SESSION`, `MODELS` in a plain divider list) rather than the calmer, symbol-led
   treatment in the mockup. This is the clearest rebuild target.
4. **Status bar under-informs at idle.** Home's footer is just `Ready` — no model/context per
   §55's own idle-state mockup (`AUTO · LOCAL · Qwen 32B   ctx 18k/32k   Ready   Ctrl+P`). Worth
   confirming whether this is deliberate (idle = nothing to report) or a real omission during
   implementation.
5. **Brand copy doesn't match the new tone.** `"Your models. Your code."` vs the new spec's
   `"Maximum intelligence. Your way."` — not mandatory verbatim, but signals a copy pass is
   wanted, and the three functional bugs above (context filter, approval Escape, Shift+Enter
   hint) need fixing regardless of which copy ships.
6. **Streaming smoothness cannot be judged from a static capture** — the `streaming` fixture shows
   a plausible mid-stream text snapshot, but batching/flicker/stability (§14) is a runtime property
   this baseline can't score; deferred to Phase F QA against the real streaming test coverage
   already in `tests/integration/tui-v4-events.test.tsx`.

## Scorecard (0–10, per §91)

| Area              | Score      | Basis                                                                                                                  |
| ----------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------- |
| Home              | 6          | Right philosophy, contextual suggestions already work; breaks down badly ≥150 cols                                     |
| Chat              | 7          | Labels-not-bubbles, tree tool grouping, and route events already close to spec                                         |
| Composer          | 6          | Quiet-rule shape is right; missing Shift+Enter discoverability                                                         |
| Streaming         | —          | Not scorable from static captures; deferred to Phase F                                                                 |
| Tool activity     | 7          | Grouping/tree/duration/result already matches §17/§20-22 closely                                                       |
| Plan              | n/a        | No plan-progress fixture found in current state — likely not implemented; verify in Phase E                            |
| Route events      | 8          | Already matches §33-35's shape and language closely                                                                    |
| Errors            | 6          | Structure reads calm and human already (`! Local model stopped unexpectedly / Restarting runtime…`); untested at scale |
| Approvals         | 5          | Right visual shape, but Escape-to-deny is functionally broken                                                          |
| Completion        | unverified | Not captured yet — check in Phase E against §53                                                                        |
| Command palette   | 3          | Weakest surface — plain header row, no descriptions/keybindings, heavy grouping labels                                 |
| Responsive layout | 4          | Solid at 80-120, degrades sharply at 160-200                                                                           |

## Scope conclusion

This is **not** a from-zero rebuild. The transcript/tool/route presentation layer built in the
prior (uncommitted) session already implements a meaningful share of this spec correctly and
should be kept and refined, not discarded. The concentrated rebuild targets are: the command
palette, wide-terminal layout balance, exact token values, and the three confirmed functional
bugs. The three-concepts exercise in Phase C will explore Home/shell-level layout alternatives
(since that's where the real gap is), while treating the transcript/tool/route presentation layer
as a shared foundation across all three concepts rather than something each concept reinvents.
