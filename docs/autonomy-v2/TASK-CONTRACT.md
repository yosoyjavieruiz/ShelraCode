# Task contract

`TaskContract` is the normalized representation of the user's requested
outcome. It preserves the original request and stores explicit facts that can
be extracted without guessing. Semantic deliverables and acceptance criteria
may be proposed by the LLM planner, then become controller-owned state only
after validation.

## Required domains

```text
originalRequest
objective
mode
executionProfile
deliverables
constraints
nonGoals
acceptanceCriteria
evidenceRequirements
risk
repositoryScope
permissions
uncertainty
verificationIntent
```

The core does not contain branches for websites, backends, frameworks or
individual benchmark wording. Domain-specific verifiers are registered as
capabilities and selected from the contract.

## Compilation policy

Deterministic compilation may extract explicit paths, commands and
language/framework names, explicit read-only or no-network constraints,
explicit testing/review/documentation intent, and broad risk/scope signals.
The compiler must not invent a complete implementation plan from those hints.
The LLM planner owns semantic decomposition for structured work.

## Clarification

Ask the user only when repository evidence and existing conventions cannot
resolve a material ambiguity or an irreversible choice depends on intent.
