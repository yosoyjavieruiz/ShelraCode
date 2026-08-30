# Phase 1 Report

**Phase:** Build Shelra Lab foundations  
**Evidence snapshot:** 2026-08-28, `America/Santo_Domingo`  
**Source revision:** `230b5575a592897fa113e3d05407e6f93e4f01da`  
**Worktree:** dirty user work preserved; no staged changes

## Repository evidence

- Phase 0 found a deterministic evaluation matrix but no immutable,
  replay-verifiable run record for an actual local model. Scripted-provider
  evidence and real-model observations could therefore be confused by a
  reporter.
- The live evaluation entry point remains `scripts/evaluate-agent.ts`; local
  inference crosses the existing provider/runtime adapters. Phase 1 adds a
  Shelra Lab evidence boundary around those paths without replacing the agent
  loop or creating a second user interface.
- LM Studio's native model metadata can expose publisher, format, selected
  variant, quantization, and loaded-instance settings. Runtime version,
  artifact SHA-256, tokenizer, and exact chat/tool template are not exposed by
  the observed endpoint and remain explicit `unknown` values.
- Protected acceptance is intentionally external to public cases, model input,
  manifests, and replay. The loader binds it by case ID and SHA-256 and rejects
  roots reached through a Windows junction or another link.

## Changes

- Added strict public evaluation-case and run-manifest schemas, model-visible
  projection, stable digests, exact observed-or-unknown identity fields, host
  fingerprinting, source provenance, and reproduction metadata under
  `src/evals/`.
- Added immutable run bundles containing a manifest written before inference,
  redacted hash-chained observations, and a sealed summary. Bundle reading
  fails closed on links, non-regular files, digest changes, invalid evidence
  references, contradictory status, timestamp reversal, or an unbound result.
- Required every `real_local_model` bundle to seal exactly one terminal
  `trial.result` whose outcome, model status, and failure agree with the
  summary. Unexpected driver exceptions now produce both diagnostic and
  terminal failure records.
- Added replay-preserving secret redaction, including authorization, API key,
  client-secret, AWS credential, token assignment, bearer-token, and private
  key shapes. Reasoning text is not persisted.
- Added a protected held-out oracle loader. Expected material remains outside
  the public task and is digest-bound without being copied into model-visible
  context or artifacts.
- Added deterministic offline capability-protocol replay. It performs no
  discovery, health/quota request, inference, network access, workspace tool
  execution, or artifact write; missing, surplus, or unbound provider frames
  fail closed.
- Added `--protocol-only` for a real, read-only local-model trial whose complete
  normalized provider frame sequence is replayable. This path deliberately
  performs no repository mutation and grants no coding authority.
- Normalized available official LM Studio model/loaded-instance metadata and
  documented the evidence, replay, identity, held-out, and fake-versus-real
  boundaries in `docs/evals/` and `docs/RESEARCH-SNAPSHOT.md`.
- Added unit and integration coverage for schema boundaries, provenance,
  redaction, artifacts, held-out separation, local runner behavior, replay,
  protocol-only execution, runtime normalization, and adversarial false-evidence
  cases.

## Tests/evals executed

- command:
  `bun --conditions=browser test <evaluation tests> tests/unit/runtime.test.ts tests/unit/capability-probe.test.ts`
  - result: 54 pass, 0 fail, 203 assertions across 17 files.
  - note: one first invocation hit the five-second timeout in an existing
    capability test; isolated replay passed in 4.10 ms and an unchanged full
    repetition passed 53/53, so no timeout was relaxed and no code was changed
    for it.
- command: `bun run typecheck`
  - result: exit 0.
- command:
  `bun --conditions=browser test tests/integration/functional-acceptance.test.ts`
  - result: 26 pass, 0 fail, 102 assertions.
- command:
  `bun --conditions=browser run scripts/evaluate-agent.ts --summary --artifact-root=<phase-01-deterministic-root>`
  - result: `PASS (18/18 passed; failed=0; unproven=0; skipped=0)`.
  - evidence class: `scripted_fake`; this proves deterministic host behavior,
    not local-model autonomy.
- command: `bun --conditions=browser test`
  - result: exit 1; 777 pass, 1 fail, 1 skip, 2,633 assertions, 779 tests across
    136 files.
  - sole failure: `tests/unit/code-review-agent.test.ts` expected `PASS` and
    observed `BLOCKED` in its supposedly passing case.
- command:
  `bun --conditions=browser test tests/unit/code-review-agent.test.ts`
  - result: 2 pass, 1 fail; same Phase 0 baseline failure.
  - cause evidence: the test uses `process.cwd()` and therefore reviews the
    dirty checkout. `git diff --check` exits 2 on pre-existing trailing
    whitespace in TUI golden files, correctly causing the review to block.
