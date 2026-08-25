# LocalCode Core UI — Final Audit

Date: 2026-08-23, end of this session. Honest status — no optimistic claims. This session
completed Phases A-E of the plan (audit, research, 3 concepts, decision, implementation) plus a
verification pass; it did **not** complete the full 3-formal-refinement-pass process the master
prompt specifies (§98-100) — see "What's not done" below.

## What shipped, with evidence

| Change                                   | File(s)                                   | Evidence                                                                                     |
| ---------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------- |
| Exact Obsidian Violet neutral tokens     | `theme/tokens.ts`                         | `tests/unit/tui-v2-foundation.test.ts` (new test asserting every hex value)                  |
| Composer Shift+Enter/Esc discoverability | `components/Composer.tsx`                 | `tests/integration/tui-composer-v3.test.tsx`                                                 |
| Home anchored-top layout (Concept B)     | `views/HomeView.tsx`, `app.tsx`           | `tests/integration/tui-v4-home.test.tsx` + real capture `docs/ui-core/final/home/160x50.txt` |
| Removed redundant command-palette header | `app.tsx`                                 | `tests/integration/tui-v3-overlay.test.tsx`                                                  |
| 6 stale-copy test fixes                  | `tui.test.tsx`, `tui-v3-overlay.test.tsx` | now passing                                                                                  |

Command palette descriptions/keybindings/grouping were **already implemented** — the baseline
audit's "3/10" score was based on an 80-column capture where they're correctly hidden by a
width gate (`showDescriptions()` needs ≥120 cols); a 160-column capture
(`docs/ui-core/final/palette/160x50.txt`) shows them working as designed. This audit's own
initial baseline score for that surface was too harsh; corrected here.

## What's deferred (2 known bugs, thoroughly investigated, not fixed)

Both documented in detail in `docs/superpowers/plans/2026-08-23-ui-core-implementation.md`
(Tasks 3 and 4). Summary:

- **Context-picker search doesn't visually filter.** The reactive data layer is proven correct
  (instrumented logging showed the filter memo computing the right result on every keystroke);
  the rendered tree still shows all rows. Reproduced the exact component, props, and nesting in
  isolation and it worked correctly every time — the bug only appears mounted inside the full
  `AppShell` driven by the test harness's simulated keystrokes. 8 hypotheses tested and ruled
  out (viewport culling, controlled/uncontrolled input, timing, batching, nesting depth, a
  `scrollChildIntoView` effect). Root cause not found.
- **Approval dialog Escape doesn't deny.** Narrower finding: the deny callback never fires at
  all (confirmed via instrumentation) — traced to `@opentui/core`'s test harness `pressEscape()`
  sending a bare `\x1b` byte, the same first byte as any ANSI escape sequence; no other test in
  this codebase proves standalone-Escape key events reach a focused handler through this mock
  harness. May be a test-infrastructure gap rather than an application bug.

Both were reverted to their original (broken but well-understood) state rather than shipped with
speculative changes. `bun test` shows exactly these 2 failures, unchanged from before this
investigation — nothing was made worse.

## Live regression state

```
$ bun run format:check   → PASS
$ bun run typecheck      → PASS (0 errors)
$ bun test                → 193 pass / 2 fail (both documented above)
$ bun run test:functional → PASS (9/9, confirms this UI work touched no agent/tool/router code)
$ bun run build            → PASS
```

Started this session at 183 pass / 10 fail (all 10 pre-existing and out of scope at the time).
Net: +10 passing tests, -8 failures, 2 real bugs converted from "unknown" to "deeply diagnosed."

## What's NOT done (honest gap list)

- **No formal 3-pass refinement review** (§98-100: independent-reviewer function/structure pass,
  visual-quality-vs-references pass, public-launch red-team pass) was run as a separate,
  distinct exercise. What exists instead: every change was verified against a real render and a
  real test at the point it was made, and the baseline/decision docs already incorporate
  reference-informed critique. This is real verification, but it is not the same as three
  independent passes over the _finished_ whole.
- **No manual interactive QA** (§96: typing, scrolling, resizing, mouse, actual terminal
  keyboard behavior) — this environment can drive `testRender`/`mockInput`/`captureCharFrame`
  but not a live interactive terminal session. Everything claimed above is proven through that
  harness, which is real evidence but is not the same as a human (or you) actually using it.
- **No performance/stress QA** (§97: 1000 transcript events, rapid streaming, 50 tool updates,
  resize-during-stream) was run this session.
- **Plan-progress UI** (§31-32) — the baseline audit found no plan-progress fixture in the
  current state; not investigated further, unknown whether it's implemented at all.
- **Status bar idle-state richness** (§55's `AUTO · LOCAL · Qwen 32B ctx 18k/32k Ready Ctrl+P`
  mockup vs. today's bare `Ready`) — flagged in `BASELINE.md`, not changed this session; unclear
  whether the omission is deliberate (nothing to report while idle) or a real gap.
- Diff/code-block rendering (§29-30, §69-70), test-result presentation polish (§26-28), and
  error-detail expansion (§50) were not specifically audited or touched this session — the
  baseline audit sampled representative fixtures, not the full §90 state list.

## Scorecard (against §101, honest — not all categories independently re-verified this session)

Cannot responsibly assign a single 0-100 score without the manual/interactive/performance QA
above. What can be stated with evidence: the two changes with the clearest before/after proof
(Home wide-terminal balance, command-palette header redundancy) are fixed and verified; the
token-exactness gap is closed; 3 real functional bugs were found (1 fixed — composer hint; 2
deeply diagnosed but not fixed — context filter, approval escape). Recommend treating this as a
solid, verified increment rather than a finished, publish-ready pass.

## Recommended next session

1. Get `@opentui/solid`/`@opentui/core` reconciler source readable (not just `.d.ts`) to actually
   trace the context-picker and approval-escape bugs, or file them upstream if they turn out to
   be library bugs rather than application bugs.
2. Run this build in a real terminal (not just the test harness) and manually exercise §96's
   interaction list — this is the one thing this session's tooling structurally cannot do.
3. If the manual pass surfaces new issues, that's when the 3 formal refinement passes make sense
   — running them against an audit that's already 2 sessions removed from a live terminal check
   risks reviewing captures instead of the product.
