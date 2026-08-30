# Agent Kernel Status

<!-- Latest root-cause evidence is maintained below the historical sections. -->

## Phase 7 evaluation evidence — 2026-08-26

The current source includes a deterministic agent-evaluation matrix at
`tests/evals/agent-journeys.ts` and its integration gate at
`tests/integration/agent-evaluations.test.ts`. It exercises 18 disposable
journeys across conversation, repository questions, symbol lookup,
architecture analysis, planning, one- and multi-file changes, test repair,
greenfield work, configuration, refactoring, typed recovery, compaction,
resume, dirty-worktree safety, false completion, false blocking, and
strict-zero rejection.

Fresh evidence from the current checkout:

```text
bun run typecheck
  PASS
bun test tests/integration/agent-evaluations.test.ts
  2 pass / 0 fail / 82 expectations
bun run scripts/evaluate-agent.ts --deterministic --summary
  Deterministic matrix: PASS (18/18 passed; failed=0; unproven=0; skipped=0)
```

`scripts/evaluate-agent.ts --local` is deliberately conservative: it accepts
only loopback local runtimes, does not download models, and does not use a
paid fallback. The current available snapshot discovered 9 local candidates;
the selected LM Studio model was unloaded, so all local journeys remain
`UNPROVEN`. The command records the exact model/runtime/quant/context when a
loaded candidate is available and runs only disposable capability and coding
fixtures.

The deterministic matrix proves host contracts and recovery behavior with a
scripted provider. It does not establish real-model success, long-horizon
heterogeneous coding, or Claude/Codex parity. Those claims remain
`UNPROVEN` until a loaded local model passes the live probe and the remaining
release journeys are exercised.

## Scoped permission approvals — 2026-08-26

The interactive ASK boundary now exposes five explicit decisions through
`src/tui/components/ApprovalDialog.tsx`: approve once, allow for the current
session, always allow in the current project, deny, and cancel the turn.
`src/tools/permission-grants.ts` gives those decisions bounded identities;
Shell and RunTests rules match an exact normalized command, while file rules
are scoped to the approved tool/risk. Session rules are memory-only and
project rules are validated and persisted by `src/config/settings.ts` in
`.shelracode/config.json`. `/permissions` is the only canonical slash command
and opens the backed permissions center, where rules can be revoked or all
project rules cleared.

The approval callback remains below the model in `src/tui/app.tsx` and
`src/tools/workspace.ts`. An accepted destructive Shell invocation is passed
as a one-shot authorization to the shared process policy; it still cannot
leave the workspace or use a denied network path. Secret-shaped command rules
are not persisted.

Fresh evidence:

```text
bun --conditions=browser test [permission and TUI approval focus]
  34 pass / 0 fail / 97 expectations
bun run typecheck
  PASS
bun run test
  643 pass / 1 skip / 0 fail / 2196 expectations
Windows source TUI PTY
  Approval choices rendered; session approval returned focus to the composer;
  `/permissions` rendered the persisted-rule center; `/exit` restored the shell.
```

This is a functional scoped approval vertical, not an OS sandbox or a claim of
Claude/Codex permission parity. The lower process/network policy remains an
independent enforcement layer.

## Latest root-cause closure - 2026-08-25

This pass addressed the two runtime causes behind the repeated local-model
failure instead of only changing the routing message:

- A complex task with a controller-proven, non-empty bounded scope may now use
  a local `chat_only` candidate as a **host-scaffolded progressive fallback**.
  This is not an advanced-capability promotion: the controller owns the tool
  set, path scope, checkpoints, verification and completion gate. Direct
  advanced execution without a proven scope remains rejected.
- The TUI enters progressive execution as soon as the scope is proven; it no
  longer requires an already measured coding route before it can attempt the
  bounded local work unit. This removes the old `chat_only -> STOP / ASK USER`
  dead end for scoped local tasks.
- `ReadFile({ startLine })` now returns a bounded 160-line window when
  `endLine` is omitted, with `hasMore` and `nextStartLine` continuation
  metadata. Previously it read to EOF, was truncated again for the model, and
  caused small local models to repeat reads instead of editing.

