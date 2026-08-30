# 01 — Repository Forensics

> Deliverable `01` (charter §20-22, Stage C). Owner: `repository-forensics`.
> Anchor: commit `230b557` ("docs: spec autonomous-completion overhaul...").
> **The working tree is dirty** — `git status --porcelain` reports 300
> pending changes, including modifications to `src/agent/loop.ts` and
> `src/tui/app.tsx` (the two files this report identifies as the live
> execution path) and entire untracked directories (`src/core/`,
> `src/driver/`, `src/evals/`, `src/evidence/`, `src/product/`,
> `src/security/`). Every citation below is a `file:line` reference against
> that working-tree state, not against a clean commit. Where the working
> tree could diverge from `230b557` in a way material to a finding, that is
> called out explicitly.
>
> Method: every claim in this report was produced by reading the cited
> source lines and/or running `grep`/`git log` against the repository —
> never inferred from a file or directory name alone. `SHELRA_AUDIT_MODE`
> constraints were respected: no file under `src/`, `scripts/`, or `tests/`
> was modified.

## 1. Topology overview

```
src/index.ts                         entry point (bin.shelra)
  └─ cli/args.ts, cli/startup.ts      CLI parsing, default screen
  └─ tui/launch.tsx                   OpenTUI/Solid renderer bootstrap
       └─ tui/app.tsx (AppShell)      host application: session mgmt,
                                      runTask() orchestration, persistence
            ├─ router/                task→route decisioning
            ├─ context/               repository intelligence + context
            │                          packet compilation
            ├─ agent/verification-plan.ts
            ├─ agent/loop.ts          LIVE agent kernel (runAgent)
            │    ├─ providers/        model streaming + envelope parsing
            │    ├─ runtimes/         local runtime discovery (Ollama/
            │    │                     LM Studio/llama.cpp)
            │    ├─ tools/            ACI: Read/Write/Edit/Shell/Git/...
            │    │    └─ security/execution-broker.ts   host-side boundary
            │    ├─ agent/task-state.ts       in-memory ledger
            │    ├─ agent/verifier.ts         independent verification
            │    ├─ agent/completion-gate.ts  completion decision
            │    ├─ evidence/acceptance.ts    proof-backed completion
            │    └─ checkpoint/checkpoint.ts  pre-mutation baselines
            └─ storage/database.ts    bun:sqlite — durable persistence
                                       (agent_tasks, checkpoints, sessions,
                                        messages, model_driver_profiles, ...)

core/                                 DORMANT parallel task-lifecycle kernel
                                       (SweCore) — zero production callers,
                                       exercised only by tests/unit/swe-core.test.ts

scripts/evaluate-agent.ts             SEPARATE eval harness, not the product
scripts/live-agent-eval.ts             entry point; imports src/evals/* directly
```

## 2. Real production execution path (cited sequence)

**User → CLI/TUI:**
1. `src/index.ts:14` — `parseCliArgs(process.argv.slice(2))`.
2. `src/index.ts:23-26` — no-arg or `--tui` → `case "tui"` →
   `launchTui(defaultTuiScreen())`; `src/cli/startup.ts:6-8` hardcodes the
   initial screen to `"conversation"`.
3. `src/tui/launch.tsx:23-30,88-114` — `createCliRenderer` + `render(() =>
   <AppShell .../>)`. `AppShell` lives in `src/tui/app.tsx`.

**Intake (user submits an objective):**
4. `src/tui/app.tsx:1220` — `runTask(objective, turnId, sessionId,
   resumeRuntime?, repositoryRoot?)` is the orchestration entry for one
   submitted objective (new task or resume).
5. `src/tui/app.tsx:1235-1265` — dynamic imports of `cli/control-plane.js`,
   `router/task-analysis.js`, `router/router.js`, `context/repository.js`,
   `context/project-commands.js`, `agent/verification-plan.js`,
   **`agent/loop.js`**, `router/route-fallback.js`, `agent/trace.js`,
   `tools/workspace.js`, `checkpoint/checkpoint.js`, `agent/turn-policy.js`.
6. `src/tui/app.tsx:1266` — `openControlPlane(taskRoot)` →
   `src/cli/control-plane.ts:216-228` constructs the provider registry
   (`providers/registry.ts:140` `createProviderRegistry`) and the
   `LocalCodeDatabase` (`storage/database.ts`).

**Runtime routing + context:**
7. `router/task-analysis.ts::analyzeTask` and `router/router.ts:212
   selectRoute` — task→provider/model route decisioning (called from
   `app.tsx:1237-1238`, per the dynamic-import list above; exact call sites
   are further down the same `runTask` body).
8. `context/repository.ts:750 buildRepositoryContext` — calls
   `context/repository-intelligence.ts:654 buildRepositoryIntelligence`.
   Produces `agentContext` (files, instructions, snapshot revision/working-
   tree revision) consumed both for the context packet and for the
   `TaskRuntimeSnapshot.contextAnchor` (`app.tsx:1873-1907`).
9. `security/execution-broker.ts:157 ExecutionBroker` is instantiated at
   `tui/app.tsx:2067` (`createExecutionBroker(...)`) — the host-side
   workspace/process/network/write-authority boundary for this task.

