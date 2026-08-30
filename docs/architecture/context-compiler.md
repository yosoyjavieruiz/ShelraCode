# Context Compiler and Legal Actions

Phase 6 adds a host-owned `ContextCapsule` boundary for one model decision.
The capsule is a compiled view of authoritative task state; it is not the task
database, the conversation transcript, or a source of authority supplied by the
model.

## Boundary

`src/context/context-capsule.ts` provides:

- typed task, requirement, verification, repository, instruction, and budget
  fields;
- required acceptance obligations and recovery state on every consequential
  decision;
- a bounded `LegalAction` descriptor set derived from capability level,
  task state, remaining action budget, and caller-supplied policy;
- a closed output schema containing only action kinds legal for this decision;
- host-side `validateLegalAction` checks for action membership, repository
  paths, scopes, ranges, evidence references, and structured patch shape;
- deterministic rendering, token estimates, omitted optional sections, and a
  SHA-256 digest that can be inspected before the capsule is sent to a model.

The controller must compile the capsule from trusted state and policy. A model
claim, prompt instruction, or generated state cannot grant write, execution,
network, or completion authority.

## Context policy

The renderer always retains task identity, acceptance obligations, authoritative
state, legal actions, output protocol/schema summary, and budgets. Repository
facts and instructions are optional sections and may be omitted when the
configured input budget cannot fit them. Omission is explicit in
`omittedSections`; it never silently removes required obligations or forbidden
repeats.

This phase deliberately does not add semantic/vector retrieval, change the
legacy `ContextPacket` compiler used by the current agent loop, or wire the new
capsule into the TUI. The existing compiler remains a compatibility path while
the Core and Driver seams are migrated behind measured evaluations.

## Capability and policy

Capability levels (`C0` through `C6`) describe measured driver behavior; the
capsule receives the already-certified level and execution profile from its
caller. It does not certify a model or promote authority. A C0 capsule has no
repository actions, while higher levels may expose progressively broader
read, edit, verify, expert, and completion actions only when the corresponding
policy flags are true.

`task.complete` is exposed only after all required obligations are satisfied and
the host verification state says they are satisfied. The model cannot complete
by emitting a `DONE` string. Every completion action still carries proof
evidence references for the completion controller to verify.

## Integrity and migration

`inspectContextCapsule` recomputes both the host digest and derived rendering.
Consumers should reject a capsule whose digest, rendered text, token estimate,
or omission list no longer matches. The digest covers normalized task,
requirements, state, repository, instructions, actions, output schema, and
budget, but not derived text.

The capsule is intentionally a pure context boundary. Integration with
`SweCore`, repository intelligence Levels 1--3, persistence, and the live
provider loop is gated by the later roadmap phases and must preserve the
legacy path until paired real-model evidence demonstrates an improvement.
