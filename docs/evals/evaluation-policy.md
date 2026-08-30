# ShelraCode evaluation policy

**Status:** Phase 0 policy baseline  
**Effective date:** 2026-08-27  
**Applies to:** Shelra Lab, driver calibration, capability promotion, Skills,
delegation, runtime changes, and release certification

## Policy objective

ShelraCode evaluates the behavior of an exact model + artifact + runtime +
configuration + driver + host environment. A model name, model card, parseable
tool call, scripted-provider test, or successful demonstration is not a
capability certificate.

Authority follows repeatable measured behavior. When evidence is incomplete,
the runtime must preserve or reduce authority rather than infer capability.

## Normative terms

`MUST`, `MUST NOT`, `SHOULD`, and `MAY` are requirements for the evaluation and
certification implementation.

Evidence labels used in reports:

- `VERIFIED_LOCAL_DETERMINISTIC`: a fresh deterministic command or host test
  passed in the named source/worktree.
- `VERIFIED_REAL_MODEL`: the exact named local model/runtime/configuration ran
  and objective verification passed.
- `VERIFIED_EXTERNAL`: a current primary source supports a research claim.
- `UNPROVEN`: the required evidence was not produced; this is not equivalent to
  failure or success.
- `BLOCKED`: a required run could not execute because of a recorded external or
  environmental dependency.

Every report MUST distinguish source evidence, generated-artifact evidence,
installed-artifact evidence, and external/production evidence.

## Evidence classes are not interchangeable

| Evidence                         | What it can establish                                | What it cannot establish                                 |
| -------------------------------- | ---------------------------------------------------- | -------------------------------------------------------- |
| Unit/parser/schema test          | host logic for the tested inputs                     | model semantic correctness or autonomy                   |
| Scripted/fake-provider journey   | deterministic loop/tool/verification behavior        | real-model tool selection or recovery                    |
| Real-model protocol probe        | behavior on the exact probe/configuration            | repository-task completion                               |
| Real-model repository task       | behavior on that task and exact configuration        | broad generalization from one run                        |
| Source CLI smoke                 | source command launches and handles the checked path | generated executable provenance                          |
| Bundle/executable smoke          | that artifact handles the checked path               | current-source equivalence or interactive TUI acceptance |
| Public benchmark                 | reference compatibility on its distribution          | ShelraCode release authority                             |
| Protected repeated certification | evidence for the tested capability tier              | a higher or materially different tier                    |

Fake-provider success MUST never be totaled together with real-model success.
An aggregate report MAY show both, but it MUST preserve separate denominators,
labels, and raw evidence references.

## Evaluation layers

ShelraCode MUST maintain separate layers:

1. **Deterministic host correctness** — schemas, parsers, state transitions,
   tools, policies, persistence, verification, and failure handling.
2. **Controlled integration** — filesystem/process boundaries, adapters,
   repository intelligence, sandbox behavior, and restart/rehydration.
3. **Real-model probes** — protocol, action selection, arguments, edit codecs,
   verification choice, honesty, and recovery for an exact identity.
4. **Real-repository tasks** — micro, multi-file, long-horizon, security,
   durability, and false-success tasks.
5. **Protected certification** — held-out tasks and acceptance logic that were
   unavailable to the implementation model and training/export path.

A failure in a lower host/security layer blocks a dependent capability claim
even if a model completes a higher-layer demonstration.

## Evaluation case contract

Phase 1 MUST implement a versioned, validated case schema. At minimum, every
case needs:

```yaml
schemaVersion: number
caseId: string
revision: string
title: string
family: host | protocol | edit | micro | multi_file | long_horizon | security | durability | false_success
capabilityTarget: C0 | C1 | C2 | C3 | C4 | C5 | C6
workspaceFixture:
  source: string
  digest: string
objective: string
policy:
  writeAuthority: string
  networkAuthority: string
  commandPolicy: string
budgets:
  actions: number
  inputTokens: number | null
  outputTokens: number | null
  wallClockMs: number
visibleAcceptance: []
protectedAcceptanceRef: string | null
tags: []
```

Expected patches, hidden assertions, protected verifier source, and task-ID
shortcuts MUST NOT appear in model-visible fields.

## Run manifest and reproducibility

Every real-model run MUST persist a manifest before invocation. The manifest
MUST identify:

- case schema/revision and workspace fixture digest;
- exact source state: commit plus dirty-diff digest or immutable source bundle;
- generated/installed artifact digests when either is exercised;
- exact model identity, including artifact ID/hash when obtainable;
- quantization, tokenizer, runtime and version;
- endpoint protocol, chat/tool template, structured-output/grammar mode;
- reasoning and sampling configuration;
- context/KV configuration and output budget;
- OS, relevant hardware/backend identity, and runtime launch configuration;
- Driver profile ID/version and tool/edit codec surface;
- random seed or explicit statement that the provider cannot guarantee one;
- task policy, legal action schema digest, environment variables allowlist, and
  command used;
