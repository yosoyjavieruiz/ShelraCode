# ShelraCode current repository baseline

**Phase:** 0 — Establish the truth baseline  
**Snapshot date:** 2026-08-27 (`America/Santo_Domingo`)  
**Source revision:** `230b5575a592897fa113e3d05407e6f93e4f01da` on `main`  
**Evidence status:** `VERIFIED_LOCAL` unless a section says otherwise

## Purpose and evidence vocabulary

This document records the repository and runtime that actually existed when the
self-calibrating-runtime roadmap began. It is a baseline, not a capability
certificate and not a claim that the current executable was built from the
current dirty worktree.

- `VERIFIED_LOCAL`: observed from the current checkout, a fresh local command,
  or a loopback-only runtime request during this audit.
- `VERIFIED_EXTERNAL`: checked against a current primary source and linked from
  the ADR.
- `UNPROVEN`: the mechanism or claim may exist, but the required end-to-end
  evidence was not produced.
- `NOT_VERIFIED`: the audit did not exercise or inspect enough of the boundary
  to make the claim.

Fake or scripted model tests prove deterministic host behavior only. They are
never counted as real-model autonomy evidence in this baseline.

## Scope and non-goals

Phase 0 performed a read-first audit and added documentation only. It did not:

- rewrite `src/agent/loop.ts` or `src/tui/app.tsx`;
- introduce a second runtime, TUI, or delivery path;
- create model profiles, a new core, a lab, an execution broker, or a DCS;
- repair pre-existing formatting or dirty-worktree test failures;
- rebuild or install the executable;
- create Claude Code configuration before repository commands and boundaries
  were known.

## Repository state

### Git and worktree

| Fact                              | Observation                                                        |
| --------------------------------- | ------------------------------------------------------------------ |
| Branch                            | `main`                                                             |
| `HEAD`                            | `230b5575a592897fa113e3d05407e6f93e4f01da`                         |
| Local upstream comparison         | `origin/main`, ahead 2 and behind 0 against the existing local ref |
| External upstream freshness       | `NOT_VERIFIED`; no fetch was performed                             |
| Staged changes                    | none                                                               |
| Dirty entries before Phase 0 docs | 96 modified, 90 deleted, 12 untracked                              |
| Existing diff before Phase 0 docs | 186 tracked files, +2,377 / -21,924 lines                          |

The dirty worktree belongs to the user and was preserved. A Git commit hash by
itself therefore does not identify the source that the evaluator or an ignored
binary represents. The deleted historical architecture audit was inspected
from `HEAD` without restoring it into the worktree.

### Repository and stack

| Area                    | Current evidence                                                               |
| ----------------------- | ------------------------------------------------------------------------------ |
| Package                 | one TypeScript ESM package, `shelra@0.1.1`                                     |
| Package manager/runtime | Bun 1.3.14                                                                     |
| TypeScript              | 7.0.2 installed; strict compilation through the repository config              |
| UI                      | SolidJS 1.9.12 + OpenTUI 0.5.7                                                 |
| Persistence             | `bun:sqlite` plus filesystem/config state                                      |
| Workspace declaration   | no package workspaces declared in `package.json`                               |
| Package-manager pin     | no `packageManager` or `engines` field in `package.json`                       |
| CI                      | no repository CI workflow/configuration found in the audited tree              |
| Source inventory        | 135 files under `src/`                                                         |
| Test inventory          | 131 files under `tests/`: 85 unit, 36 integration, 6 UI, plus fixtures/support |

Primary repository areas:

