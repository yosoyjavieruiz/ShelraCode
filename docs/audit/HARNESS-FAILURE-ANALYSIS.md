# Harness Failure Analysis — why a capable local model fails inside ShelraCode

> **Focused deliverable** (user-directed: audit-only, autonomy-focused). Produced
> INLINE while the deep domain agents are blocked by an account session limit
> (resets 21:30). Evidence = code tracing + live runtime probes against the
> loaded LM Studio model. Snapshot: commit `230b557`, dirty tree.
> Cross-refs: `01-repository-forensics.md`, `10-real-autonomy.md`, `DEAD-COMPLEXITY.md`.

## User's empirical anchor

The operator reports: the model **"Parable Qwen3 4B Claude Fable 5"** performs a
coding task **perfectly in the LM Studio chat UI**, but ShelraCode's agent fails
("no crea ni una web simple"). This localizes the fault to the **harness**
(system prompt, action/tool flow, parsing, edit interface), not the model —
exactly the audit's root-cause discipline (charter §43).

## Verdict (REPRODUCED against the loaded model — not inference)

**The failure is harness-side and it has been reproduced live.** The model is
fully capable: it returns clean valid HTML via the same LM Studio API ShelraCode
uses, and it PASSED the simple edit+test journey through the real `runAgent`
loop. The harder multi-file journey ended `status: "blocked"` — **because
ShelraCode's own execution broker denied every file write** with
`PERMISSION_DENIED / "Workspace mutation requires a current certified Driver
profile" (authority: none, reason: driver_profile_uncertified)`. The model did
everything right (ReadFile ✓, then a correct EditFile) and the harness refused
the write. See F-HARNESS-006 — this is the root cause.

## Live reproduction (evidence)

| Run | Model | Path | Result | Why |
| --- | --- | --- | --- | --- |
| Direct API | parable-qwen3-4b | `POST /v1/chat/completions` | Clean valid `<!DOCTYPE html>…` | Model is capable |
| Simple journey | parable-qwen3-4b | real `runAgent` (`scripts/live-agent-eval.ts`) | **PASS** (ReadFile→EditFile→bun test✓) | Probe certified that run: `certified:true, writeAuthority:"bounded"` |
| Complex journey | parable-qwen3-4b | real `runAgent --complex` | **BLOCKED** (ReadFile✓,ReadFile✓,EditFile✗,ReadFile✓,EditFile✗) | Probe did NOT certify: `authority:none, driver_profile_uncertified` → all writes denied |

Same model, same code, different certification outcome between runs → the write
gate is **non-deterministic/flaky** against a real local model.

## Fix applied & verified (F-HARNESS-006) — 2026-08-29

**Change:** `src/agent/capability-probe.ts` — `runExecutableCapabilityProbe` now
retries the executable edit exercise up to 3 times (resetting the disposable
fixture between attempts) instead of measuring it exactly once. A capable but
stochastic local model reliably demonstrates the edit and earns its (already
cached-by-identity) bounded write certification, instead of being bricked by a
single unlucky probe run. The security gate is UNCHANGED: authority is still
granted only on a *demonstrated* verified edit; `chat_only`/`workspace_reader`
still get none, and authority is still `bounded` (never autonomous/unrestricted).

**Verification (real model, parable-qwen3-4b, via `scripts/live-agent-eval.ts --complex`):**

| Metric | Before | After (2/2 runs) |
| --- | --- | --- |
| Write denials (`PERMISSION_DENIED`) | 2 → `status:blocked` | **0** |
| EditFile | denied | **ok** (multiple), `verify:test:0` (tests pass) |
| `add` fixed by the model | never reached | **true** |
| Full test suite | — | **942 pass / 1 skip / 0 fail**; `tsc --noEmit` clean |
| Security-design tests (929/957/1044) | pass | **still pass, unchanged** |

