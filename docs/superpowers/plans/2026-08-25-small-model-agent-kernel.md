# Small-Model Agent Kernel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make ShelraCode turn complex coding objectives into bounded, evidence-grounded, verifiable work units that local models can execute safely.

**Architecture:** Preserve the existing Bun/TypeScript/OpenTUI application boundaries. Close the P0s at the controller and execution boundaries first: capability admission, context sufficiency, bounded tool execution, and one central process policy. Then strengthen provider normalization, task state, compaction, memory and role-specialized evaluation.

**Tech Stack:** Bun 1.3+, TypeScript ESM, SolidJS/OpenTUI, `bun:sqlite`, existing provider/runtime/tool adapters.

**Spec:** User-provided ShelraCode small-model agent-kernel research and implementation mandate, 2026-08-25.

## Global Constraints

- Preserve unrelated user work and never use destructive Git rollback.
- `strict-zero` never intentionally executes paid inference.
- Privacy and cost gates precede capability, context, health, quota and score.
- Read-only, plan and review turns cannot mutate the repository.
- All process execution uses one policy, approval, sandbox and cancellation path.
- Provider payloads stop at adapters; the agent kernel consumes normalized events.
- Completion requires controller-owned evidence and verification.
- No real credentials or secret values in tests, fixtures, logs or memory.
- Functional kernel correctness precedes TUI changes.

---

### Task 1: Re-audit current paths and establish red regressions

**Files:**

- Inspect: `src/tui/app.tsx`, `src/router/router.ts`, `src/router/route-fallback.ts`, `src/context/repository.ts`, `src/agent/loop.ts`, `src/tools/workspace.ts`.
- Test: `tests/unit/router.test.ts`, `tests/unit/tool-envelope.test.ts`, `tests/unit/run-tests-tool.test.ts`, `tests/integration/agent-loop.test.ts`.
- Document: `docs/agent-kernel/STATUS.md`, `docs/agent-kernel/ROOT-CAUSES.md`.

- [ ] Record current branch, HEAD, worktree, active source entrypoint, bundle entrypoint and current test baseline.
- [ ] Add a failing routing test proving `chat_only` cannot be selected for `advanced_coding_agent` when mutation is required.
- [ ] Add a failing tool-envelope test proving a 100-call response is rejected or bounded before execution.
- [ ] Add a failing `RunTests` policy test proving `bun install` is blocked when network is disabled.
- [ ] Add a failing context test proving discovery failure or zero relevant evidence prevents mutation admission.
- [ ] Run each focused test and confirm the failure is caused by the missing behavior.

### Task 2: Close capability admission, process policy and tool batching

**Files:**

- Modify: `src/router/router.ts`, `src/router/route-fallback.ts`, `src/tui/app.tsx` only where route requirements are assembled.
- Modify: `src/tools/workspace.ts`, `src/tools/permissions.ts`, `src/shared/process.ts`.
- Modify: `src/agent/tool-envelope.ts`, `src/agent/loop.ts`.
- Test: the failing tests from Task 1 plus `tests/unit/permissions.test.ts` and `tests/integration/routing.test.ts`.

- [ ] Make required capability a boolean admission gate before scoring.
- [ ] Preserve local/free fallback only among candidates that satisfy the task role.
- [ ] Ensure no route decision can be reconstructed with an empty rejection explanation after fallback exhaustion.
- [ ] Route `Shell`, `RunTests` and future process tools through one network/approval/sandbox policy.
- [ ] Replace environment exclusion with a safe inherited-environment allowlist or an explicit minimal environment.
- [ ] Bound textual and native tool batches before execution; allow only conservative concurrent read batches and serialize mutations.
- [ ] Add early non-progress intervention before repeated failures can reach dozens of calls.

### Task 3: Make repository localization and evidence authoritative

**Files:**

- Modify: `src/context/repository.ts`, `src/context/context-builder.ts`, `src/context/evidence-sufficiency.ts`.
- Modify: `src/agent/types.ts`, `src/agent/task-state.ts`, `src/agent/loop.ts`.
- Test: `tests/unit/context.test.ts`, `tests/unit/context-relevance.test.ts` or the existing equivalent, `tests/unit/evidence-sufficiency.test.ts`, `tests/integration/agent-loop.test.ts`.

