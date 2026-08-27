# Autonomous Completion Overhaul

**Date:** 2026-08-27
**Status:** Approved for implementation
**Parent architecture:** `docs/superpowers/specs/2026-08-26-level-10-agent-architecture.md`
(Phase 1 — objective contract and truthful completion; Phase 5 —
instruction hierarchy, narrowly for the system prompt only)

## Problem

Live use (building a counter app end-to-end) surfaced four recurring
failure patterns, all reported by the user as present in the same session:

1. The agent stops with an internal watchdog error instead of trying a
   different approach.
2. It runs out of its turn budget on multi-file objectives.
3. It reports success while the objective is still broken.
4. It stops mid-task to ask the user something it could have decided
   itself from repository evidence.

Code inspection (not speculation) traced (1) and (3) to a concrete,
fixable asymmetry, and (4) to a missing behavioral directive rather than
a permission-system bug. See "Root cause evidence" below.

## Goal

The agent should behave like a senior engineer working unsupervised:
adapt when something doesn't work, keep going instead of stopping at the
first obstacle, verify its own output before declaring done, and only
involve the human for decisions a human must actually make (irreversible
actions, or missing information that truly isn't in the repo/objective).

## Root cause evidence

`src/agent/loop.ts` has four "no progress" watchdogs:

| Watchdog | Trip threshold | On trip today |
|---|---|---|
| Repeated identical tool call | 3x (`NON_PROGRESS_LIMIT`) | hard-abort task (`loop.ts:3944`) |
| Repeated tool error | 3x | hard-abort task (`loop.ts:5008`) |
| Repeated failed mutation | 2x (`MUTATION_FAILURE_LIMIT`) | hard-abort task (`loop.ts:5020`) |
| Mutation stagnation (bytes change, no criterion progress) | 3x (`MODEL_MUTATION_STAGNATION_LIMIT`) | calls `appendModelRecoveryPlan()` to get a different strategy from the planner; only aborts if that fails (`loop.ts:5337`) |

Only the fourth watchdog uses the recovery path that already exists and
is already tested. The other three throw away all task progress on the
first trip, with no attempt to let the planner propose a different
strategy. This is the direct, evidenced cause of "stops with a
watchdog error" and a contributor to "runs out of turns" (a wasted whole
task run means the next attempt starts from zero turns again) and
"reports success while broken" (a hard abort skips the
`reviewCodingObjective` / `verifySuccessCriteria` gate entirely, so the
user only sees a truncated task and may not realize it never finished).

`checkPermission()` in `src/tools/permissions.ts` already scopes
approval prompts correctly: only actions classified `destructive` (e.g.
`rm -rf`, force-push, `git reset --hard`) require human approval in
every permission mode, including `AUTO`. That gate is a deliberate
safety boundary and is **not** being changed. What can legitimately
cause unwanted stops:

- `classifyShellCommand` over-classifying a safe command as
  `destructive` (one such false positive — an unrelated `-f` flag on a
  chained command — was already found and fixed this session; worth a
  systematic pass for others).
- Nothing in the system prompt tells the model to resolve ambiguity from
  repository evidence and act, rather than surface a question — so a
  model that's uncertain has no instructed default except "ask."

The coding system prompt (`SYSTEM_PROMPT_BY_PROFILE.coding`,
`loop.ts:785`) is six sentences of mechanical constraints (one tool per
turn, don't narrate a tool call as prose, don't assume file contents).
It carries no identity, standard, or judgment guidance — nothing that
establishes "senior engineer who owns the objective end-to-end and
verifies before declaring done."

No `reasoning_effort`-equivalent field exists anywhere in
`src/providers/types.ts`'s request shape, so even backends that support
an effort/thinking-budget parameter (e.g. reasoning-tuned local models
served through an OpenAI-compatible endpoint such as LM Studio) never
receive one.

## Design

### 1. Unify non-progress watchdogs into one recovery path

Route the three hard-abort watchdogs (repeated call, repeated error,
repeated mutation failure) through the same recovery mechanism the
stagnation watchdog already uses:

- On trip, call `appendModelRecoveryPlan()` with a description of what
  was attempted and why it's considered stuck (reuse the existing
  `issues` / `nextActions` shape already used by the stagnation path).
- Cap recovery attempts per watchdog **kind** at 2 (matching the existing
  convention for stagnation recovery) using a counter keyed by watchdog
  type, so a genuinely unsolvable task still terminates instead of
  looping forever.