Fresh deterministic evidence:

```text
bun run typecheck
  PASS

Focused routing/kernel suite
  96 pass / 0 fail / 334 expectations
```

Fresh source-TUI evidence from the pre-window-contract smoke run:

```text
route: lm-studio/qwen3.5-4b-claude-4.6-opus-reasoning-distilled-v2
capability: coding_agent
route stop: no
tool turns: 15
mutation: 1 valid EditFile
verification runs: 3
criteria: pass
final diff review: PASS, score 9
task result: completed, verified=true
```

That real run proves the former `chat_only` stop was not active on the
available 4B route and that a local model can complete a bounded mutation. It
does not yet prove arbitrary multi-file frontier-level autonomy; the next
live smoke should measure whether the bounded `ReadFile` contract reduces the
15-turn read overhead.

Living status for the agent-kernel workstream. See [AUDIT.md](AUDIT.md) for
the full component table and [ROOT-CAUSES.md](ROOT-CAUSES.md) for the
reported-failure investigation.

## Routing policy addendum — 2026-08-25

The active router applies empirical capability as a hard admission gate before
scoring. A `chat_only` or unmeasured candidate cannot enter direct coding, and
a `workspace_reader` candidate cannot enter an `advanced_coding_agent` task.
The only exception is a host-scaffolded progressive route with a non-empty,
controller-proven scope: a local/free `chat_only` model may attempt that one
bounded unit while the controller retains tool, checkpoint, verification and
completion authority. This keeps 1.5B routes accessible without making an
unsupported frontier-parity claim.

The older score-only wording below is retained as historical evidence of a
previous implementation and is not the current runtime policy.

## Done (this pass)

- Traced the reported failure to source and reproduced both tool errors
  directly (not inferred from the screenshot) — see ROOT-CAUSES.md.
- Added a typed, self-correcting tool-error taxonomy (`src/tools/errors.ts`:
  `INVALID_ARGUMENT`, `PATH_NOT_FOUND`, `PATH_IS_FILE`, `PATH_IS_DIRECTORY`)
  and applied it to `ReadFile`/`ListFiles`, the two tools implicated in the
  report.
- `ToolResult.code` carries that signal through the agent loop to the model.
- Added one explicit tool-error-recovery sentence to the workspace/coding
  system prompts.
- Added regression coverage at both the tool level
  (`tests/unit/tool-error-recovery.test.ts`) and the full agent-loop level
  (new case in `tests/integration/agent-loop.test.ts` replaying the exact
  reported sequence end-to-end).
- Verified no regressions: `bun test` — 199 pass / 2 fail (pre-existing,
  unrelated TUI overlay timing tests, confirmed failing before this pass
  too); `bunx tsc --noEmit` clean.
- Audited the rest of the existing agent kernel (turn classification, agent
  loop, capability probe, context builder, checkpoint/verification) against
  the spec's MVP gate — most of it was already implemented and tested in
  the current working tree, contrary to `docs/STATUS.md` (UI-focused) which
  doesn't mention this work at all. That doc drift is itself worth fixing
  separately.

## Explicitly not done (do not claim otherwise)

- `Shell`/`RunTests`/`GitStatus`/`GitDiff` still throw plain `Error`, not
  typed `ToolError`s. Lower priority: not implicated in the reported bug.