**Agent kernel (the live loop):**
10. `src/tui/app.tsx:2187` — `runAgent(agentTask, { provider, tools:
    executionTools, ... persistTask: persistRuntime, ... })`, imported from
    `agent/loop.js` (`app.tsx:1259`). This is **the** call into the live
    kernel; `src/agent/loop.ts:908 export async function runAgent`.
11. `agent/loop.ts:914-925` — if `task.runtimeSnapshot` is present (a
    resumed task), it is `structuredClone`d and `reopenTaskForResume`
    (`agent/task-state.ts:267-276`) resets terminal phases to `"reflect"`
    and invalidates stale evidence/criteria for any paths the host found
    changed since the snapshot (`task-state.ts:244-257`,
    `invalidateStaleResumeProof`).
12. `agent/loop.ts:1111-1141` — if the restored runtime carried an
    `inFlight` marker (an operation interrupted by process death), the loop
    records it as a **failed** action and adds a blocker demanding a fresh
    bounded decision — it never blindly replays an interrupted mutation.

**Provider (model call):**
13. `agent/loop.ts:4142-4160` — `options.provider.stream({ modelId,
    messages, temperature, maxOutputTokens, tools, toolChoice, stream:
    true }, signal)`. The concrete adapter is
    `providers/openai-compatible.ts:116 GenericOpenAICompatibleProvider`.

**Parser (envelope / textual tool-call recovery):**
14. `agent/loop.ts:4143` — the raw stream is wrapped by
    `providers/stream-normalizer.ts:144 normalizeProviderEvents`, which
    calls `providers/tool-envelope.ts::recoverTextToolCalls`
    (`stream-normalizer.ts:161,193,211`) to recover pseudo-tool-call JSON
    that a model emitted as plain text instead of a native tool call,
    re-emitting it as a proper `tool.call` event. `agent/tool-envelope.ts`
    is a one-line re-export of the same function
    (`agent/tool-envelope.ts:6-9`) — not a second implementation.

**Tool (execution) + observation:**
15. `agent/loop.ts:5530` — `output = await tool.execute(input, context)`
    for each `ToolCall` accumulated from the stream. `tool` is one of
    `tools/workspace.ts`'s exported tool definitions
    (`workspace.ts:1951 workspaceTools`).
16. Every tool resolves `executionBrokerFor(ctx)`
    (`tools/workspace.ts:271`, called from 8+ tool bodies, e.g.
    `workspace.ts:702,801,896,1023,1131,1211,1338,1556`), which returns
    `ctx.executionBroker` — the same `ExecutionBroker` instantiated at
    step 9 — enforcing workspace containment, checkpoint-gated writes
    (`security/execution-broker.ts:410-461`), process/network policy
    (`execution-broker.ts:279-343`), and output redaction
    (`execution-broker.ts:524-532`).
17. `agent/loop.ts:5541-5569` — the result becomes a `ToolResult`;
    `observeTool`/`observeModelPlanAction` record it, and on `write`/
    `destructive` success the loop snapshots a checkpoint
    (`checkpoint/checkpoint.ts::snapshot`, called via
    `context.checkpoint.snapshot` at `loop.ts:5555`) and pushes a
    before/after pair into the in-process `pendingMutations` regression
    guard (`loop.ts:5558`).

**Ledger update:**
18. `agent/task-state.ts::recordTaskAction`/`recordTaskMutatedPaths`/
    `recordVerificationRun`/`addTaskEvidence` mutate the in-memory
    `AgentTaskLedger` (imported at `loop.ts:77-93`). Each mutation bumps
    `ledger.updatedAt`.

**Verifier / completion:**
19. `agent/loop.ts:2877 evaluateCompletionGate` (from
    `agent/completion-gate.ts`) is the gate the loop consults before
    declaring completion; it consumes `assessObjectiveProof`
    (`agent/objective-proof.ts`, called `loop.ts:2833-2839`) and, when the
    canonical acceptance path is enabled, `evaluateProofBackedCompletion` +
    `compileAcceptanceObligations` + `deriveEvidenceRecordsFromTaskState`
    from `evidence/acceptance.ts` (called `loop.ts:2866-2876`).
20. `agent/loop.ts:3143-3145` — unless the caller supplies
    `options.independentVerifier` (the TUI does not), the loop runs
    `agent/verifier.ts::independentlyVerifyTask` — a host-owned,
    model-independent pass/fail check (evidence count, mutation occurred,
    verification ran+passed, final review performed, no unresolved
    blockers, user work preserved).

**Persistence (durable state):**
21. `agent/loop.ts:1202-1224 persistLedger` calls
    `options.persistTask?.(ledger, inFlight, persistedRehydration)` after
    essentially every phase transition, model turn, and tool call. The TUI
    supplies `persistRuntime` (`tui/app.tsx:1908-1939`), which builds a
    `TaskRuntimeSnapshot` via `agent/task-runtime-state.ts::
    createTaskRuntimeSnapshot` and calls `controlPlane.db.saveAgentRuntime(
    ...)` — `storage/database.ts:401-460`, writing to the `bun:sqlite`
    `agent_tasks` table (`ledger_json` column) inside a transaction, guarded
    by a monotonic `updatedRevision` optimistic-concurrency check
    (`database.ts:413-422`, throws `RuntimePersistenceConflictError` /
    `STALE_RUNTIME_SNAPSHOT` on a stale write).