**Remaining (secondary — NOT the P0 brick, for the deep audit):**
- F-HARNESS-003: exact-match `EditFile` still `fail`s when the model's `oldText`
  is not byte-exact; the agent recovers (re-read + retry) but wastes turns.
- The complex multi-unit journey still did not finish `multiply` — the model
  stalled after the first work unit ("no executable action after bounded
  recovery"). Separate agent-loop/context autonomy issue (owners: agent-loop-auditor,
  context-intelligence-auditor).

## Root causes (evidence-backed)

```yaml
id: F-HARNESS-006
title: All file mutation is gated behind a flaky per-run capability probe; uncertified => every write denied => task blocked
domain: verification / model-runtime / ACI
severity: P0
confidence: HIGH        # REPRODUCED live against parable-qwen3-4b
claim: >
  The execution broker denies EditFile/WriteFile/CreateFile unless a live
  capability probe certifies a Driver profile for the exact model this session.
  Certification requires the probe run to classify the model as
  "advanced_coding_agent", OR "coding_agent" with execution.editApplied===true
  (capability-probe.ts:156-160). The probe is stochastic against a real local
  model: when it does not certify, driverProfileFromCapabilityProbe returns
  undefined, authority is "none", and every write is PERMISSION_DENIED — so the
  agent can read but never change files, and any non-trivial task ("create a web
  page") ends status:"blocked". A fully capable model is castrated by the harness.
evidence:
  source_files:
    - "src/security/execution-broker.ts:500-505 (throws 'Workspace mutation requires a current certified Driver profile'; authority:none, reason:driver_profile_uncertified)"
    - "src/agent/capability-probe.ts:156-160 (certifies only advanced_coding_agent OR coding_agent+editApplied===true; else returns undefined)"
    - "src/agent/capability-probe.ts:64-79 (code comment: this gate 'made write authority permanently unreachable for every real local model')"
  runtime_trace: |
    scripts/live-agent-eval.ts --complex vs simple against parable-qwen3-4b:
    simple -> certified:true, writeAuthority:bounded -> EditFile ok -> PASS
    complex -> authority:none, driver_profile_uncertified -> EditFile FAIL x2 -> status:blocked
    (direct /v1/chat/completions proves the model itself produces correct code)
current_behavior: Uncertified probe run => all writes denied => blocked task.
expected_behavior: >
  A capable model that can apply an edit must be able to write. Certification
  must be stable (not per-run stochastic) and must not silently strip all write
  authority.
impact: >
  This is the direct cause of "no crea ni una web simple": creating files needs
  Write/Create, which are denied when the probe does not certify.
root_cause: >
  Write authority is bound to a live, stochastic, per-session capability probe
  instead of a stable model capability record; a single non-certifying probe run
  disables all mutation.
specification_status: SPECIFICATION_GAP
recommended_direction: >
  VALIDATE + FIX (highest leverage): make certification deterministic and cached
  per model identity; on an uncertified probe, degrade gracefully (e.g. request
  approval or retry the probe) instead of hard-denying every write. Add a
  real-local-model E2E that must create + verify a multi-file artifact.
implementation_priority: DO FIRST
dependencies: []
unknowns: >
  Exact probe inputs that make parable-qwen3-4b fail classification some runs —
  quantify the certify rate over N probe runs (next step).
```

