# Minimal SWE Core boundary

Phase 5 adds `src/core/swe-core.ts` as a small, provider-neutral lifecycle
service. It owns task registration, operation exclusion, cancellation, bounded
run budgets, immutable inspection snapshots, and the status transition that
follows an injected host outcome.

The public lifecycle is:

```text
startTask -> ready
step      -> one genuine bounded decision (when supported)
run       -> bounded step sequence or one legacy whole-run execution
cancel    -> host abort + persisted cancelled state
inspect   -> deep-cloned authoritative snapshot
resume    -> same task ID/runtime, then a fresh bounded run
```

## Explicit boundaries

`SweDriverBoundary` chooses one normalized semantic decision. It does not
expose provider response objects. `SweExecutionBoundary` owns side effects and
policy checks. `SweVerificationBoundary` owns objective proof and decides
whether the complete task is actually satisfied. The Core composes those ports
only when all three are supplied.

`SweTaskExecutor` is the compatibility port for an existing whole-run engine.
`LegacyAgentRunner` adapts `runAgent` without copying its lifecycle authority
into the Core. It intentionally does not implement `step`: the legacy loop's
turn-local recovery, completion, and continuation state cannot be represented
honestly by calling it with `maxTurns: 1`. The Core returns the typed
`STEP_UNSUPPORTED_BY_RUNNER` result instead.

## State and persistence

`TaskStateService` clones snapshots at every boundary and delegates persistence
to `TaskRuntimeRepository`. The default in-memory implementation is
deterministic for host tests; a production application can inject a repository
adapter. A task snapshot may carry the existing versioned
`TaskRuntimeSnapshot`, including ledger obligations, route identity, evidence
anchors, and in-flight markers. Runtime identity, task ID, objective, and
workspace root are checked before a snapshot is accepted.

The Core persists a `ready` task before any executor call and persists the
`running` state before execution. Persistence conflicts are surfaced rather
than overwritten or converted into a fake task failure.

## Completion and recovery limits

An executor outcome marked `completed` without `verified: true` is downgraded
to a host `blocked` state with reason `unverified_completion`. The model or
legacy runner cannot self-certify completion. A run that exhausts its
step/wall-clock budget is also blocked with explicit evidence. Recovery policy,
repository intelligence, context compilation, route selection, and provider
composition remain outside this boundary for later phases.

The Core installs a host-owned `AbortController` before the first asynchronous
resume operation. Cancellation during rehydration therefore reaches the resume
hook and is persisted as `cancelled`; resume hooks and semantic executors must
cooperate with the signal. Wall-clock timers abort the signal while a decision
is in flight and a late outcome is never accepted as completion. A
non-cooperative external process may still consume resources until its adapter
enforces the signal at its own boundary, so such adapters cannot be certified
as cancellable until that contract is tested.

## Strangler migration

The current TUI and `runAgent` path remain intact. Phase 5 does not move route
discovery, repository context, permission dialogs, checkpoint composition, or
verification callbacks into a new mega-manager. The next integration step is
to inject the prepared task and legacy runner from an application service,
then compare the Core path against the existing path on the same deterministic
and real-model evidence without changing model-brand behavior.