| Path                                                              | Current responsibility                                                                                     |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                                                    | package/bin entry point and command dispatch                                                               |
| `src/cli/startup.ts`                                              | startup mode and command-line launch behavior                                                              |
| `src/tui/launch.tsx`                                              | canonical OpenTUI renderer launch                                                                          |
| `src/tui/app.tsx`                                                 | application composition and substantial task lifecycle orchestration                                       |
| `src/agent/loop.ts`                                               | the main tool-using agent loop and substantial turn/recovery authority                                     |
| `src/agent/`                                                      | task contracts, planning, context, tools, verification, checkpoints, persistence, and related host logic   |
| `src/providers/`                                                  | provider contracts, registry, OpenAI-compatible adapter, streaming/tool normalization, and circuit breaker |
| `src/runtimes/`                                                   | local runtime discovery and Ollama/runtime HTTP integration                                                |
| `src/agent/capability-probe.ts` and `src/shared/model-quality.ts` | model probe/classification and heuristic quality handling                                                  |
| `src/router/`, `src/privacy/`, and `src/quota/`                   | route policy, privacy, free-capacity, quota, and strict-zero decisions                                     |
| `scripts/evaluate-agent.ts`                                       | deterministic and local model evaluation entry point                                                       |
| `scripts/build.ts`                                                | bundle/executable build and optional per-user installation                                                 |
| `scripts/smoke.ts`                                                | source/bundle/executable CLI smoke and deterministic evaluator smoke                                       |
| `tests/`                                                          | deterministic host, integration, and UI-oriented coverage                                                  |

## Discovered development commands

These commands are taken from the audited `package.json`; they are not example
commands inferred from the roadmap.

| Intent                | Command                                 |
| --------------------- | --------------------------------------- |
| Source CLI/TUI        | `bun run shelra` or `bun run dev`       |
| Explicit TUI          | `bun run dev:tui`                       |
| Typecheck             | `bun run typecheck`                     |
| Full tests            | `bun run test`                          |
| Functional acceptance | `bun run test:functional`               |
| Format check          | `bun run format:check`                  |
| Build                 | `bun run build`                         |
| Smoke                 | `bun run smoke`                         |
| Agent evaluation      | `bun run scripts/evaluate-agent.ts ...` |

`scripts/build.ts` also installs the generated executable unless
`SHELRA_BUILD_SKIP_INSTALL=1` is set. Phase 0 intentionally did not run the
build because it would replace ignored artifacts and could update the user's
per-user installation.

## Active launch and artifact path

### Source path

The current no-argument/package path is:

1. the `shelra` bin in `package.json` resolves to `src/index.ts`;
2. command/startup handling selects the conversation/TUI route;
3. `src/tui/launch.tsx` creates the OpenTUI renderer;
4. `AppShell` in `src/tui/app.tsx` owns the visible application;
5. its task path performs routing, context construction, persistence,
   checkpoint, and permission setup before invoking `runAgent`;
6. `runAgent` in `src/agent/loop.ts` drives the model/tool turn loop.

This is the authoritative source path found in the audit. No second current TUI
entry point was found or created.

### Executable observed on `PATH`

The executable resolved from the user's environment was:

`C:\Users\Javie\.shelra\bin\shelra.exe`

| Artifact               |              Size | SHA-256                                                            |
| ---------------------- | ----------------: | ------------------------------------------------------------------ |
| `dist/index.js`        |   2,900,188 bytes | `2A15DD510CD55A87B408590DAAC7689E149C2FE291A70C0428BF07A34C77595E` |
| `dist/shelra.exe`      | 111,501,824 bytes | `5A203C9F9A4875F41F597B2BE4C4DCD282F79FC12B4A4CB249AEEE6687BCB43A` |
| installed `shelra.exe` | 111,501,824 bytes | `5A203C9F9A4875F41F597B2BE4C4DCD282F79FC12B4A4CB249AEEE6687BCB43A` |

The distribution and installed executable were byte-identical and reported
version 0.1.1. The executable was unsigned. Its observed timestamp was
2026-08-27 23:10:54Z.

**Boundary:** equality between `dist/shelra.exe` and the installed file proves
only that those two files match. There is no manifest tying either file to the
current dirty source, exact Git diff, build configuration, or model/runtime
configuration. Artifact provenance is therefore `UNPROVEN`.

