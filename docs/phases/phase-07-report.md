# Phase 7 Report

**Phase:** Build Repository Intelligence Levels 1-3  
**Evidence snapshot:** 2026-08-29, `America/Santo_Domingo`  
**Source revision:** `230b5575a592897fa113e3d05407e6f93e4f01da`  
**Worktree:** dirty user work preserved; no staged changes

## Repository evidence

- `src/context/repository-snapshot.ts`, `src/context/repository.ts`, and the
  existing `src/context/repository-intelligence.ts` are the live host-owned
  repository-fact path. The Phase 7 work extends that path without wiring a
  new query service into the legacy loop or TUI.
- The pre-existing intelligence index was a bounded lexical structural index,
  not a compiler AST. Phase 7 preserves that honest boundary and documents
  declarations/imports as heuristic syntax structure.
- Existing context integration tests exercise privacy filtering, objective
  relevance, and `.shelracode` runtime-state exclusion. No vector database or
  semantic retrieval dependency was present or added.

## Changes

- Extended `src/context/repository-intelligence.ts` with explicit generated,
  vendor, and runtime exclusions, PowerShell function facts, host-capped
  positive-integer limits, per-fact truncation tracking, and realpath-based
  symlink containment. Privacy and exclusion policy is reapplied to a resolved
  in-workspace symlink target before reading it.
- Added `src/context/repository-queries.ts` with a provider-neutral
  `RepositoryQueryService` for symbol, definition, reference, implementation,
  caller, dependency/dependent, related-test, and diagnostics queries.
- Added bounded query input validation, composed service/per-call
  cancellation, stable degraded fallbacks, strict provider-result
  normalization, and field-by-field output reconstruction. Dependency results
  expose the import module specifier as `importSource` while retaining the
  query-result provenance marker as `source`.
- Exported the query boundary from `src/context/index.ts` and documented the
  Levels 1-3 architecture in `docs/architecture/repository-intelligence.md`.
- Added regression coverage for provider-shape isolation, unsafe provider and
  query paths, cancellation races, integer limits, symbol/reference
  truncation, symlink escapes, generated/vendor/runtime exclusions, and
  PowerShell indexing.

## Tests/evals executed

- command: `bun --conditions=browser test tests/unit/repository-intelligence.test.ts tests/unit/repository-queries.test.ts`
  - result: **13 pass, 0 fail, 55 assertions**.
- command: `bun --conditions=browser test tests/integration/context-relevance.test.ts tests/integration/privacy-context.test.ts tests/unit/repository-intelligence.test.ts tests/unit/repository-queries.test.ts`
  - result: **23 pass, 0 fail, 99 assertions**.
- command: `bun run typecheck`
  - result: **exit 0**.
- command: `bunx prettier --check src/context/repository-intelligence.ts src/context/repository-queries.ts tests/unit/repository-intelligence.test.ts tests/unit/repository-queries.test.ts src/context/index.ts docs/architecture/repository-intelligence.md docs/architecture/index.md`
  - result: **exit 0**.
- command: `git diff --check -- src/context/repository-intelligence.ts src/context/repository-queries.ts tests/unit/repository-intelligence.test.ts tests/unit/repository-queries.test.ts docs/architecture/repository-intelligence.md docs/architecture/index.md src/context/index.ts`
  - result: **no Phase 7 whitespace errors**; Git emitted only its normal LF/CRLF working-copy warning.
- command: `bun --conditions=browser test`
  - result: **exit 1; 846 pass, 1 fail, 1 skip, 2,973 assertions, 848 tests**
    across 142 files.
  - sole failure: `tests/unit/code-review-agent.test.ts` expects `PASS` but
    observes `BLOCKED` because the dirty repository contains pre-existing
    trailing whitespace in TUI golden files and `git diff --check` blocks the
    review. This is the same known baseline failure recorded by earlier phase
    reports; no test was weakened and unrelated user work was not rewritten.

## Real-model evidence

- No new real-model run was available for this phase. The exact local LM
  Studio evidence remains the Phase 1 run at:
  `C:\Users\Javie\.shelracode\evaluations\phase-01-final-secure-20260828\20260828T204358245Z-protocol-local-lm-studio-qwen2.5-coder-7b-instruct-b8942ac6-74d6-4a3c-a234-71e1d486d94c\manifest.json`.
- That run is `UNPROVEN` after `errorRecovery` failed, with replay integrity
  verified and no write authority. Repository intelligence does not infer
  model capability or promote authority.
- Deterministic repository and query tests prove host behavior only; they are
  not autonomous real-model evidence.

## Metrics

| Metric | Phase 7 observation |
| --- | --- |
| Focused repository/query tests | 13 pass / 0 fail |
| Focused assertions | 55 |
| Context/privacy integration plus Phase 7 tests | 23 pass / 0 fail |
| Full suite | 846 pass / 1 baseline fail / 1 skip |
| Full-suite assertions/tests | 2,973 / 848 |
| Typecheck | pass |
| Scoped format | pass |
| Query operations | 9 normalized host/provider-neutral operations |
| Default index bounds | 256 files / 2,000 symbols / 1,000 imports / 2,000 references |
| Provider fallback | stable deterministic fallback with `degraded: true` |
| Real-model authority promotion | none |

## Risks / regressions

- Syntax extraction remains heuristic and non-compiler-grade. Reliable
  language-provider relations remain optional and degrade to deterministic
  facts when unavailable or malformed.
- Provider arrays are normalized before the final result slice; a maliciously
  oversized provider response could cause transient memory pressure. A later
  provider boundary may need streaming/early-cap handling.
- `truncated` is an aggregate signal rather than per-collection provenance.
- If the workspace root cannot be resolved with `realpath`, the index is empty
  without a separate degraded reason. The later ExecutionBroker/evidence layer
  should make that condition explicit.
- The known dirty-worktree code-review failure and repository-wide formatting
  failure remain outside this phase's scope.

## Independent verification

- The read-only Phase 7 verifier initially found provider-shape leakage,
  cancellation composition gaps, weak limits, false truncation reporting, and
  symlink-policy gaps. All findings were fixed before the gate.
- Final adversarial checks reproduced that provider extras and unsafe
  `../`, colon/ADS, and control-character paths are rejected or degraded with
  stable warnings; ordinary provider errors preserve an aborted signal;
  symbols/imports/references report truncation; exact-limit import-plus-usage
  indexing reports `truncated: true`; and an in-workspace alias to vendor
  content is not indexed.
- Final independent result: **PASS**. It also confirmed no premature loop/TUI
  wiring, no vector retrieval dependency, and no compiler-AST overclaim.

## Gate decision

**PASS**

## Next phase eligibility

**YES** - Phase 8 is eligible to make completion proof-backed with
`AcceptanceObligation` and `EvidenceRecord` enforcement. Semantic/vector
retrieval remains optional and gated by paired evaluation.