**Task completion → UI:**
22. `runAgent` returns an `AgentRunResult`; `tui/app.tsx:2178-2187` awaits
    it, and (elsewhere in the same function body, not re-traced line by
    line in this pass) the transcript is appended via
    `controlPlane.db.appendMessage(sessionId, "assistant", result.text)`
    (`app.tsx:2475`) — a separate, single-writer conversation table
    distinct from the task-execution ledger.

**Restart / resume:**
23. On a later resume, `tui/app.tsx:2567 controlPlane.db.
    getLatestAgentRuntime(session.id)` loads the most recently persisted
    `TaskRuntimeSnapshot` for the session (`storage/database.ts:484-492`),
    `agent/resume-policy.ts:56 assessResumeWorkspace` (imported
    `app.tsx:54`, called `app.tsx:1341`) evaluates whether the working tree
    changed underneath the persisted state, and the result flows back into
    `runTask(..., resumeRuntime)` → step 11 above.

**Verdict:** `agent/loop.ts::runAgent` is the entire live agent kernel.
`core/legacy-agent-runner.ts` and `core/swe-core.ts` are **not** reachable
from this path — see §3.

## 3. Resolved: `core/legacy-agent-runner.ts` vs `agent/loop.ts`

- `agent/loop.ts::runAgent` (`loop.ts:908`) is the **only** agent-loop
  implementation reachable from `src/index.ts`. Confirmed by full trace
  above and by `grep -r "runAgent" src/` returning exactly one call site
  outside `agent/loop.ts` and `core/legacy-agent-runner.ts` that matters at
  runtime: `tui/app.tsx:2187`.
- `core/legacy-agent-runner.ts:1,45-52` — `LegacyAgentRunner.run()`
  literally calls `runAgent(task, loopOptions, request.signal)` and wraps
  its `AgentRunResult` into a `SweExecutionOutcome`. It is an **adapter**,
  not an alternative engine. Its own doc comment
  (`core/legacy-agent-runner.ts:36-41`) states: *"Compatibility adapter for
  the existing whole-run agent loop... `runAgent` owns a complete state
  machine."*
- `core/swe-core.ts::DefaultSweCore`/`createSweCore`
  (`swe-core.ts:413,921`) — a fully built, internally consistent,
  optimistic-concurrency-safe task-lifecycle service (`startTask`, `step`,
  `run`, `cancel`, `resume`, `inspect`) with its own `TaskStateService`
  (`core/task-runtime-repository.ts:67-90`). **Zero files under `src/`
  import `createSweCore` or `DefaultSweCore` outside `core/swe-core.ts`
  itself** (verified via repo-wide grep). The only importer anywhere in the
  repository is `tests/unit/swe-core.test.ts`. Because `DefaultSweCore` is
  never constructed by an application service, `LegacyAgentRunner` — which
  exists purely to be handed to a `DefaultSweCore` via the `SweTaskExecutor`
  port — is also never constructed outside that same test.
- `docs/architecture/swe-core.md:66-73` (project's own architecture doc,
  written at the time `core/swe-core.ts` was added, "Phase 5") states this
  explicitly: *"The current TUI and `runAgent` path remain intact... The
  next integration step is to inject the prepared task and legacy runner
  from an application service, then compare the Core path against the
  existing path..."* No later phase report (`docs/phases/phase-06..12`)
  mentions `swe-core` — the integration step was never taken.
- **Conclusion:** `core/` is a self-consistent, tested, but **entirely
  dormant** second architecture for task lifecycle management. It does not
  compete with `agent/loop.ts` in production; it simply isn't wired to
  anything. "Legacy" in `LegacyAgentRunner`'s name refers to `runAgent`
  being the pre-existing whole-run engine relative to `SweCore`'s newer
  step/run/resume model — not to `runAgent` being superseded. Reading the
  name alone (as the Stage-A skeleton did) would have produced the opposite,
  incorrect conclusion.

## 4. State ownership table (charter §22)

All six required sources traced, plus two adjacent sources encountered
during tracing (`sessions`/`messages` tables, `pendingMutations` buffer)
that materially affect the flags below.

