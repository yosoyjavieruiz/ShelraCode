# Evaluation Program

## Current routing policy - 2026-08-25

The capability-class veto described in older evaluation snapshots is
superseded. A `chat_only`, `workspace_reader`, or unmeasured probe is now a
quality signal, not an independent route veto. A candidate still has to pass
privacy, cost, quota, health, context, and executable-tool gates; after
selection, the host-owned loop, permissions, recovery, verification, and
completion gate determine whether the task succeeds. This keeps the 1.5B
route usable for small-resource users without claiming frontier-level task
completion.

The deterministic fixture in `tests/support/fixture-repo.ts` contains a
manifest, `AGENTS.md`, TypeScript sources, tests, and an injectable failing
math implementation. `tests/support/fake-provider.ts` separates kernel
correctness from live model quality.

Current functional acceptance evidence (2026-08-24):

```text
bun run test:functional
24 pass / 0 fail / 86 expectations
```

The suite covers conversation, knowledge, language, symbols, architecture,
review, plan-only, commands/tests, small edits, feature/tests, multi-file
changes, failing-test iteration, malformed arguments, file/directory and
missing-path recovery, false completion, dirty work, cancellation, and raw
tool-call suppression. The agent-loop regression suite additionally covers a
host-owned `test -> typecheck -> build` plan, failed-stage blocking, and full
plan reruns after a later edit.

The full repository suite is now green under the canonical browser-conditioned
command. Live-model capability is still separate: the historical LM Studio
Qwen probe returned `workspace_reader`; under the current router that result
does not independently block a runnable local candidate, but it remains an
important quality signal. A complete model-vs-harness matrix and a live
zero-cost remote benchmark remain open evidence, not assumed results.

Final verification snapshot (2026-08-24):

```text
bun run typecheck       -> PASS
bun run test:functional -> 24 pass / 0 fail / 86 expectations
focused kernel suite    -> PASS; current targeted kernel additions are green
bun run smoke           -> PASS for source and rebuilt bundle
full canonical test     -> 306 pass / 0 fail / 1032 expectations,
                            306 tests across 66 files
```

The canonical package command is `bun run test` (it expands to
`bun --conditions=browser test`). A bare `bun test` is not equivalent for
this OpenTUI/Solid repository because it can load a different Solid runtime:

```text
bun run test -> 306 pass / 0 fail / 1032 expectations,
               306 tests across 66 files
```

Three review passes were completed after the first green functional suite:
agent correctness, autonomy depth, and adversarial reliability. The findings
closed in those passes include checkpoint-derived dirty-work preservation,
explicit mode propagation into the task ledger, failing-command completion
prevention, edit/test capability probes, network-command blocking, trace
coverage, and SIGINT cancellation wiring. Functional TUI interactions covered
by the focused suite remain green; the full browser-conditioned suite is also
green. No visual redesign was introduced.

## Latest deterministic delta — 2026-08-24

The post-audit contract pass added regression coverage for canonical structured
search matches, filename globs, structured shell evidence, Spanish read-only
classification, evidence relevance, binary-file rejection, and the explicit
`FakeModelAdapter` fixture surface.

Latest release commands:

```text
bun run typecheck       -> PASS
bun run format:check    -> PASS
bun run test:functional -> 24 pass / 0 fail / 86 expectations
bun run test            -> 311 pass / 0 fail / 1052 expectations
bun run smoke           -> PASS for source and current dist entrypoints
```

No live model inference was run during this continuation because the user was
still downloading the LM Studio model. The live model/runtime/template matrix
remains explicitly `NO VERIFICABLE` until the user signals readiness.

## Latest authoritative run — 2026-08-24

The current canonical suite includes the binary-file contract regression added
after the preceding snapshot:

```text
bun run test            -> 312 pass / 0 fail / 1053 expectations
bun run test:functional -> 24 pass / 0 fail / 86 expectations
bun run smoke           -> PASS for source and current dist entrypoints
```

Earlier `306` and `311` counts above are historical snapshots. No live LM
Studio generation was performed while the model download was in progress.

## Three critical review passes — 2026-08-24

After the deterministic suite was green, the required review passes were
rerun with separate focused commands:

```text
Pass A — agent correctness       -> 62 pass / 0 fail / 233 expectations
Pass B — autonomy depth           -> 42 pass / 0 fail / 116 expectations
Pass C — adversarial reliability  -> 37 pass / 0 fail / 94 expectations
```

The passes cover lifecycle transitions, tool recovery, completion authority,
capability/routing/compaction, permissions, path boundaries, process
cancellation/timeouts, privacy, checkpoints, stale edits, and redacted trace.

## Latest implementation run — 2026-08-24

After adding deterministic generation settings, runtime model-role filtering,
strict executable-probe evidence, and typed `PATH_IS_FILE` recovery probing:

