# Phase 3 Report

**Phase:** Implement protocol calibration  
**Evidence snapshot:** 2026-08-29, `America/Santo_Domingo`  
**Source revision:** `230b5575a592897fa113e3d05407e6f93e4f01da`  
**Worktree:** dirty user work preserved; no staged changes

## Repository evidence

- The existing provider boundary already normalizes native tool calls and
  textual LM Studio envelopes, but it did not expose a model-independent
  calibration contract for comparing action representations.
- `src/driver/profile.ts` defines the four candidate action protocols while
  leaving newly observed profiles uncalibrated. Phase 3 adds the measurement
  primitive without changing route selection or granting authority.
- The existing real LM Studio evidence remains a single exact local trial from
  Phase 1. It is `UNPROVEN` for coding authority because its error-recovery
  dimension failed; no new real-model protocol winner is claimed here.

## Changes

- Added `src/driver/protocol-calibration.ts` with normalized action types and
  encoders for native function calls, constrained JSON, XML system tools, and a
  minimal text action grammar.
- Added a strict parser that keeps parse validity, action-schema validity,
  legal-action validity, and action-specific argument validity independent.
  Valid JSON with the wrong shape is parse-valid but schema-invalid; missing,
  wrongly typed, or extra tool arguments are rejected by explicit or inferred
  action schemas.
- Added semantic probe scoring that records semantic action correctness,
  environment success, progress, verification, false success, and loop signals
  independently of syntax.
- Added typed attempted failures (`kind: "failure"`) so timeout/refusal/runtime
  failures remain measured observations. A protocol with no response is the
  only `unsupported` result.
- Added paired comparison. Every observed case remains in `cases`; selection
  uses only the common `pairedCases` and paired metrics. One protocol, disjoint
  coverage, or an exact paired tie returns `insufficient_comparison` without a
  winner.
- Added adversarial unit coverage for malformed/schema-invalid output,
  illegal actions, invalid arguments, inferred argument validation, paired
  coverage, explicit attempted failures, false success, and exact ties.
- Extended `docs/architecture/shelra-driver.md` with the protocol-calibration
  boundary and its non-certifying scope.

## Tests/evals executed

- command:
  `bun --conditions=browser test tests/unit/protocol-calibration.test.ts`
  - result: 11 pass, 0 fail, 64 assertions.
- command:
  `bun --conditions=browser test tests/unit/protocol-calibration.test.ts tests/unit/driver-profile.test.ts tests/unit/storage.test.ts`
  - result: 24 pass, 0 fail, 128 assertions.
- command: `bun run typecheck`
  - result: exit 0.
- command:
  `bunx prettier --check src/driver/protocol-calibration.ts tests/unit/protocol-calibration.test.ts docs/architecture/shelra-driver.md`
  - result: exit 0; all Phase 3 files are formatted.
- command: `bun --conditions=browser test`
  - result: exit 1; 798 pass, 1 fail, 1 skip, 2,755 assertions, 800 tests
    across 138 files.
  - sole failure: `tests/unit/code-review-agent.test.ts` expects `PASS` but
    observes `BLOCKED` because the dirty repository root contains pre-existing
    trailing whitespace in TUI golden files and `git diff --check` blocks the
    review. This remains the recorded baseline failure; no test was weakened.
- command: `bun run format:check`
  - result: exit 1; Prettier reports 110 existing/worktree files. Only the
    Phase 3 scope was formatted.

## Real-model evidence

- No protocol winner is promoted from a fake provider or fixture. The Phase 3
  module is a deterministic host-side parser/scorer and does not invoke a
  provider by itself.
- The current exact local LM Studio/Q6_K evidence remains at:
  `C:\Users\Javie\.shelracode\evaluations\phase-01-final-secure-20260828\20260828T204358245Z-protocol-local-lm-studio-qwen2.5-coder-7b-instruct-b8942ac6-74d6-4a3c-a234-71e1d486d94c\manifest.json`.
  Its outcome is `UNPROVEN` after `errorRecovery` failed, with replay integrity
  verified. It grants no Driver write authority.
- The fixture calibration compares constrained JSON and XML on the same probe
  IDs, records the constrained-JSON winner when XML has a measured failure,
  reports one-protocol and no-common cases as insufficient, and preserves all
  attempted failures for audit.

## Metrics

| Metric                         | Phase 3 observation                                      |
| ------------------------------ | -------------------------------------------------------- |
| Candidate protocols            | 4 supported representations                              |
| Parser dimensions              | parse, schema, legal action, arguments, semantic action  |
| Outcome dimensions             | environment, progress, verification, false success, loop |
| Focused protocol tests         | 11 pass / 0 fail                                         |
| Focused Phase 2 + 3 tests      | 24 pass / 0 fail                                         |
| Full suite                     | 798 pass / 1 baseline fail / 1 skip                      |
| Scoped format                  | pass                                                     |
| Repository-wide format         | fail; 110 dirty/worktree files                           |
| Paired comparison              | common probe intersection only                           |
| Single/disjoint/tied promotion | none                                                     |
| Production Driver authority    | unchanged; no promotion                                  |

## Risks / regressions

- Protocol calibration currently consumes supplied normalized responses; a
  later runner must bind those responses to repeated real-model trials and
  exact `ModelDriverProfile` identities before any authority promotion.
- The deterministic score is a comparison aid, not a release metric. Real
  certification still requires repeated trials, objective verification,
  protected tasks, and provenance.
- The existing dirty-checkout test failure and global format failure remain
  explicitly recorded and unrelated user files were not rewritten.

## Independent verification

- The read-only independent verifier reproduced the inferred invalid-argument
  case (`argumentsValid=false`, `semanticActionCorrect=false`) and reviewed
  parse/schema separation, explicit schemas, typed failures, retained cases,
  paired selection, unsupported handling, and tie behavior.
- final status: `PASS`. The verifier ran 11 protocol tests with 64 assertions,
  typecheck, scoped Prettier, and found no remaining blocker in the Phase 3
  scope.

## Gate decision

PASS

## Next phase eligibility

YES — Phase 4 is eligible for edit-codec calibration. It must preserve the same
paired-evidence and no-authority-promotion rules.
