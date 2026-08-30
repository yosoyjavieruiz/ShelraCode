# ShelraCode — Repository Map (confirmed)

> Stage C output. Every purpose below was confirmed by **tracing real code**
> (imports, call sites, file:line evidence) — not inferred from names.
> `(name-only)` labels from the Stage-A skeleton have been replaced with
> traced purposes, or explicitly marked `UNKNOWN` where tracing could not
> establish a purpose within this pass.
> Snapshot: commit `230b557` + uncommitted working tree (dirty; see
> `AUDIT-BOOTSTRAP.md`). Full findings and evidence: `01-repository-forensics.md`.

## Entry points (confirmed)

- `src/index.ts:14` — `parseCliArgs(process.argv.slice(2))`; no-arg / `--tui`
  → `case "tui"` (`src/index.ts:23-26`) → `launchTui(defaultTuiScreen())`
  (`src/cli/startup.ts:6-8` hardcodes `"conversation"`).
- `src/tui/launch.tsx:14-120` — mounts the OpenTUI/Solid renderer and
  `AppShell` (`src/tui/app.tsx`). This is the **only** path that reaches the
  live agent loop in normal use.
- CLI non-TUI commands (`doctor`, `models`, `providers`, `config`, `setup
  --non-interactive`) route to `src/cli/commands.ts` and do **not** invoke
  `runAgent` — they are diagnostics/config surfaces only (confirmed: none of
  `runConfig`/`runDoctor`/`runModels`/`runProviders` import `agent/loop.ts`).
- Scripts (`scripts/evaluate-agent.ts`, `scripts/live-agent-eval.ts`,
  `scripts/build.ts`, `scripts/smoke.ts`, `scripts/refresh-model-catalog.ts`)
  are a **separate, non-interactive harness**, not the product entry point.
  `scripts/evaluate-agent.ts` imports `src/evals/*` directly
  (`scripts/evaluate-agent.ts:37-58`).

## Real production execution path (confirmed, cited)

See `01-repository-forensics.md` §2 for the full cited sequence. Summary:

`src/index.ts` → `tui/launch.tsx` → `tui/app.tsx` (`runTask`, `app.tsx:1220`)
→ dynamic imports of `router/task-analysis.ts`, `router/router.ts`,
`context/repository.ts`, `agent/verification-plan.ts`, **`agent/loop.ts`**
(`app.tsx:1259`, `runAgent` called at `app.tsx:2187`) → `providers/*` (stream)
→ `providers/stream-normalizer.ts` (parse) → `tools/workspace.ts` (execute,
via `security/execution-broker.ts`) → `agent/task-state.ts` (ledger update) →
`agent/verifier.ts` + `agent/completion-gate.ts` + `evidence/acceptance.ts`
(completion gate) → `storage/database.ts` (`saveAgentRuntime`, durable
persistence).

**`core/legacy-agent-runner.ts` and `core/swe-core.ts` are NOT on this path.**
See "Resolved: core/ vs agent/loop.ts" below.

## Subsystems (src/) — confirmed

