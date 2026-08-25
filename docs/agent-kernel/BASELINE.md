# Agent Kernel Baseline

Fresh baseline checked 2026-08-24 before the current implementation pass.
This file is a snapshot, not a claim that the dirty worktree is releasable.

## Repository and artifact boundary

```text
git status --short       -> dirty: existing modified and untracked work
branch                   -> main
git root                 -> D:/PROYECTS/shelra
HEAD                     -> 4cc7ba7a3a017028c4b06703864493c5445220b9
package bin              -> src/index.ts
```

The active package entrypoint is the TypeScript source path in `package.json`:
`bun --conditions=browser run src/index.ts`. `dist/index.js` exists, but it is
not the package `bin` and was not accepted as evidence for the source-path
behavior. All runtime observations below used the source entrypoint or direct
imports of the same source modules.

The checkout contains substantial pre-existing modified and untracked work,
including UI, agent, provider, context, tool, and test files. No rollback,
cleanup, commit, or blanket staging was performed.

## Fresh command evidence

| Command                          | Result                                                                      |
| -------------------------------- | --------------------------------------------------------------------------- |
| `bun run typecheck`              | PASS, exit 0                                                                |
| `bun run test:functional`        | PASS, 9 tests, 34 expectations                                              |
| `bun test`                       | FAIL, 194 pass, 7 fail, 685 expectations, 201 tests across 50 files         |
| `bun run src/index.ts --help`    | PASS                                                                        |
| `bun run src/index.ts --version` | PASS, `LocalCode 0.1.0`                                                     |
| `bun run src/index.ts doctor`    | PASS; LM Studio healthy, Ollama/llama.cpp unavailable, llmfit fallback      |
| `bun run src/index.ts models`    | PASS; local `qwen2.5-coder-1.5b-instruct` visible; no agent probe in output |
| `bun run src/index.ts providers` | PASS; configured remote providers visible, but strict-zero remained active  |
| `bun run src/index.ts config`    | PASS; privacy `private`, routing `strict-zero`, permission `PLAN`           |

The full-suite failures are current evidence, not dismissed as a clean suite:

- `tui-v4-overlays`: context filtering retains `src/tui/app.tsx` for
  `package`; approval Escape does not render `Approval denied`.
- `tui-v4-tools`: tool-group expansion and controlled activity expansion do
  not render the expected detail; the isolated Solid signal update also stays
  `closed`.
- `workspace-search`: fallback `ListFiles` returns `src\\session.ts` on
  Windows while the test expects `src/session.ts`.

## Real user-visible path

Fresh PTY evidence using `bun run src/index.ts --tui`:

1. The OpenTUI surface launched and selected local LM Studio
   `qwen2.5-coder-1.5b-instruct`.
2. `Hello` produced a normal assistant response and no visible repository
   activity.
3. `What programming language is this project written in?` produced a
   visible `Unknown tool` activity and then an error/`Done` state instead of a
   grounded answer. A direct `runAgent` trace against the same local model
   recorded `GitStatus` with `{"type":"object"}`, followed by repeated
   unavailable `TypeScript` calls, and then `Agent exceeded maximum turns`.
4. Sending Escape during a live repository task aborted the process/tool and
   returned to the TUI. The visible error was `Process aborted`, not a clear
   task-ledger `cancelled` state. Sending a terminal Ctrl+C control character
   invoked the launcher's SIGINT teardown and exited the renderer; this is not
   sufficient evidence of an in-app cancellation state.

## Current runtime call graph

```text
user input
  -> src/tui/launch.tsx:52-94, renderer + signal teardown
  -> src/tui/app.tsx:1648-1687, submit + runTask promise
  -> src/tui/app.tsx:858-1073, task orchestration
  -> analyzeTask + resolveTurnMode + resolveTurnPolicy
  -> buildRepositoryContext (workspace_read/coding only)
  -> ControlPlane.discoverModels
  -> selectRoute
  -> runtime/provider adapter
  -> runAgent
  -> GenericOpenAICompatibleProvider.stream
  -> normalized provider events
  -> workspace tool validation/execution
  -> serialized tool observation and next provider request
  -> automatic bun test after mutation, when configured
  -> AgentRunResult.verified
  -> UI notice and assistant transcript
```

State is currently split between app Solid signals, local loop variables,
SQLite sessions/messages/routes/checkpoints, and the model transcript. There
is no durable `AgentTask` ledger owning phase, success criteria, evidence,
hypotheses, plan steps, blockers, changed files, or completion-gate state.

## Subsystem classification

