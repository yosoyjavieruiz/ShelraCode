# ShelraCode Level-10 Agent Architecture

**Date:** 2026-08-26  
**Status:** Approved for phased implementation  
**Baseline:** `fb060621a3fd634e78d2689379fb30d7c24b79c2`

## Goal

Evolve ShelraCode from a bounded functional coding agent into a durable,
evidence-driven coding system that can accept an unfamiliar engineering
objective, gather the right repository context, execute bounded work, recover,
verify the requested outcome, and resume safely. The target is parity of
mechanisms with the public behavior of Claude Code and Codex; it is not a
claim that local models have frontier-model intelligence.

## Architecture principles

1. The host owns lifecycle, permissions, evidence, verification, persistence,
   and completion. Model output is a proposal, never proof.
2. The agent kernel remains provider-independent. Provider/runtime-specific
   wire formats stop at adapters.
3. Privacy and cost gates precede model quality. `STRICT_ZERO` never invokes a
   paid route, and no phase may weaken this invariant.
4. Every mutation remains path-bounded, checkpointed, cancellable, and
   recoverable without destructive Git rollback.
5. Durable task state has one canonical representation. UI state is a view of
   domain events and cannot decide completion.
6. Context is compiled per decision from bounded, relevant evidence. Memory,
   instructions, tool output, and repository data retain provenance and trust
   boundaries.
7. Each phase ships a real vertical slice with failing tests, passing tests,
   and an executable acceptance path before the next phase is accepted.

## Phase boundaries

### Phase 1 — Objective contract and truthful completion

Make deliverables, acceptance criteria, evidence requirements, and completion
proof authoritative host state. Model plans may enrich the contract but cannot
mark a deliverable complete. Missing or unavailable evidence must produce a
typed blocked/recovery result.

### Phase 2 — Repository intelligence and decision context

Add a bounded repository index for symbols, imports, references, related tests,
and language-aware file relationships. Feed a task-specific context packet to
each model decision and preserve a compact evidence trail rather than relying
on a growing transcript.

### Phase 3 — Durable task runtime

Persist and validate the complete ledger, graph, plan revisions, recovery
contracts, verification state, route identity, and context anchor. Resume must
continue the same task state after process restart; compaction must rehydrate
the same authority rather than restart from only the user text.

### Phase 4 — Process, network, and workspace safety

Centralize every child-process action behind a policy boundary with explicit
network intent, inherited cancellation, bounded output, environment filtering,
and the strongest available Windows isolation. Application policy and OS
enforcement must be reported separately when the platform cannot provide a
capability.

### Phase 5 — Skills and instruction hierarchy

Load scoped instruction metadata globally and full Skill content lazily. Apply
an explicit precedence/trust model for system, project instructions,
`AGENTS.md`, Skills, user input, memory, and repository data. Untrusted text
must not silently override policy or completion authority.

### Phase 6 — Isolated delegation

Introduce a bounded child-agent contract with fresh context, restricted tools,
independent cancellation, structured evidence, and parent incorporation. Add
parallel work only after ownership, worktree isolation, reconciliation, and
failure propagation are testable.

### Phase 7 — Product evidence and release closure

Build a heterogeneous disposable evaluation matrix across real local model,
runtime, template, quantization, artifact, and repository journeys. Publish
success, recovery, verification, resume, safety, and release metrics. Re-score
the product from fresh evidence; do not infer level 10 from unit coverage.

## Non-goals for this implementation

- No automatic paid inference or privacy-policy downgrade.
- No replacing Bun, TypeScript, OpenTUI, SolidJS, or `bun:sqlite` casually.
- No UI redesign as a substitute for kernel behavior.
- No self-approval based only on model prose.
- No destructive Git reset/checkout/clean behavior.
- No claim of Claude/Codex raw model parity for small local models.

## Definition of level-10 readiness

The product may only be described as `CLAUDE/CODEX-CLASS CODING AGENT` after
fresh evidence demonstrates high success across unseen heterogeneous tasks,
truthful objective verification, safe recovery, durable resume, bounded
context, process-level safety, and productive delegation. Passing a phase
raises capability only for the behavior covered by its evidence.