- start/end timestamps and termination reason.

The raw model response, normalized action, environment observation, verifier
result, evidence references, failure class, and state digest MUST be retained
for each step after secret redaction.

A failing action is reproducible only when another operator can reconstruct the
case, identity, driver representation, budget, and environment from the
manifest. Printing a summary to stdout is insufficient.

## Exact identity and invalidation

Certification MUST be keyed to an `ExactModelIdentity`, not provider/model ID
alone. At minimum, the identity includes the fields required by the governing
architecture: artifact/hash, quantization, runtime/version, endpoint, templates,
structured-output and reasoning modes, tokenizer, context/sampling settings,
OS, and relevant hardware fingerprint.

Changing any behaviorally material identity field MUST invalidate or degrade
the corresponding profile until required probes are repeated. An uncalibrated,
invalidated, expired, or stale profile MUST have no autonomous write or network
authority.

If a runtime cannot expose a required identity field, reports MUST say
`unknown`; they MUST NOT synthesize a value. Policy decides whether that
unknown field blocks a tier.

## Protocol and semantic scoring

Protocol evaluation MUST record these dimensions separately:

- `parse_valid`;
- `schema_valid`;
- `legal_action`;
- `arguments_valid`;
- `semantic_action_correct`;
- `environment_success`;
- `progress_made`;
- `verification_success`;
- `false_success`;
- `loop_detected`.

A response with valid JSON/XML/native-tool syntax but the wrong action is a
semantic failure. A correct action that fails because of an environment defect
must preserve both observations rather than collapse them into one score.

Candidate protocols, edit codecs, tool surfaces, context budgets, reasoning
modes, and recovery policies MUST be compared on the same task distribution
and compatible budgets. Unsupported alternatives are reported as unsupported;
they are never simulated to manufacture a comparison.

## Acceptance obligations and evidence

Each task MUST be compiled into explicit, stable acceptance obligations before
consequential execution. Required obligations remain authoritative across
turns, compaction, restart, and recovery.

Completion is accepted only when host-side evidence satisfies every required
obligation. The model's `task.complete` proposal is an input to the completion
gate, not proof.

Evidence records MUST include source, timestamp, summary, and a digest or
artifact reference where feasible. Command evidence also records the exact
command and exit code. Reports MUST state when a verifier is unavailable or an
obligation requires human/manual evidence.

Any deterministic false completion is a hard failure and blocks the dependent
phase and release.

## Result states

Use the following per-case states:

- `PASS`: all required obligations are objectively satisfied;
- `FAIL`: a required obligation was attempted and failed, or a hard policy
  failure occurred;
- `BLOCKED`: an external/environmental dependency prevented a required attempt;
- `UNPROVEN`: no qualifying attempt/evidence exists;
- `SKIPPED`: policy intentionally excluded the case, with a recorded reason.

`UNPROVEN`, `BLOCKED`, and `SKIPPED` MUST NOT be converted to `PASS`. A matrix
cannot be called fully passing when its denominator silently excludes them.

## Real-model trial discipline

One lucky run is not certification. For stochastic or nondeterministic model
behavior:

- use repeated trials on the same versioned case set;
- report primary first-attempt success and all-trial results;
- report failures and raw traces, not only successful exemplars;
- report variance or confidence intervals when the sample supports it;
- pair comparisons by task and trial policy;
- preserve timeouts, refusals, and malformed responses in the denominator;
- never rerun only failed cases until a favorable exemplar appears.

The minimum trial count for each certification tier will be versioned with the
protected certification suite. Phase 0 does not invent a statistically
unsupported universal number.

## Held-out and contamination policy

Protected evaluation material MUST be physically and logically separated from
implementation-agent context and training exports.

- Public case metadata MAY expose the task family, policy, and visible
  acceptance criteria.
- Gold patches, hidden checks, protected verifier source, and expected action
  traces MUST remain restricted.
- Implementation prompts MUST NOT contain protected answers.
- Runtime trajectories used for training MUST carry case provenance and MUST
  exclude protected acceptance data.
- Benchmark wording, task ID, fixture path, or hidden-test filename MUST NOT be
  used as a solution signal.
- A protected case exposed to implementation or training is contaminated and
  cannot certify that model/artifact.

Newly authored and real-repository cases SHOULD supplement public benchmarks.
Public benchmark results remain research references rather than release
authority.

## Security and false-success hard failures

The following automatically fail the case and reject any affected release
claim:

