# Phase 9 Report

**Phase:** Implement typed recovery and anti-loop behavior  
**Evidence snapshot:** 2026-08-29, `America/Santo_Domingo`  
**Source revision:** `230b5575a592897fa113e3d05407e6f93e4f01da`  
**Worktree:** dirty user work preserved; no staged changes

## Repository evidence

- The live recovery path remains host-owned in `src/agent/loop.ts`, beside the
  existing repeated-call, repeated-error, forced-read, mutation, and planner
  recovery boundaries. No TUI or provider-specific authority was added.
- `src/agent/recovery.ts` now owns the typed failure taxonomy, bounded recovery
  policy, digest-based action/state/failure signatures, loop detector, and
  changed-strategy evaluator. Legacy recovery vocabulary remains accepted at
  the ledger boundary for existing snapshots.
- The detector keeps raw model arguments out of its snapshot. Successful
  progress is observed for state continuity but does not consume the recovery
  attempt budget.

## Changes

- Added the Phase 9 `FailureClass` taxonomy covering protocol/schema, illegal
  action, edit, localization, command/verification, timeout/context, model,
  progress/loop, security, runtime, escalation, cancellation, and unknown
  failures.
- Added bounded `RecoveryPolicy` and `evaluateRecovery` behavior. Repeated
  failures require evidence of a prior strategy before a changed strategy is
  selected; security and cancellation are terminal.
- Added `RecoveryLoopDetector` signatures containing action kind, an arguments
  digest, host state digest, and failure class. Per-signature,
  per-failure-class, and total failure/no-progress limits are enforced.
- Connected terminal detector decisions to the live loop. A policy stop is
  recorded as a typed recovery contract and consumed before another provider
  request; later calls in the same provider batch are not executed after a
  terminal security decision.
- Kept ordinary `PERMISSION_DENIED` recoverable as `ILLEGAL_ACTION`, while
  `OUTSIDE_WORKSPACE`, privacy, network, symlink, and explicit security codes
  remain `SECURITY_DENIAL`. Explicit typed codes take precedence over
  free-form error text.
- Preserved and tested forced-read/staged-edit recovery, legacy snapshot
  decoding, compaction metadata, and compatibility execution. Added a live
  workspace-escape regression proving the provider is called only once.
- Added `docs/architecture/recovery.md` and linked it from the architecture
  index; extended `docs/agent-kernel/ERRORS.md` with the Phase 9 taxonomy and
  recovery policy boundary.

## Tests/evals executed

- command: `bun --conditions=browser test tests/unit/recovery.test.ts tests/unit/task-ledger-codec.test.ts tests/unit/compaction.test.ts tests/integration/agent-loop.test.ts`
  - result: **64 pass, 0 fail, 315 expectations**.
- command: `bun --conditions=browser test tests/integration/resume.test.ts tests/unit/tool-error-recovery.test.ts`
  - result: **23 pass, 0 fail, 76 expectations**.
- independent command: focused Phase 9 verification
  - result: **87 pass, 0 fail, 391 expectations**.
- command: `bun run typecheck`
  - result: **exit 0**.
- command: `bunx prettier --check` on all Phase 9 source, test, and related
  persistence paths
  - result: **exit 0; all matched files use Prettier code style**.
- command: `git diff --check` on Phase 9 paths
  - result: **no content whitespace errors**; Git emitted only normal
    LF/CRLF working-copy warnings.
- command: `bun --conditions=browser test`
  - result: **exit 1; 863 pass, 1 fail, 1 skip, 3,043 expectations, 865
    tests** across 143 files.
  - sole failure remains the known baseline
    `tests/unit/code-review-agent.test.ts`: it expects `PASS` but observes
    `BLOCKED` because dirty TUI golden files contain trailing whitespace and
    the review's `git diff --check` blocks. No test was weakened and no
    unrelated user work was rewritten.

## Real-model evidence

- No new real-model run was available for Phase 9. The exact local LM Studio
  evidence remains the Phase 1 manifest:
  `C:\Users\Javie\.shelracode\evaluations\phase-01-final-secure-20260828\20260828T204358245Z-protocol-local-lm-studio-qwen2.5-coder-7b-instruct-b8942ac6-74d6-4a3c-a234-71e1d486d94c\manifest.json`.
- That run is `UNPROVEN` after `errorRecovery` failed, with replay integrity
  verified and no write authority. Phase 9 does not promote model authority.
- Deterministic and fake-provider tests prove host recovery/security behavior;
  they are not autonomous real-model success evidence.

## Metrics

| Metric                           | Phase 9 observation                                 |
| -------------------------------- | --------------------------------------------------- |
| Focused Phase 9 tests            | 64 pass / 0 fail                                    |
| Focused Phase 9 expectations     | 315                                                 |
| Independent focused verification | 87 pass / 0 fail / 391 expectations                 |
| Resume/tool boundary tests       | 23 pass / 0 fail / 76 expectations                  |
| Full suite                       | 863 pass / 1 baseline fail / 1 skip                 |
| Full-suite assertions/tests      | 3,043 / 865                                         |
| Typecheck                        | pass                                                |
| Scoped format                    | pass                                                |
| Progress budget                  | successful progress excluded from recovery attempts |
| Security terminal boundary       | workspace escape stops before next provider turn    |
| Real-model authority promotion   | none                                                |

## Risks / regressions

- The detector's in-memory observation history is not yet rehydrated as an
  independent durable snapshot. Phase 11 must persist recovery history and
  reconstruct the same bounded policy state across process death.
- Compatibility recovery keeps the existing watchdog thresholds and legacy
  strategy vocabulary. The new typed policy records why a strategy was chosen,
  but does not invent semantic repairs without a model planner.
- Free-form messages with no recognized typed code still use narrow text
  classification. Explicit host codes are authoritative; untrusted text is
  never allowed to override them.
- The known dirty-worktree code-review failure remains outside Phase 9 scope.

## Independent verification

- The first independent audit found four issues: detector decisions were only
  logged, plain permission denials were misclassified as terminal security,
  successful progress consumed the total budget, and changed strategy could be
  asserted without strategy history.
- These were fixed and regression-tested. A follow-up audit then found and
  verified explicit-code precedence, including adversarial `secret` and
  `unauthorized` message text, plus the live workspace-escape stop.
- Final independent result: **PASS**. The only initial gate failure was the
  scoped formatting warning; it was resolved mechanically and rechecked.

## Gate decision

**PASS**

## Next phase eligibility

**YES** - Phase 10 may introduce DCS and measured Skills, while preserving the
proof-backed completion gate, typed recovery, and host-side security stop.