```text
bun run test            -> 317 pass / 0 fail / 1065 expectations
bun run test:functional -> 24 pass / 0 fail / 86 expectations
bun run format:check    -> PASS
bun run typecheck       -> PASS
bun run build           -> PASS
bun run smoke           -> PASS for source and current dist entrypoints
```

The real LM Studio probe ran against the downloaded 1.5B model and remains
`workspace_reader`; no capable live model or remote benchmark is being claimed.

## Latest implementation run — 2026-08-24

The current deterministic run is:

```text
bun run test            -> 319 pass / 0 fail / 1076 expectations
bun run test:functional -> 24 pass / 0 fail / 86 expectations
bun run format:check    -> PASS
bun run typecheck       -> PASS
bun run build           -> PASS
bun run smoke           -> PASS
```

The runtime identity regression confirms that LM Studio's native human label
does not replace the provider wire key during capability probing or agent
execution. The live model matrix is still incomplete: only the installed 1.5B
model has been measured, and it is `workspace_reader`, not coding-eligible.
Probe version 8 now persists the exact generation settings and hardware
snapshot alongside that result, so the next downloaded model can be compared
under the same evidence contract.

## Latest live model matrix entry — 2026-08-24

The newly available Qwen 7B was run through the actual LM Studio adapter and
the same disposable fixture boundary:

| Configuration                                                       | Result                                                                                                          |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Qwen2.5 Coder 7B Q6_K + LM Studio + Agent Kernel, simple edit/test  | PASS: completed and verified; 1 file changed; tests passed                                                      |
| Qwen2.5 Coder 7B Q6_K + LM Studio + Agent Kernel, multi-file coding | FAIL safely: blocked; 0 writes; no false completion                                                             |
| Qwen2.5 Coder 7B capability doctor                                  | `workspace_reader`, not coding-eligible                                                                         |
| Strong remote benchmark                                             | NOT RUN; no remote inference authorized                                                                         |
| Hybrid route                                                        | Not evaluated in the current run; capability admission remains required before any free/local route is selected |

The complex run's failure mode was model/tool behavior, not a harness false
success: the model emitted planning prose and fenced tool-shaped snippets,
then stopped after a read. The kernel preserved the blocked state and did not
execute speculative code. The deterministic parser regression suite confirms
that the observed LM Studio text envelopes are recoverable without raw JSON
leaking into the transcript.

The current canonical deterministic baseline is `bun run test`: 328 pass / 0
fail / 1094 expectations. This is a harness result and must not be presented
as live-model task success.

## No-action recovery evaluation — 2026-08-24

The kernel now retries a coding turn when the model emits prose without an
executable workspace action. The retry is bounded by the existing
non-progress watchdog and is covered by a deterministic integration fixture;
the same fixture also confirms that an unrecovered task remains `blocked`.

The latest canonical run is:

```text
bun run test            -> 329 pass / 0 fail / 1100 expectations
bun run test:functional -> 24 pass / 0 fail / 86 expectations
```

The Qwen 7B live complex task was rerun after this hardening and still ended
blocked with zero writes. `tool_choice=required` was also tested directly;
the LM Studio response remained textual/planning-oriented and the bounded
evaluation was cancelled after no-progress, with no repository mutation.

## Installed-model comparison continuation - 2026-08-24

The installed Qwen2.5 Coder 1.5B Q8_0 was rerun through the same disposable
simple-edit fixture after the 7B evaluation:

```text
Model                 qwen2.5-coder-1.5b-instruct / LM Studio / Q8_0
Simple edit           source changed and bun test passed
Observed status       BLOCKED after an unnecessary SearchText action
Verification          passed, exitCode=0
Classification        workspace_reader; not coding-eligible
```

This comparison does not weaken the 7B result: the smaller model can perform
one bounded edit, but it does not complete the full task lifecycle reliably.
The current release evidence is:

```text
bun run format:check  -> PASS
bun run typecheck     -> PASS
bun run test          -> 329 pass / 0 fail / 1100 expectations
bun run build         -> PASS
bun run smoke         -> PASS for source and current dist entrypoints
```

## Criteria-gated live continuation - 2026-08-24

The live evaluator now supplies an exact read-only criteria verifier for its
disposable fixture. Fresh runs against Qwen2.5 Coder 7B Q6_K through LM Studio
show:

```text
Simple edit + test       -> COMPLETED, verified=true, criteria satisfied
Complex multi-file task  -> BLOCKED, verified=false, 1 partial file change;
                            add fixed, multiply/export/test missing
False completion         -> 0
```

The model reached the implementation of `add` and a green test, then kept
describing the missing `multiply` step without executing it. The explicit
criteria gate prevented a false `COMPLETED` result. The deterministic suite
now reports `332 pass / 0 fail / 1110 expectations`.