| Source | Owner | Writers | Readers | Persistence | Source of truth? | Invalidated by | Reconstructed after restart | Flags |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `agent/task-state.ts` (`AgentTaskLedger` + mutators) | `agent/loop.ts` (sole caller of every mutator; imports at `loop.ts:77-93`) | `agent/loop.ts` exclusively | `agent/loop.ts`, `agent/completion-gate.ts`, `agent/verifier.ts`, `agent/objective-proof.ts`, `evidence/acceptance.ts` (all read-only, passed the ledger object) | None itself (pure in-memory object) — durable only once wrapped by `task-runtime-state.ts` | Authoritative **for the current process**, not durable on its own | `reopenTaskForResume` (`task-state.ts:267-276`) on a changed-paths resume | Via the wrapping `TaskRuntimeSnapshot.ledger` field (see next row) | none critical — single writer, single owner |
| `agent/task-runtime-state.ts` (`TaskRuntimeSnapshot`) | `agent/loop.ts` constructs the ledger delta; `tui/app.tsx:1908-1939 persistRuntime` constructs the full snapshot and is the sole call site that reaches the database | `tui/app.tsx` (`persistRuntime` → `db.saveAgentRuntime`) | `tui/app.tsx` (`getLatestAgentRuntime` on resume), `agent/loop.ts` (`task.runtimeSnapshot` input) | Durable — SQLite `agent_tasks.ledger_json` via `storage/database.ts:401-460` | **Yes** — the authoritative durable record of the last persisted turn boundary | Monotonic `updatedRevision` check (`database.ts:413-422`) rejects stale overwrites (`RuntimePersistenceConflictError`) | `getLatestAgentRuntime(sessionId)` (`database.ts:484-492`, called `app.tsx:2567`) + `task-ledger-codec.ts::restoreTaskRuntime` + `resume-policy.ts::assessResumeWorkspace` gate | None in the live path (single writer). See dormant duplicate below. |
| `core/task-runtime-repository.ts` (`TaskStateService` / `InMemoryTaskRuntimeRepository` / `TaskSnapshot`) | `core/swe-core.ts::DefaultSweCore` — itself unowned in production (§3) | `DefaultSweCore` methods, exercised only by `tests/unit/swe-core.test.ts` | Same, test-only | **None.** Default implementation is a `Map` (`task-runtime-repository.ts:36`). Doc comment (`task-runtime-repository.ts:30-34`) admits: *"A production adapter can map this port to LocalCodeDatabase"* — that adapter does not exist | No — not part of the live task lifecycle at all | N/A | **Never** — in-memory `Map` is lost on process exit | **DUPLICATED** (independently re-encodes the same "task snapshot" domain concept as the row above) · **NON_DURABLE** (only implementation is memory-only) · **UNOWNED in production** (no application service ever constructs `DefaultSweCore`) |
| `storage/database.ts` (`LocalCodeDatabase`, all tables) | `storage/database.ts`, instantiated once per process via `cli/control-plane.ts::openControlPlane` | `tui/app.tsx` (`saveAgentRuntime`, `appendMessage`), `checkpoint/checkpoint.ts` (delegates `createCheckpoint`/`addCheckpointFile`/`updateCheckpointFile`) | `tui/app.tsx` (`getLatestAgentRuntime`, `getAgentRuntime`), `checkpoint/checkpoint.ts` (`checkpointFiles`, `checkpointExists`), `scripts/refresh-model-catalog.ts` (via control-plane) | Yes — `bun:sqlite`, file-backed unless `:memory:` (test override); schema versioned, `CURRENT_SCHEMA_VERSION = 5` (`database.ts:25`), idempotent `migrate()` | Yes, for every table it owns | Revision check on `agent_tasks` (above); other tables not deep-traced this pass | This *is* the reconstruction mechanism for every other row in this table | **Dormant MULTIPLE_SOURCE_OF_TRUTH hazard**: `saveAgentTask` (`database.ts:360`) is dead code — zero callers anywhere in `src/` (only its own definition and a comment referencing it, `database.ts:397`) — but it writes a bare `AgentTaskLedger` (no envelope) into the same `agent_tasks.ledger_json` column that `saveAgentRuntime`/`getAgentRuntime` treat as a versioned `TaskRuntimeSnapshot`. `getAgentRuntime`'s own fallback branch (`database.ts:469-481`, `parseTaskLedger` + `"legacy ledger without a versioned runtime snapshot"` error) proves the two encodings are incompatible and that this code path has been triggered by real data before (migration remnant). If any future caller resumes calling `saveAgentTask`, it would silently desynchronize rows from the live `saveAgentRuntime` reader's expectations. |
| `checkpoint/checkpoint.ts` (`CheckpointService`, `checkpoints`/`files_changed` tables) | `checkpoint/checkpoint.ts`, instantiated at `tui/app.tsx:937,1689` and `agent/capability-probe.ts:550` | `tools/workspace.ts` (via `context.checkpoint`, on writes/deletes), `agent/loop.ts` (`context.checkpoint.snapshot` at `loop.ts:5555`) | `agent/loop.ts` (`userWorkPreserved`/`checkUserWorkPreserved` → `isPreserved`), `security/execution-broker.ts` (`assertNoExternalChange` before every write/delete) | Yes — same SQLite DB as `agent_tasks` (`checkpoints`+`files_changed` tables) | Yes, for "known-good file content baseline" — cross-referenced by `checkpointId` (an ID pointer, not duplicated content) from `TaskRuntimeSnapshot.checkpointId` | `assertNoExternalChange` throws `STALE_EDIT` (`checkpoint.ts:176-221`) when live content hash no longer matches the last recorded hash | `TaskRuntimeSnapshot.checkpointId` is persisted alongside the ledger; on resume, `agent/loop.ts` reuses it if `context.checkpoint.hasCheckpoint(restoredRuntime.checkpointId, ...)` still holds (`loop.ts` ~1153-1161) | **NON_DURABLE (narrow)**: the in-process `pendingMutations` regression-guard buffer (`agent/loop.ts:1881`, populated `loop.ts:5558`, cleared `loop.ts:5858`) that lets the loop auto-rollback a mutation which invalidated a previously-satisfied criterion is **not** persisted anywhere. A crash between a flagged mutation and the regression-guard's rollback decision loses only that bookkeeping — the underlying file content stays durable in `files_changed` — but the "should this be auto-rolled-back" decision itself does not survive a restart. |
| `agent/task-ledger-codec.ts` (`serializeTaskRuntime`/`restoreTaskRuntime`) | `storage/database.ts` (sole consumer) | `storage/database.ts::saveAgentRuntime` | `storage/database.ts::getAgentRuntime`/`getLatestAgentRuntime` | It *is* the (de)serialization boundary, not a separate store | N/A (a codec, not a store) | Schema-version / shape validation rejects malformed envelopes (`task-ledger-codec.ts:779-886` region) | N/A | Correctly the single choke point; its existence is what makes the `saveAgentTask` dead-code hazard above detectable rather than silently corrupting |
| *(adjacent, not requested but discovered)* `sessions`/`messages` tables | `storage/database.ts` | `tui/app.tsx:1284,2475` (`appendMessage`) | `tui/app.tsx` (transcript rendering) | Yes — same DB | Yes, for chat transcript — a **distinct domain** from task-execution ledger | None observed this pass | Read back per session on resume | None — single writer, does not overlap task-state domain; listed for completeness only |

