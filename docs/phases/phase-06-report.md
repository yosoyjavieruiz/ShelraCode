# Phase 6 Report

**Phase:** Implement Context Compiler and Legal Actions  
**Evidence snapshot:** 2026-08-29, `America/Santo_Domingo`  
**Source revision:** `230b5575a592897fa113e3d05407e6f93e4f01da`  
**Worktree:** dirty user work preserved; no staged changes

## Repository evidence

- The existing live loop still consumes the legacy `ContextPacket` compiler in
  `src/context/context-compiler.ts`; `src/agent/loop.ts` and `src/tui/app.tsx`
  do not import the new capsule. This phase preserves that compatibility path.
- `src/context/context-builder.ts` already owns context-budget helpers and
  `src/context/repository-intelligence.ts` already exposes host-built facts;
  Phase 6 consumes bounded references but does not add semantic/vector
  retrieval or replace repository intelligence.
- The existing tool and turn-policy boundaries remain authoritative for the
  live runtime. The new capsule is a pure, provider-neutral boundary for the
  later Core/Driver strangler migration.

## Changes

- Added `src/context/context-capsule.ts` with typed task, requirements,
  verification state, repository references, trusted instructions, active Skill
  references, budgets, legal actions, output schema, deterministic rendering,
  omission tracking, and SHA-256 integrity inspection.
- Added host-owned legal-action derivation for capability levels C0-C6,
  task status, remaining action budget, and explicit write/execute/expert/
  completion policy. Terminal (`blocked`, `failed`, `completed`, `cancelled`)
  states expose no actions, and task/action capability levels must agree.
- Added bounded closed action descriptors and host validation for descriptor
  membership, custom required/type/enum schemas, extra keys, repository paths
  and scopes, line ranges, evidence references, and stale-guarded structured
  patches.
- Kept required obligations, current failure, verification state, and
  forbidden repeats in required rendered sections. Repository and instruction
  sections are optional only when the input budget cannot fit them, and every
  omission is explicit.
- Added `src/context/index.ts`, architecture documentation, and focused
  regression tests including digest tampering, terminal authority, capability
  disagreement, empty-proof completion, schema constraints, path safety, and
  optional-context bounding.

## Tests/evals executed

- command: `bun --conditions=browser test tests/unit/context-capsule.test.ts`
  - result: **7 pass, 0 fail, 43 assertions**.
- command:
  `bun --conditions=browser test tests/unit/context-capsule.test.ts tests/unit/context-compiler.test.ts tests/unit/context-budget.test.ts tests/integration/context-relevance.test.ts tests/integration/privacy-context.test.ts`
  - result: **22 pass, 0 fail, 93 assertions**.
- command: `bun run typecheck`
  - result: **exit 0**.
- command:
  `bunx prettier --check src/context/context-capsule.ts src/context/index.ts tests/unit/context-capsule.test.ts docs/architecture/context-compiler.md docs/architecture/index.md`
  - result: **exit 0**; scoped implementation, tests, and docs are formatted.
- command: `bun --conditions=browser test`
  - result: **exit 1; 836 pass, 1 fail, 1 skip, 2,926 assertions, 838 tests**
    across 141 files.
  - sole failure: `tests/unit/code-review-agent.test.ts` expects `PASS` but
    observes `BLOCKED` because the dirty repository contains pre-existing
    trailing whitespace in TUI golden files and `git diff --check` blocks the
    review. No test was weakened and unrelated user work was not rewritten.
- repository-wide `bun run format:check` remains a known dirty-worktree
  failure from unrelated files; the Phase 6 scope passes the targeted check.

## Real-model evidence

- No new real-model run was available for this phase. The exact local LM
  Studio evidence remains the Phase 1 run at:
  `C:\Users\Javie\.shelracode\evaluations\phase-01-final-secure-20260828\20260828T204358245Z-protocol-local-lm-studio-qwen2.5-coder-7b-instruct-b8942ac6-74d6-4a3c-a234-71e1d486d94c\manifest.json`.
- That run is `UNPROVEN` after `errorRecovery` failed, with replay integrity
  verified and no write authority. The Context Capsule does not infer
  capability from a model name and does not promote a profile.
- The deterministic capsule tests prove host behavior only; they are not
  autonomous real-model evidence.

## Metrics

| Metric                         | Phase 6 observation                         |
| ------------------------------ | ------------------------------------------- |
| Focused capsule tests          | 7 pass / 0 fail                             |
| Focused capsule assertions    | 43                                          |
| Context compatibility tests    | 22 pass / 0 fail                            |
| Full suite                    | 836 pass / 1 baseline fail / 1 skip         |
| Full-suite assertions/tests   | 2,926 / 838                                 |
| Typecheck                     | pass                                        |
| Scoped format                 | pass                                        |
| Required-context retention    | task, obligations, state, actions, output, budget |
| Optional-context handling     | explicit omissions under budget pressure   |
| Terminal action authority     | zero actions                                |
| Completion authority          | required proof obligations plus host state  |
| Real-model authority promotion| none                                        |

## Risks / regressions

- A terminal capsule renders an empty `type` enum. Terminal states should not
  invoke a model; a later integration may instead short-circuit before schema
  submission for runtimes that reject empty enums.
- The output envelope schema is intentionally shallow. `validateLegalAction`
  and the completion controller must remain mandatory host-side gates.
- Path scope comparison is bounded and exact in this pure module; later
  ExecutionBroker integration must reuse the canonical workspace path and
  symlink policy rather than treating this helper as a filesystem authority.
- The pre-existing dirty-checkout code-review failure and repository-wide
  formatting failure remain explicitly recorded and unrelated files were not
  formatted or rewritten.

## Independent verification

- The read-only Phase 6 verifier initially found four authority inconsistencies.
  They were fixed before the gate: terminal states now expose no actions,
  task/action capability levels must match, output type enums are filtered to
  legal response forms, required obligations must be non-empty for completion,
  and custom descriptor schemas are enforced by the host validator.
- The verifier reproduced the adversarial cases after correction: failed
  actions/types are empty; C0/C6 disagreement throws a typed input error; zero
  obligations cannot expose completion; C1 output types are only
  `action`/`blocked`; missing required fields, wrong types, wrong enums, and
  extra keys are rejected while a valid constrained action is accepted.
- Final independent result: **PASS**. It also confirmed no capsule wiring into
  the legacy loop/TUI and no semantic/vector retrieval was added.

## Gate decision

**PASS**

## Next phase eligibility

**YES** - Phase 7 is eligible to build Repository Intelligence Levels 1-3.
Semantic/vector retrieval remains optional and gated by paired evaluation.