## Qwen2.5 14B live model matrix - 2026-08-24

Qwen2.5 14B Instruct was evaluated through the same LM Studio adapter and
disposable fixture. The fixture is a real Git repository with a committed
baseline, so final diff inspection is part of the run.

```text
Model/runtime       qwen2.5-14b-instruct / LM Studio
Quant/context       Q4_K_M / 32768
Probe               version 11, temperature 0, maxOutputTokens 512
Classification      advanced_coding_agent
Doctor              Autonomous coding READY
Simple edit         COMPLETED, verified=true, 3 turns
Complex multi-file  COMPLETED, verified=true, 5 turns
Changed files       src/math.ts, src/index.ts, tests/math.test.ts
Verification        bun test passed; GitDiff passed
False completion    0 in the observed run
Remote inference    0 calls
```

The exact criteria verifier checked `add`, `multiply` implementation/export,
the new multiply test, and a passing test command. The host-owned completion
gate supplied `verified`; the model's final prose was not authoritative.

| Configuration                                   | Result                                |
| ----------------------------------------------- | ------------------------------------- |
| Qwen2.5 Coder 7B Q6_K, simple edit/test         | PASS                                  |
| Qwen2.5 Coder 7B Q6_K, complex multi-file       | BLOCKED safely; partial progress      |
| Qwen2.5 14B Instruct Q4_K_M, simple edit/test   | PASS                                  |
| Qwen2.5 14B Instruct Q4_K_M, complex multi-file | PASS; criteria/tests/GitDiff passed   |
| Qwen2.5 Coder 1.5B Q8_0                         | workspace_reader; not coding-eligible |

This is measured local MVP evidence, not a claim of Claude/Codex parity.
Long-horizon compaction, live mutation resume, subagents, worktrees, and
authorized remote comparison remain outside this run.

## Observability and progressive prompt guide - 2026-08-24

The reproducible prompt ladder, expected policy/tool behavior, log event
assertions, live-model matrix, and release blockers are maintained in
[TEST-GUIDE.md](TEST-GUIDE.md). The JSONL schema, event taxonomy, redaction
rules, and inspection commands are maintained in [LOGGING.md](LOGGING.md).
The deterministic suite now also covers logger filtering/redaction, JSONL
reporting, process lifecycle summaries, context discovery summaries, provider
request/stream metadata, route decisions, checkpoint lifecycle, and agent-loop
correlation.

## Fresh source and artifact closure - 2026-08-24

The post-closure source checks remain green after the final TUI and capability
cache changes:

```text
bun run format:check  -> BLOCKED by 3 pre-existing untracked docs/ui-chat-v2 files
bunx prettier --check <functional source and kernel paths> -> PASS
bun run typecheck     -> PASS
bun run test          -> 346 pass / 0 fail / 1148 expectations
bun run build         -> PASS
bun run smoke         -> PASS
git diff --check       -> PASS (only Git line-ending warnings)
```

The final live Qwen2.5 14B complex run also completed with `verified=true` in
5 turns against the committed disposable fixture baseline.

## Final observability validation - 2026-08-24

```text
bun run typecheck       -> PASS
bun run test            -> 378 pass / 0 fail / 1231 expectations
bun run test:functional -> 24 pass / 0 fail / 86 expectations
scoped Prettier check    -> PASS
bun run build           -> PASS
bun run smoke           -> PASS
```

The direct source `doctor` smoke with an isolated state/log directory produced
29 valid JSONL records and was summarized by `logs:inspect`. No remote model
call or live coding claim is inferred from this observability smoke.

## Current evaluation closure - 2026-08-25

The latest deterministic run after the capability and review changes is:

```text
bun run test       -> 499 pass / 1 skip / 0 fail / 1583 expectations
bun run typecheck  -> PASS
bun run build      -> PASS
bun run smoke      -> PASS
scoped Prettier    -> PASS for all changed files
real TUI PTY       -> PASS; submit, cancellation, local command, clean exit
```

The global formatter still reports 14 pre-existing files outside the changed
set. That is recorded as a repository hygiene failure, not hidden by running a
blanket formatter over unrelated work.

New deterministic coverage includes:

- oversized native tool batches are rejected before any tool executes;
- free-cloud capability probing is explicit, source-filtered, and never probes
  local candidates through the remote path;
- memory facts are bounded, provenance-aware, revision-aware and secret-safe;
- the read-only code-review agent blocks unavailable verification and passes
  only evidence-backed verified ledgers;
- unavailable verification is distinct from `not_required` and cannot produce
  a verified completion.

Live remote inference was not run in this closure. The free-cloud probe is
implemented and bounded, but Groq/OpenRouter success, quota, latency and
privacy are still account-specific live evidence rather than a claim derived
from a provider key or catalog entry.
