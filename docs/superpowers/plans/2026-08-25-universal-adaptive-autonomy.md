# Universal Adaptive Autonomy implementation plan

> **For the implementation agent:** execute this plan incrementally. Preserve
> existing user changes and keep the agent kernel provider-independent.

## Goal

Turn ShelraCode into an adaptive software-engineering control plane while
preserving the existing Bun/TypeScript/OpenTUI architecture. The semantic
plan must be proposed by the LLM through a structured plan contract. The host
validates scope, dependencies, permissions, evidence and completion, but it
must not replace the model's semantic plan with a fixed task-specific tree.

Plan evolution is monotonic: accepted decisions remain in history; a replan
adds a revision, repair node or explicit supersession record. No controller
operation may silently erase a model decision.

## Current constraints

- `src/agent/loop.ts` is the active production loop and already owns tool
  execution, mutation gates, verification and completion.
- `src/agent/task-state.ts` and `src/agent/task-graph.ts` are existing domain
  state; extend them instead of creating a second ledger.
- `src/tui/app.tsx` is the active TUI caller; business state must stay outside
  the TUI.
- Existing direct `runAgent` callers and tests remain compatible unless a new
  planning mode is explicitly requested.
- No native provider, subagent runtime or UI redesign is in scope for this
  vertical.

## Files to add or change

- `src/agent/task-contract.ts` — generic contract types and deterministic
  extraction of explicit facts from a request.
- `src/agent/execution-profile.ts` — adaptive strategy selection.
- `src/agent/planner.ts` — LLM plan proposal protocol, schema validation and
  append-only plan revisions.
- `src/agent/recovery.ts` — typed recovery contracts and non-repetition rules.
- `src/agent/task-state.ts` — persist contract/profile/plan revisions/recovery.
- `src/agent/task-graph.ts` — model-authored nodes and monotonic revisions.
- `src/agent/types.ts` — planning/profile options and result metadata.
- `src/agent/loop.ts` — contract compilation and structured plan integration.
- `src/tui/app.tsx` — request model planning for adaptive structured work and
  stop supplying a fixed generic plan as semantic authority.
- `tests/unit/task-contract.test.ts`
- `tests/unit/execution-profile.test.ts`
- `tests/unit/planner.test.ts`
- `tests/unit/recovery.test.ts`
- `tests/integration/agent-planner.test.ts`
- `docs/autonomy-v2/` — current architecture, contracts and evaluation docs.
- `SHELRACODE-AUTONOMY-V2-IMPLEMENTATION.md` — root handoff report.

## Incremental steps

### Step 1 — Domain contract and adaptive strategy

1. Add generic `TaskContract`, deliverable, acceptance, evidence, risk and
   uncertainty types.
2. Compile only explicit user facts deterministically; semantic deliverable
   interpretation remains available to the LLM planner.
3. Select conversation/direct/linear/structured/decomposed without task-name
   branches and add unit tests first.

### Step 2 — LLM-defined monotonic planner

1. Request exactly one structured `PlanProposal` from the selected LLM.
2. Validate IDs, dependencies, cycles, workspace scope, legal tools,
   read-only constraints and bounded plan size at the host boundary.
3. Append accepted proposals as immutable revisions. Replans use new node IDs
   and explicit supersession; they do not overwrite prior nodes.

### Step 3 — Ledger and loop integration

1. Persist contract/profile/plan metadata in `AgentTaskLedger`.
2. Add explicit `planningMode`; existing callers keep compatibility when it is
   unset, while the production adaptive path requests an LLM plan for
   structured/decomposed work.
3. Use the accepted model proposal for the authoritative plan projection;
   retain host scope and permission gates.
4. Emit the existing `plan.changed` event from authoritative state.

### Step 4 — Recovery and proof boundary

1. Record typed recovery contracts for tool, protocol and verification errors.
2. Prevent identical retries and preserve failed strategies.
3. Expose missing completion evidence as actionable recovery metadata.

### Step 5 — Evaluation and handoff

1. Document current versus target architecture and unimplemented boundaries.
2. Add heterogeneous task-level regressions without production benchmark
   branches.
3. Run formatting, typecheck, unit/integration/functional suites and source
   smoke; recheck the dirty worktree and user-owned audit document.

## Verification gates

- `bun run format:check`
- `bun run typecheck`
- focused new unit/integration tests
- `bun run test`
- `bun run test:functional`
- `bun run smoke`
- `git diff --check`
- final `git status --short`
- verify `index.html` still equals `HEAD:index.html` unless user-owned.

## Definition of done for this slice

- Adaptive structured work has an explicit model-defined plan authority.
- The host rejects unsafe/invalid model plans deterministically.
- Replanning is append-only and auditable.
- Simple tasks do not pay for a planner/DAG unnecessarily.
- Existing permissions, verification, cancellation and user-work protection
  remain intact.
- Full arbitrary-node scheduling, semantic verifier breadth, subagents, native
  runtime and live model generalization remain documented evidence gaps.
