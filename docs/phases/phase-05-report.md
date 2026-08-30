# Phase 5 Report

**Phase:** Extract Minimal SWE Core  
**Evidence snapshot:** 2026-08-29, `America/Santo_Domingo`  
**Source revision:** `230b5575a592897fa113e3d05407e6f93e4f01da`  
**Worktree:** dirty user work preserved; no staged changes

## Repository evidence

- The historical lifecycle concentration remains in `src/agent/loop.ts`:
  `runAgent` owns the existing ledger, phase transitions, provider turns,
  recovery, verification, completion, checkpoints, persistence, and
  rehydration. Phase 5 does not copy or rewrite that state machine.
- `src/agent/task-state.ts` and `src/agent/task-runtime-state.ts` remain the
  existing authoritative ledger/runtime foundations. The new Core accepts an
  optional, host-created `TaskRuntimeSnapshot` and validates task ID, objective,
  repository root, and runtime anchors before storing it.
- The provider boundary in `src/providers/types.ts` is already
  provider-neutral. The new `src/core` surface contains no model-brand or
  provider-specific branching.
- `src/tui/app.tsx` remains on the existing application path. Its routing,
  context, permission, verification, checkpoint, and UI composition were not
  moved into a replacement mega-manager. Production TUI/database wiring is a
  later strangler step, not a claim of Phase 5 migration.

## Changes

- Added `src/core/types.ts` with provider-neutral task snapshots, bounded run
  budgets, semantic driver/execution/verification ports, executor contracts,
  and typed lifecycle results.
- Added `src/core/task-runtime-repository.ts` with a cloning state service,
  typed not-found/conflict errors, and a deterministic in-memory repository for
  host tests. Durable database integration remains behind this port for the
  persistence phase.
- Added `src/core/swe-core.ts` with `startTask`, `step`, `run`, `cancel`,
  `inspect`, and `resume` lifecycle boundaries. It persists `ready` before any
  executor call, owns per-task operation exclusion, bounds steps and wall time,
  preserves cancellation during resume rehydration, and rejects unverified
  completion.
- Added `src/core/legacy-agent-runner.ts` as a narrow adapter around the
  existing `runAgent`. It deliberately does not fake `step()` with
  `maxTurns: 1`; unsupported stepping is returned as a typed result.
- Added `tests/unit/swe-core.test.ts` covering persistence-before-execution,
  semantic stepping, legacy compatibility, operation locks, cancellation,
  resume identity/runtime continuity, cancel-during-rehydration, late
  wall-clock outcomes, verification downgrade, persistence conflicts, and
  provider-neutral boundaries.
- Added `docs/architecture/swe-core.md` and updated the architecture index.
  The document records the required cooperative `AbortSignal` contract and
  the limit that a non-cooperative external adapter cannot be certified as
  cancellable merely from prompt intent.

## Tests/evals executed

- command: `bun --conditions=browser test tests/unit/swe-core.test.ts`
  - result: **17 pass, 0 fail, 61 assertions**.
- command:
  `bun --conditions=browser test tests/integration/resume.test.ts tests/integration/functional-acceptance.test.ts`
  - result: **31 pass, 0 fail, 120 assertions**.
- command: `bun run typecheck`
  - result: **exit 0**.
- command:
  `bunx prettier --check src/core/swe-core.ts tests/unit/swe-core.test.ts`
  - result: **exit 0**; focused implementation/tests are formatted.
- command: `bun --conditions=browser test`
  - result: **exit 1; 829 pass, 1 fail, 1 skip, 2,883 assertions, 831 tests**
    across 140 files.
  - sole failure: `tests/unit/code-review-agent.test.ts` expects `PASS` but
    observes `BLOCKED` because the dirty repository contains pre-existing
    trailing whitespace in TUI golden files and `git diff --check` blocks the
    review. No test was weakened and unrelated user work was not rewritten.
- repository-wide `bun run format:check` remains a known dirty-worktree
  failure from unrelated files; all Phase 5 implementation, test, and
  architecture-document files pass the scoped check.

## Real-model evidence

- No new real-model run was available for this phase. The exact local LM Studio
  evidence remains the Phase 1 run at:
  `C:\Users\Javie\.shelracode\evaluations\phase-01-final-secure-20260828\20260828T204358245Z-protocol-local-lm-studio-qwen2.5-coder-7b-instruct-b8942ac6-74d6-4a3c-a234-71e1d486d94c\manifest.json`.
- That run is `UNPROVEN` after `errorRecovery` failed, with replay integrity
  verified and no write authority. Phase 5 does not promote a model profile,
  infer capability from a model name, or claim real-model autonomy.
- `LegacyAgentRunner` is only a model/provider-neutral compatibility adapter;
  its deterministic host tests are not real-model evidence.

## Metrics

| Metric                          | Phase 5 observation                         |
| ------------------------------- | ------------------------------------------- |
| Focused Core tests              | 17 pass / 0 fail                            |
| Focused Core assertions         | 61                                          |
| Resume + functional integration | 31 pass / 0 fail                            |
| Full suite                      | 829 pass / 1 baseline fail / 1 skip         |
| Full-suite assertions/tests     | 2,883 / 831                                 |
| Typecheck                       | pass                                        |
| Scoped format                   | pass                                        |
| Operation exclusion             | run/step/resume mutually exclusive per task |
| Completion authority            | host outcome + verification only            |
| Legacy step authority           | unsupported; no `maxTurns: 1` emulation     |
| Real-model authority promotion  | none                                        |

## Risks / regressions

- The Core is a safe strangler seam, not yet the active TUI/database runtime.
  Application-service integration and paired old-vs-new real-model evaluation
  must precede removing the legacy path.
- Semantic executors and resume hooks must honor `AbortSignal`; the host timer
  aborts in-flight work and rejects late completion, but cannot forcibly stop a
  non-cooperative external process. Such an adapter must remain uncertified for
  cancellation until its boundary is tested.
- The existing dirty-checkout code-review failure and repository-wide format
  failure remain explicitly recorded. They predate this phase and were not
  hidden by changing tests or formatting unrelated files.

## Independent verification

- The read-only Phase 5 verifier reproduced the lifecycle contracts and issued
  **PASS** after reviewing the fixes for concurrent `resume`/`run`, concurrent
  `resume`/`resume`, wall-clock expiry during an awaited semantic step, and
  cancel during resume rehydration.
- It confirmed that the resume controller is installed before the first
  asynchronous persistence operation, the abort reaches the resume hook, the
  cancelled state is persisted, and the resume-to-run handoff cannot race a
  competing operation.
- It found no `maxTurns: 1` emulation, provider-brand branching, or new
  mega-manager in `src/core`.

## Gate decision

**PASS**

## Next phase eligibility

**YES** — Phase 6 is eligible to implement the Context Capsule compiler and
bounded Legal Actions. Semantic/vector retrieval remains out of scope until
the required context and repository-intelligence gates are measured.