- Only after recovery is attempted and exhausted does the task hard-stop
  — and the final message should summarize what was tried ("attempted
  a direct edit, then a recovery plan targeting X, then Y — still
  blocked because ...") instead of the current bare "same call repeated
  3 times."
- A hard-stop after exhausted recovery still goes through
  `verifySuccessCriteria` / `reviewCodingObjective` if any mutation
  happened, so the user gets a truthful "here's what's actually done and
  what isn't" instead of a silent partial state.

This is the highest-confidence, most testable change and the direct fix
for "no completa tareas."

### 2. Reduce unnecessary mid-task stops

- Audit `classifyShellCommand` (`src/tools/permissions.ts`) for other
  over-broad `destructive` matches beyond the one already fixed this
  session, using the same kind of command-injection-safe regex review.
- Add an explicit directive to the coding system prompt: resolve
  ambiguity from repository evidence and act on your best judgment;
  only stop to ask when the required information provably doesn't exist
  in the repository or the stated objective. This does not change any
  permission-system code — it changes what the model is told to do with
  the autonomy it already has.
- The destructive-action approval gate itself is explicitly out of
  scope — it is a deliberate safety boundary, not a bug.

### 3. Rewrite `SYSTEM_PROMPT_BY_PROFILE.coding`

Replace the current constraint-only prompt with one that leads with
identity and standard, then keeps the existing mechanical rules (they
prevent real protocol failures and must not be dropped):

- Identity: an autonomous senior engineer responsible for the whole
  objective, not just the next tool call.
- Standard: read enough to be confident before editing, but don't stall
  in read-only exploration once there's enough evidence to act; when a
  tool result contradicts an assumption, update the plan instead of
  repeating the same action; verify your own change against the
  objective before reporting success.
- Keep verbatim: one tool call per turn, never describe a planned tool
  call as prose/JSON/code block, don't assume file contents before
  reading them, the existing `TOOL_ERROR_RECOVERY_INSTRUCTION` and
  `PLATFORM_EXECUTION_INSTRUCTION` strings.
- Keep the prompt profile-scoped as today (`minimal` / `workspace` /
  `coding`) — only the `coding` profile changes.

### 4. Best-effort reasoning-effort passthrough

- Add an optional `reasoningEffort?: "low" | "medium" | "high"` field to
  the provider request shape in `src/providers/types.ts`.
- Thread it from `AgentTask` (new optional field, default `"high"` for
  `mode === "coding"`) through `runAgent` to the provider request.
- Each provider adapter decides whether to forward it (e.g. as
  `reasoning_effort` for OpenAI-compatible endpoints); adapters that
  don't support it ignore the field. No behavior or error changes for
  backends without support — this must never cause a request to fail.

## Non-goals

- No changes to `mutation-intent.ts`, `task-contract.ts`'s greenfield
  classifier, or `stream-normalizer.ts` — all stabilized last session.
- No weakening of the destructive-action approval gate in any
  permission mode.
- No change to `maxTurns` sizing (`Math.max(16, ceil(complexity * 32))`
  in `app.tsx` already scales reasonably with task complexity).
- No new UI surface; this is agent-kernel behavior only.

## Testing approach

TDD, red/green, per existing repo convention:

1. Watchdog unification: unit tests in `tests/unit/` (or wherever
   `loop.ts`'s watchdog behavior is currently covered) asserting that a
   trip of each of the three previously-hard-abort watchdogs now invokes
   recovery, that a second exhaustion after 2 recovery attempts
   terminates, and that `verifySuccessCriteria` still runs on the
   terminal path.
2. Permission audit: targeted unit tests for any `classifyShellCommand`
   false positive found, following the pattern already used for the
   `-f` flag fix this session.
3. System prompt: since prompt text has no meaningful unit-testable
   assertions beyond "contains expected directives," keep this change
   reviewed by re-running the counter-app scenario manually (see below)
   rather than over-testing prose.
4. Reasoning-effort passthrough: unit test that the field is forwarded
   when present and omitted/ignored when absent, for at least one
   provider adapter.
5. End-to-end confirmation: re-run the counter-app build objective (the
   real reproducer for all four reported symptoms) after implementation
   and confirm it completes without a watchdog abort and without a false
   "done."

## Risks

- Recovery-instead-of-abort could mask a genuinely unrecoverable task
  and burn more turns before giving up. Mitigated by the 2-attempt cap
  per watchdog kind, same as the existing stagnation watchdog.
- A more "opinionated" system prompt could make the model over-act
  (edit before reading enough). Mitigated by keeping the existing
  evidence-before-mutation mechanical rules verbatim.