| Subsystem                  | State                 | Evidence and boundary                                                                                                 |
| -------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------- |
| CLI entrypoint             | WORKING               | `src/index.ts`; help/version/doctor/models/config execute                                                             |
| TUI launch/lifecycle       | PARTIALLY WORKING     | OpenTUI launches and restores the terminal; SIGINT teardown competes with in-app cancellation                         |
| turn controller            | PARTIALLY WORKING     | `src/tui/app.tsx:858-1073`; no persistent task state                                                                  |
| turn policy                | CONNECTED BUT FRAGILE | Four modes only; plan/review boundaries are misclassified or write-capable                                            |
| prompt assembly            | PARTIALLY WORKING     | Three profiles and repository context are assembled, but no scoped instruction precedence or structural evidence gate |
| AGENTS.md loading          | PARTIALLY WORKING     | Root/context files can enter the broad context; nested scope semantics are not modeled                                |
| Skills                     | CONFIG-ONLY           | No default full preload in current builder, but no relevance metadata/load contract                                   |
| repository discovery       | PARTIALLY WORKING     | Git/rg/walk discovery and manifest-priority ordering exist; no `RepositorySnapshot` object                            |
| context sufficiency        | MISSING               | Model can stop after a failed/unrelated tool without host proof of sufficient evidence                                |
| ReadFile/ListFiles         | CONNECTED BUT FRAGILE | Input validation and path-kind errors exist; schema/argument behavior still fails with live local model               |
| GlobFiles                  | MISSING               | No `GlobFiles` tool in `workspaceTools`                                                                               |
| SearchText                 | PARTIALLY WORKING     | rg and fallback exist; errors/results are not fully typed/bounded as required                                         |
| EditFile/WriteFile         | PARTIALLY WORKING     | Exact replacement and checkpoint recording work in fixtures; central permission/stale-edit policy is incomplete       |
| Shell/RunTests             | CONNECTED BUT FRAGILE | Process execution and timeout exist; no workspace command containment or first-class test-failure model               |
| GitStatus/GitDiff          | CONNECTED BUT FRAGILE | Read tools exist; no complete pre-existing-work ownership ledger                                                      |
| typed errors               | PARTIALLY WORKING     | Only four path/input codes are defined; shell/test/git/provider failures remain heterogeneous                         |
| model stream normalization | PARTIALLY WORKING     | OpenAI-compatible text/tool events are normalized; parser/template differences and abort semantics are incomplete     |
| router                     | PARTIALLY WORKING     | Privacy/cost/health/quota gates exist; empirical capability probes are not wired into discovery/routing               |
| model capability           | TEST-ONLY             | Probe exists and has unit coverage, but no persisted or route-enforced result                                         |
| verification               | PARTIALLY WORKING     | Post-mutation `bun test` can run; project command discovery and structured failure iteration are missing              |
| completion                 | MISSING               | `verified` starts true; no objective/success-criteria/evidence/final-review gate                                      |
| checkpoints                | PARTIALLY WORKING     | Hash-aware rollback protection exists; no full dirty-worktree ownership ledger                                        |
| persistence/resume         | PARTIALLY WORKING     | Sessions/messages/routes/checkpoints persist; task lifecycle does not                                                 |
| cancellation               | PARTIALLY WORKING     | AbortSignal reaches process and fake provider; real TUI semantic state is not reliable                                |
| observability              | MISSING               | No developer trace answering why a tool/model/stop decision happened                                                  |
| compaction                 | MISSING               | No long-horizon state reconstruction                                                                                  |
| independent verifier       | MISSING               | No read-only final verifier                                                                                           |
| subagents/worktrees        | MISSING               | Correctly outside the first kernel slice, but not implemented                                                         |
| deterministic evaluations  | PARTIALLY WORKING     | Functional suite is useful and green; required fixture matrix and experiment harness are incomplete                   |

## Required read-only reproductions

| Scenario                 | Current evidence                                    | Result                                                                                    |
| ------------------------ | --------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `Hello`                  | Functional suite and real TUI                       | PASS: zero tools in functional path; real TUI answered normally                           |
| General knowledge        | Functional suite                                    | PASS: no repository tools                                                                 |
| Project language         | Real LM Studio plus direct loop trace               | FAIL: invalid object-shaped argument and repeated unknown tool; no grounded answer        |
| Real symbol lookup       | Deterministic read-only scripted run for `runAgent` | Harness executes `SearchText` then `ReadFile` without writes; no live-model success proof |
| Plan-only OAuth analysis | Deterministic classifier/run                        | FAIL boundary: exact wording classified `knowledge`, exposed no repository tools          |
| Review-only              | Deterministic classifier/run                        | FAIL boundary: classified `coding`, exposing write-capable policy                         |

## Root-cause status

Confirmed current causes are recorded in [ROOT-CAUSES.md](ROOT-CAUSES.md).
The former `SKILL.md`/`ENOTDIR` screenshot is not reproducible verbatim from
the present source, but the live model reproduced a new failure in the same
class: protocol-validity and tool-inventory mismatch followed by loop
termination without an evidence gate.

