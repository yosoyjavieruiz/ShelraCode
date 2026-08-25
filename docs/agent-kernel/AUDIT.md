# Agent Kernel Audit

## Current audit snapshot — 2026-08-24

This section supersedes the historical test counts and `WORKING` labels below
where they conflict. The checkout was audited as-is, with existing modified
and untracked work preserved. Fresh evidence is in
[BASELINE.md](BASELINE.md); the required research is in
[RESEARCH.md](RESEARCH.md).

The source entrypoint is `src/index.ts` because `package.json` maps the
`localcode` bin to that file. The real TUI path launches successfully and the
real local model answers a greeting, but the same path fails the repository
language question: it emits an invalid object-shaped `GitStatus` call and
repeats an unavailable `TypeScript` tool until the current loop budget is
exhausted. This is a live failure, not a stale binary claim.

The current architecture is therefore **PARTIALLY WORKING**, not a completed
autonomous agent. The functional fake-provider suite proves a useful vertical
for scripted behavior; it does not prove live model tool selection,
capability eligibility, long-horizon state, or completion truthfulness.

Historical hard blockers at the initial audit:

- plan-only and review-only requests do not map to structurally safe modes;
- the loop has no context-sufficiency gate or authoritative task ledger;
- `verified` begins as `true` and can be returned without required evidence;
- capability probes are not persisted or wired into route eligibility;
- tool errors outside the four path/input cases are not normalized;
- real terminal cancellation does not yet produce a reliable task-cancelled
  state;
- full `bun test` is currently red (194 pass, 7 fail).

Current release boundaries after the kernel pass:

- the active LM Studio model is measured as `workspace_reader`, so no live
  coding-capable route is eligible;
- live coding cancellation, long-horizon live compaction, and a lower-level
  shell sandbox remain unverified or incomplete.

Evidence-based audit of LocalCode's agent kernel against the reported failure
(`ListFiles`/`ReadFile` errors on a skill file, no recovery, false "Done").
Method: read the real source, then execute it directly (see
[ROOT-CAUSES.md](ROOT-CAUSES.md)) rather than infer from the screenshot alone.
Every "WORKING" claim below has a passing automated test as of this audit;
run `bun run test` to reverify (the package script supplies the required
`browser` condition for OpenTUI/Solid reactivity).

