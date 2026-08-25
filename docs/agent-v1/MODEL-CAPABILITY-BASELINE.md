# Model capability baseline

The unit of evidence is the complete configuration:

```text
model x runtime x quantization x context/template x harness
```

Parameter count and a model name are not capability proof.

## Historical local runs before progressive staging

The live script used a disposable temporary Git repository and LM Studio at
127.0.0.1:1234. No remote or paid route was used.

| Configuration                                    | Task                   | Turns | Tools/verification                                               | Outcome                                | Classification                           |
| ------------------------------------------------ | ---------------------- | ----: | ---------------------------------------------------------------- | -------------------------------------- | ---------------------------------------- |
| Qwen2.5-Coder-7B-Instruct, Q6_K, context 32768   | bounded message edit   |     5 | ReadFile, EditFile, RunTests; tests passed                       | completed, verified                    | Evidence supports bounded coding         |
| Qwen2.5-Coder-7B-Instruct, Q6_K, context 32768   | multi-file math change |    13 | GlobFiles, ReadFile, EditFile; NOT_FOUND, CONFLICT, failing test | blocked, verified false                | Not proven for complex autonomous coding |
| Qwen2.5-Coder-1.5B-Instruct, Q8_0, context 32768 | bounded message edit   |     5 | ReadFile, EditFile, SearchText; focused test passed              | blocked, verified false, no final text | Not coding-eligible from this run        |

The 1.5B result is nuanced: the intended file mutation and test succeeded,
but the task did not satisfy the kernel's full completion path because the
model made an unnecessary post-verification search and did not produce a
terminal answer.

## Capability probe status

src/agent/capability-probe.ts and the control-plane cache path exist. A fresh
all-model probe matrix, including runtime version, chat-template fingerprint,
sampling profile and repeatable pass-rate metrics, was not run in this audit.
Therefore no current 1B/3B/7B/14B product label is asserted.

## Historical routing conclusion

The router has capability gates, but current fresh evidence supports only:

- conversation/read-only behavior: deterministic tests;
- bounded local coding: 7B live pass;
- complex local coding: not proven;
- 1.5B autonomous coding: not proven.

The correct current user-facing behavior for an incapable configuration is an
actionable blocked/reroute result, not a generic coding-agent promise.

## Progressive harness result — 2026-08-25

The exact Qwen2.5 Coder 1.5B Instruct / LM Studio / Q8_0 configuration was
rerun through the staged host controller, not the old monolithic coding path.
It completed the disposable multi-file objective in 9 turns with three
successful host verification stages and all four fixture content checks true.
The same configuration completed the one-file edit in 3 turns.

This is a harness-conditioned capability result. It supports exposing a
guarded progressive coding route for bounded, explicitly localized tasks; it
does not upgrade the model to `advanced_coding_agent` or justify advertising
unrestricted autonomous repository engineering.

## Final repeated evidence - 2026-08-25

After the final recovery changes, the same exact configuration passed two
consecutive runs of the disposable three-file objective:

    model: Qwen2.5 Coder 1.5B Instruct
    runtime: LM Studio
    quantization: Q8_0
    temperature: 0
    turns: 10 per run
    status: completed
    verified: true
    verification: 3 passing host-controlled stages per run

The run is therefore a valid bounded acceptance signal for ordinary users
with modest hardware. It does not establish arbitrary super-complex
repository reliability, and the route must remain progressive and
capability-gated.

The updated agent doctor now reports the complete local matrix instead of
arbitrarily presenting the first detected runtime model. Current output:

    Qwen3 8B                         chat_only
    Qwen2.5 Coder 7B Instruct       workspace_reader
    Qwen2.5 Coder 1.5B Instruct     workspace_reader
    Progressive coding               READY
    Bounded coding                   NOT READY
    Autonomous coding                NOT READY

This makes the accessible path discoverable without weakening the hard gate
for arbitrary multi-file autonomous coding.
