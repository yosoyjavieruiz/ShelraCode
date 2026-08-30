# Phase 4 Report

**Phase:** Implement edit-codec calibration  
**Evidence snapshot:** 2026-08-28, `America/Santo_Domingo`  
**Source revision:** `230b5575a592897fa113e3d05407e6f93e4f01da`  
**Worktree:** dirty user work preserved; no staged changes

## Repository evidence

- The existing workspace mutation boundary is in `src/tools/workspace.ts` and
  already provides exact replacement, stale-state, checkpoint, and path
  protections. Phase 4 adds a pure calibration primitive beside that boundary;
  it does not replace the production workspace tools.
- `src/driver/profile.ts` already names the four candidate edit codecs. The
  calibration module compares those representations without selecting a
  production profile or granting write authority.
- Phase 3 established the paired-probe and typed-failure rules used here. The
  edit evaluator retains all observations but selects only from common paired
  probe cases.

## Changes

- Added `src/driver/edit-codec-calibration.ts` with host-owned encoders and
  validators for whole-file, search/replace, unified-diff, and structured-patch
  responses.
- Added independent parse validity, schema validity, argument validity, apply
  success, exact semantic correctness, stale rejection, no-progress, attempted
  failure, and payload-token measurements.
- Added expected-before SHA-256 guards for every payload. Structured patches
  require a valid nested digest that exactly matches the outer digest; unsafe
  paths, malformed payloads, ambiguity, overlapping operations, stale ranges,
  and no-op edits are rejected before mutation.
- Added typed attempted failures so a runtime timeout/refusal is measured and
  not mislabeled as unsupported. A codec with no response is the only
  unsupported result.
- Added paired comparison with retained unpaired observations, deterministic
  tie handling, and no winner when comparison evidence is insufficient.
- Added `tests/unit/edit-codec-calibration.test.ts` covering all four codecs,
  stale and malformed state, nested digest integrity, path/codec binding,
  semantic-versus-apply scoring, token cost, ambiguity, typed failures,
  unsupported codecs, and paired selection.
- Documented the boundary in `docs/architecture/shelra-driver.md`.

## Tests/evals executed

- command:
  `bun --conditions=browser test tests/unit/edit-codec-calibration.test.ts`
  - result: **14 pass, 0 fail, 67 assertions**.
- command: `bun run typecheck`
  - result: **exit 0**.
- command:
  `bunx prettier --check src/driver/edit-codec-calibration.ts tests/unit/edit-codec-calibration.test.ts docs/architecture/shelra-driver.md`
  - result: **exit 0**; all Phase 4 files are formatted.
- command: `bun --conditions=browser test`
  - result: **exit 1; 812 pass, 1 fail, 1 skip, 2,822 assertions, 814 tests**
    across 139 files.
  - sole failure: `tests/unit/code-review-agent.test.ts` expects `PASS` but
    observes `BLOCKED` because the dirty repository root contains pre-existing
    trailing whitespace in TUI golden files and `git diff --check` blocks the
    review. This is the recorded baseline failure; no test was weakened.
- repository-wide `bun run format:check` remains a known worktree failure from
  110 pre-existing/unrelated files; Phase 4 scope passes the targeted check.

## Real-model evidence

- No real model was available for a new edit-codec calibration run in this
  phase, so no codec winner or write authority is claimed.
- The current exact local LM Studio evidence remains the Phase 1 run at:
  `C:\Users\Javie\.shelracode\evaluations\phase-01-final-secure-20260828\20260828T204358245Z-protocol-local-lm-studio-qwen2.5-coder-7b-instruct-b8942ac6-74d6-4a3c-a234-71e1d486d94c\manifest.json`.
  It is `UNPROVEN` after the `errorRecovery` dimension failed, with replay
  integrity verified and no write authority.
- The Phase 4 module consumes supplied responses and objective fixture state;
  it does not invoke a provider, infer behavior from a model name, or promote
  a profile.

## Metrics

| Metric                              | Phase 4 observation                 |
| ----------------------------------- | ----------------------------------- |
| Candidate edit codecs               | 4                                   |
| Focused edit-codec tests            | 14 pass / 0 fail                    |
| Full suite                          | 812 pass / 1 baseline fail / 1 skip |
| Focused typecheck                   | pass                                |
| Scoped format                       | pass                                |
| Parse/schema/apply/semantic metrics | separate in every measured case     |
| Stale rejection denominator         | stale-expected cases only           |
| Paired selection                    | common probe intersection only      |
| Production Driver authority         | unchanged; no promotion             |

## Risks / regressions

- A later runner must bind model-produced edit responses to repeated real-model
  trials and the exact `ModelDriverProfile` before using this result for
  authority.
- The deterministic score is a comparison aid, not a release metric. Real
  certification still requires repeated trials, objective verification,
  protected tasks, and provenance.
- The pre-existing dirty-checkout code-review failure and repository-wide
  formatting failure remain explicitly recorded and unrelated files were not
  rewritten.

## Independent verification

- The read-only Phase 4 verifier reproduced all previously identified boundary
  cases and confirmed the final nested structured-patch digest correction:
  malformed internal digest yields `parseValid=true`, `schemaValid=false`,
  `applied=false`, `errorClass=INVALID_EDIT`, rather than a stale rejection.
- It also verified codec/path binding, unsafe path rejection, outer digest
  guards, typed failures, semantic/apply/token separation, stale-only scoring,
  retained observations, paired-only selection, unsupported handling, and tie
  behavior.
- final status: **PASS**; focused tests, typecheck, and scoped formatting all
  passed.

## Gate decision

**PASS**

## Next phase eligibility

**YES** — Phase 5 is eligible to extract the Minimal SWE Core. The codec
calibration remains a pure, non-authoritative boundary until real-model
evidence and later profile certification exist.
