# Shelra Lab run artifacts

**Implemented:** Phase 1  
**Schema version:** 1

Shelra Lab stores evaluation truth outside the model conversation. A run is a
sealed filesystem bundle whose manifest exists before the first inference
request.

## Bundle layout

```text
<artifact-root>/
  <run-id>/
    manifest.json
    observations.jsonl
    summary.json
```

- `manifest.json` binds the public case and fixture digests to source
  provenance, exact observed model/runtime fields, explicit unknown identity
  fields, request budgets, host fingerprint, policy, and reproduction command.
- `observations.jsonl` is an ordered SHA-256 chain. Provider requests,
  normalized response frames, agent events, host results, and failures are
  redacted before persistence. Reasoning text is never stored; only its
  character count is retained.
- `summary.json` seals the manifest digest, final observation digest, outcome,
  metrics, and failure/evidence references.

The reader rejects a symlinked run directory, non-regular bundle files,
manifest mismatch, changed/reordered observations, and a summary that does not
seal the observed chain.

Summary sealing also rejects contradictory outcome/model-status pairs,
backwards timestamps, missing failure records for unsuccessful outcomes, and
evidence references that do not name recorded observations. The final
observation must be part of the sealed evidence set. Every `real_local_model`
bundle must seal exactly one `trial.result`; its outcome, model status, and
failure must agree with the summary. Scripted-fake evidence can instead bind a
deterministic host result. A text claim of `PASS` cannot create a valid bundle
by itself.

## Evidence classes

`scripted_fake` proves deterministic host behavior only.
`real_local_model` records an actual local runtime/model invocation. Reporters
keep these classes separate; neither is silently promoted into capability
certification.

Identity fields that LM Studio or another runtime does not expose remain
`unknown`. A model name, quantization label, or successful run is not an
artifact hash or a Driver certificate.

## Protected acceptance

A public case contains only an opaque ID and SHA-256 reference to protected
acceptance material. The oracle loader reads that material from a separate
root, verifies its digest and case binding, and never adds its payload to the
model-visible case or run manifest. Protected data is not needed for offline
action replay. The protected root must be a real directory, not a symlink or
junction, and the oracle must be a regular file that resolves inside it.

## Commands

Deterministic host evidence:

```powershell
bun --conditions=browser run scripts/evaluate-agent.ts --summary
```

One actually available local model, without downloads or paid fallback:

```powershell
bun --conditions=browser run scripts/evaluate-agent.ts --local-only --json --max-models=1
```

One real, read-only protocol trial whose complete provider-frame set is
eligible for offline replay:

```powershell
bun --conditions=browser run scripts/evaluate-agent.ts --protocol-only --json --max-models=1
```

Use `--artifact-root=<absolute-path>` to select an explicit evidence root. If
omitted, the evaluator uses the ShelraCode per-user state directory.

Verify and replay a sealed run:

```powershell
bun --conditions=browser run scripts/evaluate-agent.ts --replay-run=<absolute-manifest.json> --json
```

## Replay boundary

Replay first validates the immutable bundle, then feeds the recorded normalized
provider frames into an in-memory provider and re-runs the current capability
protocol logic. It performs no model discovery, health/quota request,
inference, download, network call, original-workspace tool execution, or new
artifact write. It compares protocol-behavior digests and reports `MATCH`,
`DIVERGED`, or `BLOCKED` without printing raw prompts or response payloads.

Host execution timing and disposable probe-root names are normalized before
request comparison; semantic fields remain digest-bound. Missing frames or a
missing recorded probe result fail closed. Replay currently proves the
recorded capability protocol, including typed recovery behavior. It does not
claim to reproduce an entire coding journey, raw HTTP wire bytes, stochastic
model generation, or a future Driver profile. Those later claims require their
own phase gates.

Replay requires the sealed `trial.result` to be named by summary evidence and
requires every recorded provider request frame in that protocol trial to be
consumed. Surplus or stale frames return `DIVERGED`. A mixed run that also
contains executable probes or coding-journey inference is intentionally not
treated as a complete protocol replay; use `--protocol-only` for the bounded
reproduction contract.

## Current limitations

- Each invocation records one trial per selected model. Repeated stochastic
  trials are separate immutable runs and must be reported with all outcomes.
- The response frames are normalized provider events, not raw runtime wire
  payloads.
- Protocol-only runs execute no workspace mutation or verifier journey. Their
  coding-task matrix therefore remains `UNPROVEN`.
- Artifact SHA-256, runtime version, template, tokenizer, or parser fields may
  remain unknown when the runtime does not expose them.
- Phase 1 artifacts do not grant write/network authority and are not a
  capability certificate.
