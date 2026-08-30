# Phase 8 Report

**Phase:** Make completion proof-backed  
**Evidence snapshot:** 2026-08-29, `America/Santo_Domingo`  
**Source revision:** `230b5575a592897fa113e3d05407e6f93e4f01da`  
**Worktree:** dirty user work preserved; no staged changes

## Repository evidence

- The live completion path remains `src/agent/loop.ts` ->
  `src/agent/completion-gate.ts`. The model's prose is not a completion
  authority; the host computes objective proof and verification before the
  terminal decision.
- Existing task contracts, verification runs, mutation ledgers, and objective
  proof were preserved. Phase 8 adds a canonical acceptance/evidence layer
  beside those controls instead of replacing the legacy scheduler.
- `src/evidence/acceptance.ts` now owns bounded `AcceptanceObligation` and
  `EvidenceRecord` validation, redaction, deterministic evidence assessment,
  conflict detection, and a capped in-memory evidence store. Durable task
  persistence remains a Phase 11 responsibility.

## Changes

- Added `src/evidence/acceptance.ts` and `src/evidence/index.ts` with:
  - contract-to-obligation compilation;
  - host-validated, secret-scrubbed evidence records;
  - latest-evidence-wins semantics, so a later failed verification invalidates
    an older pass;
  - false-success classification when completion is declared without proof;
  - defensive cloning, caps, duplicate/conflict rejection, and snapshots;
  - an adapter from the existing task ledger/objective proof into canonical
    evidence records.
- Extended `src/agent/completion-gate.ts` and the live loop so every
  repository-bearing mode receives an `AcceptanceProofAssessment`. Legacy
  inferred coding tasks use a reduced compatibility contract while explicit
  task contracts retain their full deliverables, criteria, and evidence
  requirements.
- Added a bounded lexical completion-declaration signal only for false-success
  telemetry. The completion gate still requires host-owned proof and does not
  trust model text or `status: satisfied` as evidence.
- Added deterministic unit, integration, and regression coverage for missing
  evidence, false completion, redaction, evidence conflicts, newer failures,
  optional obligations, normal coding compatibility, and completion-gate
  integration.
- Added `docs/architecture/evidence-verification.md` and linked it from the
  architecture index.

## Tests/evals executed

- command: `bun --conditions=browser test tests/unit/acceptance-evidence.test.ts tests/unit/completion-gate.test.ts tests/integration/agent-loop.test.ts tests/integration/agent-evaluations.test.ts`
  - result: **61 pass, 0 fail, 352 expectations**.
- independent command: focused Phase 8 verification
  - result: **59 pass, 0 fail, 267 expectations**.
- command: `bun run typecheck`
  - result: **exit 0**.
- command: `bunx prettier --check src/evidence/acceptance.ts src/evidence/index.ts src/agent/completion-gate.ts src/agent/loop.ts src/agent/types.ts tests/unit/acceptance-evidence.test.ts tests/unit/completion-gate.test.ts tests/integration/agent-loop.test.ts docs/architecture/evidence-verification.md docs/architecture/index.md`
  - result: **exit 0**.
- command: `git diff --check --` on Phase 8 paths
  - result: **no Phase 8 whitespace errors**; Git emitted only its normal
    LF/CRLF working-copy warnings.
- command: `bun --conditions=browser test`
  - result: **exit 1; 854 pass, 1 fail, 1 skip, 3,006 expectations, 856 tests**
    across 143 files.
  - sole failure: `tests/unit/code-review-agent.test.ts` expects `PASS` but
    observes `BLOCKED` because pre-existing trailing whitespace in dirty TUI
    golden files makes `git diff --check` fail. No test was weakened and no
    unrelated user work was rewritten.

## Real-model evidence

- No new real-model run was available for Phase 8. The exact local LM Studio
  evidence remains the Phase 1 run at:
  `C:\Users\Javie\.shelracode\evaluations\phase-01-final-secure-20260828\20260828T204358245Z-protocol-local-lm-studio-qwen2.5-coder-7b-instruct-b8942ac6-74d6-4a3c-a234-71e1d486d94c\manifest.json`.
- That run is `UNPROVEN` after `errorRecovery` failed, with replay integrity
  verified and no write authority. Phase 8 does not promote model authority.
- Deterministic and fake-provider tests prove host completion enforcement only;
  they are not autonomous real-model success evidence.

## Metrics

| Metric | Phase 8 observation |
| --- | --- |
| Focused Phase 8 tests | 61 pass / 0 fail |
| Focused Phase 8 expectations | 352 |
| Independent focused verification | 59 pass / 0 fail / 267 expectations |
| Full suite | 854 pass / 1 baseline fail / 1 skip |
| Full-suite assertions/tests | 3,006 / 856 |
| Typecheck | pass |
| Scoped format | pass |
| Required-obligation enforcement | host-gated; missing proof blocks completion |
| False-success traps | deterministic unit + integration coverage |
| Real-model authority promotion | none |

## Risks / regressions

- The canonical evidence store is currently in-memory and task-local. Phase 11
  must persist canonical records, checkpoints, and recovery history through
  restart/resume; this phase intentionally does not claim durable cognition.
- Legacy inferred coding tasks receive a reduced canonical compatibility
  contract so scheduler path inference remains unchanged. Explicit contracts
  remain the stronger acceptance authority.
- Completion declaration detection is lexical and bounded. It can miss
  paraphrases or affect telemetry for negated language, but it cannot grant
  completion without host proof.
- Host-owned `createdAt` ordering is required for latest-evidence semantics;
  untrusted model timestamps are not accepted.
- The known dirty-worktree code-review failure remains outside Phase 8 scope.

## Independent verification

- The read-only Phase 8 verifier found three initial issues: completion claims
  were not connected to false-success assessment, older passing evidence could
  beat a newer failure, and normal inferred coding could skip canonical proof.
- All three were fixed and regression-tested. The final verifier confirmed
  live-loop wiring, compatibility coverage, status/evidence separation,
  redaction and caps, conflict handling, and latest-failure precedence.
- Final independent result: **PASS**. Remaining concerns are non-gating and
  recorded above.

## Gate decision

**PASS**

## Next phase eligibility

**YES** - Phase 9 is eligible to add typed recovery and anti-loop behavior;
the completion gate must remain proof-backed while recovery changes strategy
after repeated failure.