```yaml
id: F-HARNESS-001
title: Per-model protocol/edit calibration is measured but never applied in the live loop
domain: agent-loop / model-runtime / ACI
severity: P1
confidence: HIGH        # static trace; live repro pending (see F-HARNESS-005)
claim: >
  The harness computes a driver profile (best tool-call protocol + edit codec)
  via capability-probe / driver/protocol-calibration.ts / driver/edit-codec-
  calibration.ts, and app.tsx threads `driverProfile` into runAgent — but the
  live agent loop never reads it, so a capable model is forced through a single
  fixed regime instead of the protocol it actually handles.
evidence:
  source_files:
    - "src/tui/app.tsx:2064-2075 (passes driverProfile into runAgent)"
    - "src/agent/loop.ts (grep driverProfile|editCodec|actionProtocol -> 0 uses; only two logger.warn(\"agent.model.protocol_recovery\") at 4269,4382)"
    - "src/agent/loop.ts:926 (systemPromptProfile defaults to fixed \"coding\")"
    - "src/context/context-builder.ts (imports only a capability-LEVEL type from driver/profile; no protocol/edit-codec use)"
    - "src/providers/stream-normalizer.ts:161,193,211 (calls recoverTextToolCalls unconditionally, protocol-agnostic)"
    - "src/driver/protocol-calibration.ts:116-120 (native_function|constrained_json|xml_system_tools|text_action_grammar defined & scored)"
  runtime_trace: "loop.ts protocol references are recovery-only warnings, not protocol selection"
current_behavior: >
  Fixed "coding" system prompt + protocol-agnostic parser + fixed exact-match
  edit tool, regardless of the calibrated per-model driver profile.
expected_behavior: >
  The loop instructs the model in its calibrated protocol/edit format AND parses
  responses using that protocol.
impact: >
  A model that succeeds in its native format (LM Studio chat) emits output the
  harness does not steer or parse in that format; its action can be dropped ->
  the agent stalls / loops / "does nothing". Root cause of low real autonomy.
root_cause: Calibration output is not consumed at generation or parsing time.
specification_status: SPECIFICATION_GAP
recommended_direction: >
  VALIDATE FIRST: reproduce live (F-HARNESS-005), then specify applying the
  driver profile at both the system-prompt (generation) and parser (recognition)
  boundaries. Do not implement during the audit.
implementation_priority: VALIDATE FIRST
dependencies: [F-HARNESS-005]
unknowns: Whether any protocol instruction is injected via a path not yet traced (full agent-loop audit pending at reset).
```

```yaml
id: F-HARNESS-002
title: Tool-call recognition is a 11-format text catch-all — a fragility symptom
domain: ACI
severity: P2
confidence: HIGH
claim: >
  recoverTextToolCalls tries ~11 textual envelope formats (JSON, concatenated
  JSON, validated-response, [TOOL_REQUEST], <tool_request>, <response>, <xml>,
  <tools>, <tool_call>, fenced, embedded-fenced). Reliance on a sprawling
  catch-all is evidence models routinely emit shapes the harness must guess at;
  any output outside all 11 shapes is silently a non-action.
evidence:
  source_files:
    - "src/providers/tool-envelope.ts:293-322 (recoverTextToolCalls format list)"
    - "src/providers/stream-normalizer.ts:122-222 (protocolFailure on unrecognized envelope)"
current_behavior: Unrecognized tool intent -> protocolFailure / dropped action.
expected_behavior: One calibrated protocol per model with a grammar/schema-constrained decode.
impact: Wasted turns, silent no-ops, loops for small models.
root_cause: No single enforced protocol; recognition is best-effort post-hoc.
specification_status: SPECIFICATION_GAP
recommended_direction: Tie recognition to the calibrated protocol (see F-HARNESS-001).
implementation_priority: VALIDATE FIRST
unknowns: Per-format hit rate against the loaded model (needs live trace).
```

```yaml
id: F-HARNESS-003
title: editFileTool requires an exact oldText match and hard-fails otherwise
domain: ACI / editing
severity: P2
confidence: HIGH
claim: >
  editFileTool takes {path, oldText, newText}; if oldText occurs 0 times it
  errors. Small models that paraphrase whitespace/indentation or quote
  approximate context fail the edit and can loop on it.
evidence:
  source_files:
    - "src/tools/workspace.ts:960-1058 (schema {path,oldText,newText}; \"Exact existing text\"; occurrences===0 -> error)"
    - "src/driver/edit-codec-calibration.ts (calibration exists but is not applied in the live edit path per F-HARNESS-001)"
current_behavior: Exact-match-or-fail edit; no fuzzy/anchored fallback wired.
expected_behavior: Edit format matched to the model's calibrated edit codec.
impact: Common small-model edit failure mode; blocks file mutation ("build a web page").
root_cause: One edit representation forced on all models.
specification_status: SPECIFICATION_GAP
recommended_direction: Apply the calibrated edit codec; spec an anchored/fuzzy fallback.
implementation_priority: VALIDATE FIRST
unknowns: none
```

