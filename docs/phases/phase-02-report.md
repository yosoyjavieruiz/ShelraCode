# Phase 2 Report

**Phase:** Create exact model identity and Driver profile schema  
**Evidence snapshot:** 2026-08-29, `America/Santo Domingo`  
**Source revision:** `230b5575a592897fa113e3d05407e6f93e4f01da`  
**Worktree:** dirty user work preserved; no staged changes

## Repository evidence

- Before this phase, the reusable capability cache was keyed by only
  `(providerId, modelId)`. Its probe environment checked several dimensions,
  but there was no persisted profile schema for the complete runtime/artifact
  configuration or its authority.
- SQLite schema version was 4 and `model_capabilities` remains the compatibility
  store for the existing probe result. Phase 2 adds a separate
  `model_driver_profiles` table rather than silently changing the meaning of
  old capability records.
- Phase 1 already records observed-or-unknown model/runtime fields in immutable
  evaluation manifests. Phase 2 reuses the same principle in a domain Driver
  contract: unavailable facts are explicit `null`, never inferred from a
  display label.

## Changes

- Added `src/driver/profile.ts` with a versioned `ExactModelIdentity` covering
  provider family, wire model ID, artifact/hash, parameter class,
  quantization, runtime/version, endpoint and tool/structured-output
  configuration, tokenizer/reasoning mode, context/sampling configuration,
  operating system, hardware fingerprint, and observation timestamp.
- Added canonical identity hashing. Object-key order is normalized and only
  `createdAt` is excluded because it is observation time, not configuration;
  material changes produce a new digest.
- Added strict `ModelDriverProfile` parsing and construction with the roadmap
  fields: schema version, identity digest, lifecycle status, C-level,
  protocol/edit selections, certified tool/context/action budgets, reasoning,
  recovery policy, evidence references, expiry, and authority fields.
- Added explicit uncalibrated profiles (`C0`, unselected protocol/codec,
  zero write/network authority) and a host-side `driverProfileCanWrite()`
  check that fails closed for invalid, mismatched, expired, or non-certified
  profiles.
- Added SQLite schema version 5, profile upsert/read/list methods, exact
  identity lookup, and persisted invalidation. When a new material identity is
  observed for the same provider/model, prior profiles are retained for audit
  but changed to `invalidated` with both authority fields set to `none`.
- Added database reopen/migration tests and documented the boundary in
  `docs/architecture/shelra-driver.md`.
- No protocol optimization, edit-codec selection, route change, or write
  authority promotion was introduced in this phase.

## Tests/evals executed

- command:
  `bun --conditions=browser test tests/unit/driver-profile.test.ts tests/unit/storage.test.ts tests/unit/capability-cache.test.ts`
  - result: 22 pass, 0 fail, 93 assertions.
- command: `bun run typecheck`
  - result: exit 0.
- command:
  `bunx prettier --check src/driver/profile.ts src/storage/database.ts tests/unit/driver-profile.test.ts tests/unit/storage.test.ts docs/architecture/shelra-driver.md`
  - result: exit 0; all Phase 2 files are formatted.
- command: `bun --conditions=browser test`
  - result: exit 1; 787 pass, 1 fail, 1 skip, 2,691 assertions, 789 tests
    across 137 files.
  - sole failure: `tests/unit/code-review-agent.test.ts` expects `PASS` but
    observes `BLOCKED` because its fixture uses the dirty repository root and
    `git diff --check` finds pre-existing trailing whitespace in golden TUI
    files. This is the recorded Phase 0 baseline failure; it was not weakened
    or hidden.
- command: `bun run format:check`
  - result: exit 1; Prettier reports 110 existing/worktree files. Only the
    Phase 2 scope was formatted.
- command: `bun --conditions=browser test tests/unit/driver-profile.test.ts tests/unit/storage.test.ts`
  - result: 18 pass, 0 fail, 86 assertions, including profile persistence
    across close/reopen and schema version 5.

## Real-model evidence

- No new inference or protocol calibration was run in Phase 2 by design. The
  Phase 1 exact local trial remains the current real-model evidence and is
  stored at:
  `C:\Users\Javie\.shelracode\evaluations\phase-01-final-secure-20260828\20260828T204358245Z-protocol-local-lm-studio-qwen2.5-coder-7b-instruct-b8942ac6-74d6-4a3c-a234-71e1d486d94c\manifest.json`.
- That trial was `UNPROVEN` for `qwen2.5-coder-7b-instruct`/LM Studio Q6_K
  because `errorRecovery` failed; its replay was `MATCH` with 8/8 provider
  requests consumed. It did not grant a Driver profile or write authority.
- A Phase 2 profile created for an observed configuration therefore remains
  uncalibrated unless separately promoted by later measured evidence.

## Metrics

| Metric                           | Phase 2 observation                                                   |
| -------------------------------- | --------------------------------------------------------------------- |
| Exact identity material fields   | 18 plus explicit timestamp                                            |
| Identity digest stability        | same configuration / different `createdAt`: pass                      |
| Identity invalidation dimensions | quantization, runtime, template, context, sampling, hardware: covered |
| Uncalibrated write authority     | denied                                                                |
| Uncalibrated network authority   | denied                                                                |
| Profile parser                   | strict schema and digest validation: pass                             |
| SQLite schema                    | migrated/persisted as version 5                                       |
| Profile reopen persistence       | pass                                                                  |
| Phase 2 focused tests            | 22 pass / 0 fail                                                      |
| Full suite                       | 787 pass / 1 baseline fail / 1 skip                                   |
| Scoped format                    | pass                                                                  |
| Repository-wide format           | fail; 110 dirty/worktree files                                        |
| New model authority              | none                                                                  |

## Risks / regressions

- Profiles are persisted and invalidated, but are not yet the source of route
  selection or ExecutionBroker authority. That integration belongs to later
  gates; no existing capability cache behavior was removed.
- Identity lookup invalidates every stored variant for the same provider/model
  when a material mismatch is observed. This is fail-closed and preserves
  audit data, but later runtime selection may refine variant scoping before
  promoting profiles automatically.
- Unknown artifact hashes, runtime versions, templates, tokenizers, and
  hardware details remain unknown when the adapter cannot expose them. The
  profile cannot claim those facts.
- The existing dirty-checkout full-suite failure and global format failure
  remain explicitly recorded. No unrelated user files were rewritten.

## Independent verification

- A focused read-only review inspected the identity/profile implementation,
  SQLite methods, tests, and documentation, and checked malformed-storage
  fail-closed behavior, exact digest invalidation, authority downgrades, and
  migration/reopen evidence.
- final status: `PASS`. The independent review verified all material identity
  fields and explicit unknowns, stable digest behavior, strict parser and
  authority containment, a real v4-to-v5 migration, reopen persistence,
  identity mismatch invalidation, and corrupt JSON rejection. Its selected
  driver/storage command passed 18 tests with 86 assertions; typecheck and
  scoped Prettier also passed. No repository file was modified by the
  verifier.

## Gate decision

PASS

## Next phase eligibility

YES — Phase 3 is eligible for protocol calibration; it must not assume a
profile is certified merely because this schema exists.