- Capability probe (`src/agent/capability-probe.ts`) exists and is tested in
  isolation, but nothing currently calls it to gate routing eligibility —
  §81–84 of the original brief ("route complex coding only to models that
  prove they can handle them") is unimplemented, not just unverified.
- No completion gate that checks an answer actually rests on evidence before
  returning it (the exact "false Done" failure mode) — the fix in this pass
  only removes one _cause_ of an ungrounded answer (unrecoverable tool
  errors), it does not add a structural gate that would catch other causes.
- `shelra doctor --agent` capability report: not built.
- Independent verification agent, context compaction, subagents
  (Explore/Research/Verify): not built. The main loop working standalone is
  a stated precondition for subagents in the original brief, and it does —
  but that's a floor, not a reason to add subagents yet.

## Next (priority order, not commitment)

1. Wire `probeAgentCapability` into routing so autonomous coding is gated on
   demonstrated tool reliability, not model name/parameter count.
2. Extend the typed error taxonomy to `Shell`/`RunTests`/git tools
   (`COMMAND_FAILED`, `TEST_FAILED` as evidence, `CONFLICT`, `CANCELLED`).
3. Completion gate: require a coding-task "Done" to cite which tool results
   it rests on; a workspace-question "Done" without any successful read/
   search tool result should not be returned as an answer.
4. `shelra doctor --agent`: surface capability-probe results and current
   routing eligibility per configured model.
5. Live model eval report against the actual local runtime, replacing
   assumption with measurement (spec §205).

## Current implementation snapshot — 2026-08-24

The historical status above predates the current kernel pass. Current source
and tests now include the seven turn modes, persistent task ledger, context
sufficiency, GlobFiles, the full typed error taxonomy, stale-edit protection,
provider-failure/cancellation states, independent verifier, compaction,
redacted developer trace, capability-aware discovery/routing, and
`doctor --agent`.

Fresh deterministic result: `bun run test:functional` — 24 pass, 0 fail, 86
expectations. The current live LM Studio qwen probe is `workspace_reader`;
editing and verification remain failed, so coding is blocked by policy and
the autonomous-coding doctor result is `NOT READY`.
Subagents, worktrees, stronger shell sandboxing, and a passing advanced live
model remain open. The full repository suite is now green under the canonical
browser-conditioned command; live coding remains blocked by the measured model
capability gate.

## Final evidence — 2026-08-24

- `bun run typecheck`: PASS, exit 0.
- `bun run test:functional`: PASS, 24/24 tests, 86 expectations.
- Focused kernel additions: PASS (agent loop, context, policy, provider,
  capability, doctor, and envelope suites).
- `bun run smoke`: PASS for the source entrypoint and rebuilt bundle.
- `bun run src/index.ts doctor --agent`: PASS as a command; the configured
  qwen/LM Studio model is `workspace_reader`, with editing/test iteration /
  verification failed, so autonomous coding is `NOT READY`.
- The current canonical `bun run test` run: 306 pass, 0 fail, 1032
  expectations across 306 tests and 66 files. The package script's
  `--conditions=browser` flag is required for OpenTUI/Solid's shared runtime;
  bare `bun test` is not an equivalent release command.
- The source TUI direct language journey completed with visible `Done` and
  `TypeScript` after host-side fact context and a bounded output request; no
  live coding-capable model is available.
- Saved sessions can be reopened and resumed with `/resume`; this appends a
  new task turn to the existing session while preserving prior task ledgers.
- Fresh source-TUI acceptance exercised Sessions -> open -> `/resume` on a
  saved conversational task; coding resume remains blocked by model eligibility.
- Three post-green review passes completed: correctness, autonomy depth, and
  adversarial reliability. See [FINAL-AUDIT.md](FINAL-AUDIT.md) for the exact
  release decision and remaining evidence boundary.

- Coding verification is host-owned across the discovered `test`, `typecheck`,
  optional `lint`, and `build` stages. A failed stage blocks completion, and a
  later mutation invalidates the prior plan result and triggers a full rerun.
- Capability-aware local discovery now runs the edit and failing-test probes
  against a disposable temporary workspace after the protocol gate; the live
  qwen result remains `workspace_reader` before that executable pass.

## Current authoritative status — 2026-08-24

The earlier sections preserve the initial remediation history. Current source
and runtime evidence is:

- deterministic functional acceptance: 24 pass / 0 fail / 86 expectations;
- host-owned multi-stage verification: PASS in the agent-loop regression
  suite, including failed-stage blocking and rerun-after-edit;
- live qwen/LM Studio capability: `workspace_reader`, not coding-eligible;
- source TUI direct-language journey: visible `Done` and `TypeScript`, with
  host facts, no model workspace tools, and bounded generation;
- current canonical suite: 306 pass / 0 fail / 1032 expectations across 306
  tests and 66 files;
- autonomous coding MVP: FAIL until an eligible live model and the remaining
  live acceptance evidence are available. The deterministic release suite is
  green.

## Audit continuation — 2026-08-24

The deterministic kernel was tightened without changing the visual surface:

- `SearchText` now exposes canonical `query`/`glob` inputs and structured,
  bounded search matches while accepting `pattern` as a compatibility alias;
- `Shell` now returns host-owned command, cwd, timing, timeout, stdout, and
  stderr evidence;
- task framing persists host-derived constraints in `AgentTaskLedger`;
- repository completion checks require useful evidence quality, not merely a
  non-empty evidence array;
- Spanish intent classification and direct repository-fact handling now
  normalize accents and preserve read-only policy;
- binary-looking file reads return `BINARY_FILE` instead of silently exposing
  decoded bytes;
- the deterministic test fixture now exports an explicit `FakeModelAdapter`.

Fresh command evidence after these changes:

```text
bun run typecheck       -> PASS
bun run format:check    -> PASS
bun run test:functional -> 24 pass / 0 fail / 86 expectations
bun run test            -> 311 pass / 0 fail / 1052 expectations
bun run smoke           -> PASS for source and current dist entrypoints
```

These results prove the harness and source/bundle CLI smoke paths only. They
do not replace the pending LM Studio capability probe or a real eligible-model
coding journey. The autonomous-coding MVP therefore remains **FAIL** until
the downloaded model passes the live capability and verification gates.

## Latest authoritative test count — 2026-08-24

The contract-hardening test added after the previous note is included in the
current canonical run:

```text
bun run test            -> 312 pass / 0 fail / 1053 expectations
bun run test:functional -> 24 pass / 0 fail / 86 expectations
bun run smoke           -> PASS for source and current dist entrypoints
```

This supersedes earlier `306` and `311` counts in historical sections. The
live LM Studio model gate remains pending and the autonomous-coding MVP is
still **FAIL** until an eligible model passes live coding, test iteration, and
verification.

## Latest implementation and live evidence — 2026-08-24

The current source also includes host-controlled generation temperature
(`0.2` for coding/command turns and `0` for capability probes), filtering of
embedding/reranking runtime entries, runtime-first doctor selection, typed
tool-error recovery measurement, and strict executable-probe evidence gates.

Fresh release checks:

```text
bun run format:check    -> PASS
bun run typecheck       -> PASS
bun run test            -> 317 pass / 0 fail / 1065 expectations
bun run test:functional -> 24 pass / 0 fail / 86 expectations
bun run build           -> PASS
bun run smoke           -> PASS for source and current dist entrypoints
```

Fresh LM Studio evidence is `qwen2.5-coder-1.5b-instruct` classified as
`workspace_reader`: conversation/no-tool discipline fail, repository read,
selection, arguments, recovery, and multi-turn pass; editing, test iteration,
and verification fail. The live autonomous-coding MVP remains **FAIL**.

## Latest runtime identity and release evidence — 2026-08-24

The LM Studio adapter now enriches model discovery from the native
`/api/v1/models` endpoint when available. It keeps the provider `key` in
`ModelCandidate.modelId` for inference and uses `displayName` only as the
human-facing label. Quantization, model size, architecture, tool-training
metadata, and native context length are preserved without exposing the
embedding model as a coding candidate. Generic OpenAI-compatible discovery
remains the fallback when native metadata is unavailable.

Fresh evidence:

```text
bun run format:check    -> PASS
bun run typecheck       -> PASS
bun run test            -> 319 pass / 0 fail / 1074 expectations
bun run test:functional -> 24 pass / 0 fail / 86 expectations
bun run build           -> PASS
bun run smoke           -> PASS for source and current dist entrypoints
```

The live source diagnostic reports `Qwen2.5 Coder 1.5B Instruct`, `Q8_0`,
`workspace_reader`, and `Autonomous coding NOT READY`. The model identity
repair fixed the probe's wire identifier; it did not change the model's
measured capability class. The autonomous-coding MVP remains **FAIL** pending
an eligible live model and the required complex coding journey.

Capability evidence is persisted with probe version 8, model/runtime identity,
`Q8_0`, context `32768`, generation `temperature: 0` /
`maxOutputTokens: 512`, and the current hardware snapshot. Future model
comparisons therefore use a reproducible evidence record instead of an
untracked manual test.

## Latest live Qwen 7B evaluation — 2026-08-24

The user-loaded LM Studio model is now measured from the real local endpoint:

```text
Model       qwen2.5-coder-7b-instruct
Display     Qwen2.5 Coder 7B Instruct
Runtime     LM Studio
Quant       Q6_K
Context     32768
Probe       version 11
Class       workspace_reader
```

`doctor --agent` reports conversation, no-tool discipline, repository read,
tool selection, arguments, and multi-turn as passing. Recovery, editing, test
iteration, and verification remain failing; autonomous coding is therefore
`NOT READY` and the router correctly refuses this model for coding tasks.

Direct endpoint inspection found that this model does not emit native
OpenAI `tool_calls` for the tested requests. It emits textual variants such as
`<response>...</response>`, fenced XML, and `<xml>...</xml>`. The kernel now
normalizes these bounded envelopes, including the first complete fenced tool
call embedded in model prose, while suppressing the internal JSON from the
assistant transcript.

Real disposable-workspace evidence:

```text
Simple edit + test       -> COMPLETED, verified=true, 6 turns, 1 file changed,
                            tests passed after a recoverable GitStatus failure
Multi-file coding task   -> BLOCKED, verified=false, 0 files changed;
                            model stopped after planning/one read and did not
                            perform the required implementation
```

Fresh deterministic release checks after this live-model pass:

```text
bun run format:check     -> PASS
bun run typecheck        -> PASS
bun run test             -> 328 pass / 0 fail / 1094 expectations
bun run test:functional  -> 24 pass / 0 fail / 86 expectations
bun run build            -> PASS
bun run smoke            -> PASS for source and current dist entrypoints
```

This is a stronger local model than the previously measured 1.5B model, but
the evidence does not justify advertising it as an autonomous coding agent.

## No-action recovery hardening — 2026-08-24

Coding turns now treat a prose-only model response as a recoverable
no-progress observation instead of immediately terminating. The host appends
one bounded recovery instruction, records the failed model-turn action in the
ledger, and retries only while the coding objective still lacks mutation or
required verification. After the watchdog limit it returns `blocked`, never
`completed`.

Regression and release evidence:

```text
prose-only coding recovery fixture -> PASS
bun run test:functional            -> 24 pass / 0 fail / 86 expectations
bun run test                       -> 329 pass / 0 fail / 1100 expectations
```

The live Qwen 7B complex task still blocks after these bounded retries, which
confirms the remaining limitation is model execution capability rather than
an unhandled early-stop path in the kernel.

The installed Qwen2.5 Coder 1.5B Q8_0 was also rerun on the disposable simple
edit fixture. It changed the target and passed `bun test`, but ended `blocked`
after an unnecessary search action. Both installed LM Studio models therefore
remain below the coding-agent capability gate; no remote route was invoked.

Latest source/artifact checks:

```text
bun run format:check  -> BLOCKED by 3 pre-existing untracked docs/ui-chat-v2 files
bunx prettier --check <functional source and kernel paths> -> PASS
bun run typecheck     -> PASS
bun run test          -> 329 pass / 0 fail / 1100 expectations
bun run build         -> PASS
bun run smoke         -> PASS
```

## Latest kernel continuation - 2026-08-24

The loop now removes prose-only assistant turns from the provider retry
context, recognizes LM Studio's lowercase `<tool_request>` envelope, and
requests an implementation tool after read evidence instead of repeating a
planning prompt. Explicit success criteria are host-verified and cannot be
auto-satisfied by mutation plus a green test.

Fresh checks:

```text
bun run format:check  -> PASS
bun run typecheck     -> PASS
bun run test          -> 332 pass / 0 fail / 1110 expectations
bun run build         -> PASS
bun run smoke         -> PASS
```

The installed Qwen 7B simple live task passes; the criteria-gated complex
task remains safely `blocked` because the model does not complete `multiply`.
The autonomous-coding MVP remains **FAIL** pending a coding-eligible model
and a successful complex live journey.

## Live eligible-model closure - 2026-08-24

LM Studio now exposes three healthy local generative models. Qwen2.5 14B
Instruct (`Q4_K_M`, context `32768`) passed capability probe version 11 as
`advanced_coding_agent`, including no-tool discipline, tool arguments,
multi-turn continuation, `PATH_IS_FILE` recovery, executable edit,
failing-test iteration, and verification. `doctor --agent` now reports
`Autonomous coding READY`.

The same 14B completed the disposable multi-file objective in 5 turns: it
fixed `add`, implemented/exported `multiply`, added its test, ran `bun test`,
and used `GitDiff` against a committed fixture baseline. Qwen2.5 Coder 7B
(`Q6_K`) remains `workspace_reader`: it completes the simple edit fixture but
its complex run ends `blocked` after partial progress.

The TUI now supplies a host-owned structural verifier only for coding turns;
conversation and knowledge turns do not receive synthetic explicit criteria.
Real source-TUI acceptance passed `Hello`, the project-language question,
cancellation, and a subsequent prompt. No visual redesign was introduced.

Capability-cache timeout results now retain the current probe version, so
negative evidence cannot silently become an unversioned unknown result.

## Fresh closure checks - 2026-08-24

```text
bun run format:check  -> PASS
bun run typecheck     -> PASS
bun run test          -> 346 pass / 0 fail / 1148 expectations
bun run build         -> PASS
bun run smoke         -> PASS
git diff --check       -> PASS (only Git line-ending warnings)
```

The Qwen2.5 14B Instruct `Q4_K_M` route remains `advanced_coding_agent` and
`Autonomous coding READY`. The final disposable complex acceptance completed
in 5 turns with all exact criteria, tests, and `GitDiff` checks passing.

## Observability and test guide continuation - 2026-08-24

Structured JSONL logging is now wired from the control plane through context
discovery, routing, provider/runtime adapters, the agent loop, tools/processes,
checkpoints, persistence, verification, and the active TUI task boundary.
Logs are correlation-safe and redacted before custom sinks, with no raw prompt,
file content, shell output, tool JSON, or credentials. See
[LOGGING.md](LOGGING.md) and [TEST-GUIDE.md](TEST-GUIDE.md).

The new report command is:

```text
bun run logs:inspect -- .shelracode/logs/agent.jsonl
```

The prompt ladder covers conversation, repository questions, plan/review,
editing, malformed arguments, file/directory recovery, failing-test iteration,
multi-file work, capability routing, local-only enforcement, dirty worktrees,
cancellation, resume, and complex migrations. Deterministic test results for
this continuation are recorded only after the final validation commands run;
live-model claims remain separate from harness evidence.

## Final observability validation - 2026-08-24

```text
bun run typecheck -> PASS
bun run test -> 378 pass / 0 fail / 1231 expectations
bun run test:functional -> 24 pass / 0 fail / 86 expectations
scoped Prettier check -> PASS
bun run build -> PASS
bun run smoke -> PASS for source and current dist entrypoints
git diff --check -> PASS with existing line-ending warnings only
```

The source CLI `doctor` was exercised with an isolated state directory and a
JSONL log path. It produced 29 records with zero malformed lines, including
control-plane, storage, hardware, runtime, provider, and process lifecycle
events. `bun run logs:inspect -- <jsonl>` summarized the run without printing
raw prompt or command output.

## Progressive low-resource continuation — 2026-08-25

The current kernel adds a guarded progressive path for accessible local
models. Multi-file objectives with explicit workspace paths are decomposed by
the host into one writable target at a time, with verification between stages.
The active prompt budget is model-size aware and compaction preserves the
objective/context anchor plus the latest observation.

Fresh live evidence through the real LM Studio adapter:

```text
Qwen2.5 Coder 1.5B Instruct / Q8_0
multi-file fixture: COMPLETED, verified=true, 9 turns
files: src/math.ts, src/index.ts, tests/math.test.ts
verification: 3 passing bun test stages
simple fixture: COMPLETED, verified=true, 3 turns
```

The capability probe remains valuable evidence for score and fallback
preference; it is no longer an unconditional ordinary-routing gate. The TUI
may use the progressive fallback when no stronger candidate is available,
explicit multi-file paths exist, and the local candidate has measured
read/continuation capability. An arbitrary super-complex task is not yet
proven by this fixture.

## Final authoritative update - 2026-08-25

The current deterministic suite is green:

    474 pass / 1 skip / 0 fail / 1529 expectations

The current source builds and the rebuilt dist/index.js passes the CLI smoke
path. The final bundle TUI journey at 80 columns accepted Hola without
repository tools, reached Task completed and verified, and restored the
terminal after Ctrl+C.

The exact Qwen2.5 Coder 1.5B Instruct / LM Studio / Q8_0 pair passed two
consecutive final runs of the bounded three-file fixture, each in 10 turns
with completed, verified=true, three passing verification stages and no
user-worktree mutation. This promotes the progressive low-resource route to
validated MVP status. It does not promote raw 1.5B to unrestricted
frontier-level repository autonomy.

Older contradictory entries in this file are historical snapshots. The
latest evidence above is authoritative for the current source state.

## Path-domain and transparency update - 2026-08-25

Objective path extraction now ignores dependency names such as `Moment.js`
unless the user explicitly identifies a file/document. Canonical path
comparison and host criteria prevent a model from mutating outside the current
target stage. The real integration regression covers the `Moment.js` plus
`index.html` case.

The filesystem contract now separates read/list/create/edit/overwrite/delete
operations, typed file-vs-directory/missing-path errors, checkpoints, and
bounded redaction-aware diffs. The TUI labels rejected requests `BLOCKED`
instead of making them look like successful writes, and shows safe model
progress metadata without revealing private reasoning text.

## Current authoritative closure - 2026-08-25

This section supersedes the older snapshots above for the current checkout.

```text
bun run test       -> 499 pass / 1 skip / 0 fail / 1583 expectations
bun run typecheck  -> PASS
bun run build      -> PASS; current source bundled to dist/
bun run smoke      -> PASS; source and bundle help/version/doctor
scoped Prettier    -> PASS for all changed files
git diff --check   -> PASS; only Git line-ending warnings
real TUI PTY       -> PASS; type, submit, Esc cancel, /models, Ctrl+C exit
```

The global `bun run format:check` remains red only because it reports 14
pre-existing files outside this change. The changed-file check is clean; no
unrelated historical UI/document files were reformatted to hide that boundary.

The current JSONL report contains 152,097 valid records and zero malformed
lines. Its volume is still a product issue: it contains 92,380 route
rejections, 40 tool failures, 35 checkpoint-preservation failures, and three
watchdog interventions across historical and fixture tasks. Recent records
include repeated `task-provider-crash`, `PATH_IS_FILE`, and
`changed-external` events. They are now typed and observable, but runtime
stability and log rotation remain open work; these counts must not be read as
failures from the final deterministic suite.

The kernel now includes a read-only `code-review` host agent. It checks the
task ledger, objective criteria, verification state, final diff check, and
user-work preservation without editing or asking a model to self-approve. It
is a behavioral comparison point against Claude Code's public
context/action/verification loop, not a claim of internal Claude parity.

Free cloud routing now has an explicit bounded protocol-probe path. When the
coding turn has no eligible measured local route and policy permits remote
free capacity, at most one verified-free candidate per provider is probed.
The probe sends only generic tool-loop prompts, never repository context, and
stores exact capability evidence in the local cache. It does not claim local
sandbox or remote test execution; account quota/privacy and full remote
coding journeys remain live evidence gates.

### Remaining release blockers

The deterministic kernel P0 regressions are closed. The following P1 maturity
areas remain explicitly open:

- Windows process isolation is centralized and network-denying, but not yet a
  proven OS-level filesystem/network sandbox for every child-process escape.
- The task graph is persisted and host-owned, but its dependency scheduler is
  not yet fully autonomous; the worker still chooses actions inside a bounded
  node.
- Explore/Build/Verify model subagents and isolated worktrees are not yet a
  production path; the current verifier is deterministic and read-only.
- Long-horizon arbitrary-repository coding, resume after compaction, and
  repeated 1.5B/7B/14B model-runtime-template matrices remain unproven.
- Remote Groq/OpenRouter capability probes are structurally implemented but
  were not run as live inference in this validation pass.
- Full PTY resize/cross-width acceptance and standalone executable packaging
  remain outside the current artifact proof.

## Authoritative routing correction — 2026-08-25

The prior `STOP · ASK USER` behavior for a complex local task with no
pre-localized scope was a controller defect. The router was correctly refusing
`chat_only` for mutation, but the TUI had no preparation stage and terminated
the task instead of localizing it first.

The current source adds an explicit `discovery` strategy:

```text
complex coding objective without proven scope
  -> local discovery, no mutation tools
  -> validate proposed/read paths against the workspace
  -> progressive route request
  -> measured coding_agent only
  -> bounded mutation + host verification
```

This preserves the capability hard gate while removing the false early stop.
If no validated scope can be found, the task is reported as preparation
paused/blocked; it is not marked completed and no file is mutated.

Fresh current evidence:

```text
bun run typecheck                                      -> PASS
bun test routing + kernel acceptance                   -> 85 pass / 0 fail
bun test full suite                                    -> 495 pass / 1 skip / 22 fail
focused TUI rerun (--max-concurrency=1)               -> 14 pass / 1 skip / 11 fail
doctor --agent                                        -> Qwen3.5 2B, coding_agent,
                                                        recovery FAIL,
                                                        autonomous coding NOT READY,
                                                        progressive/bounded READY
```

The 22 full-suite failures are concentrated in pre-existing OpenTUI/Solid
controlled-renderer tests (animation ticks, composer signal synchronization,
slash sheets, status updates and streaming). The same failures reproduce when
those files run alone and serially; they are not evidence that the routing or
agent-kernel correction failed. They remain an open TUI test-harness blocker
and must not be represented as a green release suite.

The live local boundary is now explicit: Qwen3.5 2B can participate in
progressive/bounded work, but its probe still fails recovery, so it is not
advertised as an unrestricted autonomous coding model. Qwen2.5 Coder 1.5B and
7B remain workspace-reader profiles in the current matrix. No raw 1.5B/frontier
parity claim is made.

## Capability-probe integrity correction — 2026-08-25

The previous probe had two control-plane defects that could create misleading
`chat_only` results:

- the plain greeting probe advertised `ReadFile` with `toolChoice=auto`, so a
  model could be penalized for selecting a tool that the probe itself offered;
- provider/runtime timeouts were persisted as if they were behavioral model
  measurements, poisoning the next route decision.

The greeting probe now sends no tools and `toolChoice=none` (probe version 12).
Transport failures are not persisted as capability evidence, failed cache rows
are never considered current, and a compatible previous measurement is reused
temporarily while the runtime is retried. LM Studio native model discovery also
records `loaded_instances` and orders the selected/loaded model first during
probing.

Focused evidence after this correction:

```text
bun test capability-cache + capability-probe + runtime -> PASS
bun run typecheck                               -> PASS
```

The current local database was refreshed by a diagnostic run while several
models were unloaded; those timeout rows are intentionally no longer trusted.
The 1.5B classification must be re-established with that model loaded and a
fresh version-12 probe. This is a measurement-status limitation, not evidence
that the model is inherently chat-only.

The real TUI journey then exposed one remaining routing branch: a debugging
objective requiring `coding_agent` could still skip discovery when its scope
was not proven. The discovery condition now applies to every coding task
without verified scope, not only `advanced_coding_agent` tasks. The capability
gate remains intact for the subsequent mutation route.