- command: `bun run format:check`
  - result: exit 1; 110 existing/worktree files reported.
  - interpretation: repository-wide formatting remains a recorded dirty-tree
    baseline and was not rewritten to make the gate green.
- command: scoped Prettier write/check over Phase 1 files
  - result: exit 0; all Phase 1 files use the configured style.

## Real-model evidence

- Final evidence root:
  `C:\Users\Javie\.shelracode\evaluations\phase-01-final-secure-20260828`.
  The final exact-current protocol trial is generated only after this report
  and all Phase 1 source are formatted; no repository file is changed after
  that invocation.
- model identity: locally loaded LM Studio
  `qwen2.5-coder-7b-instruct`, publisher `lmstudio-community`, GGUF variant
  `Q6_K`, one observed loaded instance.
- runtime: loopback LM Studio at `127.0.0.1:1234`; observed loaded context
  16,384 and catalog maximum context 32,768. Artifact ID/SHA-256, runtime
  version, tokenizer, and exact chat/tool template remain `unknown` rather than
  inferred.
- policy: local-only, protocol-only, read-only; no cloud route, paid inference,
  download, repository mutation, or verifier journey.
- expected interpretation of the sealed result: a failure in the
  `errorRecovery` probe produces `UNPROVEN` with
  `PROTOCOL_PROBE_DIMENSIONS_FAILED`. This is truthful negative evidence, not
  an evaluator failure and not a capability certificate.
- replay requirement: the sole generated manifest must replay as `MATCH`, with
  every recorded provider frame consumed and the recorded failure reproduced.
  A missing/surplus/unbound frame makes the phase gate fail closed.
- an earlier mixed local micro journey remains historical smoke evidence. It is
  not accepted as replay-complete because its additional coding-journey frames
  exceed the bounded protocol replay contract.

## Metrics

| Metric                       | Phase 1 observation                       |
| ---------------------------- | ----------------------------------------- |
| Typecheck                    | pass                                      |
| Phase 1 focused tests        | 54 pass / 0 fail                          |
| Full deterministic suite     | 777 pass / 1 baseline fail / 1 skip       |
| Functional acceptance        | 26 pass / 0 fail                          |
| Scripted-fake evaluator      | 18/18 pass                                |
| Real local protocol outcome  | `UNPROVEN`; recovery dimension failed     |
| Offline protocol replay      | required `MATCH` with all frames consumed |
| Protected-answer exposure    | rejected by schema and boundary tests     |
| False/contradictory evidence | rejected by adversarial tests             |
| Repository-wide format       | fail; 110 dirty/worktree files            |
| Scoped Phase 1 format        | pass                                      |
| New write/network authority  | none                                      |

No stochastic capability success rate, confidence interval, C-level, or
write-authority promotion is reported from one protocol run.

## Risks / regressions

- The full suite remains red only for the Phase 0 dirty-checkout-dependent
  code-review fixture. Phase 1 does not weaken, skip, or repair that unrelated
  test.
- The global format count rose as the preserved dirty worktree evolved. Only
  files in the Phase 1 scope were formatted.
- Normalized frames are replay evidence for the current capability protocol;
  they are not raw HTTP wire captures and cannot reproduce stochastic model
  generation.
- A protocol-only trial proves read-only interaction and typed failure replay,
  not a coding task, repository edit, verification, C2 certification, or
  release readiness.
- Exact identity remains incomplete where the runtime does not expose facts.
  Phase 2 must version, persist, invalidate, and authority-gate Driver profiles;
  Phase 1 must not pre-claim those behaviors.
- No generated executable, installed executable, TUI keyboard journey,
  strict-zero OS egress boundary, durable resume, or release artifact is
  claimed by this phase.

## Independent verification

- Initial read-only security review found secret-shape gaps, summary/result
  contradictions, replay acceptance of surplus/unbound frames, and protected
  root link traversal. Each issue received a failing regression test before its
  production fix.
- A subsequent review found that a real bundle could omit a terminal result.
  The store now requires exactly one sealed, summary-bound `trial.result` for
  `real_local_model`; the local exception path emits a terminal failed result.
- The next adversarial pass found that an unreferenced earlier terminal result
  could be hidden behind one referenced result. A red regression reproduced
  the acceptance; the store now requires exactly one `trial.result` in the
  complete real-model observation chain and exactly one matching reference.
- final status: `PASS`. The read-only recheck independently rejected duplicate
  referenced and unreferenced terminal results in both sealing and reading,
  rejected semantic contradictions, verified exception sealing and
  fail-closed replay, exercised secret redaction and junction rejection, ran
  32 focused evaluation tests with 117 assertions, and passed typecheck. No
  repository file was modified by the verifier.

## Gate decision

PASS

## Next phase eligibility

YES — Phase 2 is eligible only after the final external local trial replays as
`MATCH` and the independent security recheck returns `PASS`.
