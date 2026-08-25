# LocalCode Functional MVP Audit — Phase 0

Date: 2026-08-23
Method: static code reading + live `bun run typecheck` / `bun test` execution. No live LM Studio/llama.cpp
model was available in this environment, so the exact live-model transcript from the bug report
(qwen2.5-coder-1.5b-instruct via LM Studio) was not re-run; conclusions below are derived from tracing
the code paths that would produce that transcript, and are marked accordingly where inference rather
than direct observation.

## Executive summary

The chat/agent core is **not** the unstructured mess the bug report's symptoms suggest. The tool
registry (`src/tools/workspace.ts`), the OpenAI-compatible SSE parser (`src/providers/openai-compatible.ts`),
and the tool-call presentation layer (`src/tui/presentation/adapter.ts`) are all reasonably well built:
risk-classified permissions, checkpointed writes, structured `tool_calls` parsing that never
string-concatenates JSON into assistant text, and a dedicated `ToolActivityViewModel` renderer that
turns tool calls into `READ path` / `RUN command` lines instead of raw JSON.

The actual defects are architectural gaps **above and around** that machinery:

1. **A hardcoded fake assistant line is unconditionally injected on every single user submission**,
   before the real agent even runs. This alone reproduces the headline bug.
2. **There is no turn/intent policy anywhere.** `analyzeTask()` correctly classifies "Hola" as
   `EXPLAIN` with `toolNeed: false`, but that classification is discarded after routing — every task,
   including plain conversation, is executed with the full 9-tool set and no `tool_choice` restriction
   (the concept does not exist in the codebase at all).
3. **The "no route" failure discards the router's own explanation**, replacing real rejection reasons
   with a fixed, unhelpful string.
4. Two real environment/robustness gaps: `SearchText`/repo-context file discovery depend on a system
   `rg` binary with no fallback and currently fail outright in this environment; the local-model
   tool-call **text recovery** in the agent loop only recognizes 4 specific envelope shapes, so a model
   that emits its tool call in a fifth shape will still leak raw JSON to the user.

None of this requires a rewrite. It requires: (a) removing the fake injected line, (b) adding a real
`TurnPolicy` that gates tools/`tool_choice`/system prompt by classified intent, (c) surfacing the
router's real rejection reasons, (d) hardening the two robustness gaps above.

## Current architecture (confirmed)

Stack: Bun + TypeScript, TUI built on **OpenTUI + SolidJS** (not Ink/React — corrects an assumption in
the original task brief). Entry: `src/index.ts` → `src/cli/args.ts` → either CLI print-only commands
(`doctor`, `models`, `providers`, `config`) or `src/tui/launch.tsx` → `AppShell` (`src/tui/app.tsx`,
~2250 lines).

Per-turn pipeline, `runTask()` at `src/tui/app.tsx:862-1080ish`://
`buildRepositoryContext` → `analyzeTask` → `discoverModels` → `selectRoute` → resolve provider adapter
→ `runAgent` (`src/agent/loop.ts`) with the full `workspaceTools` set.

Most of `src/agent/`, `src/checkpoint/`, `src/config/`, `src/context/`, `src/hardware/`, `src/privacy/`,
`src/providers/*`, `src/quota/`, `src/router/`, `src/runtimes/`, `src/storage/`, `src/tools/`, and large
parts of `src/tui/` are uncommitted (`??` in `git status`) — this is a large, recent, working-but-unshipped
scaffold, not legacy debt.

## Working functionality

- **Tool execution layer** (`src/tools/workspace.ts`): `ReadFile`, `WriteFile`, `EditFile`, `ListFiles`,
  `SearchText`, `Shell`, `GitStatus`, `GitDiff`, `RunTests`. Each has `risk` classification, permission
  gating (`src/tools/permissions.ts`), bounded output, and (for writes) mandatory checkpoint recording.
  `EditFile` requires an exact `oldText` match and rejects ambiguous replacements without `replaceAll`.
- **Checkpoint/rollback** (`src/checkpoint/checkpoint.ts`): refuses rollback over externally-modified
  content — the "don't destroy the user's dirty worktree" invariant is implemented, and
  `tests/integration/checkpoint.test.ts` covers it.
- **Provider stream normalization** (`src/providers/openai-compatible.ts:236-373`): SSE frame parsing
  correctly separates `delta.content` (`text.delta`), `delta.reasoning_content` (`reasoning.delta`), and
  `delta.tool_calls[]` (accumulated per-index into structured `tool.call` events on `finish_reason ===
"tool_calls"` or `[DONE]`). No code path stringifies a tool call into a `text.delta`.
- **Tool-call presentation** (`src/tui/presentation/adapter.ts:66-343`): `tool.started`/`tool.finished`
  events are mapped through `activityMetadata()`/`resultPresentation()` into human labels (`READ path`,
  `RUN command`, `N matches`, `exit N`) inside a grouped `activity-group` transcript item — never raw
  JSON, never mixed into `assistant.delta` text.
