# ShelraCode agent-v1 audit

Date: 2026-08-24

Status: audit complete; implementation changes intentionally not started.

## Scope

This is a read-only audit of the active ShelraCode source path, the checked-in
tests, the current generated bundle, a disposable live LM Studio fixture, and
the real source TUI entrypoint. Documentation files under this directory are
the only files added by this audit. Existing user changes were preserved.

The repository is the source of truth. Historical documentation and the
research report are treated as hypotheses unless current source or fresh
runtime output confirms them.

## Worktree baseline

Verified locally before and after the audit:

```text
branch: main
root: D:/PROYECTS/shelra
HEAD: 5b0a1d45a90f233461a037149d58a6208fe69d43
staged files: none
```

Pre-existing worktree changes:

```text
 M src/runtimes/http.ts
 M src/runtimes/ollama.ts
 M src/tools/workspace.ts
 M tests/integration/functional-acceptance.test.ts
 M tests/integration/tui-v4-home.test.tsx
 M tests/unit/runtime.test.ts
 M tests/unit/tool-error-recovery.test.ts
```

Diff size at audit start and end: 100 insertions, 1 deletion, 7 files.
The audit did not stash, reset, clean, checkout, stage, commit, or overwrite
these changes.

## Active project and artifact

| Surface               | Current evidence                                            | Classification                         |
| --------------------- | ----------------------------------------------------------- | -------------------------------------- |
| Package/runtime       | package.json, Bun TypeScript ESM package named localcode    | Active                                 |
| CLI entrypoint        | src/index.ts (bin.localcode)                                | Active                                 |
| Source TUI entrypoint | src/index.ts -> src/tui/launch.tsx -> src/tui/app.tsx       | Active                                 |
| Generated bundle      | dist/index.js, 2,428,672 bytes, written 2026-08-24 23:20:02 | Active artifact, provenance incomplete |
| Standalone executable | No current .exe found in the release surface                | Missing                                |
| Agent kernel          | src/agent/loop.ts and related state/gate/verifier modules   | Active, partial                        |
| TUI presentation      | src/tui/presentation/* and OpenTUI views                    | Active, partial                        |

The smoke script passed against both source and bundle help/doctor paths. This
does not prove that the bundle is byte-for-byte attributable to the current
dirty source, nor does it establish packaged executable acceptance.

## Current subsystem classification

| Subsystem                      | State           | Evidence-led assessment                                                                                                      |
| ------------------------------ | --------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Turn classification and policy | Active          | Structural modes and tool policies exist; greeting and read-only tests pass                                                  |
| Agent lifecycle                | Active          | Explicit phases, ledger, recovery watchdog, cancellation and bounded turns exist                                             |
| Context snapshot/compiler      | Active          | Manifest/language/source/test discovery and direct-fact path exist                                                           |
| Evidence sufficiency           | Partial         | Gate exists, but its generic evidence rule is weaker than a task-specific proof obligation                                   |
| Provider normalization         | Partial         | OpenAI-compatible adapter normalizes complete tool calls; richer incremental normalized events are not exposed to the kernel |
| Tool contracts                 | Active          | Schemas, bounded outputs and typed errors exist; contract surface has inconsistencies noted below                            |
| Permissions                    | Active, partial | Turn policy and tool permission checks are structural; Shell is not an OS sandbox                                            |
| Checkpoint/Git safety          | Active, partial | DB checkpoints and dirty-work preservation exist; external process changes remain outside checkpoint coverage                |
| Verification/completion        | Active          | Host verification and completion gate prevent false completion in current fixtures                                           |
| Trace                          | Partial         | Opt-in recorder exists, but event taxonomy and persistence are below the requested JSONL audit contract                      |
| Capability probes/routing      | Active, partial | Probe and router gates exist; fresh capability classification matrix is incomplete                                           |
| Persistent memory              | Partial/unclear | Storage exists, but durable memory retrieval and freshness behavior are not proven by this audit                             |
| Compaction                     | Partial         | Structured transcript compaction exists; full task rehydration is not proven                                                 |
| Explore/Build/Verify subagents | Missing         | No current production delegation path was proven                                                                             |
| Presentation event layer       | Active          | Domain events are mapped to structured UI items; no provider JSON fallback was observed                                      |
| Real TUI lifecycle             | Active, partial | Source launch, matrix activity, cancellation and terminal restoration observed; narrow/resize evidence remains incomplete    |
| Release proof                  | Partial         | Typecheck, full tests, smoke and live fixture evidence exist; format and packaged-artifact gates are not clean               |

## Fresh command evidence

| Command                         | Result                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------- |
| Focused kernel/regression suite | 79 pass, 0 fail, 302 expect()                                                       |
| bun run typecheck               | PASS, exit 0                                                                        |
| bun run test                    | 434 pass, 1 skip, 0 fail, 1398 expect(), 87 files                                   |
| bun run format:check            | FAIL; Prettier reported 16 files                                                    |
| bun run smoke                   | PASS for source and bundle help/doctor paths                                        |
| Real source TUI launch          | Home rendered; route/activity rendered; Ctrl+C cancelled/exited cleanly with exit 0 |

The skipped full-suite test was:

```text
Esc closes the sheet and leaves the composer focused and intact
```

The format failure is not treated as a source correctness failure, but it is a
release-gate failure and must be resolved before a clean handoff.

## Live local evidence

The live fixture used a disposable temporary Git repository and LM Studio at
http://127.0.0.1:1234/v1. This proves a local runtime path only; it is not
production, remote-provider, paid-route, or release evidence.

| Configuration                                    | Scenario               | Result                                                                                                              |
| ------------------------------------------------ | ---------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Qwen2.5-Coder-7B-Instruct, Q6_K, context 32768   | bounded message edit   | Completed, verified, 5 turns; ReadFile -> EditFile -> RunTests passed                                               |
| Qwen2.5-Coder-7B-Instruct, Q6_K, context 32768   | multi-file math change | Blocked honestly, not verified; path errors, edit conflicts and failing verification remained                       |
| Qwen2.5-Coder-1.5B-Instruct, Q8_0, context 32768 | bounded message edit   | Blocked, not verified; correct file changed and test passed, then an extra SearchText call ended without final text |

The 7B complex run is the most important current autonomy result: the
harness did not emit false completion, but the model/runtime/harness
configuration did not complete the multi-file objective.

## Real TUI evidence

The active source path was launched with bun --conditions=browser run
src/index.ts --tui in a PTY. The home screen rendered, the local route was
shown, Hola entered the running state and displayed the AgentMatrixPulse,
and cancellation through the terminal control path restored the terminal and
returned exit code 0.

This is evidence of launch/lifecycle wiring, not proof of a successful live
conversation. The observed model response did not arrive before cancellation.
The session was not run at every required width, and a true PTY resize journey
was not captured. NO_COLOR=1 still produced terminal control sequences
required by the renderer; semantic color suppression is therefore not fully
proven.

## Main audit conclusion

The repository already contains a substantial functional agent kernel. The
known P0 regressions are covered by fresh deterministic tests and currently
pass. The remaining risk is not absence of all architecture; it is the gap
between a promising kernel and a release-grade, capability-aware, observable
long-horizon agent:

1. complex live tasks still block on model/tool recovery and verification;
2. the trace contract is too small and console-oriented for the requested
   evidence package;
3. provider normalization stops at complete calls rather than a complete
   kernel-facing incremental event contract;
4. capability results are not yet a fresh, reproducible matrix for each exact
   model/runtime/template/quantization;
5. subagent delegation and durable memory/rehydration are not proven;
6. format and packaged-artifact gates are not clean.

Therefore the current state is functional kernel: locally verified and
autonomous coding MVP: not yet release-proven. No production code should be
changed until the root-cause and call-graph artifacts are reviewed.
