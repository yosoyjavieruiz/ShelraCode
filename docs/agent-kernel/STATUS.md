# Agent Kernel Status

Living status for the agent-kernel workstream. See [AUDIT.md](AUDIT.md) for
the full component table and [ROOT-CAUSES.md](ROOT-CAUSES.md) for the
reported-failure investigation.

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
- `localcode doctor --agent` capability report: not built.
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
4. `localcode doctor --agent`: surface capability-probe results and current
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
bun run logs:inspect -- .localcode/logs/agent.jsonl
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