## Post-implementation evidence — 2026-08-24

The initial counts above are retained as the before snapshot. After the
kernel implementation, fresh deterministic evidence is:

| Command                                                      | Result                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `bun run typecheck`                                          | PASS, exit 0                                                                         |
| `bun run test:functional`                                    | PASS, 24 tests, 86 expectations                                                      |
| focused loop/checkpoint/tool/compaction/verifier/trace tests | PASS                                                                                 |
| `bun run src/index.ts doctor --agent`                        | PASS command; live qwen classified `workspace_reader`, autonomous coding `NOT READY` |

This separation is intentional: the fake-provider suite proves host/kernel
behavior, while the live capability probe proves that the currently selected
small LM Studio model is not eligible for autonomous coding. Full-suite and
real TUI post-change evidence remains recorded only after rerun.

The post-change source TUI rerun confirmed: `Hello` receives a normal answer
with no repository activity; the repository-language question receives a
focused host context, exposes no model workspace tools, and completed with
visible `Done`/`TypeScript`; and Ctrl+C exits cleanly after the turn. A live
coding task could not be started because no eligible local model was present.
The Sessions -> open -> `/resume` path also completed a same-session
conversational restart against persisted state.

## Historical verification snapshot — 2026-08-24

The following snapshot predates the current multi-stage verification tests and
the current dirty TUI branding assertions. See [FINAL-AUDIT.md](FINAL-AUDIT.md)
for the current release evidence.

## Fresh continuation evidence — 2026-08-24

The checkout remained dirty and all pre-existing changes were preserved. After
the deterministic contract pass:

```text
bun run typecheck       -> PASS, exit 0
bun run format:check    -> PASS
bun run test:functional -> PASS, 24/24, 86 expectations
bun run test            -> PASS, 311/311, 1052 expectations, 66 files
bun run smoke           -> PASS for source and current dist entrypoints
```

The live LM Studio model was not invoked in this continuation. No claim about
its coding capability, tool template, quantization, or test iteration is
updated by these deterministic results.

```text
bun run typecheck       -> PASS, exit 0
bun run test:functional -> PASS, 24 tests, 86 expectations
focused kernel suite    -> PASS, 68 tests, 272 expectations across 8 files
bun run smoke           -> PASS, source and rebuilt bundle
full canonical test     -> historical PASS snapshot: 290 pass, 0 fail,
                           982 expectations, 290 tests across 64 files
```

The focused repair stayed within functional TUI behavior: status-bar prop
compatibility, reactive overlay mounting, context filtering/count propagation,
and Escape acceptance timing. No visual redesign was introduced. Current
canonical-suite failures and the live model capability boundary are recorded
in the final audit.

The historical counts in the preceding blocks are superseded by the latest
canonical run: `bun run test` is `312/312` with `1053` expectations, while the
functional acceptance suite is `24/24`. The live model boundary is unchanged.

Latest authoritative continuation evidence is `317/317` canonical tests with
`1065` expectations, `24/24` functional acceptance, passing format/typecheck,
current-source build, and source/current-dist smoke. The live probe is now
version 8; its model-role filtering, deterministic temperature, recovery
measurement, and executable evidence gate are included in that result.

The current authoritative continuation supersedes that count with `319/319`
canonical tests and `1076` expectations. It also includes LM Studio native
model metadata normalization and a wire-model-id regression. The installed
model remains below the autonomous-coding capability gate.

## Current live baseline after Qwen2.5 Coder 7B became available — 2026-08-24

The active local baseline is now explicitly recorded as:

```text
Runtime       LM Studio OpenAI-compatible endpoint
Model         qwen2.5-coder-7b-instruct
Display       Qwen2.5 Coder 7B Instruct
Quant         Q6_K
Context       32768
Probe         version 11
Class         workspace_reader
```

Live simple edit/test: PASS in a disposable fixture. Live multi-file coding:
BLOCKED with zero writes and no false completion. Therefore the effective
autonomous-coding baseline remains below release, even though the local model
is stronger than the earlier 1.5B candidate.

Latest deterministic source baseline:

```text
bun run test            -> 328 pass / 0 fail / 1094 expectations
bun run test:functional -> 24 pass / 0 fail / 86 expectations
bun run typecheck       -> PASS
bun run format:check    -> PASS
bun run build           -> PASS
bun run smoke           -> PASS
```

The subsequent no-action recovery hardening adds one integration regression
and leaves the release checks green: `bun run test` is now 329 pass / 0 fail /
1100 expectations. The live Qwen 7B complex task remains blocked with zero
writes, as required by the capability gate.