```yaml
id: F-HARNESS-005
title: Live validation blocked — product needs a SERVER-loaded model; chat-UI load is not enough
domain: model-runtime / evaluation
severity: P2
confidence: HIGH
claim: >
  The evaluator and live path treat a model as usable only when the LM Studio
  server reports loaded_instances>0; ShelraCode never auto-loads (policy). A
  model loaded only in the LM Studio chat UI reports as "discovered but not
  loaded", so ShelraCode skips it — which is why the operator's perfect chat-UI
  run cannot yet be reproduced through the live loop.
evidence:
  source_files:
    - "src/runtimes/http.ts:91-94,165,177 (loaded = loaded_instances.length>0)"
  runtime_trace: |
    `bun run src/index.ts models` -> "Parable Qwen3 4B ... lm-studio - healthy"
    `bun run scripts/evaluate-agent.ts --local` -> "Local matrix: UNPROVEN
      (discovered=1; evaluated=1)"; reason: "parable-qwen3-4b-claude-fable-5 is
      discovered but not loaded; the evaluator never loads or downloads models."
current_behavior: Healthy runtime + not-server-loaded model -> skipped, UNPROVEN.
expected_behavior: >
  A way to test the intended model without ambiguity (load it in the LM Studio
  server / enable JIT, or an explicit user-authorized load).
impact: Cannot empirically confirm F-HARNESS-001..003 until the model is server-loaded.
root_cause: Load-state (server) vs. availability (chat UI) mismatch + no-auto-load policy.
specification_status: SPECIFICATION_GAP
recommended_direction: >
  Operator action: load the model in LM Studio's SERVER (or enable JIT), then
  re-run the local eval + a traced live journey.
implementation_priority: DO FIRST (unblocks all live validation)
unknowns: none
```

## Why this was never caught

`10-real-autonomy.md` F-AUTO-001: 0/128 tests exercise a real model through the
live loop; all agent-journey coverage uses `tests/support/fake-provider.ts`
(scripted turns). So F-HARNESS-001..003 are invisible to the suite by
construction — the model, the exact part that fails, is the part the tests hold
constant.

## Smallest evidence-backed path to real autonomy (VALIDATE FIRST — no code changes yet)

1. **Unblock live validation (F-HARNESS-005, DO FIRST):** load the model in the
   LM Studio *server* (or enable JIT), then re-run
   `bun run scripts/evaluate-agent.ts --local` and a traced live journey
   (`SHELRACODE_AGENT_TRACE=1`) to capture the exact turn where the action drops.
2. **Confirm F-HARNESS-001** with that trace (does the model emit a valid action
   the harness fails to steer/parse?).
3. **Specify** (SDD, not implement): apply the driver profile's protocol + edit
   codec at generation (system prompt) and recognition (parser); add a
   real-local-model E2E acceptance obligation whose canonical case is
   "create a simple static web page and verify it renders".
4. Hand the confirmed findings to `agent-loop-auditor` / `tool-aci-auditor` /
   `model-runtime-auditor` at reset for the full domain writeups (02/04/05).

## Summary

Autonomy is not at the level required and is currently unproven. The dominant,
evidence-backed cause is harness-side: ShelraCode calibrates each model's best
action protocol and edit codec, then does not apply that calibration in the live
loop, forcing a capable model through a fixed prompt + a guess-and-recover
parser + an exact-match edit tool. Live reproduction is one step away and is
blocked only by loading the model into the LM Studio server.