- [ ] Represent search-backend failure separately from zero matches.
- [ ] Build deterministic repository metadata before model exploration.
- [ ] Add required evidence predicates for repository questions and mutation work.
- [ ] Block mutation until evidence is relevant, fresh enough and discovery did not fail.
- [ ] Introduce a bounded active work-unit/task-graph representation without duplicating existing ledger state.
- [ ] Keep raw repository artifacts outside the active model context and rehydrate only selected ranges.

### Task 4: Normalize provider streams and quarantine textual tool protocols

**Files:**

- Modify: `src/providers/openai-compatible.ts` and provider/runtime adapters only after current official documentation is recorded in `docs/RESEARCH-SNAPSHOT.md`.
- Modify: `src/agent/tool-envelope.ts`, `src/agent/types.ts`.
- Test: `tests/integration/provider-contract.test.ts`, `tests/unit/tool-envelope.test.ts`, `tests/unit/capability-probe.test.ts`.

- [ ] Keep provider-specific event shapes inside adapters.
- [ ] Normalize native text, tool-call start, argument deltas, completion, usage and failure events.
- [ ] Buffer arguments by call ID, enforce a size limit, parse and schema-validate before execution.
- [ ] Keep textual fallback quarantined until it is classified as a valid tool envelope.
- [ ] Ensure partial or malformed tool JSON never reaches the assistant transcript.

### Task 5: Make verification and completion evidence-driven

**Files:**

- Modify: `src/agent/verification-criteria.ts`, `src/agent/verifier.ts`, `src/agent/completion-gate.ts`, `src/agent/loop.ts`.
- Test: `tests/unit/completion-gate.test.ts`, `tests/unit/verifier.test.ts`, `tests/integration/agent-loop.test.ts`, `tests/integration/functional-acceptance.test.ts`.

- [ ] Separate “verification unavailable” from “verification not required.”
- [ ] Require current verification evidence for coding completion when the task has mutations.
- [ ] Make semantic objective review and final diff review explicit completion inputs.
- [ ] Keep failed verification, unresolved blockers and external conflicts terminal for completion.
- [ ] Add a fresh-context read-only verifier contract before introducing edits by specialist agents.

### Task 6: Add bounded compaction, provenance-backed memory and role probes

**Files:**

- Modify: `src/agent/compaction.ts`, `src/storage/database.ts`, `src/checkpoint/checkpoint.ts` only where retention/provenance is needed.
- Create or modify: role-specific capability profile/probe modules under `src/agent/`.
- Test: `tests/unit/compaction.test.ts`, `tests/unit/capability-probe.test.ts`, `tests/unit/storage.test.ts`.

- [ ] Rebuild compact context from authoritative task state with bounded summaries.
- [ ] Separate working, semantic, episodic, procedural and raw-resource storage concepts.
- [ ] Attach source/hash/revision/confidence to semantic facts and invalidate stale facts.
- [ ] Measure localization, relevant-context selection, tool recovery, patching, test repair and verification separately.
- [ ] Do not promote a model role from parameter count or provider metadata.

### Task 7: Add Explore/Build/Verify only after the main loop passes

**Files:**

- Create: focused role contracts under `src/agent/` only after Tasks 1–6 are green.
- Modify: task orchestration and presentation event adapters as required.
- Test: new deterministic fixture scenarios under `tests/fixtures` and `tests/integration`.

- [ ] Implement read-only Explore/localizer with bounded tools and structured findings.
- [ ] Keep Build as the owner of mutation and the task ledger.
- [ ] Implement Verify as a fresh-context read-only evidence consumer.
- [ ] Prove a measurable gain over the single-loop baseline before retaining the roles.

### Task 8: Release proof and documentation reconciliation

**Files:**

- Modify: `docs/agent-kernel/STATUS.md`, `docs/agent-kernel/ARCHITECTURE.md`, `docs/agent-kernel/EVALS.md`, `docs/agent-kernel/ROOT-CAUSES.md`, `docs/RESEARCH-SNAPSHOT.md`.
- Inspect: `package.json`, `scripts/build.ts`, `scripts/smoke.ts`, real TUI launch path.

- [ ] Run focused tests, full tests, format check, typecheck, build and source/bundle smoke.
- [ ] Exercise the real user-visible TUI flow for greeting, repository question, bounded edit, failed test repair, cancellation and false completion.
- [ ] Record model/runtime/quant/template capability evidence separately from source tests.
- [ ] Reconcile docs so “implemented,” “deterministic fixture,” “live observed,” and “not verified” are not conflated.
- [ ] Report remaining P0/P1 items; do not claim Claude Code parity without comparable evidence.
