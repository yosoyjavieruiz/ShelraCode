# LocalCode Functional MVP — STATUS

Updated: 2026-08-23 (end of this session). No optimistic statuses — a line here is DONE only
because its check actually ran and passed in this environment; anything not run here is
marked accordingly, not assumed.

## DONE

- **Phase 0 — Audit.** `docs/mvp-functional/AUDIT.md`. Root causes for the greeting bug found
  and cited with file:line via direct code reading (corrected one mischaracterization from an
  automated recon pass along the way — see AUDIT.md).
- **Phase 1 — Turn policy + dynamic system prompt.**
  - Deleted the hardcoded `"I'll inspect the repository first."` line that fired on every
    composer submission (`src/tui/app.tsx`, was line 1656) — this alone reproduced the
    headline bug.
  - New `src/agent/turn-policy.ts`: `resolveTurnMode` (conversation / knowledge /
    workspace_read / coding, deterministic keyword+pattern based, ES+EN) and
    `resolveTurnPolicy` (tool subset, `tool_choice`, system-prompt profile per mode).
  - `src/router/task-analysis.ts` gained Spanish-language keyword coverage (`corrige`,
    `arregla`, `implementa`, `dónde está`, …) — without this, every Spanish coding
    instruction in the acceptance tests misclassified as `EXPLAIN`.
  - `src/agent/loop.ts`: system prompt is now profile-scoped (`minimal` / `workspace` /
    `coding`) instead of one static string; the "inspect the workspace" default nudge only
    applies to non-conversational profiles; `toolChoice` is threaded through to the provider;
    **defense-in-depth**: if `toolChoice` is `"none"`, an attempted tool call is refused
    outright even if the model ignores that instruction.
  - `src/tui/app.tsx`'s `runTask` now classifies the turn _before_ building repository context
    or picking tools, skips repository-context building entirely for conversation/knowledge
    turns, and passes only the policy-scoped tool subset + `toolChoice` into `runAgent`.
  - `src/tui/presentation/adapter.ts`: the "no route" failure now surfaces the router's real
    `explanation`/rejection reasons instead of a fixed, uninformative string.
  - Tests: `tests/unit/turn-policy.test.ts` (8), `tests/unit/task-analysis.test.ts` (+3),
    `tests/integration/agent-loop.test.ts` (+3: toolChoice-none defense-in-depth, minimal
    system prompt, non-progress watchdog), `tests/unit/tui-v4-presentation.test.ts` (+1).
- **Phase 2 — Provider/tool protocol correctness.**
  - `NormalizedModelRequest` gained `toolChoice`; `GenericOpenAICompatibleProvider` sends
    `tool_choice` alongside `tools`, and omits both entirely when no tools are offered
    (rather than sending `tools: []`).
  - Confirmed via direct code reading (not assumption) that the SSE stream parser already
    correctly separates `tool_calls` from `content` — no raw-JSON-into-text leak exists at
    the provider layer. The one remaining leak surface is `recoverTextToolCalls` in
    `src/agent/loop.ts`, which only recognizes 4 textual tool-call envelope shapes; a model
    emitting a 5th shape still leaks raw text. Documented, not fixed (needs a real local
    model to observe the actual shape — see BLOCKED).
  - Tests: `tests/integration/provider-contract.test.ts` (+1 for `tool_choice` serialization).
- **Phase 3 — Tool execution reliability.**
  - `src/shared/process.ts`: `runCommand` no longer throws when the executable isn't on
    `$PATH` — it resolves with a shell-style exit code 127, matching how every caller was
    already (incorrectly) assuming missing-binary failures behave. This was a real,
    previously-unnoticed bug affecting **both** `ListFiles` and `SearchText`, not only
    `SearchText` as the initial audit pass suspected — corrected in AUDIT.md.
  - `SearchText` now has a pure-JS fallback (`searchFallback`) when `rg` isn't installed,
    mirroring `ListFiles`'s existing fallback.
  - `src/context/repository.ts`: file discovery now has a third tier (`filesFromWalk`, pure
    `readdir`) after Git and ripgrep both come up empty — fixes repository-context building
    and `listRepositoryFiles` in a non-git directory without `rg` (this environment).
  - Every tool in `src/tools/workspace.ts` now declares a real JSON-Schema `parameters`
    object (path/oldText/newText/command/etc, with `required`) instead of an opaque
    `{properties: {}, additionalProperties: true}` stub sent to the model for all 9 tools.
  - Tests: `tests/unit/process.test.ts` (2), `tests/unit/workspace-search.test.ts` (3),
    `tests/integration/privacy-context.test.ts` and `tests/unit/repository-files.test.ts`
    (previously failing in this environment — now pass), `tests/integration/agent-loop.test.ts`
    tool-schema assertions strengthened.
