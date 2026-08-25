# Model Capability Evidence

`probeAgentCapability()` evaluates the exact provider/model pair with protocol
probes and, during capability-aware local discovery, a disposable executable
pass:

1. greeting without a tool call;
2. valid `ReadFile` selection and arguments;
3. continuation after a tool result;
4. valid `EditFile` selection and continuation;
5. `RunTests` selection and continuation after a failing observation;
6. actual `EditFile` mutation in a temporary fixture;
7. actual fail -> inspect/edit -> retest -> pass iteration in that fixture.

## Current routing policy — 2026-08-25

Probe results remain valuable reproducible evidence, but the resulting class
is not an unconditional route veto. The router can attempt a policy-valid
local candidate with executable tools even when the class is `chat_only`,
`workspace_reader`, or unmeasured. The class affects score and fallback
preference; the agent loop, host verification, and completion gate decide
whether the task actually succeeded. The live probe and doctor reports below
remain model-behavior evidence, not a claim of frontier parity.

The result is persisted on `ModelCandidate.agentProbe` during capability-aware
discovery and is consumed by the router as a score/fallback signal. Unprobed
local candidates are reported as unmeasured rather than silently claimed to be
coding agents, but they are not rejected solely for lacking a probe when their
tools and policy boundary are executable.

The current probe intentionally distinguishes deterministic harness evidence
from live-model evidence. It classifies `chat_only`, `workspace_reader`,
`coding_agent`, or `advanced_coding_agent` only after the corresponding edit
and verification behavior passes. The installed qwen model now passes the
host-recovered read path but fails edit/test behavior and is therefore
`workspace_reader`, not a coding agent.

`localcode doctor --agent` displays the current result and reports
`Autonomous coding NOT READY` unless the required capability evidence exists.

## Fresh live result — 2026-08-24

```text
Model       qwen2.5-coder-1.5b-instruct
Runtime     LM Studio OpenAI-compatible local endpoint
Probe       version 4 (protocol recovery plus disposable edit/test execution)
Class       workspace_reader
```

| Probe              | Result                           |
| ------------------ | -------------------------------- |
| Conversation       | FAIL                             |
| No-tool discipline | FAIL                             |
| Repository read    | PASS                             |
| Tool selection     | PASS                             |
| Arguments          | PASS                             |
| Recovery           | NO VERIFICABLE in doctor summary |
| Multi-turn         | PASS                             |
| Editing            | FAIL                             |
| Test iteration     | FAIL                             |
| Verification       | FAIL                             |

The read result includes host-side recovery for LM Studio's textual
`<tools>...</tools>` envelope and a duplicate-call fallback that retries the
continuation with tools disabled. This is protocol recovery evidence, not
evidence that the model can autonomously edit or verify code. Capability cache
entries carry the probe version so older measurements are not reused after
probe semantics change.

## Latest live result after deterministic-generation and probe-gate fixes — 2026-08-24

The capability probe is now version 8. It sends `temperature: 0` and a bounded
output cap during capability checks, measures the `PATH_IS_FILE` -> `ReadFile`
recovery path, and does not mark executable editing/test behavior as passing
when the protocol gate skipped the disposable execution phase.

Fresh `bun run src/index.ts doctor --agent` evidence:

```text
Model                         qwen2.5-coder-1.5b-instruct
Runtime                       lm-studio
Capability                    workspace_reader
Conversation                  FAIL
No-tool discipline            FAIL
Repository read               PASS
Tool selection                PASS
Arguments                     PASS
Recovery                      PASS
Multi-turn                    PASS
Editing                       FAIL
Test iteration               FAIL
Verification                 FAIL
Autonomous coding             NOT READY
```

The model remains ineligible because it emits a tool action for the probe's
plain greeting when tools are technically available. The runtime endpoint is
healthy and the host parser recovers its textual tool envelope, but this model
does not meet the no-tool-discipline and executable coding gate.

## Model identity reconciliation — 2026-08-24

LM Studio native discovery now records the model's provider `key` separately
from its display label. Capability probes, capability-cache keys, and agent
requests use `modelId` (`qwen2.5-coder-1.5b-instruct`), while diagnostics may
show `Qwen2.5 Coder 1.5B Instruct`. This prevents a readable label from being
sent to the runtime as though it were the wire identifier. The regression is
covered by runtime, agent-loop, and capability-probe tests.

The live metadata observed for the installed model is `Q8_0` and context
length `32768`; native metadata is descriptive evidence only and does not
override empirical capability results. The current class remains
`workspace_reader`.

