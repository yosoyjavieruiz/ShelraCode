# agent-v1 audit status

The opening section below is the historical audit baseline from 2026-08-24.
The authoritative implementation continuation is recorded at the end of this
file.

## Historical audit baseline — 2026-08-24

## Current phase

Audit complete. The implementation mandate has not started. The next safe
phase is review of the evidence package and an explicit implementation plan.

## Gate snapshot

| Gate                                | Status                                  |
| ----------------------------------- | --------------------------------------- |
| Worktree preservation               | PASS                                    |
| Active source call graph            | PASS                                    |
| Named deterministic regressions     | PASS                                    |
| Typecheck                           | PASS                                    |
| Full deterministic suite            | PASS with 1 skip                        |
| Format check                        | FAIL                                    |
| Source and bundle smoke             | PASS                                    |
| Local 7B bounded coding             | PASS                                    |
| Local 7B complex coding             | FAIL to complete; honest blocked result |
| Local 1.5B autonomous coding        | NOT PROVEN                              |
| Real TUI launch/lifecycle           | PASS for observed journey               |
| Full PTY width/resize acceptance    | NOT PROVEN                              |
| Production cutover/release artifact | NOT VERIFICABLE                         |

## Exit criteria for the audit phase

- [x] Exact worktree baseline captured.
- [x] Active source entrypoint identified.
- [x] Source call graph mapped with unproven edges labeled.
- [x] Known regressions reproduced as current tests.
- [x] Real local model and real TUI evidence collected.
- [x] Evidence package written without production-code edits.

## Explicit non-claims

This status does not claim that ShelraCode is a fully autonomous coding
agent, that every provider works, that the generated bundle is release
reproducible, or that a standalone executable exists.

## Authoritative continuation — 2026-08-25

The kernel now contains the first low-resource progressive-coding vertical:

- explicit multi-file objectives are staged by the host; only one named
  mutation target is writable at a time;
- host verification advances the next target and gives the model a bounded
  next action instead of asking it to hold the whole plan in context;
- objective-aware review requires named files to be read and checks the
  relationship between the objective, changed paths, tests, and exports;
- active context budgets are selected from the exact model size class, with a
  10,000-character coding budget for a 1.5B candidate and larger budgets for
  larger candidates;
- compaction preserves the initial objective/context anchor and the latest
  observation instead of retaining only the newest transcript tail;
- an unmutated blocked route may escalate to another eligible candidate, but
  a route that already mutated the workspace never switches models silently;
- regression rollback restores only post-satisfaction mutations that can be
  attributed to a regressed criterion.

Fresh disposable LM Studio evidence for
`qwen2.5-coder-1.5b-instruct` (`Q8_0`, context `32768`) after this vertical:

```text
multi-file staged task -> COMPLETED, verified=true, 9 turns
changed                -> src/math.ts, src/index.ts, tests/math.test.ts
verification           -> bun test passed after each of 3 mutation stages
content checks         -> add fixed, multiply implemented/exported/tested
simple edit            -> COMPLETED, verified=true, 3 turns
```

This proves the staged fixture path, not arbitrary super-complex repository
reliability. The capability probe may still classify this exact model/runtime
as `workspace_reader`; the progressive path is deliberately guarded by host
criteria and truthful blocking. A current TUI journey using the progressive
route, full provider matrix, standalone artifact, and arbitrary-repository
long-horizon acceptance remain open evidence gates.

## Current-source continuation — 2026-08-25

The context compiler now performs bounded objective-term content search,
promotes matching source files, and excludes credential paths from relevance
results. The TUI builds a routing context first and rebuilds an execution
context after selecting the exact model, using a model-size-aware budget.
Task plans now expose explicit or host-inferred target-file stages and update
verification and target status as host feedback advances the work. Inference
is limited to a small code-file set and is enabled only on the guarded
low-capability route.

Fresh deterministic evidence:

```text
bun run test      -> 452 pass / 1 skip / 0 fail / 1461 expectations
bun run typecheck -> PASS
```

Fresh PTY source journey through `bun --conditions=browser run src/index.ts
--tui`:

```text
Hola              -> no repository tools visible, normal assistant reply,
                      Task completed and verified
cancelled request -> visible Process aborted / Task cancelled, terminal usable
Hola otra vez     -> subsequent prompt completed normally
exit              -> alternate screen restored, exit code 0
```

The current source and bundle have no standalone product `.exe` in the
release surface. The bundle must be rebuilt and smoke-tested after the final
source edits before release claims are made.

## Final validation update - 2026-08-25

The latest source and bundle validation is:

```text
bun run typecheck -> PASS
bun run test      -> 460 pass / 1 skip / 0 fail / 1487 expectations
bun run build     -> PASS
bun run smoke     -> PASS
scoped Prettier   -> PASS
```

The rebuilt `dist/index.js` was launched through the real TUI entrypoint at
80 columns. `Hola` produced a normal response with no repository tools,
showed the completion state, and Ctrl+C restored the terminal with exit code 0.

The exact Qwen2.5 Coder 1.5B Instruct / LM Studio / Q8_0 configuration passed
the bounded disposable three-file coding fixture in two consecutive final
runs. Each run completed in 10 turns, returned `completed` with
`verified=true`, changed only the expected fixture files, and passed three
host-controlled verification stages. This is sufficient evidence for a
guarded progressive low-resource route; it is not evidence of unrestricted
1.5B autonomy on arbitrary repositories.

The product boundary remains explicit: the harness is functional and
frontier-quality in its safety, state, evidence, recovery and verification
architecture, while model capability remains empirical and route-specific.

## Path-domain and UI transparency update - 2026-08-25

The current host no longer treats arbitrary dotted dependency names as file
targets. Workspace paths are canonicalized before host-criteria comparison,
and a disposable integration task containing `Moment.js` plus `index.html`
completed the real `ReadFile` -> `WriteFile` sequence without a phantom
criteria conflict.

The tool domain is explicit and visible: `ReadFile`, `ListFiles`,
`CreateFile`, `EditFile`, `WriteFile`, and `DeleteFile` classify target kind,
enforce workspace/permission/checkpoint boundaries, and return bounded diff
evidence. The TUI renders `CREATE`, `EDIT`, `OVERWRITE`, `DELETE`, and
`BLOCKED` states with the path, operation, payload size, error, and recovery
hint. Provider reasoning is represented only as safe progress metadata; its
private chain-of-thought text is not displayed.

Fresh deterministic validation after this update:

```text
bun run test      -> 474 pass / 1 skip / 0 fail / 1529 expectations
bun run typecheck -> PASS
bun run build     -> PASS
bun run smoke     -> PASS
```