- **Phase 4 — Agent loop + fake deterministic adapter + E2E tests.**
  - `tests/support/fake-provider.ts` (`createScriptedProvider`) and
    `tests/support/fixture-repo.ts` (`createFunctionalFixtureRepo`,
    `breakFixtureMathAdd`) — reusable, deterministic, no live model/network required.
  - `tests/integration/functional-acceptance.test.ts` — 8 scenarios driving the _real_
    production pipeline (`analyzeTask` → `resolveTurnMode` → `resolveTurnPolicy` →
    `runAgent`) against the fixture repo: greeting (golden path), greeting (adversarial —
    model attempts `EditFile`, is refused), general knowledge question, repository question
    (read-only), small edit + verification, fix-a-real-failing-test (RunTests discovers the
    real failure → ReadFile → EditFile → RunTests really passes), malformed tool call, and
    mid-run cancellation. Wired as `bun run test:functional`.
  - Non-progress watchdog in `src/agent/loop.ts`: 3 identical consecutive tool calls stop the
    run with an actionable error well before `maxTurns` is exhausted.
- **Phase 5 — Model capability routing gate (scoped).**
  - `src/agent/capability-probe.ts`: `probeAgentCapability(provider, modelId)` — a
    deterministic, non-destructive 3-part probe (chat / read-tool / multi-turn-continuation)
    against the real `ProviderAdapter` interface. Returns `agenticCodingEligible` plus
    human-readable `notes` explaining any failure.
  - `ModelCandidate` gained an optional `agentProbe` field; `selectRoute` rejects a candidate
    for tool-needing tasks if it has been probed and failed
    (`"failed the agentic-coding capability probe"`) — additive and opt-in: an unprobed
    candidate is unaffected, so this cannot regress existing routing behavior.
  - Tests: `tests/unit/capability-probe.test.ts` (4), `tests/unit/router.test.ts` (+2).

## IN PROGRESS

- None — Phase 6 (this section) is the last step of this session's work.

## LIVE VERIFICATION (real LM Studio + qwen2.5-coder-1.5b-instruct)

The user ran the actual TUI against their real local model after the Phase 0-6 work above.
Results:

- **"Hola" → confirmed fixed live.** Greeted naturally, zero tool calls, zero fake narration.
  This is the exact scenario the whole engagement started from.
