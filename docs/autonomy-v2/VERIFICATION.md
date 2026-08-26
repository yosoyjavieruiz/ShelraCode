# Verification and proof-based completion

Project health and objective satisfaction are separate.

Project checks may include tests, typecheck, lint and build. Objective
verification uses the task contract, changed artifacts, available verifier
capabilities and evidence ledger to establish whether the requested outcome is
observable.

Every criterion can be:

```text
PASS | FAIL | NOT_APPLICABLE | UNAVAILABLE | INCONCLUSIVE
```

`NOT_APPLICABLE` is not failure. `UNAVAILABLE` is not success. Completion must
require applicable mandatory evidence or a truthful blocked state with a
recovery path.

The model may propose completion, but only the controller can accept it after
checking deliverables, criteria, verification, blockers, scope and user-work
preservation.