Probe version 8 also persists the generation profile (`temperature: 0`,
`maxOutputTokens: 512`) and the hardware snapshot used for the live result.
The stored evidence records Windows x64, the Ryzen 9 9955HX, 32 CPU cores,
15.2 GB memory, and the reported DirectML-possible accelerator.

## Qwen2.5 Coder 7B live result — 2026-08-24

The newly available local candidate was probed with the same deterministic
settings and a disposable executable workspace:

```text
Model ID       qwen2.5-coder-7b-instruct
Runtime        lm-studio
Quantization   Q6_K
Context        32768
Probe version  11
Generation     temperature=0, maxOutputTokens=512
Hardware       Windows x64, Ryzen 9 9955HX, 32 cores, 15.2 GB RAM
```

| Probe                                   | Result                          |
| --------------------------------------- | ------------------------------- |
| Conversation / no-tool discipline       | PASS                            |
| Repository read / selection / arguments | PASS                            |
| Multi-turn continuation                 | PASS                            |
| PATH_IS_FILE recovery                   | FAIL                            |
| Protocol edit selection                 | FAIL in the complete probe path |
| Executable edit                         | FAIL                            |
| Test iteration                          | FAIL                            |
| Verification                            | FAIL                            |
| Classification                          | `workspace_reader`              |

The model can complete a real one-file edit plus `bun test` in a disposable
fixture (`COMPLETED`, `verified=true`). A separate multi-file task was run
with direct wording and stopped while describing the next action, with zero
writes and no verification. This is positive evidence for workspace reading
and bounded simple edits, but not for autonomous multi-file coding.

The model/runtime combination returned textual tool envelopes rather than
native `tool_calls`. LocalCode now recovers the observed `<response>`, fenced
XML, `<xml>`, and embedded fenced JSON forms. That harness repair improves
simple-task execution but does not replace the empirical capability gate.

## Qwen2.5 Coder 1.5B comparison - 2026-08-24

The installed `qwen2.5-coder-1.5b-instruct` (`Q8_0`, context `32768`) was
run through the same real LM Studio adapter and disposable simple-edit
fixture. It changed `src/message.ts` and passed `bun test`, but ended
`blocked` after an unnecessary `SearchText` call. This is bounded edit
evidence, not autonomous-coding eligibility; the capability class remains
`workspace_reader`.

The 7B model remains the strongest installed local candidate, but it also
remains `workspace_reader` because its complex multi-file journey did not
reach implementation and verification.

## Latest criteria-gated live result - 2026-08-24

After host recovery and semantic completion gating were enabled, the 7B model
completed the one-file greeting task with all explicit criteria satisfied.
On the complex math fixture it changed only `src/math.ts`, corrected `add`,
and passed the focused test; it did not implement/export/test `multiply`.
The criteria verifier therefore returned `BLOCKED`, not `COMPLETED`. This is
evidence that the kernel now distinguishes partial verified progress from a
complete engineering objective; it does not upgrade the model's capability
class.

## Qwen2.5 14B Instruct live capability - 2026-08-24

Fresh official capability-probe evidence for the local LM Studio pair:

```text
Model ID       qwen2.5-14b-instruct
Display        Qwen2.5 14B Instruct
Runtime        lm-studio
Quantization   Q4_K_M
Context        32768
Probe version  11
Generation    temperature=0 maxOutputTokens=512
Hardware      Windows x64, Ryzen 9 9955HX, 32 cores, 15.2 GB RAM
Class          advanced_coding_agent
```

| Capability                              | Result |
| --------------------------------------- | ------ |
| Conversation / no-tool discipline       | PASS   |
| Repository read / selection / arguments | PASS   |
| Multi-turn continuation                 | PASS   |
| `PATH_IS_FILE` recovery                 | PASS   |
| Executable edit                         | PASS   |
| Failing-test iteration                  | PASS   |
| Verification behavior                   | PASS   |

The probe is persisted in the local capability database and survives
`doctor --agent` discovery. The doctor output is now:

```text
Capability                    advanced_coding_agent
Conversation                  PASS
No-tool discipline            PASS
Repository read               PASS
Tool selection                PASS
Arguments                     PASS
Recovery                      PASS
Multi-turn                    PASS
Editing                       PASS
Test iteration                PASS
Verification                 PASS
Autonomous coding             READY
```

The 14B route is eligible for complex coding only because of this exact
model/runtime evidence; model size or a display name does not grant the class.