- **Agent loop multi-turn + textual tool-call recovery** (`src/agent/loop.ts`): supports native
  `tool.call` events and a 4-pattern fallback parser (`recoverTextToolCalls`) for models that emit tool
  calls as inline JSON/`[TOOL_REQUEST]`/`<tool_call>`/fenced-JSON text instead of structured
  `tool_calls`. Covered by `tests/integration/agent-loop.test.ts` (complete envelope, envelope after
  streamed prose, unknown/invalid tool calls all pass today — `bun test` confirms, see below).
- **Router privacy/cost gates** (`src/router/router.ts:129-238`): high-confidence-secret block on cloud
  routes, `strict-zero` excludes paid/unverified-free/stale candidates, circuit breaker, quota
  freshness/headroom — all implemented and covered by `tests/integration/{routing,zero-spend}.test.ts`.
- **Live verification run** (this session): `bun run typecheck` — clean, 0 errors. `bun --conditions=browser
test` — **141 pass / 12 fail across 153 tests, 43 files** (see "Live test run" below).

## Partially working functionality

- **Task intent classification exists but is discarded.** `src/router/task-analysis.ts:11-83`
  `analyzeTask()` correctly classifies `"Hola"` as `class: "EXPLAIN"`, `toolNeed: false`. But
  `TaskAnalysis` is used **only** inside `selectRoute()` to (a) filter out models lacking
  `capabilities.tools` when `toolNeed` is true, and (b) weight route scoring. It is never attached to
  `AgentTask` (`src/agent/types.ts` has no `taskClass`/`toolNeed` field) and never used to restrict
  which tools are offered to the model or to set `tool_choice`. So a correctly-classified "no tools
  needed" turn still gets the full 9-tool set.
- **Local-model textual tool-call recovery is real but incomplete.** `recoverTextToolCalls`
  (`src/agent/loop.ts:148-165`) only recognizes 4 envelope shapes. Anything else — e.g. the shape a
  specific llama.cpp/LM Studio chat template actually emits for qwen2.5-coder — falls through to
  `presentAssistantText(streamBuffer)` (`loop.ts:274-276`) and leaks as literal text. This is the most
  likely mechanism behind the raw-JSON-in-transcript half of the bug report; it could not be confirmed
  against a live model in this environment (no LM Studio/llama.cpp endpoint reachable here).
- **`ListFiles` degrades gracefully without `rg`; `SearchText` does not.** Both shell out to `rg`
  (`workspace.ts:201-218`, `247-268`). `ListFiles` has a real fallback (`listFallback`, readdir-based).
  `SearchText` has none — if `rg` isn't on `$PATH`, the tool call fails outright.

## Broken functionality (confirmed root causes)

### P0-1 — A hardcoded fake assistant message fires on every submission, before intent is known

`src/tui/app.tsx:1649-1658`, inside the live composer-submit handler `submit()` (not a test fixture —
verified by reading the full function; it is wired directly to the OpenTUI composer's Enter key and is
the only path into `runTask`):

```ts
setComposerValue("");
setActiveObjective(text);
setScreen("conversation");
const turnId = crypto.randomUUID();
setPresentation((current) =>
  presentAppEvent(
    beginTranscriptTurn(current, { turnId, text }),
    { type: "assistant.delta", text: "I'll inspect the repository first." },
  ),
);
void runTask(text, turnId).catch(...);
```

This line runs **unconditionally**, for `Hola`, `hOLA`, `¿Qué puedes hacer?`, everything. It is the
direct, sufficient explanation for the "I'll inspect the repository first." text the bug report shows
appearing before a greeting is even routed. It is dead demo scaffolding (near-identical text exists as
legitimate fixture data in `src/tui/state/fixtures.ts:170` and `tests/unit/tui-v4-presentation.test.ts:253`
for TUI screenshot tests — an initial static-only pass can conflate the two, but only `app.tsx:1656`
executes on real input).

**This is P0 blocker #1: trivial fix, highest-leverage root cause.**

### P0-2 — No turn/intent policy gates tool availability or `tool_choice`

Confirmed by exhaustive grep: `toolChoice`/`tool_choice` does not appear anywhere in `src/`. The single
call site that wires tools into the agent loop is `src/tui/app.tsx:986`:

