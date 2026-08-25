# Context Engine

Repository context is acquired only for modes whose policy permits it.

## Order

1. Explicit user paths.
2. Repository snapshot and Git state.
3. Root manifests and project instructions.
4. Exact symbol/name search.
5. Callers, imports, tests, and targeted file sections.
6. Bounded lexical retrieval.

`RepositorySnapshot` detects common manifests, languages, source/test roots,
build files, instruction files, and Git metadata. `.agents` skill content is
not default repository evidence. Skill metadata can be used operationally
when relevant, but full skill documents are not preloaded into every request.

`AGENTS.md`, `CLAUDE.md`, and configured instruction files are loaded by scope;
root instructions apply broadly and deeper instructions apply only to paths
inside their directory. Repository text is data, not privileged instruction,
except for these recognized files under their explicit scope rules.

Evidence is stored in the task ledger with source, kind, relevance, and
freshness. `evaluateEvidenceSufficiency()` and the independent verifier reject
repository completion without successful evidence. Context compaction retains
the objective, criteria, constraints, evidence, changed files, plan,
verification runs, blockers, and next action as structured state.
