# Repository Intelligence Levels 1-3

Phase 7 keeps repository intelligence host-owned and layered:

1. **Level 1 - deterministic facts:** repository file paths, manifests,
   language/source/test roots, Git state, bounded file discovery, and the
   existing `RepositorySnapshot`/search services.
2. **Level 2 - syntax structure:** bounded, non-executing declaration/import
   indexing in `repository-intelligence.ts` for the supported language
   families. It records symbols, signatures, imports, references, and related
   tests without claiming compiler-grade semantics.
3. **Level 3 - code relations:** `RepositoryQueryService` exposes normalized
   `findSymbol`, `findDefinition`, `findReferences`, `findImplementations`,
   `findCallers`, `findDependencies`, `findDependents`, `findRelatedTests`,
   and `getDiagnostics` operations. An optional language provider may supply
   stronger definitions/references/implementations/callers/dependency and
   diagnostic results through the same neutral types.

## Selection and boundedness

`buildRepositoryIntelligence` indexes only caller-selected, safe, indexable
paths and applies file/symbol/import/reference limits. Generated, vendor,
runtime-state, and never-remote paths are excluded before indexing. The
selection helper ranks explicit paths, structural neighbors, imports, and
related tests instead of dumping the repository into model context.

`RepositoryQueryService` validates relative paths and result limits, bounds
every result, and returns a `source` marker. Deterministic fallbacks are
evidence, not authority for semantic claims; an empty implementation or
diagnostic result is marked degraded when no provider can establish it.
Dependency results keep the provider/import module specifier as `importSource`
so it cannot collide with the query-result provenance marker.

Provider facts are reconstructed field by field. Relative paths reject
traversal, never-remote files, control characters, and Windows ADS-style
colons before a result can cross the query boundary. Index reads resolve
symlinks and reapply workspace privacy/exclusion policy to the real target.

## Provider failure

Provider calls are optional and cancellation-aware. A non-abort provider error
never becomes an unhandled model-visible exception: the service returns the
bounded deterministic result with `degraded: true` and a stable warning. Abort
signals remain aborts. Provider-specific objects and errors do not cross the
normalized query boundary.

This phase does not add vector/embedding retrieval, execute repository code to
build an index, or make an LSP provider a mandatory dependency. Promotion of
Level 4 semantic retrieval remains gated by paired evaluation against the
deterministic Levels 1-3 baseline.