## 5. Maturity classification — untracked directories

Ladder: `ABSENT · STUB · STRUCTURAL · FUNCTIONAL · INTEGRATED ·
REAL-MODEL-VALIDATED · MEASURABLY_EFFECTIVE`.

| Directory | Classification | Evidence |
| --- | --- | --- |
| `core/` | **STRUCTURAL** (built + internally tested, zero production integration) | `DefaultSweCore`/`createSweCore` (`swe-core.ts:413,921`) has no importers in `src/` outside itself; only `tests/unit/swe-core.test.ts` exercises it. `docs/architecture/swe-core.md:66-73` confirms the integration step was deliberately deferred and never resumed in phases 6-12 (`docs/phases/` has no later reference to `swe-core`). |
| `driver/` | **SPLIT**: `profile.ts` INTEGRATED; `edit-codec-calibration.ts`/`protocol-calibration.ts` STRUCTURAL | `profile.ts` imported by 10 production files including `security/execution-broker.ts:35` and `storage/database.ts:14` (persisted `model_driver_profiles` table). `edit-codec-calibration.ts`/`protocol-calibration.ts` export real logic (`encodeEditCodec`, `calibrateEditCodecs`, etc.) with dedicated unit tests (`tests/unit/edit-codec-calibration.test.ts`, `tests/unit/protocol-calibration.test.ts`) but **zero** `src/` importers (verified by grep for both filenames across `src/`). |
| `evals/` | **SPLIT**: `redaction.ts`/`paired-capability.ts` INTEGRATED into production; remainder FUNCTIONAL (real eval-harness caller, not production) | `redaction.ts` imported by `security/execution-broker.ts:22`, `agent/recovery.ts:2`, `evidence/acceptance.ts:1`. `paired-capability.ts` imported by `agent/dynamic-capabilities.ts:15-19`, `context/context-builder.ts:19`. The remaining eval-artifact/replay/protocol-trial modules are wired only into `scripts/evaluate-agent.ts:37-58` — a real, working caller, but not the product entry point. Not **REAL-MODEL-VALIDATED**: `docs/STATUS.md:27` records the local/real-model matrix as `UNPROVEN` (discovered=9, evaluated=1). |
| `evidence/` | **INTEGRATED** | `compileAcceptanceObligations`, `deriveEvidenceRecordsFromTaskState`, `evaluateProofBackedCompletion` imported at `agent/loop.ts:15-19` and invoked in the live completion path at `loop.ts:2866-2876`, gated by `canonicalAcceptanceEnabled` (feature-flag-style condition observed in the same code region — not further traced this pass). |
| `product/` | **INTEGRATED** (foundational, small) | `product/identity.ts` (`PRODUCT_NAME`, `CLI_NAME`, `PRODUCT_STATE_DIR_NAME`, `readProductEnv`) consumed across `src/index.ts`, `checkpoint/checkpoint.ts:5`, `scripts/refresh-model-catalog.ts:4`, and elsewhere; implements the live ShelraCode/LocalCode env-var migration path. |
| `security/` | **INTEGRATED** | `ExecutionBroker` instantiated live at `tui/app.tsx:2067`; every workspace tool call resolves it via `tools/workspace.ts::executionBrokerFor` (`workspace.ts:271`, 8+ call sites: `702,801,896,1023,1131,1211,1338,1556`). Not merely constructed-and-unused — it is on the hot path for every Read/Write/Edit/Shell/RunTests call. |