| Component                                                                                                                     | State                             | Evidence                                                                                                                                                                       |
| ----------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Turn classification (conversation/knowledge/workspace_read/coding)                                                            | WORKING                           | `src/agent/turn-policy.ts` — deterministic regex greeting detection, no LLM call; `tests/unit/turn-policy.test.ts`                                                             |
| Per-turn tool subsets + `toolChoice`                                                                                          | WORKING                           | `resolveTurnPolicy()` in `turn-policy.ts`; enforced in `src/tui/app.tsx:895-1008` (`tools: workspaceTools.filter(...)`)                                                        |
| System-prompt profiles (minimal/workspace/coding)                                                                             | WORKING                           | `SYSTEM_PROMPT_BY_PROFILE` in `src/agent/loop.ts`                                                                                                                              |
| Agent loop: multi-turn tool execution                                                                                         | WORKING                           | `src/agent/loop.ts:runAgent`; `tests/integration/agent-loop.test.ts`                                                                                                           |
| Textual tool-call recovery (model emits JSON instead of a native tool call)                                                   | WORKING                           | `recoverTextToolCalls()` in `loop.ts`; covered by 2 existing tests                                                                                                             |
| Non-progress watchdog (repeated identical tool call)                                                                          | WORKING                           | `loop.ts:236-330`; `tests/integration/agent-loop.test.ts` "non-progress watchdog" test                                                                                         |
| `toolChoice: "none"` hard-refuses a tool call even if the model attempts one                                                  | WORKING                           | `loop.ts:338-352`; covered test                                                                                                                                                |
| Tool contracts: typed, validated input (`ToolDefinition.validate`)                                                            | WORKING                           | `src/tools/workspace.ts`                                                                                                                                                       |
| Tool contracts: typed, self-correcting **errors** (`PATH_IS_FILE`, `PATH_NOT_FOUND`, `PATH_IS_DIRECTORY`, `INVALID_ARGUMENT`) | **WAS MISSING — FIXED THIS PASS** | `src/tools/errors.ts` (new); see root cause below                                                                                                                              |
| Repository context acquisition (manifest-priority ordering, not skill files)                                                  | WORKING                           | `src/context/repository.ts` — `priorityNames` includes `package.json`/`tsconfig.json`/etc., not `SKILL.md`; gated to `workspace_read`/`coding` turns only in `app.tsx:897-912` |
| Secret redaction / never-remote paths in context                                                                              | WORKING                           | `src/privacy/policy.ts` used by `context/repository.ts`                                                                                                                        |
| Checkpointing before first mutation                                                                                           | WORKING                           | `src/checkpoint/checkpoint.ts`; `loop.ts:461-495`                                                                                                                              |
| Verification after mutation (`bun test`)                                                                                      | WORKING                           | `loop.ts:539-558`; `tests/integration/agent-loop.test.ts` first test                                                                                                           |
| Model capability probe (conversation / read-tool / multi-turn)                                                                | WORKING (probe exists)            | `src/agent/capability-probe.ts`; `tests/unit/capability-probe.test.ts`                                                                                                         |
| Capability probe wired into routing eligibility gate                                                                          | **NOT VERIFIED**                  | No caller of `probeAgentCapability` found outside its own test — routing does not yet appear to consult it. Needs confirmation before claiming §81–84 of the spec.             |
| System prompt explicitly instructs tool-error recovery                                                                        | **WAS MISSING — FIXED THIS PASS** | Added `TOOL_ERROR_RECOVERY_INSTRUCTION` to workspace/coding profiles in `loop.ts`                                                                                              |
| Regression test reproducing the exact reported failure end-to-end with recovery                                               | **WAS MISSING — ADDED THIS PASS** | `tests/integration/agent-loop.test.ts` "recovers from the reported ListFiles-on-a-file / invalid-maxChars failures"                                                            |
| Structured error taxonomy applied to `Shell`/`RunTests`/`GitStatus`/`GitDiff`                                                 | NOT DONE                          | Those tools still throw plain `Error`; lower priority since they weren't implicated in the reported bug                                                                        |
| `localcode doctor --agent` capability report (spec §180)                                                                      | NOT DONE                          | No CLI surface for capability-probe results found                                                                                                                              |
| Independent verification agent (spec §102–104)                                                                                | NOT DONE                          | No second-pass verifier; only the deterministic `bun test` run                                                                                                                 |
| Context compaction for long-running tasks (spec §111)                                                                         | NOT DONE                          | No compaction logic found                                                                                                                                                      |
| Subagent architecture (Explore/Research/Verify) (spec §113–119)                                                               | NOT DONE                          | Not present; main loop works standalone, which the spec itself requires as a precondition before adding this                                                                   |

## Full test suite state at time of audit

```
bun test        → 199 pass, 2 fail (pre-existing, unrelated TUI overlay timing tests:
                   tui-v4-overlays.test.tsx "context picker filters..." and
                   "approval Escape denies...")
bunx tsc --noEmit → clean
```

The 2 failures predate this pass (reproduced before any change was made) and
are rendering-timing issues in `tui-v4-overlays.test.tsx`, unrelated to the
agent kernel. They are out of scope for this audit and are called out here
rather than silently left unmentioned.

## Current implementation update — 2026-08-24

The historical table above records the pre-implementation audit. The current
working tree now contains the requested kernel slice: seven explicit turn
modes with host-owned tool policy; a persistent `AgentTaskLedger`; repository
snapshot, scoped instructions, evidence sufficiency, and `.agents` exclusion;
bounded `GlobFiles`; typed workspace/process/Git errors; stale-edit and
cancellation protection; normalized multi-turn observations; a watchdog;
provider-failure state; structured plan state; a read-only independent
verifier; compaction; opt-in redacted tracing; capability probes wired into
local discovery/routing; and `localcode doctor --agent`.

Fresh deterministic evidence is `bun run test:functional`: 24 pass, 0 fail,
86 expectations. The real configured LM Studio model was probed separately
and classified `workspace_reader`; the router therefore refuses it for
autonomous coding. This is a deliberate fail-closed result, not a claim that
live coding works.

