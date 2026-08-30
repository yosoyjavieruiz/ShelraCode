# Phase 11 Report

**Phase:** Durable task state and true resume
**Source revision:** `230b5575a592897fa113e3d05407e6f93e4f01da`
**Working tree:** dirty; unrelated user changes were preserved (`260` status
entries at verification time)
**Gate:** PASS

## Repository evidence

- `src/agent/loop.ts` remains the live provider-independent loop and now
  persists the runtime envelope through the existing `persistTask` boundary.
- `src/tui/app.tsx` remains the live resume entry point. It validates the saved
  repository/task identity before routing and now checks checkpoint ownership
  before continuing.
- `src/storage/database.ts` stores versioned runtime envelopes in SQLite,
  rejects stale revisions, and now exposes checkpoint existence scoped by task.
- `src/checkpoint/checkpoint.ts` is the host preservation boundary. Unknown or
  task-foreign checkpoint IDs are not considered preserved.
- The Phase 0-10 baseline already separated deterministic/fake-provider
  evidence from real-model evidence; this phase does not promote autonomy from
  deterministic fixtures.

## Changes

- Extended `RecoveryLoopSnapshot` with policy identity, retained observations,
  and cumulative counters; `RecoveryLoopDetector` rehydrates and validates
  bounded history instead of resetting its budget after process loss.
- Extended `TaskRuntimeSnapshot`/rehydration with exact route references,
  checkpoint ID, recovery history, and canonical redacted acceptance evidence.
  Compaction merges the envelope instead of replacing durable fields.
- Added strict runtime-envelope validation for partial Driver references,
  malformed recovery history, conflicting evidence, invalid checkpoints, and
  stale revisions.
- Added `revalidateTaskRuntimeDriverReference()`. A resumed exact reference is
  retained only for a current certified, unexpired profile whose identity,
  runtime metadata, candidate, and configuration digest all match. The TUI
  currently lacks a current configuration digest and therefore downgrades
  safely to unknown exact authority.
- Kept mutation in-flight markers through `tool.execute()`, path attribution,
  result construction, action/evidence/checkpoint observation, and the final
  marker-less persistence. This closes the post-execute/pre-commit replay
  window. Verification markers follow the same ordering.
- Added checkpoint existence and `(checkpointId, taskId)` ownership checks,
  including SQLite close/reopen continuity.
- Added deterministic regression coverage for the post-execute marker window,
  unknown/foreign checkpoints, exact Driver revalidation, and durable
  acceptance/recovery state.
- Documented the durable envelope and resume invariants in
  `docs/architecture/persistence.md`.

## Tests/evals executed

- command: `bun --conditions=browser test tests/integration/agent-loop.test.ts tests/integration/checkpoint.test.ts tests/integration/resume.test.ts tests/unit/task-runtime-state.test.ts`
- result: **60 pass, 0 fail, 285 expectations**
- command: `bun run typecheck`
- result: **PASS** (`tsc --noEmit`)
- command: `bunx prettier --check` on all Phase 11 source, test, and document
  paths
- result: **PASS**
- command: `git diff --check` on Phase 11 paths
- result: **PASS** (only Git's LF-to-CRLF working-copy warnings)
- command: `bun test`
- result: **869 pass, 24 fail, 1 skip, 3137 expectations across 894 tests**.
  The 24 failures are the same pre-existing dirty OpenTUI interaction/golden
  tests and the existing `code-review-agent` baseline recorded before Phase
  11; no Phase 11 focused host test failed.
- command: independent read-only Phase 11 gate review by
  `phase1_gate_verifier`
- result: **PASS**; expanded focused review reported **122 pass, 0 fail, 509
  expectations**, with typecheck and scoped Prettier also passing.

## Real-model evidence

- exact model identity: unchanged from the Phase 0 baseline
- runtime: no new qualifying local-model E2E run was available for this phase
- result: **UNPROVEN** for broad coding autonomy and Driver authority
  promotion; deterministic/fake-provider results are not relabeled as
  real-model capability.

## Metrics

- recovery history/counter restoration: covered and passing
- task/objective/repository identity continuity: covered and passing
- checkpoint continuity after SQLite close/reopen: covered and passing
- checkpoint ownership and unknown-ID rejection: covered and passing
- post-execute mutation-marker ordering: covered and passing
- exact Driver stale/invalidated/configuration mismatch: fail-closed and
  covered
- canonical acceptance evidence persistence/redaction: covered and passing
- full dirty-worktree suite: `869/894` tests passed; known unrelated failures
  remain explicitly visible

## Risks / regressions

- The current TUI does not yet calculate a live configuration digest, so a
  resumed exact Driver reference is intentionally dropped until that host fact
  is available. This is a safe authority downgrade, not a capability claim.
- The full dirty-worktree suite still contains unrelated OpenTUI and
  `code-review-agent` failures; they remain recorded and were not weakened.
- Checkpoint ownership is enforced by the current runtime task ID. Any future
  cross-process/imported checkpoint mechanism must preserve that ownership
  relation before allowing resume.
- No new real local-model evidence was produced; release claims remain bounded
  by the existing calibration baseline.

## Gate decision

**PASS**

The Phase 11 durable envelope, recovery continuity, checkpoint continuity and
ownership, replay protection, and fail-closed Driver authority boundaries are
implemented and independently verified. The known broader-suite failures and
absent real-model evidence do not support a higher autonomy claim.

## Next phase eligibility

**YES** — Phase 12 may begin. It must preserve the current durable envelope,
task-scoped checkpoint ownership, and fail-closed exact Driver behavior.