- deterministic false completion;
- unauthorized write or command-policy bypass;
- workspace or symlink escape;
- strict-zero network escape;
- secret disclosure into prompts, observations, logs, snapshots, or exports;
- write/network authority granted to an unmeasured, invalidated, or stale
  profile;
- resume that silently creates a new cognitive task;
- protected expected answers visible to implementation/training;
- real-model evidence absent for a claimed coding capability;
- release artifact not tied to exact source/configuration;
- benchmark/task wording special-casing;
- weakened or removed regression tests solely to obtain a green gate.

Security policy MUST be evaluated independently of model cooperation. Prompt
obedience does not satisfy an enforcement test.

## Optional capability and Skill evaluation

A Skill, retrieval provider, subagent, expert path, verifier, or other optional
capability is a hypothesis. Automatic activation requires a paired OFF/ON
evaluation with the same:

- task distribution;
- exact model artifact/runtime;
- Driver protocol and edit codec;
- context and output budgets;
- randomization/trial policy;
- security and task policy.

Compare task success, false success, actions, tokens, wall time, interventions,
loops, security failures, and verifier success. No demonstrated benefit means
the capability remains disabled or opt-in. A capability that raises nominal
success while materially worsening false success or security fails promotion.

The paired runner uses explicit trial identities and requires repeated trials
per task (two by default) plus complete coverage of the metrics used for
comparison. Missing optional measurements cannot be interpreted as zero cost or
zero risk. Repository-authored Skill metadata never counts as host-owned
paired evidence.

## Capability-level policy

The highest advertised level is the highest level whose complete protected
gate passes for the exact profile:

- C0 Chat
- C1 Reader
- C2 Micro Coder
- C3 Bounded Coding Agent
- C4 Multi-file Agent
- C5 Durable Agent
- C6 Advanced Autonomous Engineer

Passing a lower tier does not imply the next tier. Capability can differ by
tool surface, repository/language distribution, write/network policy, and
runtime configuration; reports MUST expose those restrictions.

## Required metrics

Evaluation summaries MUST retain, where applicable:

- task and verification success rates;
- false-success rate;
- parse validity and semantic-action accuracy;
- edit apply and edit semantic-success rates;
- localization success;
- mean/median actions to success;
- repeated-loop and recovery-success rates;
- human intervention rate;
- context/output tokens and wall time to success;
- security-failure rate;
- resume-success rate;
- profile-invalidation correctness.

Metrics MUST keep denominators and `PASS`/`FAIL`/`BLOCKED`/`UNPROVEN`/`SKIPPED`
counts visible. Optimization of one metric cannot hide false-success or
security degradation.

## Current baseline classification

As of 2026-08-27:

- the 18/18 deterministic evaluator result is
  `VERIFIED_LOCAL_DETERMINISTIC` and uses scripted/fake model behavior;
- the available LM Studio Qwen2.5-Coder 7B Q6_K configuration completed one
  verified temporary-fixture micro edit;
- that same probe failed error recovery and left repository reasoning
  unmeasured;
- 17 other local journey types are `UNPROVEN`;
- no protected held-out mechanism, repeated real-model evidence bundle, or
  model-specific capability certificate exists;
- the current `coding_agent` classifier result does not confer C2+ authority
  under this policy.

See `docs/research/current-repo-baseline.md` for commands and detailed evidence.

## Phase and release gate operation

Each roadmap phase report MUST include repository evidence, changes, exact
commands/results, real-model evidence separated from deterministic evidence,
metrics, risks/regressions, `PASS | FAIL | BLOCKED`, and next-phase eligibility.

- `PASS`: every phase exit condition is satisfied; explicitly allowed baseline
  failures may be carried only when the phase specification says they may be
  recorded instead of repaired.
- `FAIL`: an exit condition failed or a hard failure occurred. Do not proceed.
- `BLOCKED`: the exit condition could not be evaluated after in-scope attempts.
  Do not claim it passed.

Independent verification is required for consequential implementation phases.
The verifier reads the obligations, diff, and raw evidence rather than trusting
the implementer's summary.

## Phase 1 acceptance handoff

Shelra Lab foundations must, at minimum:

1. implement validated evaluation-case and run-manifest schemas;
2. persist raw step/run evidence and summaries before/after invocation;
3. capture exact identity or explicit unknown fields;
4. include dirty-source or immutable-source provenance, not only `HEAD`;
5. separate protected expectations from model-visible task data;
6. reproduce at least one frozen failed real-model action from a manifest;
7. retain current deterministic fixtures as host tests without relabeling them
   as autonomy evidence.

No Phase 1 abstraction is accepted if it cannot represent malformed, refused,
timed-out, semantically wrong, or partially successful raw model behavior.

The implemented schema, storage, redaction, held-out boundary, and bounded
offline replay contract are documented in `docs/evals/run-artifacts.md`.
