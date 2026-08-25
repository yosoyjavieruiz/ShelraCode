# Current root-cause findings

This document distinguishes historical failure mechanisms from current
evidence. The known regressions are currently covered by tests; they are not
reported as still failing merely because the original report described them.

## Regression root causes and current controls

| Reported behavior                                 | Root architectural cause identified in source                                                   | Current control                                                                                  | Fresh status                                                                |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Hola invoked repository activity                  | Tool access was previously coupled to a generic agent path rather than a structural turn policy | resolveTurnMode, resolveTurnPolicy, toolChoice none, zero allowed tools for conversation         | PASS in focused and full suites                                             |
| Language question loaded irrelevant Skill context | Context acquisition lacked a direct-fact strategy and scoped-instruction boundary               | isDirectRepositoryFactQuestion, manifest/language snapshot, direct fact files, .agents exclusion | PASS in functional acceptance                                               |
| ReadFile rejected omitted maxChars                | Host validation treated an optional model field as required                                     | Optional host input and positive internal default of 20,000 chars                                | PASS in unit and focused suites                                             |
| ListFiles(file) leaked ENOTDIR                    | Filesystem enumeration happened before semantic path classification and error normalization     | statForTool then PATH_IS_FILE                                                                    | PASS in unit and focused suites                                             |
| Agent did not recover from typed tool errors      | Tool failures were not consistently returned as structured observations with recovery state     | ToolResult, recovery hints, observe/reflect loop and repeated-call watchdog                      | PASS for named deterministic cases; long-horizon live recovery remains weak |
| Tool JSON appeared as assistant text              | Provider/tool framing was mixed with assistant transcript rendering                             | Native tool event path, textual envelope parser, presentation adapter                            | PASS in regression test; broader provider matrix incomplete                 |
| Model said Done before objective completion       | Completion was coupled to model stopping rather than independent evidence                       | verifier, completion gate, final diff review, task status transition rules                       | PASS in false-completion fixture and live blocked run                       |

## Current residual causes

### Long-horizon live reliability

The 7B complex fixture run produced NOT_FOUND, CONFLICT, and failing test
observations and ended blocked with verified=false. This is honest
termination, but not successful autonomous coding. The 1.5B run made the
bounded edit and passed its test, then issued an unnecessary search and ended
without final text. These results show that the current model/runtime/template
configuration still needs a stronger next-action policy, better task-specific
completion handling, or capability-based rerouting for multi-step work.

### Trace incompleteness

src/agent/trace.ts records only a compact set of task-level events and
defaults to console.error(JSON.stringify(event)) when enabled. It does not
currently provide the requested durable JSONL trace with stable sessionId,
turnId, modelRequestId, and toolCallId on every event.

### Provider event granularity

src/providers/openai-compatible.ts buffers streamed tool-call fragments and
emits a complete tool.call. This prevents partial JSON from entering the
transcript, which is correct, but the kernel-facing contract does not expose
the richer started/arguments-delta/completed event sequence proposed in the
research report.

### Evidence gate specificity

src/context/evidence-sufficiency.ts has a gate, and the language question
works. The generic rule can accept any non-empty evidence item for repository
modes, so a future task-specific gate must require evidence kinds and
relevance appropriate to the objective rather than only evidence presence.

### Release/artifact alignment

Source tests and bundle smoke pass, but format:check fails and no standalone
executable was found. There is no current audit proof tying the bundle hash to
a clean, reproducible source revision.

## Priority

| Priority         | Finding                                                                                                                                 |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| P0 autonomy      | None reproduced in the deterministic regression suite                                                                                   |
| P1 autonomy      | Complex live coding does not complete reliably; capability classification and rerouting need stronger fresh evidence                    |
| P1 observability | Trace schema/persistence does not meet the requested audit contract                                                                     |
| P1 release       | Formatting gate fails; packaged executable acceptance is absent                                                                         |
| P2 architecture  | Incremental provider events, task-specific evidence gates, subagents, memory rehydration and full PTY matrix remain incomplete/unproven |

## Continuation findings — 2026-08-25

The previous long-horizon failure was not only a model-quality problem. The
host gave a small model a multi-file objective as one undifferentiated action
space and accepted generic structural criteria. The current controls split
that path into explicit host stages, preserve the initial context during
compaction, and run an objective-adjacency review before completion.

The 1.5B Q8_0 LM Studio pair now completed the disposable three-file math
task through the real adapter after those controls were enabled. The result
was independently checked by file-content assertions and three passing host
test runs. This is a bounded positive result, not evidence that raw 1.5B
reasoning equals a frontier model or that every repository task will pass.

The remaining root cause for arbitrary super-complex work is semantic
decomposition: extracting exact implementation obligations from a natural
language objective without a task-specific verifier is still conservative.
When the host cannot prove the objective, it must remain blocked or route to a
stronger measured candidate rather than emit an unearned success claim.

## Final recovery controls - 2026-08-25

The final implementation closes the tested failure chain with four
controller-owned controls: failed exact edits require a fresh read, bounded
secret-safe current-content previews make recoverable edit errors actionable,
latest verification failures are promoted into evidence and next paths, and
completion is blocked until the objective review and latest verification pass.

These controls explain the two consecutive final 1.5B fixture passes. They do
not remove the remaining semantic-decomposition boundary for arbitrary
super-complex work.

## Path-domain and transparency finding - 2026-08-25

The reported `Moment.js`/`index.html` sequence exposed a separate host/UI
failure. The objective-path extractor accepted every dotted token as a
workspace path. A dependency name therefore became a phantom host criterion;
the loop emitted `tool.started` before applying that criterion, and the TUI
rendered the rejected request as `WRITE` instead of an explicit blocked action.

The current control is layered:

1. objective-path extraction accepts nested paths, canonical repository files,
   and explicitly named file/document references, but not arbitrary library
   names;
2. route/criteria comparisons canonicalize slash direction, `./`, duplicate
   separators, and dot segments before comparing paths;
3. filesystem tools classify file, directory, missing parent, and outside-root
   targets before execution;
4. `CreateFile`, `EditFile`, `WriteFile`, and `DeleteFile` have distinct
   contracts and return operation plus bounded diff evidence;
5. the presentation adapter labels rejected requests `BLOCKED` and shows the
   typed error/recovery action, while safe model-progress metadata is shown
   without exposing private chain-of-thought.

Focused regression coverage passes for the phantom dependency, explicit root
document, typed path errors, mutation diffs, approval-gated deletion, and the
blocked-write presentation.