```ts
result = await runAgent(
  { id: sessionId, objective, root: process.cwd(), candidate: selected, ... },
  {
    provider,
    tools: workspaceTools,   // always all 9 tools, every turn, every task class
    events: appEvents,
    ...
  },
);
```

and `src/agent/loop.ts:229-236` serializes `options.tools.map(toolSchema)` into every provider request
with no `tool_choice` field at all — so the provider (and therefore the model) always sees every
mutation/shell/test tool available with implicit "auto" selection, regardless of whether the turn is a
greeting, a knowledge question, or a coding task. `analyzeTask()`'s `toolNeed: false` for `"Hola"`
(§ Partially working, above) is computed and then thrown away before it reaches the agent loop.

This is the root cause of "repository tools execute without a valid user objective" and "mutation tools
can execute after a greeting" — nothing in the request construction path would prevent a model from
calling `EditFile` in response to `"Hola"` if the model itself decided to.

### P0-3 — Default context text nudges toward tool use when no context was supplied

`src/agent/loop.ts:204-206`:

```ts
content: `${task.objective}\n\n${task.context ?? "No repository context was provided. Inspect the workspace before editing."}`,
```

Minor compared to P0-2, but compounds it: any caller of `runAgent` that omits `task.context` gets an
instruction fragment that explicitly tells the model to inspect the workspace, even if the objective is
conversational. (In the live `app.tsx` path `task.context` is always populated by
`buildRepositoryContext`, so this specifically affects the test-only/future call sites and any future
"conversation mode" that skips repository-context building — it should still be removed as part of the
turn-policy fix rather than left as a trap.)

### P0-4 — "No route is currently available" discards the router's real explanation

`src/router/router.ts:243-255` computes a real, specific explanation when no candidate survives
filtering:

```ts
return {
  rejections,
  ...
  explanation: `No eligible route. ${reasons || "All candidates were rejected by policy."}`,
};
```

but `src/tui/presentation/adapter.ts:379-386` throws that away:

```ts
if (event.type === "route.selected") {
  const candidate = event.decision.selected?.candidate;
  if (!candidate) {
    return presentAppEvent(state, {
      type: "route.failed",
      error: "No route is currently available",
    });
  }
```