## Reconciliation after the latest live pass — 2026-08-24

The historical table above is retained as the pre-kernel audit. Fresh current
evidence supersedes its stale labels:

- Turn policy has all seven required modes and an objective-aware direct-fact
  policy. The source TUI now builds a focused 2.3k-character fact context and
  gives the model no workspace tools for that deterministic question.
- The shared envelope parser accepts LM Studio's textual `<tools>` wrapper;
  duplicate textual calls become typed observations and the continuation can
  retry with tools disabled. Raw tool JSON is not rendered as assistant prose.
- Capability probe version 4 is persisted and cache-invalidated. The active
  qwen/LM Studio pair is `workspace_reader`: read/selection/arguments/
  multi-turn pass, while conversation/no-tool discipline, editing, test
  iteration, and verification fail. Coding therefore remains ineligible.
- OpenAI-compatible requests now carry a host-controlled `maxOutputTokens`
  bound (512 for non-coding turns, 2,048 for coding/command turns by default).
- Fresh deterministic evidence: functional acceptance 24/24; focused
  agent/context/policy/provider/capability tests green; typecheck PASS.
- The current full-suite evidence is 306 pass / 0 fail / 1032 expectations
  across 306 tests and 66 files under the canonical browser-conditioned
  command. Bare `bun test` is not equivalent here: it resolves a different
  Solid runtime and produces false reactive-renderer failures. The full
  browser-conditioned suite is green; live model capability remains a
  separate release boundary.

## Deterministic contract continuation — 2026-08-24

The latest source audit closed the remaining contract gaps identified during
the read-only review:

- `SearchText` has a canonical query/glob schema and structured match evidence;
- `Shell` exposes command, cwd, output, duration, and timeout state;
- `AgentTaskLedger.constraints` records host-framed constraints;
- evidence sufficiency checks relevance/freshness when structured evidence is
  available;
- Spanish direct-fact, plan, and review wording follows the same structural
  read-only policy as English wording;
- `ReadFile` rejects binary-looking content with `BINARY_FILE`;
- the deterministic fixture exports `FakeModelAdapter` explicitly.

Fresh verification is `bun run typecheck`, `bun run format:check`,
`bun run test:functional` (24/24), `bun run test` (311/311, 1052
expectations), and `bun run smoke` (source plus current dist CLI). No live
LM Studio inference was performed while the requested model download remained
in progress, so the live capability boundary is unchanged and the autonomous
coding MVP remains blocked pending an eligible model.

## Latest authoritative deterministic count — 2026-08-24

The current canonical browser-conditioned suite is `312 pass / 0 fail / 1053
expectations` across 66 files. The functional acceptance suite remains `24/24`
and source/current-dist CLI smoke passes. Earlier `306` and `311` counts in
historical reconciliation sections are superseded by this run.

## Latest live/runtime audit continuation — 2026-08-24

LM Studio is reachable at `http://127.0.0.1:1234/v1` and exposes one
generative model plus one embedding-only model. The runtime now excludes the
embedding entry before capability probing. Capability probe version 8 uses
temperature `0`, measures `PATH_IS_FILE` recovery, and refuses to claim
executable edit/test evidence when the protocol gate skipped that phase.

The fresh live result remains `workspace_reader`; the installed 1.5B model
fails no-tool discipline and therefore cannot be selected for autonomous coding.

## Current runtime audit addendum — 2026-08-24

The live LM Studio endpoint is reachable and its native model inventory is
available. The active generative entry is exposed as
`qwen2.5-coder-1.5b-instruct` with display label `Qwen2.5 Coder 1.5B Instruct`,
quantization `Q8_0`, and native context `32768`; the embedding entry is excluded
before probing. A regression test proves that the native key, not the display
label, is sent through the agent loop and capability probe.

Current release evidence is `bun run test` 319/319, functional acceptance
24/24, format/typecheck/build/smoke all passing. The live capability gate is
still the limiting evidence: the installed model is `workspace_reader`, so a
complex live mutation/test/review journey is not yet claimed.
