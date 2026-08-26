# Agent Kernel Architecture

Checked 2026-08-24 against the active source entrypoint (`src/index.ts`) and
the real TUI orchestration path.

## Runtime path

```text
user submit
  -> src/tui/app.tsx:runTask
  -> analyzeTask
  -> resolveTurnMode / resolveTurnPolicy
  -> buildRepositoryContext (read turns only)
  -> ControlPlane.discoverModels (capability probe for repository turns)
  -> selectRoute (privacy, cost, health, context, capability)
  -> runWithRouteFallback (pre-mutation diagnosed provider failures only)
  -> provider adapter.stream
  -> runAgent
       -> normalized model events
       -> schema boundary
       -> workspace tool executor
       -> typed observation
       -> next provider request
       -> verification
       -> independent verifier
       -> completion gate
  -> transcript/persistent AgentTask ledger
```

## Ownership

| Concern                                     | Owner                                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Intent and exposed tools                    | `src/agent/turn-policy.ts`                                                                |
| Task lifecycle/evidence/actions             | `src/agent/task-state.ts`                                                                 |
| Model/tool/result iteration                 | `src/agent/loop.ts`                                                                       |
| Repository snapshot and scoped instructions | `src/context/repository-snapshot.ts`, `instructions.ts`, `repository.ts`                  |
| Tool validation and execution               | `src/tools/workspace.ts`, `src/tools/errors.ts`                                           |
| Workspace boundary and mutation checkpoints | `src/shared/paths.ts`, `src/checkpoint/checkpoint.ts`                                     |
| Capability probes and eligibility           | `src/agent/capability-probe.ts`, `src/router/router.ts`                                   |
| Verification plan and authority             | `src/agent/verification-plan.ts`, `src/agent/verifier.ts`, `src/agent/completion-gate.ts` |
| Persistent task state                       | `src/storage/database.ts` (`agent_tasks`)                                                 |
| Developer trace                             | `src/agent/trace.ts`                                                                      |

Saved sessions can be reopened and resumed with `/resume`. Resume appends a
new task turn to the existing session, preserves the previous task ledger, and
re-evaluates the objective against the current workspace. It is an explicit
same-session restart boundary, not an assertion that an interrupted provider
stream can be reconstructed byte-for-byte.

Provider adapters own protocol translation. The kernel never renders raw
provider events as assistant prose and never lets a model widen its policy.

Current routing correction (2026-08-25): empirical capability classes are a
hard admission gate for the required task role, before quality scoring. A
`chat_only` candidate cannot enter a `coding_agent` or
`advanced_coding_agent` task, and an unmeasured candidate cannot be presented
as coding-capable. Bounded single-file work may require only
`workspace_reader`, but the host still scopes mutation, evidence, verification
and completion. Required executable tools, privacy, cost, context, health,
quota and permissions remain hard boundaries as well. Older status notes that
describe capability as score-only are historical and superseded by this
paragraph.

## Explicit success-criteria authority - 2026-08-24

When a caller supplies explicit success criteria, `runAgent` no longer marks
them satisfied merely because a file changed and a test passed. The caller
must provide the read-only `verifySuccessCriteria` hook, which marks the
criterion IDs supported by current workspace evidence. Missing or failed
criteria keep the task out of `complete`; when the hook is available, the
kernel sends bounded host feedback and allows another action/reverification
turn. This separates generic lifecycle facts from semantic objective proof.

Coding no-action recovery is also evidence-aware: after repository evidence
exists, the retry asks for `EditFile`/`WriteFile` rather than another planning
paragraph. Textual `<tool_request>` envelopes are normalized through the same
schema boundary as native calls.

The TUI integration now uses `verifyStructuralCodingCriteria()` for coding
turns. It checks only host-proven facts—recorded mutation, configured
verification commands, final diff/status review, and checkpoint preservation.
Conversation and knowledge turns intentionally do not receive synthetic
explicit criteria, so a normal `Hello` response is not forced through a
coding-only verifier.

Capability discovery persists exact model/runtime evidence, including probe
version and hardware identity. Timeout/failure cache entries retain the
current probe version, distinguishing negative evidence from legacy unknown
measurements.

## Structured observability - 2026-08-24

`src/shared/logging.ts` is the host-owned JSONL logger. It is injected from the
control plane and passed through context discovery, the agent loop, tools,
process execution, checkpoints, persistence, runtimes, providers, and routing.
Every child logger preserves `sessionId`, `taskId`, `turnId`, provider/model,
component, and phase correlation without putting raw prompt or tool content in
the record. `src/shared/log-report.ts` and `scripts/inspect-agent-log.ts`
provide a bounded event summary for test analysis.

Logging is observational only: it cannot widen permissions, choose a route, or
declare completion. The completion gate and task ledger remain authoritative.
The logger is off by default; `LOCALCODE_LOG_LEVEL`, `LOCALCODE_LOG_PATH`, and
`LOCALCODE_LOG_STDERR` opt it in for a test session.