`decision.explanation` and `decision.rejections` (which include per-candidate reasons like "provider
health is unverified" or "required tool capability is unavailable") are computed and then never shown
to the user. This is the direct cause of the `hOLA` → `"No route is currently available"` failure mode
being uninformative; it does not explain _why_ no route was available (most likely: transient
`AbortSignal.timeout(2_000)` model-discovery timeout at `app.tsx:900-902` returning an empty candidate
list that turn — a live-environment timing question, not something this static audit can fully confirm
without a running provider).

### P1-1 — missing `rg` crashes tool/context code instead of degrading — corrected finding

Confirmed live: `bun --conditions=browser test` fails
`privacy-aware repository context > excludes never-remote paths and redacts high-confidence secrets`
and `repository file discovery returns safe context-picker candidates` with:

```
error: Executable not found in $PATH: "rg"
  path: "rg", errno: -4058, code: "ENOENT"
    at runCommand (src/shared/process.ts:25:21)
    at filesFromRg (src/context/repository.ts:46:24)
```

**Correction to the initial read of this finding:** `src/tools/workspace.ts:247-276`
(`searchTextTool`) has no fallback at all, but a deeper root cause makes `listFilesTool`'s
apparent fallback (`result.exitCode === 0 ? ... : listFallback(...)`) broken too, not just
SearchText's absence of one. `src/shared/process.ts`'s `runCommand` calls `Bun.spawn(...)`
outside any try/catch; a missing executable makes `Bun.spawn` throw synchronously (confirmed
via a direct repro script), so `runCommand` never returns an exit code for a missing binary —
it rejects. Every caller that branches on `result.exitCode` (both `ListFiles` and
`filesFromRg`/`filesFromGit` in `src/context/repository.ts`) therefore never reaches that
branch when `rg` is absent; the whole call throws uncaught instead. Fixed by making
`runCommand` resolve with a shell-style exit code 127 for a missing executable (matching
`bash: rg: command not found` conventions) instead of throwing, plus a genuine pure-JS
fallback added to `SearchText` and a third-tier `readdir` walk added to repository file
discovery. See STATUS.md Phase 3 for what was actually implemented and tested.

### P1-2 — Tool JSON schemas carry no argument shape

`src/agent/loop.ts:20-33` (`toolSchema`) emits, for every tool:

```ts
parameters: { type: "object", properties: {}, additionalProperties: true }
```

regardless of the tool's actual expected input (`ReadFile` wants `{path, maxChars?}`, `EditFile` wants
`{path, oldText, newText, replaceAll?}`, etc). The model receives only a `name`/`description`, never a
real parameter schema. This increases malformed/hallucinated-argument risk, especially for small local
models — directly relevant to the "reliableToolArguments" capability dimension the release brief calls
for, and currently unmeasurable because there is no schema to validate against up front (validation
only happens after the fact, inside each tool's own `validate()`).

### P2 — Router's tool-use gate is a boolean, not a graded capability tier

`src/router/router.ts:187-190` only checks `candidate.capabilities.tools: boolean` plus a 5%-weighted
`quality.toolUse` score in `scoreCandidate`. There is no `AgentModelCapabilities` concept
(`agenticCodingEligible`, `multiTurnTools`, `reliableToolArguments`, etc.), no capability probe, and no
distinction between "the model will accept a `tools` array in its request" and "the model reliably uses
tools correctly across multi-turn coding work." A model can be selected for an autonomous coding task
purely because it reports `capabilities.tools: true`, with no empirical tool-use evidence.

## Root cause map / dependency order

```
P0-1 (fake injected text)         — independent, fix first (cosmetic-but-critical, zero coupling)
P0-2 (no TurnPolicy)              — root architectural gap; P0-3 and part of P0-4's UX are downstream
  └─ P0-3 (default "inspect" text)  — folds into the TurnPolicy/prompt-assembly fix
P0-4 (no-route message)           — independent, small, high UX value
P1-1 (rg dependency, SearchText)  — independent, needed before any real "read project" / "search" E2E test can pass in this environment
P1-2 (empty tool schemas)         — independent, improves tool-call reliability; do after P0-2 so schemas are attached per-mode
P2  (boolean tool gate)           — depends on P0-2 existing (TurnMode) before "coding-eligible" gating means anything
```

## Live test run (this session)

```
$ bun run typecheck        → clean, 0 errors
$ bun --conditions=browser test
 141 pass
 12 fail
 Ran 153 tests across 43 files. [977.00ms]
```

Failing tests:

- `privacy-aware repository context > excludes never-remote paths and redacts high-confidence secrets` — `rg` not on PATH (P1-1)
- `repository file discovery returns safe context-picker candidates` — `rg` not on PATH (P1-1)
- 10x TUI layout/visual assertions (`focused composer communicates submit, newline and clear actions`,
  `model-picker fixture keeps narrow metadata on its own row`, `context picker filters, toggles by
keyboard and mouse...`, `approval Escape denies and returns focus to the composer`, `renders the
LocalCode shell at {80,100,120,160,200} columns`, `wide conversation does not reserve dashboard
navigation or inspector`) — these are pre-existing visual/layout regressions unrelated to the
  functional-MVP scope; **not investigated further per the functional freeze** (no UI redesign work).

## What was not (and could not be) verified in this environment

- No LM Studio / llama.cpp endpoint was reachable here, so the exact transcript from the bug report
  (qwen2.5-coder-1.5b-instruct emitting raw tool-call JSON as prose) could not be reproduced live. The
  code-level mechanism that would produce it (§ P0-1, and the incomplete `recoverTextToolCalls` pattern
  set under "Partially working") is identified and cited above; closing the loop needs either a live
  local-model smoke test or a fake-adapter regression test that emits an unrecognized tool-call shape.
- Real-time flakiness in `selectRoute` (why `hOLA` specifically produced "no route") was not
  reproduced; the 2-second model-discovery timeout at `app.tsx:900-902` is the most plausible
  mechanism but is a live-environment timing issue, not something a static read can confirm.

## Recommended repair sequence

1. Delete the hardcoded fake assistant line (`app.tsx:1656`) — P0-1. Trivial, immediate, testable.
2. Introduce `TurnPolicy`/`TurnMode`, wire `analyzeTask()`'s existing classification into it, gate
   `tools`/`tool_choice`/system-prompt-profile by mode in `runAgent` — P0-2 + P0-3.
3. Surface `decision.explanation`/`decision.rejections` in the no-route presentation — P0-4.
4. Add a `SearchText` fallback (ripgrep-equivalent JS walk, mirroring `listFallback`) — P1-1.
5. Generate real per-tool JSON schemas from each tool's `validate()` shape instead of the empty
   `{properties: {}}` stub — P1-2.
6. Build `AgentModelCapabilities` + a deterministic capability probe, wire into `selectRoute`'s
   tool-capability gate — P2.

This sequence matches `docs/mvp-functional/STATUS.md` Phase 1 → Phase 5 and the task list tracked for
this session.
