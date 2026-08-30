# Evidence and proof-backed completion

ShelraCode completion is a host decision, not a model declaration. The
canonical boundary lives in `src/evidence/acceptance.ts` and has four parts:

- `AcceptanceObligation` describes one required, typed outcome and its optional
  verifier reference.
- `EvidenceRecord` describes one redacted host observation. Model prose and
  semantic `decision` entries are not admissible evidence.
- `InMemoryEvidenceStore` provides bounded, clone-on-read storage with
  conflict detection and a versioned snapshot shape. Durable task-state
  persistence is mirrored by the Phase 11 runtime envelope as a redacted
  per-task projection.
- `evaluateProofBackedCompletion()` recalculates obligation status from linked
  evidence and rejects a claimed `satisfied` status without proof.

The existing `TaskContract` and task ledger remain the controller's source of
truth. `compileAcceptanceObligations()` adapts those structures into stable
namespaced IDs (`deliverable:`, `criterion:`, and `evidence:`). The live agent
loop derives canonical evidence from host ledger observations and passes the
assessment into `evaluateCompletionGate()`. Existing objective-proof checks
remain in place; the new layer makes their evidence contract explicit and
machine-readable rather than replacing them.

## Evidence rules

Required obligations must have a linked `EvidenceRecord` with a matching
obligation ID. A successful command/test/build/type/security/performance
record requires an explicit zero exit code. A review can be proven by a
host-produced diff review or human evidence; documentation requires a bounded
artifact reference. Non-zero command evidence is retained as a failed proof,
not silently discarded.

Evidence is normalized and secret-scrubbed before storage or evaluation. Store
reads and snapshots are defensive clones, and reusing an evidence ID with
different content is rejected. Caps prevent an unbounded model/provider stream
from becoming task state.

## Completion semantics

`task.complete` or a natural-language “done” message is only an input to the
controller. The completion gate requires the ordinary task evidence,
verification, review, preservation, and objective-proof checks plus the
canonical acceptance assessment when a task contract is active. If a caller
marks completion while a required obligation is pending or failed, the
assessment reports `falseSuccess: true` and exposes the missing obligation and
concrete evidence references for the report.

The runtime persists canonical records together with task identity, repository
snapshot, checkpoints, and recovery history before resume is allowed. Proof is
still recomputed from restored host state; a persisted record is not accepted
merely because the model claims completion.
