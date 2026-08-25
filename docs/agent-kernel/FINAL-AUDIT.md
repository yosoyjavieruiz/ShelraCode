# LOCALCODE AUTONOMOUS AGENT PROGRAM

Final audit date: 2026-08-24

Release decision: **FAIL for the full live autonomous-coding MVP**. The
deterministic Agent Kernel and the complete browser-conditioned repository
suite are green, but the only configured local model is correctly classified
as `workspace_reader`, so no eligible live coding route exists. No UI
redesign work was performed.

## RESEARCH

Completed. Current official runtime/agent documentation and the original
ReAct, Toolformer, Reflexion, and SWE-agent papers were checked on 2026-08-24.
The source/date/finding/consequence/authority ledger is in
[RESEARCH.md](RESEARCH.md). Representative primary sources were
[OpenAI's Codex agent-loop description](https://openai.com/index/unrolling-the-codex-agent-loop/),
[Claude Code permissions](https://code.claude.com/docs/en/permission-modes),
[OpenCode compaction](https://opencode.ai/v2/docs/compaction), and
[llama.cpp server/tool documentation](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md).

Important architectural findings:

- The model is only one factor; tool contracts, normalized streams, policy,
  context, recovery, and verification must be host-owned.
- Mature coding agents make permissions, task lifecycle, context management,
  compaction, and completion evidence structural rather than prompt-only.
- Local model eligibility must be measured for the exact model/runtime/template
  combination. A model name containing `Coder` is not evidence of agentic
  capability.

## AUDIT

Initial autonomy: **1.6 / 10**

Initial harness: **2.0 / 10**

Initial local model agent capability: **1.5 / 10**

Initial overall autonomous coding maturity: **1.6 / 10**

The baseline was taken from the dirty checkout before implementation. The
active entrypoint was `package.json -> src/index.ts`; `dist/index.js` was not
treated as the active artifact. Initial evidence was 9 functional tests green,
194 full-suite tests green and 7 failing, with the live repository-language
journey producing an invalid tool path and no grounded answer.

Initial dimension scores (0-10, evidence-based audit estimates):

| Dimension                  | Score |
| -------------------------- | ----: |
| Natural conversation       |     5 |
| Intent understanding       |     2 |
| Repository understanding   |     2 |
| Context relevance          |     2 |
| Context sufficiency        |     0 |
| Tool selection             |     2 |
| Tool argument validity     |     1 |
| Multi-turn tools           |     3 |
| Error recovery             |     1 |
| Planning                   |     0 |
| Multi-step execution       |     2 |
| Code editing               |     3 |
| Shell execution            |     3 |
| Test/debug iteration       |     1 |
| Verification               |     0 |
| Completion truthfulness    |     0 |
| Git safety                 |     4 |
| Cancellation               |     2 |
| Model capability detection |     1 |
| Routing                    |     4 |
| Long-task stability        |     1 |
| Context compaction         |     0 |
| Subagents                  |     0 |
| Observability              |     0 |
| Agent evaluations          |     2 |

Runtime call graph traced and implemented at these boundaries:

```text
USER INPUT
  -> src/tui/app.tsx
  -> resolveTurnMode / resolveTurnPolicy
  -> buildRepositoryContext
  -> ControlPlane.discoverModels / selectRoute
  -> ModelAdapter / normalized provider events
  -> runAgent (src/agent/loop.ts)
  -> typed tool validation and execution (src/tools)
  -> structured observation -> next model turn
  -> verification -> read-only review -> CompletionGate
  -> TUI transcript and persisted AgentTaskLedger
```

## ROOT CAUSES

1. **Live model/runtime capability failure.** The configured
   `qwen2.5-coder-1.5b-instruct` through LM Studio passes the host-recovered
   repository-read, selection, arguments, and multi-turn probes, but fails
   conversation/no-tool discipline plus editing, test iteration, and
   verification. The router now fails closed as `workspace_reader`; it does
   not pretend the model can code.

2. **Host/tool boundary weakness.** The old path exposed host-only arguments,
   leaked raw path-kind failures, and lacked a complete typed error taxonomy.
   Read/list/glob/search/process/git errors now have bounded structured
   observations and recovery suggestions. Non-zero shell/test exits are
   normalized as recoverable `COMMAND_FAILED`/`TEST_FAILED` evidence, and
   noisy command output is bounded before model continuation.

3. **Turn intent was not structural.** Conversation, knowledge, plan, review,
   workspace questions, coding, and command turns now receive distinct
   policies and tool subsets. Read-only wording cannot expose mutation tools.

4. **Completion was generation-led.** The loop previously allowed stopping
   generation to look like success. Completion now requires evidence,
   required verification, final review, preserved user work, and no blockers.

5. **No authoritative task/recovery ledger.** The loop lacked durable phase,
   evidence, actions, blockers, and verification state. `AgentTaskLedger`,
   observe/reflect transitions, typed recoverable errors, watchdogs, and
   cancellation/failure states now own that lifecycle.

6. **Long-horizon and independent live evidence remain incomplete.** Host-side
   compaction, tracing, a deterministic read-only verifier, and a same-session
   `/resume` restart exist, but no authorized strong live model, live
   model-vs-harness matrix, subagent execution, worktree orchestration, or
   live coding resume journey has been demonstrated; a real source-TUI
   conversational resume was exercised separately.

## AGENT KERNEL

| Capability          | Result | Evidence boundary                                                                                                                                |
| ------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Turn policy         | PASS   | Seven modes; structural tool subsets; unit and functional tests                                                                                  |
| Task ledger         | PASS   | Persistent SQLite ledger and lifecycle tests                                                                                                     |
| Context discovery   | PASS   | Repository snapshot, manifests/languages, scoped instructions, `.agents` exclusion                                                               |
| Context sufficiency | PASS   | Host evidence gate blocks unsupported repository answers                                                                                         |
| Agent loop          | PASS   | Sequential fake-provider turns plus 24 functional acceptance scenarios and multi-stage verification regressions                                  |
| Observe / reflect   | PASS   | Structured observations, recovery, watchdog, replan/block behavior                                                                               |
| Tool contracts      | PASS   | Bounded schemas for read/list/glob/search/edit/write/shell/tests/git                                                                             |
| Typed errors        | PASS   | Complete taxonomy applied across workspace/process/git/provider boundaries                                                                       |
| Tool recovery       | PASS   | Invalid argument, missing path, file/directory, malformed-call recovery                                                                          |
| Multi-turn tools    | PASS   | Streamed/native/text envelopes remain separate from assistant prose                                                                              |
| Editing             | PASS   | Deterministic edits, stale-edit detection, checkpoint ownership                                                                                  |
| Shell               | PASS   | Structured result, timeout/cancel, destructive and network policy checks                                                                         |
| Tests               | PASS   | First-class `RunTests`, concise failures, iterative test evidence                                                                                |
| Verification        | PASS   | Host-owned `test -> typecheck -> lint -> build` plan, stage failure evidence, rerun after edit, read-only verifier                               |
| Completion gate     | PASS   | Model stop alone cannot complete a task                                                                                                          |
| Git safety          | PASS   | Checkpoint rollback refuses external edits; dirty-worktree fixture passes                                                                        |
| Cancellation        | PASS   | Abort propagation and cancelled ledger state pass deterministically; live coding cancellation remains unverified because the model is ineligible |

Fresh focused evidence:

```text
The current focused kernel additions are green; the full deterministic
functional gate is 24 pass / 0 fail / 86 expectations. The source TUI language
journey also completed with visible `Done` and `TypeScript` after host fact
context and bounded output generation.
bun run typecheck -> exit 0
```

## MODEL / RUNTIME CAPABILITY

Model: `qwen2.5-coder-1.5b-instruct`

Runtime: LM Studio OpenAI-compatible local endpoint

Quant: `Q8_0` from LM Studio native model metadata

Tool template: LM Studio runtime-managed; host recovery accepts the observed
textual `<tools>` envelope, but this does not make the model coding-eligible

Classification: **workspace_reader**

| Probe              | Result |
| ------------------ | ------ |
| Conversation       | FAIL   |
| No-tool discipline | FAIL   |
| Repository read    | PASS   |
| Tool selection     | PASS   |
| Arguments          | PASS   |
| Recovery           | PASS   |
| Multi-turn         | PASS   |
| Editing            | FAIL   |
| Test iteration     | FAIL   |
| Verification       | FAIL   |

Doctor evidence:

```text
Autonomous coding             NOT READY
```

## ROUTING

| Gate                      | Result                                                                                                                |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Capability hard gate      | PASS                                                                                                                  |
| Stronger local fallback   | PASS in deterministic selection and pre-mutation execution tests; no stronger installed local candidate was available |
| Free remote fallback      | NO VERIFICABLE; no live remote benchmark was run under current privacy/strict-zero policy                             |
| LOCAL ONLY hard guarantee | PASS in policy/provider-boundary tests                                                                                |
| No artificial local quota | PASS; local selection is constrained by fit, capability, runtime, and policy rather than LocalCode usage quota        |

The current route intentionally returns an explainable `STOP` when the only
candidate is below `workspace_reader` or `coding_agent`. This is a safe
failure, not autonomous coding success.

## FUNCTIONAL E2E

The deterministic harness suite is green:

```text
bun run test:functional
24 pass / 0 fail / 86 expectations
```

| Scenario                    | Result                |
| --------------------------- | --------------------- |
| Greeting                    | PASS                  |
| General knowledge           | PASS                  |
| Project language            | PASS                  |
| Symbol search               | PASS                  |
| Architecture explanation    | PASS                  |
| Plan only                   | PASS                  |
| Review only                 | PASS                  |
| Simple edit                 | PASS                  |
| Test execution              | PASS                  |
| Fix failing test            | PASS                  |
| Feature + tests             | PASS                  |
| Multi-file feature          | PASS                  |
| Invalid argument recovery   | PASS                  |
| File/directory recovery     | PASS                  |
| Missing path recovery       | PASS                  |
| Failing-test iteration      | PASS                  |
| Dirty worktree preservation | PASS                  |
| Cancellation                | PASS                  |
| Raw tool JSON               | ABSENT                |
| False-completion prevention | PASS                  |
| Chat-only model restriction | PASS                  |
| Stronger local fallback     | PASS (deterministic)  |
| Free remote fallback        | NO VERIFICABLE (live) |
| LOCAL ONLY hard enforcement | PASS                  |
| Completion evidence         | PASS                  |

Real source-path smoke evidence:

```text
bun run smoke -> PASS
source and rebuilt bundle help/version/doctor -> PASS
```

The real source TUI passed the greeting journey with no visible repository
activity and the repository-language journey with visible `Done` and
`TypeScript`. The latter used host-detected facts, root manifests, no model
workspace tools, and a bounded output request. This proves a workspace-reader
journey only; the live qwen model remains ineligible for coding.

The real source TUI also opened the persisted Sessions center, reopened a
saved task, accepted `/resume`, and completed a same-session conversational
restart. This does not establish coding resume because the only installed
model remains below the coding capability gate.

The package's canonical command was re-run against the current dirty checkout:

```text
306 pass / 0 fail / 1032 expectations
306 tests across 66 files
```

The package script supplies `--conditions=browser`, which keeps Solid signals
on the same runtime instance as OpenTUI. Bare `bun test` is not a valid
equivalent release command and can report false reactive-renderer failures.
The TUI behavioral regressions were re-run through the canonical command and
pass; no visual redesign was introduced.

## EXPERIMENTAL RESULTS

Small local + baseline:

```text
Live greeting: pass.
Live repository-language task: failed with invalid/unknown tool behavior and
no grounded answer in the baseline trace.
```

Small local + Agent Kernel:

```text
Deterministic harness: 24/24 functional acceptance scenarios pass;
agent-loop regressions also cover multi-stage verification and rerun-after-edit.
Live qwen: workspace-language journey completed through host facts; coding
refused because capability = workspace_reader.
```

Strong local + Agent Kernel:

```text
NO VERIFICABLE: no stronger eligible local model was installed/available.
```

Remote benchmark + Agent Kernel:

```text
NOT RUN: no live remote inference was called under the current privacy and
strict-zero boundary.
```

Hybrid:

```text
Deterministic capability gate and fallback policy pass.
Live hybrid task success is NO VERIFICABLE because no eligible local or
authorized benchmark route was available.
```

This is not a controlled model-scale experiment. The required live matrix
remains open and must not be inferred from the deterministic fake provider.

## COMPARATIVE AUTONOMY

Before: **1.6 / 10**

After: **6.8 / 10 for the deterministic Agent Harness; 3.8 / 10 for the
effective current product because the default local model is workspace-reader
only and live coding is unavailable.**

Current default local agent intelligence: **1.5 / 10**

Claude/Codex-class gap:

- no demonstrated complex live coding completion on an eligible model;
- no live eligible-model coding resume/restart journey; the source TUI now provides a
  same-session `/resume` restart that preserves the previous task ledger and
  re-evaluates the objective against current workspace state;
- no live long-horizon compaction evidence;
- no parallel mutation worktrees or subagent execution;
- no complete lower-level shell sandbox;
- no authorized strong-local/remote comparison matrix;
- no live complex coding journey because the only configured model is below the
  coding capability gate.

## P0 REMAINING

**1 / 15 blocking areas:**

1. An eligible live model/runtime/template that passes the coding and
   verification capability probes is not available in the current environment.

The focused deterministic P0 harness gates pass; this live-model boundary
still prevents claiming the user-facing autonomous-coding MVP.

## P1 REMAINING

**7 / 8 tracked areas:** live strong-model evaluation, resume/restart, real
long-horizon compaction, lower-level command sandboxing, authorized remote
fallback evidence, subagent execution, and worktree/background orchestration.

## KNOWN LIMITATIONS

- The active qwen/LM Studio route is deliberately fail-closed as
  `workspace_reader` for coding tasks.
- No live remote request was made; remote capability and latency are not
  established.
- The independent verifier is host-side and read-only, not a second model.
- Compaction is implemented and tested structurally, but not validated on a
  long live task.
- `/resume` is a same-session restart boundary, not byte-for-byte provider
  stream restoration; its live coding journey remains unverified while the
  installed model is below the coding gate.
- `bun run format:check` passes for the current checkout. This is a formatting
  gate result only; it does not imply unrelated dirty work was authored by
  LocalCode.

## FUNCTIONAL AUTONOMOUS CODING MVP

**FAIL**

The kernel foundation is materially stronger and its deterministic acceptance
suite is green, but the final acceptance question is still answered **NO**:
the current LocalCode environment cannot yet receive a complex objective and
complete it through a capable live model, verified mutation, and final review.

## Latest audit continuation — 2026-08-24

After the contract-hardening pass, fresh deterministic evidence is:

```text
bun run typecheck       -> PASS
bun run format:check    -> PASS
bun run test:functional -> 24 pass / 0 fail / 86 expectations
bun run test            -> 311 pass / 0 fail / 1052 expectations
bun run smoke           -> PASS for source and current dist entrypoints
```

The changes covered canonical structured search results, shell evidence,
ledger constraints, evidence quality, Spanish read-only policy, binary-file
errors, and the explicit fake model adapter. No live LM Studio generation was
run while the user was downloading the model; therefore the release decision
remains **FAIL** for the live autonomous-coding MVP until an eligible model
passes the capability, coding, test-iteration, and verification journey.

## Latest authoritative deterministic count — 2026-08-24

The final local source check after that addendum is:

```text
bun run test            -> 312 pass / 0 fail / 1053 expectations
bun run test:functional -> 24 pass / 0 fail / 86 expectations
bun run smoke           -> PASS for source and current dist entrypoints
```

The live-model release boundary remains unchanged: no LM Studio generation
was run during the download, so the functional autonomous-coding MVP remains
**FAIL** pending an eligible live model and real coding journey.

The three required post-green reviews are independently green: agent
correctness `62/62`, autonomy depth `42/42`, and adversarial reliability
`37/37`. These are deterministic harness checks and do not substitute for the
pending live-model coding journey.

## Latest authoritative release evidence — 2026-08-24

```text
bun run format:check    -> PASS
bun run typecheck       -> PASS
bun run test            -> 317 pass / 0 fail / 1065 expectations
bun run test:functional -> 24 pass / 0 fail / 86 expectations
bun run build           -> PASS
bun run smoke           -> PASS for source and current dist entrypoints
```

The live LM Studio probe is now version 8 and reports:

```text
qwen2.5-coder-1.5b-instruct -> workspace_reader
Conversation/no-tool         -> FAIL
Repository read/arguments   -> PASS
Recovery/multi-turn         -> PASS
Editing/test/verification   -> FAIL
Autonomous coding           -> NOT READY
```

The deterministic release gates are green, but the full functional
autonomous-coding MVP remains **FAIL** because no eligible live coding model
has completed the required mutation, test iteration, verification, and final
review journey.

## Latest authoritative release evidence — 2026-08-24

```text
bun run format:check    -> PASS
bun run typecheck       -> PASS
bun run test            -> 319 pass / 0 fail / 1076 expectations
bun run test:functional -> 24 pass / 0 fail / 86 expectations
bun run build           -> PASS
bun run smoke           -> PASS for source and current dist entrypoints
```

The LM Studio native model inventory is now normalized without conflating
human display labels with provider model keys. Live `doctor --agent` evidence
reports the installed Qwen 1.5B model as `workspace_reader`, with conversation
and no-tool discipline failing and editing/test/verification failing. The
stored probe is version 8 and includes the model/runtime key, quantization,
context, deterministic generation settings, and hardware snapshot. The
deterministic kernel release gates pass; the functional autonomous-coding MVP
remains **FAIL** until a measured eligible model completes the live complex
coding acceptance journey.

## Final live-model audit continuation — 2026-08-24

The user made Qwen2.5 Coder 7B available in LM Studio. Fresh evidence from
the real endpoint and disposable workspaces is:

```text
Model/runtime       qwen2.5-coder-7b-instruct / LM Studio
Quant/context       Q6_K / 32768
Doctor              workspace_reader; Autonomous coding NOT READY
Simple edit + test  PASS, completed=true, verified=true
Complex multi-file  BLOCKED, verified=false, files changed=0
False completion    0 in the observed complex run
Remote inference    0 calls
```

The direct LM Studio response contained no native tool calls for the observed
requests; tool-shaped content arrived as textual `<response>`, fenced XML,
`<xml>`, and prose-embedded fenced JSON. LocalCode now recognizes only bounded
valid envelopes, executes through the normal schema/permission boundary, and
does not display their raw JSON. The complex run still failed safely because
the model stopped after planning/read activity, so the capability gate remains
authoritative.

Latest deterministic checks are `bun run test` 328/328 with 1094
expectations, `bun run test:functional` 24/24 with 86 expectations,
format/typecheck/build/smoke all passing. The release answer to the final
acceptance question remains **NO**: the current local model cannot yet carry a
genuinely complex objective through verified multi-file implementation.

## Kernel recovery continuation — 2026-08-24

A prose-only response during a coding task is now treated as a recoverable
no-action observation. The host retries within the watchdog, records the
observation in task state, and returns `blocked` after the bounded limit. The
functional suite verifies both recovery and truthful blocking.

Fresh evidence after this change:

```text
bun run test            -> 329 pass / 0 fail / 1100 expectations
bun run test:functional -> 24 pass / 0 fail / 86 expectations
bun run format:check    -> PASS
bun run typecheck       -> PASS
```

Qwen2.5 Coder 7B remains `workspace_reader`. Its disposable multi-file task
still produced zero writes after the no-action retries, and a direct
`tool_choice=required` experiment did not produce a usable native tool loop.
The release gate therefore remains **FAIL**, with the model/runtime/template
combination as the unresolved P0 evidence boundary.

The installed Qwen2.5 Coder 1.5B Q8_0 was compared on the same disposable
simple-edit task. It changed the target and passed `bun test`, but finished
`blocked` after an unnecessary search action. It is also `workspace_reader`,
so neither installed LM Studio model can be advertised as coding-agent ready.

Final deterministic source/artifact checks for this continuation:

```text
bun run format:check  -> PASS
bun run typecheck     -> PASS
bun run test          -> 329 pass / 0 fail / 1100 expectations
bun run build         -> PASS
bun run smoke         -> PASS for source and current dist entrypoints
```

## Latest completion-authority continuation - 2026-08-24

The follow-up audit found and repaired a partial-success false-completion
path. Explicit success criteria are no longer auto-satisfied by any mutation
and a passing verification command; the caller's read-only
`verifySuccessCriteria` result must support them. The live disposable Qwen 7B
run now reports:

```text
Simple edit + test       -> COMPLETED, verified=true
Complex multi-file task  -> BLOCKED, verified=false
Files changed            -> src/math.ts only
Missing objective work   -> multiply implementation/export/test
False completion         -> 0
```

The current deterministic release evidence is:

```text
bun run format:check  -> PASS
bun run typecheck     -> PASS
bun run test          -> 332 pass / 0 fail / 1110 expectations
bun run build         -> PASS
bun run smoke         -> PASS for source and current dist entrypoints
```

The remaining release blocker is still the measured model/runtime capability,
not an unobserved completion claim.

## Current final report - 2026-08-24

### RESEARCH

Completed. Official current runtime/agent sources, original agent-loop papers,
and competitor evidence are recorded in `RESEARCH.md`.

### AUDIT

Initial autonomy: **1.6 / 10**

Initial harness: **2.0 / 10**

Initial local model agent capability: **1.5 / 10**

Current deterministic harness: **8.2 / 10**

Current selected local agent intelligence: **7.2 / 10** for the measured 14B
route; the installed 7B and 1.5B routes remain below coding eligibility.

Overall autonomous coding maturity: **7.0 / 10** for the current MVP boundary.

### ROOT CAUSES

1. The original runtime mixed model prose, tool payloads, and host exceptions;
   normalized envelopes and typed recoverable errors now separate them.
2. The original turn path exposed repository tools to ordinary conversation;
   deterministic turn policy now gates tools structurally.
3. Completion treated mutation plus green tests as semantic success; explicit
   host criteria and read-only verification now prevent partial false success.
4. The local 7B model is insufficient for the complex acceptance while the
   measured 14B model passes; capability probing and routing reflect that.
5. A timed-out capability cache entry could erase positive evidence; versioned
   failure persistence and hardware identity close that integration gap.

### AGENT KERNEL

Turn policy: **PASS** · Task ledger: **PASS** · Context discovery: **PASS** ·
Context sufficiency: **PASS** · Agent loop: **PASS** · Observe/reflect:
**PASS** · Tool contracts: **PASS** · Typed errors: **PASS** · Tool recovery:
**PASS** · Multi-turn tools: **PASS** · Editing: **PASS** · Shell: **PASS** ·
Tests: **PASS** · Verification: **PASS** · Completion gate: **PASS** · Git
safety: **PASS** · Cancellation: **PASS**.

### MODEL / RUNTIME CAPABILITY

```text
Model          qwen2.5-14b-instruct
Runtime        LM Studio OpenAI-compatible local endpoint
Quant          Q4_K_M
Context        32768
Classification advanced_coding_agent
Probe          version 11; temperature 0; maxOutputTokens 512
```

Conversation: **PASS** · No-tool discipline: **PASS** · Repository read:
**PASS** · Tool selection: **PASS** · Arguments: **PASS** · Recovery: **PASS** ·
Multi-turn: **PASS** · Editing: **PASS** · Test iteration: **PASS** ·
Verification: **PASS**.

### ROUTING

Capability hard gate: **PASS**

Stronger local fallback: **PASS**; an actual advanced route selects the
measured 14B and rejects 7B/1.5B for insufficient capability.

Free remote fallback: **PASS structurally / NO VERIFICABLE live**; no remote
request was made under strict-zero.

LOCAL ONLY hard guarantee: **PASS**

No artificial local quota: **PASS**

### FUNCTIONAL E2E

Canonical deterministic suite: **346 pass / 0 fail / 1148 expectations**.
Functional acceptance slice: **24 pass / 0 fail / 86 expectations**. Source
TUI acceptance passed `Hello`, project-language evidence, cancellation, and a
subsequent prompt; no raw tool JSON appeared.

Qwen2.5 14B disposable complex acceptance: **PASS**, `verified=true` in 5
turns, three expected files changed, `bun test` passed, and `GitDiff` passed
against a committed fixture baseline.

### EXPERIMENTAL RESULTS

Small local + baseline: the initial 1.5B path failed coding capability; the 7B
complex path blocked safely.

Small local + Agent Kernel: 7B simple edit passed; 7B complex blocked safely
with no false completion.

Strong local + Agent Kernel: 14B simple and complex tasks passed; complex
criteria, tests, and GitDiff all passed.

Remote benchmark + Agent Kernel: **NOT RUN**; no remote inference authorized.

Hybrid: deterministic route/fallback tests pass; no live remote escalation was
needed.

### COMPARATIVE AUTONOMY

Before: **1.6 / 10**

After: **7.0 / 10** at the current single-agent MVP boundary.

Claude/Codex-class gap: no long-horizon live compaction/resume acceptance,
subagents, parallel worktrees, background work, lower-level sandbox, or live
remote comparison. The local coding vertical is demonstrated, but breadth and
long-task depth are not equivalent to those products.

P0 remaining: **0 / 15 for the tested MVP gates**

P1 remaining: **7 / 8 tracked maturity areas**.

### KNOWN LIMITATIONS

- The generic TUI criteria verifier is structural; task-specific semantic
  criteria must be supplied by the caller for exact file/symbol behavior.
- The 7B Coder model is not advertised as an autonomous coding route despite
  passing simple edits.
- No paid or remote inference was made; free-remote latency/success is not a
  live claim.
- Long-horizon compaction, live coding resume, subagents, worktrees, and
  background jobs remain future maturity work.
- The repository-wide Prettier check is currently blocked by three unrelated,
  pre-existing untracked files under `docs/ui-chat-v2`; the functional source,
  kernel, tests, and agent documentation paths pass scoped formatting checks.

### FUNCTIONAL AUTONOMOUS CODING MVP

**PASS for the measured local 14B vertical and deterministic release suite.**

The final acceptance question is **YES within the tested MVP boundary**:
LocalCode can classify the turn, acquire relevant context, select the measured
eligible local model, perform multi-file mutation, run and interpret
verification, review a real fixture diff, preserve user work by checkpoint,
and refuse false completion. It is not yet a Claude/Codex-class long-horizon
system.

## Observability continuation - 2026-08-24

Structured JSONL logging is now injected through the active control-plane/TUI
path and covers context discovery, verification-command discovery, hardware
fit, runtime/provider health and streams, capability probes, routing, agent
turns/tools, processes, checkpoints, persistence, and completion. The logger
redacts before sinks and records metadata only. See [LOGGING.md](LOGGING.md) for
the event taxonomy and [TEST-GUIDE.md](TEST-GUIDE.md) for the progressive live
prompt ladder.

Fresh validation after this continuation:

```text
bun run typecheck       -> PASS
bun run test            -> 378 pass / 0 fail / 1231 expectations
bun run test:functional -> 24 pass / 0 fail / 86 expectations
scoped Prettier check    -> PASS
bun run build           -> PASS
bun run smoke           -> PASS
```

The full repository-wide Prettier command remains a separate known boundary:
three unrelated pre-existing untracked files under `docs/ui-chat-v2` are not
parseable by the configured Prettier invocation. The touched source, tests, and
agent-kernel documentation paths pass the scoped check.