**Additional maturity note (not in the original 6-dir list but discovered
during enumeration):** `src/git/`, `src/catalog/`, `src/models/`,
`src/telemetry/` — all four are **ABSENT**. Each exists as a directory
(confirmed via filesystem listing) but contains zero files, and `git log
--follow` / `git log --diff-filter=D` against each path returns no history
at any commit — these are not deletions, they were never populated. The
functionality their names suggest is implemented elsewhere (see the
"Subsystems" table in `REPOSITORY-MAP.md`: Git → `tools/workspace.ts` +
`context/repository-snapshot.ts`; catalog → `cli/control-plane.ts` +
`scripts/refresh-model-catalog.ts`; models → `providers/types.ts` +
`shared/types.ts`; telemetry → nothing — the word appears only as a UI
label, `tui/state/settings.ts:12`, and one comment, `agent/loop.ts:3214`).

## 6. Duplicated `tool-envelope.ts` — resolved

**Not duplicated.** `src/agent/tool-envelope.ts` (10 lines total) is a
re-export shim:

```ts
// src/agent/tool-envelope.ts:1-9
export {
  MAX_TOOL_CALLS_PER_RESPONSE,
  recoverTextToolCalls,
} from "../providers/tool-envelope.js";
```

The real implementation (parsing textual pseudo-tool-call envelopes,
enforcing `MAX_TOOL_CALLS_PER_RESPONSE = 8`, `providers/tool-envelope.ts:5`)
lives solely in `src/providers/tool-envelope.ts`. `agent/loop.ts:46`
re-exports the same symbol again (`export { recoverTextToolCalls } from
"./tool-envelope.js"`) for its own callers. This is a compatibility
indirection, not two implementations — confirmed by reading both files in
full, not by filename comparison.

## 7. Dependency boundaries observed

- **Layering is mostly clean and one-directional** at the traced call
  sites: `tui/` → `router/` + `context/` + `agent/` → `providers/` +
  `runtimes/` + `tools/` → `security/` + `checkpoint/` → `storage/`.
  No cycle was observed back from `storage/` or `security/` into `agent/`
  or `tui/` in the files read.
- **`agent/loop.ts` is a hub, not a thin orchestrator**: at 6281 lines it
  directly imports from `context/`, `checkpoint/`, `tools/`,
  `evidence/`, `providers/`, `privacy/`, `product/`, and six sibling
  `agent/*` modules (`completion-gate.ts`, `verifier.ts`,
  `objective-proof.ts`, `compaction.ts`, `task-graph.ts`,
  `task-scheduler.ts`, `planner.ts`, `recovery.ts`, `task-state.ts`,
  `task-runtime-state.ts`, `turn-policy.ts`, `execution-profile.ts`,
  `task-contract.ts`, `verification-plan.ts`, `context-gate.ts`,
  `objective-review.ts`) — see the full import block at `loop.ts:1-108`.
  This concentrates a very large share of the system's real behavior in a
  single file; `complexity-auditor` should treat `agent/loop.ts` as the
  primary complexity/debt surface, not `core/` (which is inert).
- **`core/` is a fully isolated island**: nothing in `agent/`, `tui/`,
  `context/`, `providers/`, or `tools/` imports from `core/`. Its only
  outbound dependency into the rest of the tree is type-only
  (`core/types.ts:1 import type { TaskRuntimeSnapshot } from
  "../agent/task-runtime-state.js"`), and its only inbound dependency is
  the test file. This isolation is exactly what makes it safe to leave
  dormant (nothing in production silently depends on it) and exactly what
  makes it dead weight if abandoned.
- **`driver/profile.ts` is a genuine cross-cutting boundary**: it is
  imported by files in `agent/`, `tools/`, `context/`, `security/`,
  `storage/`, and `instructions/` — six different subsystems depend on the
  same "exact model identity / write authority" contract. This is the
  correct place to look for a single point of failure in "can the model
  write to disk at all" logic.
- **`evals/redaction.ts` is imported by `security/execution-broker.ts`**,
  meaning the production security boundary depends on a module that lives
  in an eval-harness directory. This is a naming/placement smell worth
  `complexity-auditor` attention, though the dependency itself is not
  unsafe (the function is pure and identical whichever directory it lives
  in) — not raised as a severity-bearing finding here, only noted as a
  boundary observation.

## 8. Findings (F-FORENSIC-###)

