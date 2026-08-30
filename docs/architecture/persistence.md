# Durable task state and resume

Phase 11 makes the runtime envelope, rather than the chat transcript, the
source of truth for restart. `TaskRuntimeSnapshot` is persisted transactionally
by `LocalCodeDatabase.saveAgentRuntime()` and restored through
`restoreTaskRuntime()` before a task can run again.

## Durable envelope

The envelope carries:

- the stable task ID, objective ledger, repository root, revision, and bounded
  working-tree paths;
- route identity, including the optional exact Driver profile ID, identity
  digest, and configuration digest;
- context anchors for source, instruction, memory, and proof-gap reload;
- the active checkpoint ID, if a mutation baseline exists;
- canonical redacted Acceptance evidence for the task;
- bounded recovery observations plus cumulative observation/attempt counters;
- an in-flight marker for operations that crossed a process boundary;
- a monotonic update revision and timestamp.

Raw prompts, model output, chain-of-thought, and raw tool output are excluded by
the runtime serializer. Acceptance evidence is normalized and secret-scrubbed
on restore; malformed or conflicting records are rejected before resume.

## Resume invariants

1. The requested task ID and objective must match the persisted ledger.
2. The repository root and saved revision/working-tree paths are checked by the
   host before the loop resumes. Drift in task-owned paths invalidates stale
   proof and requires fresh observations; unsafe drift blocks resume.
3. A persisted mutation/tool/verification marker stays in the envelope until
   the tool result, action, evidence, and checkpoint observation are committed.
   If the process dies in that window, resume records interrupted recovery and
   never replays the operation automatically.
4. Recovery history is reconstructed with the same bounded policy counters. A
   repeated failure cannot reset its budget merely because the process died.
5. A partial exact Driver reference is invalid. Resume revalidates the current
   certified profile, identity digest, candidate/runtime metadata, expiry, and
   configuration digest; missing or changed facts drop the reference and never
   receive write authority from a runtime snapshot.
6. A checkpoint ID must exist in the current checkpoint store. An unknown ID is
   not considered preserved, and resume blocks before executing a task that
   depends on a missing baseline.
7. Database writes reject an older update revision, and each accepted envelope
   is validated again after serialization.

The current implementation uses the existing ledger as the authoritative task
state and stores the canonical Acceptance projection alongside it. The model
never authors either state; it receives only a compiled view after rehydration.

## Evidence boundary

`src/evidence/acceptance.ts` remains the live projection/evaluation boundary.
The durable envelope stores its redacted per-task records so a restart retains
the proof references used by the completion controller. Completion still
recomputes proof from the restored ledger and host observations; a persisted
record is not accepted as proof merely because the model claims success.

## Tests

The Phase 11 resume suite covers:

- recovery detector counter/history restoration;
- exact Driver/checkpoint/evidence round-trips and malformed-state rejection;
- close/reopen of a file-backed SQLite database;
- objective/task identity continuity;
- interrupted mutation recovery without replay;
- post-execute/pre-commit mutation-marker ordering;
- unknown-checkpoint preservation rejection and checkpoint continuity after
  SQLite close/reopen;
- fail-closed exact Driver reference revalidation;
- repository drift handling and compaction envelope persistence.