| Subsystem | Key files | Confirmed purpose (traced) | Deep audit owner |
| --- | --- | --- | --- |
| `agent/` | `loop.ts` (6281 lines) | **Live agent kernel.** `runAgent()` (`loop.ts:908`) is the sole state machine: turn loop, provider streaming (`loop.ts:4144`), tool dispatch (`loop.ts:5530`), ledger mutation, recovery, completion gating, persistence callback. Confirmed as the function imported and called by `tui/app.tsx:1259,2187`. | agent-loop-auditor |
| `agent/task-state.ts` | — | Pure in-memory `AgentTaskLedger` type + mutator functions (`createTaskLedger`, `setTaskPhase`, `addTaskEvidence`, `recordTaskAction`, etc.). No I/O. Sole production caller: `agent/loop.ts` (imports at `loop.ts:77-93`). | agent-loop-auditor |
| `agent/task-runtime-state.ts` | — | Defines `TaskRuntimeSnapshot` (the durable envelope around a ledger: route identity, context anchor, checkpoint id, in-flight marker, revision). `createTaskRuntimeSnapshot` called from `tui/app.tsx:1908-1939`. | agent-loop-auditor |
| `agent/task-ledger-codec.ts` | — | `serializeTaskRuntime`/`restoreTaskRuntime` (`task-ledger-codec.ts:779,786`) — the sole (de)serialization boundary used by `storage/database.ts` for the `agent_tasks.ledger_json` column. | agent-loop-auditor |
| `agent/verifier.ts` | — | `independentlyVerifyTask` — host-owned, model-independent final check (evidence, mutation, verification-run, final-review, blocker, user-work-preserved). Called at `loop.ts:3145` when the caller supplies no `options.independentVerifier`. | verification-recovery-auditor |
| `agent/completion-gate.ts` | — | `evaluateCompletionGate` — the single gate loop.ts consults before declaring a task complete (`loop.ts:2877`). Consumes `ObjectiveProofAssessment` and `AcceptanceProofAssessment`. | verification-recovery-auditor |
| `agent/objective-proof.ts` | — | `assessObjectiveProof`/`inspectObjectiveArtifacts` — host-side artifact inspection proving the task-contract's declared deliverables actually exist/changed. Called at `loop.ts:2833-2839`. | verification-recovery-auditor |
| `agent/tool-envelope.ts` | — | **Not** a second implementation. Pure re-export shim: `export { MAX_TOOL_CALLS_PER_RESPONSE, recoverTextToolCalls } from "../providers/tool-envelope.js"` (`agent/tool-envelope.ts:6-9`), kept "for backward-compatible agent import." Real implementation lives only in `providers/tool-envelope.ts`. **Resolves the "duplicated tool-envelope.ts" open question: not duplicated, one real implementation + one compat re-export.** | tool-aci-auditor |
| `context/` | `context-builder.ts`, `context-capsule.ts`, `context-compiler.ts`, `evidence-sufficiency.ts`, `index.ts`, `instructions.ts`, `project-commands.ts`, `repository-intelligence.ts`, `repository-queries.ts`, `repository-snapshot.ts`, `repository.ts` | `context-compiler.ts` (not in the Stage-A skeleton) builds the bounded per-turn `ContextPacket`/decision context consumed at `loop.ts:31-35,4085`. `repository.ts::buildRepositoryContext` (`repository.ts:750`) calls `repository-intelligence.ts::buildRepositoryIntelligence` (`repository-intelligence.ts:654`); both are invoked once per task from `tui/app.tsx:1239`, before `runAgent`. | context-intelligence-auditor, repository-intelligence-auditor |
| `tools/` | `workspace.ts`, `permissions.ts`, `permission-grants.ts`, `errors.ts`, `types.ts` | `workspace.ts` defines the actual ACI tool set (`readFileTool`, `writeFileTool`, `createFileTool`, `editFileTool`, `deleteFileTool`, `listFilesTool`, `globFilesTool`, `searchTextTool`, `shellTool`, `gitStatusTool`, `gitDiffTool`, `runTestsTool`, exported bundle `workspaceTools` at `workspace.ts:1951`). Every tool resolves its execution boundary via `executionBrokerFor(ctx)` (`workspace.ts:271`, called at 8+ sites), which delegates to `security/execution-broker.ts`. `permissions.ts` classifies shell-command risk (`classifyShellCommand`, `checkPermission`). **`gitStatusTool`/`gitDiffTool` here are why `src/git/` is empty — Git integration lives inside `tools/workspace.ts`, not a dedicated module.** | tool-aci-auditor |
| `providers/` | `openai-compatible.ts`, `registry.ts`, `stream-normalizer.ts`, `tool-envelope.ts`, `circuit-breaker.ts`, `types.ts` | `GenericOpenAICompatibleProvider` (`openai-compatible.ts:116`) implements the provider `.stream()` called at `loop.ts:4144`. `stream-normalizer.ts::normalizeProviderEvents` (`stream-normalizer.ts:144`) wraps that stream and calls `tool-envelope.ts::recoverTextToolCalls` (`stream-normalizer.ts:161,193,211`) to recover textual pseudo-tool-call envelopes from models without native tool calling — this is the **parser** stage. `registry.ts::createProviderRegistry` (`registry.ts:140`) is called from `cli/control-plane.ts:228`. `circuit-breaker.ts::CircuitBreaker` is imported by `tui/app.tsx`. | model-runtime-auditor |
| `runtimes/` | `ollama.ts`, `http.ts`, `discovery.ts`, `model-filter.ts`, `types.ts` | `discovery.ts::discoverLocalRuntimes`/`createLocalRuntimeAdapters` (`discovery.ts:14,61`) — local runtime (Ollama/LM Studio/llama.cpp) discovery, consumed by `cli/control-plane.ts` (`discoverModels`). | model-runtime-auditor |
| `router/` | `router.ts`, `task-analysis.ts` | `router.ts::selectRoute` (`router.ts:212`) and `task-analysis.ts::analyzeTask` — both imported and called from `tui/app.tsx:1237-1238` before context building. Task→route decisioning, confirmed live. | model-runtime-auditor |
| `driver/` (untracked) | `profile.ts` | **INTEGRATED.** `driver/profile.ts` (exact model identity, write-authority, calibration status) is imported by 10 production files: `storage/database.ts`, `instructions/skill-loader.ts`, `agent/capability-probe.ts`, `agent/task-runtime-state.ts`, `agent/dynamic-capabilities.ts`, `tools/workspace.ts`, `tools/types.ts`, `context/context-builder.ts`, `security/execution-broker.ts`. It gates whether a model is permitted to write to the workspace (`security/execution-broker.ts:157-176`, `driverProfileCanWrite`). | tool-aci-auditor, model-runtime-auditor |
| `driver/` (untracked) | `edit-codec-calibration.ts`, `protocol-calibration.ts` | **STRUCTURAL, not integrated.** Fully built, exported (`encodeEditCodec`, `applyEditCodec`, `evaluateEditCodecCase`, `calibrateEditCodecs`), and unit-tested in isolation (`tests/unit/edit-codec-calibration.test.ts`, `tests/unit/protocol-calibration.test.ts`) — but **zero** importers anywhere in `src/`. No production caller. | tool-aci-auditor, model-runtime-auditor |
| `core/` (untracked) | `swe-core.ts`, `task-runtime-repository.ts`, `legacy-agent-runner.ts`, `index.ts`, `types.ts` | **STRUCTURAL, dormant, not integrated.** `DefaultSweCore`/`createSweCore` (`swe-core.ts:413,921`) has **zero importers** in `src/` outside its own file. Only consumer anywhere in the repo: `tests/unit/swe-core.test.ts`. The project's own architecture doc confirms this: `docs/architecture/swe-core.md:66-73` ("The current TUI and `runAgent` path remain intact... The next integration step is to inject the prepared task and legacy runner from an application service" — never done in phases 6-12). See "Resolved: core/ vs agent/loop.ts" below. | repository-forensics (resolved; see finding F-FORENSIC-001) |
| `evidence/` (untracked) | `acceptance.ts`, `index.ts` | **INTEGRATED.** `compileAcceptanceObligations`, `deriveEvidenceRecordsFromTaskState`, `evaluateProofBackedCompletion` are imported at `loop.ts:15-19` and called inside the live completion path at `loop.ts:2866-2876`. Part of the production completion gate, not a side artifact. | verification-recovery-auditor |
| `evals/` (untracked) | `artifact-store.ts`, `held-out.ts`, `paired-capability.ts`, `protocol-trial.ts`, `provider-recorder.ts`, `replay.ts`, `local-run.ts`, `local-runner.ts`, `provenance.ts`, `redaction.ts`, `schema.ts`, `identity.ts` | **Mixed.** `redaction.ts` (`redactEvaluationValue`) and `paired-capability.ts` are imported by production code (`security/execution-broker.ts:22`, `agent/recovery.ts:2`, `evidence/acceptance.ts:1`, `agent/dynamic-capabilities.ts:15-19`, `context/context-builder.ts:19`) — INTEGRATED as cross-cutting redaction/capability-report utilities. The rest (`artifact-store.ts`, `provenance.ts`, `schema.ts`, `local-run.ts`, `local-runner.ts`, `replay.ts`, `protocol-trial.ts`) are wired only into `scripts/evaluate-agent.ts:37-58` — a real caller, but the **eval harness**, not the production runtime. Per `docs/STATUS.md:27`, the local/real-model matrix is `UNPROVEN` — evals exist and run, but have not empirically validated real-model autonomy. | real-autonomy-evaluator |
| `security/` (untracked) | `execution-broker.ts` | **INTEGRATED.** `ExecutionBroker`/`createExecutionBroker` (`execution-broker.ts:157,535`) is instantiated live at `tui/app.tsx:2067` and is the resolved boundary for every workspace tool call (`tools/workspace.ts::executionBrokerFor`, 8+ call sites). Enforces workspace-path containment, process/network policy (`strict-zero`), checkpoint-gated writes, and secret redaction (`execution-broker.ts:524-532`). | security-privacy-auditor |
| `privacy/` | `policy.ts` | `isNeverRemotePath`/`scanSecrets` — imported by `agent/loop.ts:48` and `security/execution-broker.ts:23`. Confirmed live: protected-path classification + secret pattern scan used in both the mutation gate and the broker's redaction path. | security-privacy-auditor |
| `product/` (untracked) | `identity.ts` | **INTEGRATED (foundational).** `PRODUCT_NAME`, `CLI_NAME`, `PRODUCT_STATE_DIR_NAME`, `readProductEnv` (`product/identity.ts:1-18`). `readProductEnv` implements the ShelraCode/LocalCode env-var migration (`SHELRACODE_*` canonical, `LOCALCODE_*` legacy fallback). Used across `src/index.ts`, `checkpoint/checkpoint.ts:5`, `scripts/refresh-model-catalog.ts:4`, and widely elsewhere. | repository-forensics |
| `instructions/` | `skill-loader.ts`, `trust-policy.ts` | Skill discovery/loading; per `AUDIT-BOOTSTRAP.md`, roots restricted to `.agents/skills` only (`.claude/skills` removed from `DEFAULT_SKILL_ROOTS` this session). | context-intelligence-auditor |
| `storage/` | `database.ts` (995 lines) | `bun:sqlite`-backed `LocalCodeDatabase`. Tables: `schema_migrations`, `settings`, `sessions`, `messages`, `routes`, `quota_snapshots`, `provider_health`, `checkpoints`, `files_changed`, `agent_tasks`, `model_capabilities`, `memory_facts`, `model_driver_profiles` (`database.ts:79-186`). `saveAgentRuntime`/`getAgentRuntime`/`getLatestAgentRuntime` (`database.ts:401,462,484`) are the **live, sole durable persistence path** for task runtime state. See state-ownership table for `saveAgentTask` (dead method) risk. | repository-forensics |
| `checkpoint/` | `checkpoint.ts` | `CheckpointService` — pre-mutation file baselines, external-change detection (`assertNoExternalChange`, `STALE_EDIT`), preservation check (`isPreserved`), rollback. Instantiated at `tui/app.tsx:937,1689` and `agent/capability-probe.ts:550`; all persistence delegated to `storage/database.ts` (same SQLite file, `checkpoints`/`files_changed` tables). | verification-recovery-auditor |
| `git/` | *(none)* | **ABSENT.** Directory exists (untracked by git, no history) but contains **zero files**. Git integration is implemented as two tools inside `tools/workspace.ts` (`gitStatusTool` at `workspace.ts:1725`, `gitDiffTool` at `workspace.ts:1769`) and inside `context/repository-snapshot.ts`. | repository-forensics (resolved: ABSENT) |
| `catalog/` | *(none)* | **ABSENT.** Directory exists, zero files, no git history. Model-catalog behavior lives in `cli/control-plane.ts::discoverModels` and is written to `.shelracode/model-catalog.json` by `scripts/refresh-model-catalog.ts:6-31`. | repository-forensics (resolved: ABSENT) |
| `models/` | *(none)* | **ABSENT.** Directory exists, zero files, no git history. Model metadata/typing lives in `providers/types.ts`, `shared/types.ts` (`ModelCandidate`), and `providers/registry.ts`. | repository-forensics (resolved: ABSENT) |
| `hardware/` | `llmfit.ts`, `types.ts` | **INTEGRATED.** Imported by `tui/app.tsx`, `cli/control-plane.ts`, `cli/commands.ts`, `tui/views/Centers.tsx`, `tui/state/fixtures.ts` — hardware-fit sizing surfaced through `cli doctor`/TUI, not a stub. | model-runtime-auditor |
| `quota/` | `headers.ts` | **INTEGRATED.** Imported only by `providers/openai-compatible.ts` — parses provider rate-limit/quota response headers for the OpenAI-compatible adapter. | model-runtime-auditor |
| `config/` | `settings.ts` | UNKNOWN in depth this pass — file exists, not traced beyond confirming it is not empty. Left for a follow-on pass / config-adjacent domain audit. | repository-forensics |
| `telemetry/` | *(none)* | **ABSENT.** Directory exists, zero files, no git history. The word "telemetry" appears only as a UI settings label (`tui/state/settings.ts:12`, "Telemetry privacy") and in one code comment (`agent/loop.ts:3214`) — there is no telemetry-collection module anywhere in `src/`. | security-privacy-auditor (resolved: ABSENT) |
| `shared/` | `events.ts`, `logging.ts`, `process.ts`, `process-isolation.ts`, `process-policy.ts`, `types.ts`, `model-quality.ts`, `workspace-paths.ts`, `paths.ts`, `win32/` | Cross-cutting: `process.ts`/`process-policy.ts` are the host process boundary `security/execution-broker.ts` delegates to (`execution-broker.ts:11-20`); `paths.ts::assertWorkspacePath` is the workspace-containment primitive used by both the broker and `checkpoint.ts`. | security-privacy-auditor, complexity-auditor |
| `tui/` | `app.tsx` (2600+ lines traced), `launch.tsx`, `components/`, `screens/`, `views/`, `dialogs/`, `state/`, `theme/`, `presentation/`, `commands/`, `concepts/` | SolidJS/OpenTUI terminal UI. `app.tsx::runTask` (`app.tsx:1220`) is the orchestration function that wires router → context → verification-plan → `runAgent` → persistence for every submitted objective. This is where the "production execution path" actually lives at the host-application layer, not just inside `agent/loop.ts`. | (out of core-autonomy scope; complexity-auditor spot-check) |