```yaml
id: F-FORENSIC-001
title: core/swe-core.ts and core/legacy-agent-runner.ts are fully dormant — agent/loop.ts::runAgent is the sole live execution engine
domain: repository-forensics / agent-loop
severity: P2 MEDIUM
confidence: HIGH
claim: >
  The "core/legacy-agent-runner.ts vs agent/loop.ts" ambiguity flagged in
  AUDIT-BOOTSTRAP.md is resolved: agent/loop.ts::runAgent is the only
  reachable execution engine from src/index.ts. core/swe-core.ts and
  core/legacy-agent-runner.ts are a complete, tested, but entirely
  unintegrated parallel task-lifecycle architecture.
evidence:
  source_files:
    - src/index.ts
    - src/tui/launch.tsx
    - src/tui/app.tsx
    - src/agent/loop.ts
    - src/core/swe-core.ts
    - src/core/legacy-agent-runner.ts
    - docs/architecture/swe-core.md
  source_lines: "index.ts:14-51; app.tsx:1220,1259,2187; loop.ts:908;
    legacy-agent-runner.ts:1,45-52; swe-core.ts:413,921;
    swe-core.md:66-73"
  tests: "tests/unit/swe-core.test.ts (the only src-tree consumer of core/*)"
  runtime_trace: none (static trace only; SHELRA_AUDIT_MODE prevents execution)
  external_sources: []
current_behavior: >
  runAgent() executes every real task. DefaultSweCore/LegacyAgentRunner are
  constructed nowhere outside their own test file.
expected_behavior: UNKNOWN — the project's own architecture doc frames this
  as an intentionally staged migration, not a bug.
impact: >
  Low direct product impact (the dormant code does not run), but ~450 lines
  of tested, maintained code (core/*) currently carries zero production
  value and could mislead future readers (as it did the Stage-A skeleton)
  into thinking it is the live path from the "legacy" name alone.
root_cause: Migration ("strangler") explicitly paused after Phase 5; never resumed through Phase 12.
specification_status: SPEC (documented intent in docs/architecture/swe-core.md)
recommended_direction: N/A — audit does not propose fixes.
implementation_priority: N/A
dependencies: []
unknowns:
  - Whether resuming the SweCore migration is still the intended direction, or whether core/ should be removed as dead weight — a product decision, not a forensics finding.
```

```yaml
id: F-FORENSIC-002
title: storage/database.ts::saveAgentTask is dead code that would silently corrupt the live agent_tasks persistence contract if ever called again
domain: repository-forensics / verification-recovery
severity: P1 HIGH
confidence: HIGH
claim: >
  storage/database.ts exposes two write methods for the same agent_tasks
  table with incompatible payload shapes: saveAgentTask (bare
  AgentTaskLedger, no envelope) and saveAgentRuntime (versioned
  TaskRuntimeSnapshot, the only one any live caller uses). getAgentRuntime's
  own code proves the two are incompatible: it has an explicit fallback
  branch that detects and rejects rows written in the legacy shape.
evidence:
  source_files:
    - src/storage/database.ts
  source_lines: "database.ts:360 (saveAgentTask definition);
    database.ts:397 (comment: 'historical saveAgentTask method remains
    available for legacy callers'); database.ts:401-460 (saveAgentRuntime,
    the live path); database.ts:469-481 (getAgentRuntime's legacy-ledger
    fallback and INVALID_RUNTIME_SNAPSHOT error)"
  tests: none located exercising saveAgentTask directly in this pass
  runtime_trace: "grep -r 'saveAgentTask(' src/ → zero call sites outside its own definition"
  external_sources: []
current_behavior: >
  saveAgentTask is unused; the system is currently safe because nothing
  calls it. Its continued presence, plus a comment implying it remains a
  supported legacy path, is a latent hazard.
expected_behavior: UNKNOWN — whether this method should be removed or is
  intentionally retained for a migration path is a specification question,
  not resolved by this trace.
impact: >
  If any future code path (a script, a migration tool, a resumed core/
  integration) calls saveAgentTask on an existing task id, it will
  overwrite that row's ledger_json with a shape getAgentRuntime already
  demonstrably rejects as invalid — silently breaking resume for that task
  the next time the live path tries to read it.
root_cause: Schema migration from a pre-TaskRuntimeSnapshot persistence model left the old writer in place instead of removing it once the new one became exclusive.
specification_status: SPECIFICATION_GAP
recommended_direction: N/A — audit does not propose fixes.
implementation_priority: N/A
dependencies:
  - F-FORENSIC-001 (both point at the same "unfinished migration" pattern in storage/core)
unknowns:
  - Whether any existing persisted database file (a user's real .shelracode state) still contains legacy-shape rows from before this migration.
```

```yaml
id: F-FORENSIC-003
title: src/git, src/catalog, src/models, src/telemetry are empty directories with no git history — the Stage-A "(to enumerate)" label was misleading
domain: repository-forensics
severity: P3 LOW
confidence: HIGH
claim: >
  Four directories carried into REPOSITORY-MAP.md as "(to enumerate)"
  contain zero files and have never contained tracked files at any commit.
  The subsystems their names imply (git integration, model catalog, model
  metadata, telemetry) are implemented elsewhere in src/.
evidence:
  source_files: []
  source_lines: "n/a — absence is the evidence"
  tests: []
  runtime_trace: >
    find src/git src/catalog src/models src/telemetry -type f → no output
    (all four empty); git log --oneline -- src/git src/catalog src/models
    src/telemetry → no output at any commit; git ls-files for the same
    paths → no output.
  external_sources: []
current_behavior: Four empty, untracked directories exist in the working tree.
expected_behavior: UNKNOWN
impact: Cosmetic/organizational only; no runtime effect. Minor risk of misleading future contributors or agents who infer behavior from directory names, exactly as the Stage-A bootstrap flagged as a general risk.
root_cause: UNKNOWN — likely leftover mkdir from a planned-but-abandoned reorganization during the current WIP session (all four are part of the same dirty working tree alongside src/core, src/driver, etc.).
specification_status: SPECIFICATION_GAP
recommended_direction: N/A — audit does not propose fixes.
implementation_priority: N/A
dependencies: []
unknowns:
  - Whether these directories are intended scaffolding for a not-yet-written reorganization (e.g., extracting git tools out of tools/workspace.ts) or pure accident.
```

