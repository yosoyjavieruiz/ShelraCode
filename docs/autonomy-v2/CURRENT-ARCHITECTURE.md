# Current ShelraCode architecture before Adaptive Autonomy v2

This document records the active source path before the v2 changes. It is a
source/evidence map, not a claim that every adjacent abstraction is active in
the product.

## Active path

```text
src/index.ts
  -> src/tui/launch.tsx
  -> src/tui/app.tsx
  -> analyzeTask / resolveTurnMode / resolveTurnPolicy
  -> repository context + routing
  -> runAgent (src/agent/loop.ts)
  -> ProviderAdapter.stream
  -> normalized provider events
  -> typed workspace tools
  -> ledger evidence/actions/verification
  -> completion gate + final review
  -> TUI event projection
```

## Existing foundations

| Area | Current source | Status before v2 |
|---|---|---|
| Entry | `src/index.ts`, `src/tui/launch.tsx` | ACTIVE |
| Turn classification | `src/router/task-analysis.ts`, `src/agent/turn-policy.ts` | ACTIVE, lexical |
| Repository context | `src/context/repository.ts` | ACTIVE, bounded lexical/context facts |
| Model routing | `src/router/router.ts`, `src/router/route-fallback.ts` | ACTIVE, policy/capability gates |
| Agent loop | `src/agent/loop.ts` | ACTIVE, multi-turn and bounded batches |
| Tools | `src/tools/types.ts`, `src/tools/workspace.ts` | ACTIVE, typed results and permissions |
| Ledger | `src/agent/task-state.ts` | ACTIVE, controller state |
| Graph | `src/agent/task-graph.ts` | PARTIAL, deterministic compatibility graph |
| Plan UI state | `TaskPlan` + `plan.changed` | PARTIAL, previously target-derived |
| Verification | `src/agent/verifier.ts`, `verification-criteria.ts` | ACTIVE, generic/structural |
| Completion | `src/agent/completion-gate.ts` | ACTIVE, proof-oriented but recovery-limited |
| Compaction | `src/agent/compaction.ts` | ACTIVE, structured summary |
| Memory | `src/shared/memory.ts`, storage | ACTIVE, selective facts/episodes |
| Subagents | configuration/paths | NOT PROVEN as productive runtime path |
| Native runtime | `src/runtimes/discovery.ts` | External adapter discovery; managed native runtime absent |

## Main pre-v2 gap

The old plan projection used objective paths and host-generated descriptions.
That is useful as a safety/work-unit hint, but it is not a semantic plan for an
arbitrary engineering objective. v2 separates model-authored semantic
planning, host validation/monotonic history, and controller-owned execution
truth/completion evidence.
