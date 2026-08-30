# Typed recovery and anti-loop behavior

Phase 9 adds a bounded recovery policy to the existing host-owned agent loop.
The model may propose a next action, but it cannot choose to retry forever or
override a security boundary.

## Failure classes

`src/agent/recovery.ts` normalizes tool, provider, verification, controller,
and model failures into a stable `FailureClass` taxonomy. The taxonomy keeps
protocol/schema failures separate from semantic failures and from environment
or security failures. Raw messages remain evidence; they are not the policy
surface.

## Signatures and loop detection

Each observation is represented by a SHA-256 signature of:

- action kind;
- a digest of normalized arguments;
- host-owned progress state digest; and
- failure class.

Raw arguments are not stored in the detector snapshot. A repeated signature,
repeated no-progress failure class, security failure, or policy budget limit
produces a typed stop reason. A meaningful host progress observation breaks the
consecutive failure streak and does not consume the recovery-attempt budget.

## Recovery policy

`RecoveryPolicy` is bounded by per-signature, per-failure-class, and total
failure/no-progress-attempt limits. `evaluateRecovery` selects an untried strategy such as
`relocalize`, `change_representation`, `rollback`, `ask_expert`, or
`switch_model`. After repeated failure it refuses `retry_same`; security and
cancellation are always terminal.

The legacy serialized `RecoveryStrategy` vocabulary remains for compatibility
with existing task snapshots. New contracts may additionally record the typed
failure class, state digest, semantic strategy, and whether the strategy
changed. This lets compaction and future durable resume preserve why recovery
was attempted without changing the old planner schema.

## Loop integration

The live `runAgent` path creates one detector per task and records typed failure
metadata for every failed tool/verification observation. Existing forced-read,
append-only replan, mutation-stagnation, and completion recovery paths remain
the concrete execution mechanisms. The policy annotates and bounds those paths;
it does not grant a failed model a broader tool or security surface.

Compatibility execution with no semantic planner records a recovery contract
and finishes as a truthful blocker when no safe host recovery is available.
Model-planning execution may append a replacement node, but the replacement
must remain scope-validated and auditable.