## Current lifecycle authority

The historical concentration targets still exist and remain large:

| Target              |                                           Current size | Authority observed                                                                                                                                      |
| ------------------- | -----------------------------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/agent/loop.ts` | 5,615 physical lines including blanks (5,522 nonblank) | tool-loop state, turn progression, action handling, recovery and completion-related control; exported `runAgent` occupies most of the file              |
| `src/tui/app.tsx`   | 4,189 physical lines including blanks (4,123 nonblank) | application composition plus provider/routing/context/task/persistence/checkpoint/permission orchestration; `runTask` spans a large portion of the file |

The codebase also contains valuable boundaries that a strangler migration can
preserve and extend:

- typed task contracts, ledgers, transitions, plans, and execution profiles;
- a context compiler and repository-intelligence service;
- typed tool and domain-error boundaries;
- stale-edit checks and checkpoint support;
- path canonicalization and existing-symlink checks;
- route explanations, privacy checks, and strict-zero provider policy;
- cancellation via `AbortSignal` in important paths;
- snapshots, resume policy, and persisted task/session data;
- verifier callbacks and deterministic host-side test coverage;
- a control plane/event-bus foundation.

These components do not yet establish the target architecture. In particular,
the TUI still participates in lifecycle authority, `runAgent` remains a major
control concentration, and objective verification is injected from UI-owned
orchestration rather than accepted by a small authoritative core.

## Repository intelligence baseline

`src/context/repository-intelligence.ts` currently exposes useful lightweight
repository structure. It derives symbols, imports, references, and related-test
heuristics using text/line-oriented logic.

Classification for the roadmap:

- deterministic tree/search/manifest/Git facts: **partially present**;
- syntax-aware structure backed by a real parser/AST: **not established as a
  normalized cross-language service**;
- LSP/provider-backed definitions, references, callers, types, and diagnostics:
  **not established**;
- semantic/vector retrieval: **not a current Phase 0 dependency and not
  justified by evidence**.

The current service is an asset to test against a raw-search baseline, not proof
that roadmap Repository Intelligence Levels 1–3 are complete.

## Model identity and capability baseline

The current model/probe path captures more than a model name: provider/runtime
IDs, model ID, optional quantization, context data, runtime metadata, tool-parser
metadata, generation configuration, and hardware fields can appear in an
`AgentProbeEnvironment`.

The LM Studio adapter exposed quantization, architecture, parameter and size
metadata, loaded state, maximum context, and trained-tool-use metadata during
the audit. Important exact-identity fields are still absent or not reliably
persisted:

- model artifact path/ID and SHA-256;
- LM Studio/runtime version;
- exact chat and tool templates;
- tokenizer identity;
- structured-output/grammar engine and version;
- loaded-instance context/KV/backend configuration as distinct from catalog
  maximums;
- complete sampling/reasoning configuration;
- durable hardware/backend identity where behavior may differ.

The SQLite capability cache is currently keyed by provider/model identity, not
the complete model/runtime/artifact/configuration identity. A quality heuristic
also uses parameter/coder-name signals. Neither mechanism is sufficient to
grant software-engineering authority under the new policy.

## Evaluation inventory

### Deterministic host evidence

The deterministic evaluator has 18 journeys and uses scripted/fake model
behavior. It exercises useful host contracts such as tool execution,
verification, recovery, cancellation, permissions, context behavior, and
multi-file flows. Its expected actions are available to the test harness.

Fresh result:

```text
bun run scripts/evaluate-agent.ts --deterministic --summary
PASS (18/18 passed; failed=0; unproven=0; skipped=0)
```

Classification: `VERIFIED_LOCAL_DETERMINISTIC`. It proves host behavior against
scripted actions, not autonomous local-model performance.

### Held-out and protected evaluation

No protected held-out task store, restricted expected-result mechanism, or
implementation/evaluation context boundary was found. The current one-file
local task includes visible objective/test expectations and is suitable as a
smoke journey, not as contamination-resistant certification.

The evaluator reports to stdout. Phase 0 found no durable raw-result bundle that
could reproduce a failed model action solely from a run manifest. The existing
provenance includes `HEAD`, fixture revision, commands, OS/hardware, Bun, and
artifact hashes, but `HEAD` alone omits dirty source state.

### Real local-model baseline

Loopback discovery found LM Studio on `127.0.0.1:1234`. Ollama on port 11434 and
llama.cpp on port 8080 were unavailable. The audit used no cloud provider,
download, paid route, or non-loopback network action.

Command:

```text
bun run scripts/evaluate-agent.ts --local-only --json --max-models=1
```

Observed exact-enough identity for this baseline:

| Field                                       | Observation                 |
| ------------------------------------------- | --------------------------- |
| Provider/runtime                            | LM Studio                   |
| Model                                       | `qwen2.5-coder-7b-instruct` |
| Architecture / class                        | Qwen2, approximately 7B     |
| Quantization                                | `Q6_K`                      |
| Artifact size reported by runtime           | 6,254,199,296 bytes         |
| Runtime catalog maximum context             | 32,768                      |
| Loaded-instance context observed separately | 16,384                      |
| Temperature / max output in probe           | 0 / 512                     |
| Runtime version                             | `UNPROVEN`                  |
| Artifact SHA-256                            | `UNPROVEN`                  |
| Chat/tool template                          | `UNPROVEN`                  |

Probe observations:

- conversation, read, multi-turn, tool selection, arguments, edit, and
  verification probes passed in this one run;
- the error-recovery probe failed after the injected `PATH_IS_FILE` condition;
- repository reasoning was unmeasured;
- the current classifier still labeled the configuration `coding_agent`.

One temporary-fixture micro-edit journey completed in two turns with two tool
runs and passed its host verification (`bun test` against the fixture). The
fixture changed `src/message.ts` in an isolated temporary workspace and was
cleaned up.

The evaluator explicitly reported the remaining 17 local journey types as
`UNPROVEN`. This single run therefore does **not** certify C2, general coding
reliability, recovery reliability, or write authority. It demonstrates that a
real local configuration was available and can complete one bounded smoke task
through the current driver.

## Persistence and durable-state baseline

Current snapshots persist meaningful task data: ledger, repository identity and
revision information, working paths, route/context anchors, active node,
in-flight state, and revision. Resume logic detects changed Git revision and
limits tolerated dirty paths to task-owned or in-flight targets. Interrupted
operations can be recorded as failed and force a fresh read.

Verified gaps and unproven boundaries:

- snapshots do not persist/re-attach checkpoint identity as a complete
  authoritative resume boundary;
- same-revision concurrent persistence can still become last-writer-wins;
- real process-kill → SQLite rehydrate → TUI continuation was not exercised;
- duplicate destructive-side-effect prevention after a process crash is
  `UNPROVEN`;
- a natural-language summary is not accepted as proof of same-task resume.

## Execution and security baseline

### Useful existing controls

- workspace/path validation in file tools;
- existing-component symlink and real-path checks;
- stale-edit and checkpoint hashing;
- permission modes and command policy checks;
- process timeout/cancellation and environment sanitation;
- route-level privacy, zero-cost, and strict-zero policy;
- redaction of high-confidence secrets in important remote-context/log paths.

### Gaps relative to the target ExecutionBroker

There is no single broker through which every side effect passes. Side effects
also occur in provider requests, checkpoint rollback, SQLite/config/log writes,
installer/PATH operations, capability probes, and worktree management.

The current process-isolation result explicitly reports `osEnforced: false`
with no OS sandbox mechanism. Strict-zero currently constrains provider routing;
it is not an independently demonstrated OS-level network-egress boundary for
all processes. A generic provider adapter can perform HTTP when called through
another authorized path.

Additional verified risks or unproven boundaries:

- path validation is susceptible to time-of-check/time-of-use races if a path
  is swapped to a symlink after validation;
- checkpoint rollback does not establish no-follow/handle-based final writes;
- an empty missing file and empty content can share the SHA-256 of an empty
  string in checkpoint logic;
- checkpoint/session data can include plaintext source or conversation
  material in SQLite; no at-rest encryption or database-permission hardening
  was established;
- no strict-zero network escape, workspace/symlink race, or secret-at-rest
  release suite was executed independently in Phase 0.

These observations are baseline findings, not exploit demonstrations. Phase 12
must prove host/OS enforcement and close or explicitly contain them before any
corresponding release claim.

## Claude Code project configuration baseline

The checkout contains repository agent/skill material under `.codex/` and
`.agents/`. The only `.claude/` entry found was an ignored
`scheduled_tasks.lock`; no root `CLAUDE.md`, `.claude/settings.json`, path-scoped
rules, Claude project agents, or Claude project Skills were found.

Phase 0 intentionally did not create these. Later configuration must use the
actual commands and boundaries recorded here, and must not imply deterministic
enforcement where the installed Claude Code mechanism or host does not provide
it.

## Fresh command baseline

| Command                                        | Fresh result                                                           | Interpretation                                                                           |
| ---------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `bun run typecheck`                            | exit 0                                                                 | current TypeScript compilation passed                                                    |
| `bun run format:check`                         | exit 1; 35 pre-existing/worktree files reported                        | repository-wide formatting gate is not green                                             |
| `bun run test:functional`                      | 26 pass, 0 fail, 102 assertions                                        | focused functional host acceptance passed                                                |
| `bun run test`                                 | 744 pass, 1 fail, 1 skip; 2,505 assertions; 746 tests across 121 files | full deterministic suite has one recorded failure                                        |
| focused `tests/unit/code-review-agent.test.ts` | 2 pass, 1 fail; expected `PASS`, observed `BLOCKED`                    | failure reproduced independently                                                         |
| deterministic evaluator                        | 18/18 pass                                                             | scripted/fake-provider host evidence only                                                |
| local-only evaluator                           | one micro journey passed; 17 journeys unproven; recovery probe failed  | limited real-model evidence only                                                         |
| `bun run smoke`                                | exit 0                                                                 | source/bundle/executable help, version, doctor, and deterministic evaluator smoke passed |

The sole full-suite failure is reproducible. The test gives the review agent
`process.cwd()` as its repository root; the implementation runs
`git diff --check --`; the current dirty worktree contains whitespace/formatting
issues, so the verdict becomes `BLOCKED` rather than the test's expected
`PASS`. This is a test-isolation/current-worktree dependency in the Phase 0
baseline. It was recorded rather than hidden, skipped, or weakened.

The smoke command did not provide a real keyboard-driven OpenTUI journey,
narrow-terminal checks, cancellation behavior, terminal restoration, or proof
that the ignored executable came from the current source.

## Baseline conclusions

1. ShelraCode already has valuable typed host, safety, routing, checkpoint, and
   deterministic-test foundations; the transformation should be a strangler
   migration, not a big-bang rewrite.
2. `src/agent/loop.ts` and `src/tui/app.tsx` remain lifecycle-authority
   concentrations and must be reduced only behind executable parity evidence.
3. The current evaluator is strong enough to freeze scripted host behavior but
   not yet to reproduce and certify exact real-model configurations.
4. A real Qwen2.5-Coder 7B Q6_K configuration completed one bounded micro edit,
   while recovery failed and the other local journeys remained unproven.
5. Exact model identity, persistent raw run evidence, protected tasks, and
   authority invalidation are required before promotion.
6. Current route policy is not an OS-level ExecutionBroker/security proof.
7. Source, generated artifacts, installed artifacts, and real-model evidence
   must remain separately labeled until a provenance manifest binds them.

This baseline satisfies the Phase 0 truth-recording requirement. It does not
authorize implementation beyond the next phase gate.