## Resolved: `core/legacy-agent-runner.ts` vs `agent/loop.ts` (charter §20)

**`agent/loop.ts::runAgent` is the live production execution engine.**
`core/legacy-agent-runner.ts::LegacyAgentRunner` is not a competing or
superseding path — it is an **adapter that wraps `runAgent`**
(`core/legacy-agent-runner.ts:1,51`: `import { runAgent } from "../agent/loop.js"`,
then `const result = await runAgent(task, loopOptions, request.signal)`) so
that the *unused* `core/swe-core.ts::DefaultSweCore` lifecycle service could
someday drive it through the `SweTaskExecutor` port. Because `DefaultSweCore`
itself has zero production callers (confirmed by grep across `src/`; only
`tests/unit/swe-core.test.ts` imports it), `LegacyAgentRunner` is also never
instantiated in the live path — it exists solely to satisfy that test.
The name "legacy" refers to `runAgent` being the **pre-existing, still-live**
whole-run engine relative to the newer, unshipped step/run/resume `SweCore`
lifecycle model — not to `runAgent` being superseded. See
`docs/architecture/swe-core.md:66-73` for the project's own confirmation that
this is an intentionally incomplete "strangler" migration frozen at Phase 5.

`core/swe-core.ts`'s role: a self-contained, well-tested, **dormant**
provider-neutral task-lifecycle kernel (`startTask`/`step`/`run`/`cancel`/
`resume`, optimistic-concurrency-safe via its own `TaskStateService`) that
was designed to eventually replace/wrap the ad hoc persistence and
turn-loop bookkeeping now living inline in `tui/app.tsx` + `agent/loop.ts`.
It has not been integrated into any application service since Phase 5.

