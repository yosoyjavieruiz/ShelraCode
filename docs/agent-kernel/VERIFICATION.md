# Verification and Completion

Coding verification follows a host-owned plan discovered from package scripts,
recognized Make/Just/Task targets, common ecosystem manifests, and explicitly
documented safe command lines in `AGENTS.md`, README files, and GitHub Actions
workflows. Package scripts retain priority. The current TUI selects the first
configured command for each available stage, in this order:

```text
test -> typecheck -> lint -> build
```

The plan is persisted in `AgentTaskLedger.verificationPlan`. Every stage is
recorded as a `VerificationRun` with its stage, command, exit code, counts,
failures, duration, and concise output. The host stops at the first failed
stage, returns that evidence to the model, and invalidates the plan after a
later mutation so the full plan runs again. A failed test or check is an
observation; it is not terminal task failure.

Completion has two host-owned gates:

- `evaluateCompletionGate()` requires objective output, repository evidence,
  every required verification stage, final review, no blockers, and preserved
  user work.
- `independentlyVerifyTask()` rechecks the ledger read-only for evidence,
  changed files, the latest result for every planned verification command,
  blockers, and checkpoint preservation.

Model generation ending is not completion. Provider failures become `failed`,
recoverable tool failures continue, watchdog exhaustion becomes `blocked`, and
abort becomes `cancelled`.

## Semantic criteria authority - 2026-08-24

Explicit caller-provided criteria are now a separate completion input. A
green verification command proves the command result, not every requested
repository change. `verifySuccessCriteria` must read the relevant workspace
and return the satisfied criterion IDs; without that hook, an explicit-
criteria coding task fails closed. The regression
`explicit criteria are not auto-satisfied by one mutation and green
verification` protects against the observed partial-completion bug.

The TUI's generic coding criteria are deliberately structural rather than
semantic: `verifyStructuralCodingCriteria` proves that a mutation was
recorded, configured checks passed, the final Git diff/status review succeeded,
and the checkpoint still preserves pre-existing work. A task-specific caller
can add stronger file/symbol/behavior checks through `verifySuccessCriteria`;
the kernel never treats a green test alone as proof of every requested change.