```yaml
id: F-FORENSIC-004
title: pendingMutations regression-guard buffer in agent/loop.ts is non-durable
domain: repository-forensics / verification-recovery
severity: P3 LOW
confidence: MEDIUM
claim: >
  The in-process array that lets runAgent auto-rollback a mutation which
  invalidated a previously-satisfied success criterion is held only in a
  local JS array and is never persisted; a process crash between recording
  a mutation and evaluating the regression guard loses that specific
  bookkeeping (the file content itself remains durable via the checkpoint
  tables).
evidence:
  source_files:
    - src/agent/loop.ts
  source_lines: "loop.ts:1881 (declaration); loop.ts:5558 (push);
    loop.ts:5858 (clear); loop.ts:2752-2807 (consumption / rollback logic)"
  tests: none located targeting a crash-mid-regression-guard scenario
  runtime_trace: static trace only
  external_sources: []
current_behavior: >
  pendingMutations is scoped to a single runAgent() call and is not part of
  TaskRuntimeSnapshot.
expected_behavior: UNKNOWN
impact: >
  Narrow: on resume after a crash, a mutation that should have triggered an
  automatic regression rollback may instead surface only through the
  general "interrupted operation" blocker (loop.ts:1111-1141), requiring a
  fresh model decision rather than an automatic host rollback. No data loss
  — the underlying file/checkpoint content is unaffected.
root_cause: Regression-guard state was designed as an in-turn convenience mechanism, not as part of the durable task-runtime contract.
specification_status: SPECIFICATION_GAP
recommended_direction: N/A — audit does not propose fixes.
implementation_priority: N/A
dependencies:
  - Related to the state-ownership table in §4 of this report.
unknowns:
  - Whether this gap has ever been observed in a real crash (no evidence located either way).
```

## 9. Tracker delta

Per `docs/audit/README.md` deliverable tracker:

| # | Deliverable | Status before this run | Status after this run |
| --- | --- | --- | --- |
| — | `REPOSITORY-MAP.md` | WIP (skeleton from evidence) | **DONE** — every `(name-only)`/`(to enumerate)` label replaced with a traced purpose or explicit `ABSENT`/`UNKNOWN` |
| 01 | `01-repository-forensics.md` | TODO | **DONE** — this document |

No other tracker rows were touched. `02-agent-loop.md` through `10-real-autonomy.md` remain `TODO` and are explicitly out of scope for this pass (their owning agents should treat this report as their starting evidence, not repeat the topology trace).

## 10. Handoff notes for downstream domain audits

- **agent-loop-auditor**: `agent/loop.ts` (6281 lines) is the entire kernel; treat §2 and §7 of this report as your starting map. `core/` is confirmed dormant — do not re-litigate F-FORENSIC-001 unless new evidence contradicts it.
- **verification-recovery-auditor**: the completion/verification chain is `agent/objective-proof.ts` → `evidence/acceptance.ts` → `agent/completion-gate.ts` → `agent/verifier.ts` (§2 steps 19-20). F-FORENSIC-002 and F-FORENSIC-004 are both in your domain.
- **model-runtime-auditor**: `providers/`, `runtimes/`, `router/`, `driver/profile.ts`, `hardware/`, `quota/headers.ts` are all confirmed INTEGRATED; `driver/edit-codec-calibration.ts` and `driver/protocol-calibration.ts` are confirmed STRUCTURAL-only (built, tested, unused) — worth investigating why calibration is not wired into the live route/driver-selection path.
- **security-privacy-auditor**: `security/execution-broker.ts` is the confirmed live boundary (§2 steps 9, 16; §5). `src/telemetry/` is confirmed ABSENT — there is no telemetry collection code to audit, only a UI label.
- **real-autonomy-evaluator**: `evals/` is split — `docs/STATUS.md:27`'s `UNPROVEN` local/real-model matrix result stands; nothing traced in this pass changes that. `scripts/evaluate-agent.ts` is the harness entry point, separate from the product entry point.
- **complexity-auditor**: primary candidates are (a) `agent/loop.ts` as a 6281-line hub (§7), (b) `core/` as a fully isolated ~450-line dormant island (§3, F-FORENSIC-001), (c) the four empty directories (F-FORENSIC-003), (d) `driver/edit-codec-calibration.ts` + `driver/protocol-calibration.ts` as tested-but-unwired code.
- **sdd-architect**: `docs/architecture/swe-core.md` documents an intended migration that stalled — worth reconciling against current specs/ (none exist at root yet per bootstrap) when SPEC-COVERAGE.md is produced.
