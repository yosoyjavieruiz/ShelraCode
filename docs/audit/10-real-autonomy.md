# 10 — Real autonomy vs. deterministic-test success

> **Provenance:** produced INLINE by the lead auditor as a fallback slice — the
> `real-autonomy-evaluator` subagent was terminated by an account session limit
> before it could run (resets 21:30 America/Santo_Domingo). This slice is
> evidence-backed and bounded; the deeper false-completion/recovery probes (§32-33)
> remain **TODO** for the full agent run. Snapshot: commit `230b557`, dirty tree.

## Central question

> Does ShelraCode demonstrate real coding-agent autonomy, or does its green suite
> reflect harness plumbing driven by predetermined model output?

**Answer (this slice): there is currently NO demonstrated real-model autonomy.**
Every agent-journey success in the suite is driven by a scripted/fake model; the
real-local-model matrix is UNPROVEN. Evidence below.

## Test-quality classification (§35)

Method: file census + provider-source grep over `tests/` at commit `230b557`.

| Dimension | Measure | Evidence |
| --- | --- | --- |
| Total test files | 128 (`tests/unit` 109, `tests/integration` 19, `tests/e2e` empty, no `*.test.ts` under `tests/evals`/`tests/ui`) | `find tests -name '*.test.ts'` |
| Files using a fake/scripted/replay provider | 14 | grep `FakeProvider\|createScriptedProvider\|scripted\|replay\|provider-recorder` |
| Files referencing local-runtime markers (`ollama`/`11434`/`lm-studio`) | 24 | grep — but these test **plumbing**, not a live model (see below) |
| Files that run against a REAL loaded model | **0** | no live-model guard/skip patterns found; all provider I/O is injected |

**Model source of the agent/provider tests = FAKE_PROVIDER / stubbed transport:**
- `tests/support/fake-provider.ts:47` `FakeModelAdapter implements ProviderAdapter`;
  `:103` `createScriptedProvider(...)` — agent journeys consume **predetermined
  model turns**.
- `tests/integration/provider-contract.test.ts:6-28` constructs
  `GenericOpenAICompatibleProvider` with an injected `fetchImpl: FetchLike` and
  `baseUrl: "https://fake.test/v1"` — a **stubbed HTTP transport**, never a real
  endpoint. (The injectable `fetchImpl` is good design for testability; it just
  means these are contract tests, not real-model tests.)

Classification: `REAL_LOCAL` = 0%, `REAL_REMOTE` = 0%, `RECORDED/REPLAY` present in
the evals harness, `FAKE_PROVIDER` = the basis of all agent-journey coverage.

## Deterministic evaluator (§34) — what it does and does not prove

Ran the safe, disposable evaluator:

```
$ bun run scripts/evaluate-agent.ts --deterministic --summary
Deterministic matrix: PASS (18/18 passed; failed=0; unproven=0; skipped=0)   (exit 0)
```

This proves the **harness plumbing** (turn loop, tool dispatch, ledger, completion
gate) executes end-to-end when the model's outputs are supplied by a scripted
provider. It does **not** prove a real model can produce those outputs, choose the
right tools, or recover — the model is the part held constant.

## Real-model diagnostic (§34)

**BLOCKED_REAL_MODEL.** No local model was loaded/selected for this slice, and the
account session limit halted subagent execution. Consistent with
`docs/STATUS.md` ("Local matrix: UNPROVEN … runtime reports the model as
unloaded"). Not converted into a success claim.

## Findings

```yaml
id: F-AUTO-001
title: No demonstrated real-model coding-agent autonomy
domain: real-autonomy
severity: P1
confidence: HIGH
claim: >
  Every agent-journey/deterministic success is produced by a scripted fake
  provider; zero tests exercise a real local or remote model, so the product's
  central capability (autonomy on 1-14B local models) is currently UNPROVEN by
  the suite.
evidence:
  source_files:
    - tests/support/fake-provider.ts:47 (FakeModelAdapter)
    - tests/support/fake-provider.ts:103 (createScriptedProvider)
    - tests/integration/provider-contract.test.ts:6-28 (injected fetchImpl, baseUrl fake.test)
  runtime_trace: "bun run scripts/evaluate-agent.ts --deterministic --summary -> PASS 18/18 (scripted provider)"
  external_sources: "docs/STATUS.md — Local matrix: UNPROVEN (model unloaded)"
current_behavior: Green suite reflects harness plumbing with predetermined model output.
expected_behavior: >
  At least one real-local-model E2E journey (create/modify/test/repair) must pass,
  or autonomy is unproven.
impact: >
  Architecture maturity is being read as autonomy. The core product thesis is
  untested against real models.
root_cause: Test design holds the model constant (scripted); no real-model gate in CI.
specification_status: SPECIFICATION_GAP  # no acceptance obligation for real-model E2E
recommended_direction: >
  Specify a real-local-model acceptance obligation and a small disposable
  real-model journey suite. VALIDATE FIRST — do not implement harness changes
  before measuring a real 1-14B model on the existing loop.
implementation_priority: VALIDATE FIRST
unknowns: How the loop behaves with a real 1-14B model (needs a loaded model).
```

```yaml
id: F-AUTO-002
title: "Deterministic matrix PASS is mislabeled evidence of capability"
domain: real-autonomy
severity: P2
confidence: HIGH
claim: >
  "Deterministic matrix: PASS (18/18)" is cited in STATUS as agent evidence but
  measures plumbing under scripted output, not model capability.
evidence:
  runtime_trace: "18/18 PASS with FakeModelAdapter-supplied turns"
  source_files: ["docs/STATUS.md"]
current_behavior: PASS reported without a prominent "scripted provider" qualifier.
expected_behavior: Deterministic results labeled as harness/plumbing coverage, distinct from autonomy.
impact: Over-reads readiness; risks confirmation bias in later phases.
root_cause: Conflation of harness-passes with model-passes.
specification_status: SPECIFICATION_GAP
recommended_direction: Report harness vs. real-model results as separate scores (charter §47).
implementation_priority: DO FIRST
unknowns: none
```

## Open items (full `real-autonomy-evaluator` run at reset)

- False-completion probes (§32): claims-success-without-edit, wrong-file edit,
  incomplete impl, unit-passes-but-requirement-fails, silent-abandon.
- Controlled recovery probes (§33) against the live path.
- Confirm the 24 "local-marker" files all use stubbed transport (spot-checked 1).
- Real-local-model journey once a model is loaded (`--local` loopback only).

## Summary

Demonstrated real autonomy today ≈ **zero**: 0/128 tests run a real model; the
green deterministic matrix is scripted-provider plumbing coverage; the local
matrix is UNPROVEN/BLOCKED. This is the strongest single piece of evidence for
the audit's central question and should anchor the synthesizer's verdict.
