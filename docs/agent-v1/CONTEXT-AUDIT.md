# Context and evidence audit

## Current path

The repository context compiler is in src/context/repository.ts and the
snapshot builder is in src/context/repository-snapshot.ts. The inspected path
discovers Git-listed files, manifests, language extensions, source/test roots,
build and instruction files, and bounded command facts.

For direct repository fact questions, the current path uses
isDirectRepositoryFactQuestion and prioritizes root facts. It does not load
the full scoped agent-harness Skill for the language question. The functional
acceptance test also injects a hostile EditFile attempt and proves the
read-only policy rejects it.

## Context controls

| Control                                | State            | Evidence                                                                                            |
| -------------------------------------- | ---------------- | --------------------------------------------------------------------------------------------------- |
| Manifest-first language evidence       | Active           | repository context/snapshot source and language regression                                          |
| Search before broad reads              | Active           | SearchText/GlobFiles tools and context strategies                                                   |
| Scoped AGENTS/CLAUDE instructions      | Active           | src/context/instructions.ts                                                                         |
| Skill metadata/full-content separation | Partial          | .agents is excluded from ordinary repository context; a full on-demand Skill runtime was not proven |
| Bounded context                        | Active           | maxChars/output limits and host prompt budget                                                       |
| Evidence ledger                        | Active, partial  | evidence refs and provenance exist in task/context paths                                            |
| Sufficiency gate                       | Active, partial  | gate exists but generic evidence presence can be weaker than task-specific relevance                |
| Freshness precedence over memory       | Partial/unproven | provenance types exist; durable retrieval/freshness journey was not run                             |

## Current risk

The language question regression is fixed, but the next audit should test
conflicting manifests, stale memory, large noisy repositories, and a symbol
lookup where the first search result is irrelevant. The current source proves
the mechanism; it does not prove every evidence strategy.

## Current-source continuation — 2026-08-25

Objective relevance is now active in `src/context/repository.ts`: meaningful
objective terms are searched with bounded `rg` arguments, matching files are
promoted before broad reads, and ignored credential paths are removed from the
result. `tests/integration/context-relevance.test.ts` covers both promotion
and credential exclusion. The TUI rebuilds the context after route selection
so a 1.5B execution receives a compact evidence slice rather than the full
routing snapshot.
