# ShelraCode Adaptive Autonomy v2

## Decision

ShelraCode uses a deterministic software-engineering control plane around a
probabilistic model. The model is the semantic planner and worker for the
current bounded decision. ShelraCode remains authoritative for permissions,
workspace scope, lifecycle, evidence, verification, retries, cancellation and
completion.

This is adaptive: a greeting does not create a task graph, a small bounded edit
can use a direct/linear loop, and a migration or cross-module change can use a
structured or decomposed plan.

## LLM-defined plan authority

The semantic plan is proposed by the LLM through a structured `PlanProposal`.
The controller does not generate a fixed tree of task names to stand in for
the model's understanding of the objective.

The controller validates the proposal before accepting it:

- objective and explicit constraints are preserved;
- node IDs are unique and dependencies are acyclic;
- scope stays inside the workspace and requested permissions;
- only exposed tools/actions are referenced;
- read-only modes contain no mutation action;
- evidence and verification requirements are bounded and observable.

The plan is monotonic. Once accepted, a node or criterion is retained in the
plan history. A replan adds a revision with new node IDs and may explicitly
supersede an earlier node. It cannot silently delete or rewrite the previous
decision. Deterministic controller recovery can record a recovery contract,
but semantic repair work returns through the LLM planner when the selected
profile requires model planning.

```text
objective -> TaskContract -> adaptive profile -> LLM PlanProposal
          -> host validation -> monotonic TaskGraph revision
          -> bounded worker decision -> typed observation/evidence
          -> node verification -> model replan/controller recovery
          -> proof-based completion
```

## Boundaries

```text
TUI / CLI
  -> application services
  -> Agent Kernel
       -> TaskCompiler / ExecutionProfileSelector
       -> PlanProposalAdapter
       -> TaskGraph/Scheduler
       -> Context/TaskCapsule compiler
       -> Tool and Permission boundary
       -> Evidence/Verification
       -> Recovery/Completion
  -> Provider adapters
```

The kernel consumes normalized provider events. Provider-specific structured
output and malformed-call recovery stay at the provider/adapter boundary.

## Non-goals of this slice

This slice does not claim that a generic 1.5B model equals a frontier model. It
does not implement browser automation, a native local inference runtime,
product-level multi-agent execution or a complete semantic verifier for every
domain. Those require separate evidence and remain outside the current v0.1
scope.

## Evidence status

- **Verified locally:** existing multi-turn loop, typed tools, cancellation,
  checkpoints, context budgets, routing and deterministic verification.
- **Implemented in v2 slice:** generic contract/profile/planner domain,
  structured LLM plan protocol, monotonic plan validation/history and ledger
  integration covered by focused tests.
- **Partial:** full scheduler execution of arbitrary model-authored nodes,
  broad objective-specific verification, long-horizon resume, subagents and
  live 1.5B–14B generalization.
- **Unproven:** frontier-level autonomy or universal arbitrary-task success.