- **"revisa todo el codigo del proeycto" surfaced two real bugs the deterministic suite
  didn't catch, both now fixed and covered by new regression tests:**
  1. A spurious **"Route changed"** notification appeared even though the same local model
     handled both turns. Root cause: `presentAppEvent`'s `route.selected` handler always
     attached `previous` (triggering the "changed" UI) whenever `state.currentRoute` was
     already set, without checking whether the new route actually differed. Fixed —
     `routesEqual()` now gates it; same-route reselection is a no-op.
     (`tests/unit/tui-v4-presentation.test.ts`)
  2. The model called `ListFiles({ path: "/" })` — a very common way a smaller model spells
     "the whole project" — and got a hard `Path escapes workspace: /` error instead of a
     listing. Root cause: `resolveWorkspacePath` treated a leading `/` as an OS-absolute path
     escape rather than workspace-root shorthand. Fixed at the shared path-safety layer (so
     it applies to every tool, not just `ListFiles`) by normalizing a leading `/` or `\` to
     mean workspace-root before the escape check — directory-traversal (`../..`) is still
     rejected exactly as before. (`tests/unit/paths.test.ts`,
     `tests/integration/functional-acceptance.test.ts`)

This is a meaningful signal: the deterministic acceptance suite is good at proving intent
classification and tool gating are correct, but it can't discover a real small model's
specific phrasing habits (like passing `"/"`) — that needs exactly this kind of live-model
pass. Recommend repeating a live pass after any further change to path handling or turn
classification.

## BLOCKED

- **Real local-model smoke test** (LM Studio / llama.cpp, master-prompt §131/§134
  `doctor --agent`): no local runtime is reachable in this environment. The exact transcript
  from the original bug report (qwen2.5-coder-1.5b-instruct emitting raw tool-call JSON as
  prose) was not reproduced live. What _was_ established: (a) the hardcoded fake-narration
  line is deleted and cannot recur; (b) tools are no longer offered at all for a greeting, so
  even a model with poor tool discipline has nothing to misuse; (c) `recoverTextToolCalls`'s
  4-pattern coverage is a plausible, cited, but unconfirmed-against-the-real-model mechanism
  for the raw-JSON-leak half of the report. Closing this fully needs either a live LM
  Studio/llama.cpp endpoint, or `probeAgentCapability` run against one, or a new fake-adapter
  regression test that emits the model's actual (currently unknown to this session) envelope
  shape once observed.
- **`localcode doctor --agent`** (master-prompt §134): the underlying primitive
  (`probeAgentCapability`) exists and is tested; it is not yet wired into the `doctor` CLI
  command. Not done this session — scoped out to keep the CLI/UI surface change minimal and
  low-risk this late in the session; the probe itself has no CLI dependency and is usable as
  soon as a runtime call site is added.

## NEXT

1. Wire `probeAgentCapability` into `localcode doctor --agent` so probing a real local model
   is a one-command operation, and have that CLI populate `ModelCandidate.agentProbe` for the
   router gate to actually engage in production (today the router gate is tested and correct
   but nothing yet populates `agentProbe` outside of tests).
2. Once a real LM Studio/llama.cpp endpoint is available: run the probe against
   `qwen2.5-coder-1.5b-instruct`, record the result, and — if the textual tool-call envelope
   it emits doesn't match one of `recoverTextToolCalls`'s 4 patterns — add that pattern (or a
   generic heuristic) rather than leaving the leak path merely "documented."
3. Extend `resolveTurnMode`'s repository-reference heuristic (currently a fixed term list in
   `src/agent/turn-policy.ts`) — it is deliberately conservative and will misclassify some
   phrasings; broaden based on real usage rather than guessing further ahead of evidence.
4. The 10 pre-existing TUI visual/layout test failures (listed below) are untouched per the
   functional freeze. They are a separate, already-known-broken area or a genuine environment
   change and were not this session's mandate.

## KNOWN FAILURES (current, live — `bun test`, this session's final run)

```
183 pass
10 fail
Ran 193 tests across 49 files.
```

All 10 failures are pre-existing TUI visual/layout assertions, explicitly out of scope for
this functional-freeze milestone (no UI redesign work was performed):

- `focused composer communicates submit, newline and clear actions`
- `model-picker fixture keeps narrow metadata on its own row`
- `context picker filters, toggles by keyboard and mouse, and updates composer context`
- `approval Escape denies and returns focus to the composer`
- `renders the LocalCode shell at {80,100,120,160,200} columns`
- `wide conversation does not reserve dashboard navigation or inspector`

The 2 failures that _were_ functional (missing-`rg` repository-context and file-discovery
tests) are fixed — see Phase 3 above.

## Release-gate commands (all run live this session)

```
$ bun run format:check   → PASS (0 issues; fixed 49 pre-existing unformatted files with
                            `bun run format` — pure formatting, no logic change)
$ bun run typecheck      → PASS (0 errors)
$ bun test                → 178 pass / 10 fail (all 10 pre-existing, out-of-scope TUI visual)
$ bun run test:functional → PASS (8/8)
$ bun run build           → PASS (dist/index.js + assets)
$ bun run smoke            → PASS (source and bundle both respond to help/version/doctor)
```

## Functional release gate — scorecard

See the final report delivered to the user this session for the acceptance-test-by-test
PASS/FAIL breakdown. Summary: the 5 P0 defects identified in AUDIT.md (fake narration line,
unconditional full toolset, unset `tool_choice`, no-route message discarding real reasons,
missing per-tool schemas) are fixed and covered by tests that were watched red before the
fix. Live real-local-model verification remains BLOCKED as described above — the release is
**not** being claimed as a verified 100/100 against a live model; it is a verified pass
against the deterministic acceptance suite plus the full existing regression suite, both
captured above and re-runnable at any time with `bun run test:functional` / `bun test`.