## State ownership (§22) — see `01-repository-forensics.md` §4 for full table

Six sources traced: `agent/task-state.ts` (in-memory ledger), 
`agent/task-runtime-state.ts` (durable envelope type), 
`core/task-runtime-repository.ts` (dormant parallel in-memory model), 
`storage/database.ts` (durable SQLite — the actual source of truth), 
`checkpoint/checkpoint.ts` (durable file baselines, same DB), 
`agent/task-ledger-codec.ts` (the serialization choke point).

Flags raised (detail + evidence in `01-repository-forensics.md`):
- **DUPLICATED / NON_DURABLE / effectively UNOWNED-in-production**:
  `core/task-runtime-repository.ts`'s `InMemoryTaskRuntimeRepository` encodes
  the same "task state" domain concept as `task-runtime-state.ts` +
  `storage/database.ts`, independently, with no adapter connecting it to the
  real database (`core/task-runtime-repository.ts:30-34`, doc comment admits
  this explicitly).
- **Dormant MULTIPLE_SOURCE_OF_TRUTH hazard**: `storage/database.ts`'s
  `saveAgentTask` method (`database.ts:360`) is dead code (zero callers) but
  would write a bare `AgentTaskLedger` into the same `agent_tasks.ledger_json`
  column that `saveAgentRuntime`/`getAgentRuntime` treat as a versioned
  `TaskRuntimeSnapshot` — `getAgentRuntime`'s own fallback path
  (`database.ts:469-481`) proves the two encodings are incompatible.
- **NON_DURABLE (narrow, scoped)**: `pendingMutations` in `agent/loop.ts`
  (`loop.ts:1881`, populated `loop.ts:5558`, cleared `loop.ts:5858`) is a
  purely in-process regression-guard buffer; it is not persisted, so a crash
  between a flagged mutation and its regression-guard evaluation loses only
  that bookkeeping (the underlying file content stays durable in the
  checkpoint tables).

## Tests (tests/)

`unit/`, `integration/`, `e2e/`, `evals/`, `ui/`, `fixtures/`, `support/`.
~133 test files. Classification (fake-provider vs real-model) owned by
real-autonomy-evaluator (charter §35). Confirmed in this pass:
`tests/unit/swe-core.test.ts` is the **only** consumer of `core/*` in the
entire repository outside `core/` itself.

## Open structural questions — resolved this pass

- ~~`core/legacy-agent-runner.ts` vs `agent/loop.ts`~~ — **RESOLVED**, see
  above. `agent/loop.ts::runAgent` is live; `core/*` is dormant.
- Untracked new dirs (`core`, `driver`, `evals`, `evidence`, `product`,
  `security`) — **RESOLVED**, see maturity table in
  `01-repository-forensics.md` §5. Per-dir: `core` STRUCTURAL (dormant),
  `driver` split (profile.ts INTEGRATED, calibration files STRUCTURAL),
  `evals` split (redaction/paired-capability INTEGRATED, rest FUNCTIONAL
  eval-harness-only), `evidence` INTEGRATED, `product` INTEGRATED,
  `security` INTEGRATED.
- ~~Duplicated `tool-envelope.ts` in both `agent/` and `providers/`~~ —
  **RESOLVED, not duplicated.** `agent/tool-envelope.ts` is a one-line
  re-export shim of `providers/tool-envelope.ts`.
- **New**: `src/git/`, `src/catalog/`, `src/models/`, `src/telemetry/` were
  listed as "(to enumerate)" in the Stage-A skeleton on the assumption they
  contained code to catalog. They are **empty directories with no git
  history at any commit** — the functionality their names imply is
  implemented elsewhere (see subsystem table). Flagged for
  `complexity-auditor` as candidate dead scaffolding to remove or populate.
