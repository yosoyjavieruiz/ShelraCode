# LocalCode Local Model Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with review checkpoints.

**Goal:** Introduce a first-class local model domain, safe catalog/download/runtime lifecycle, and correct local-vs-remote routing while preserving the existing agent and provider vertical.

**Architecture:** Add typed model/catalog/download modules and an `ExecutionTarget` compatibility layer. Keep remote providers behind `ProviderAdapter`; add local runtime adapters behind `LocalRuntimeAdapter`; let the router use distinct local and remote score breakdowns. Persist durable model state in the existing SQLite database.

**Tech Stack:** Bun 1.3+, strict TypeScript ESM, `bun:sqlite`, built-in `fetch`, OpenTUI Solid, existing adapter/test conventions.

**Spec:** `docs/superpowers/specs/2026-08-23-local-model-hub-design.md`

## Global Constraints

- Local inference has no LocalCode-imposed usage quota.
- `STRICT_ZERO` never intentionally selects paid inference.
- LM Studio is optional; llama.cpp is the first managed runtime.
- llmfit remains the hardware-fit authority; fallback detection is explicit.
- HF metadata/downloads are revision-aware and never execute repository code.
- Existing dirty worktree changes are preserved; no destructive Git rollback or commit is performed.
- Production claims require current source, bundle, tests and user-visible smoke evidence.

---

### Task 1: Add domain contracts and regression tests

**Files:**

- Create: `src/models/types.ts`, `src/models/targets.ts`
- Modify: `src/shared/types.ts`, `src/agent/types.ts`
- Test: `tests/unit/local-model-domain.test.ts`

- [ ] Write failing tests for `LocalExecutionTarget`, `RemoteExecutionTarget`, `Model`, `ModelVariant`, `InstalledModel`, `RunningModel`, and `LocalScoreBreakdown` serialization boundaries.
- [ ] Run `bun test tests/unit/local-model-domain.test.ts` and confirm failure comes from missing contracts.
- [ ] Implement discriminated unions and compatibility conversion from the existing `ModelCandidate` shape.
- [ ] Run the focused test and the existing typecheck.

### Task 2: Separate local and remote routing

**Files:**

- Create: `src/router/local-score.ts`
- Modify: `src/router/router.ts`, `src/shared/types.ts`, `src/privacy/policy.ts`
- Test: `tests/unit/local-score.test.ts`, `tests/integration/routing-local-domain.test.ts`

- [ ] Write tests asserting local scoring never reads quota snapshots and produces local-only explanation text.
- [ ] Run them red.
- [ ] Add local score weights, `MAX QUALITY`, `FAST`, `LOCAL ONLY` and `FREE ONLY` semantics.
- [ ] Keep remote gate order and strict-zero paid exclusion unchanged.
- [ ] Run routing tests and inspect generated explanations for forbidden cloud terms.

### Task 3: Build the catalog and HF discovery service

**Files:**

- Create: `src/models/catalog.ts`, `src/models/discovery/huggingface.ts`, `src/models/search.ts`
- Modify: `src/cli/control-plane.ts`
- Test: `tests/unit/model-catalog.test.ts`, `tests/integration/huggingface-catalog.test.ts`

- [ ] Write fixture-backed tests for HF search normalization, format/quant extraction, variant grouping, pagination and offline failure.
- [ ] Implement injectable fetch with no credentials by default; preserve revision and gated metadata.
- [ ] Implement curated categories and search without loading unbounded raw results.
- [ ] Integrate catalog refresh as optional control-plane work with stale metadata retained.

### Task 4: Add persistence for models, variants, installs, jobs and runtime instances

**Files:**

- Modify: `src/storage/database.ts`
- Test: `tests/unit/storage-models.test.ts`

- [ ] Write migration/repository tests for idempotent schema creation, duplicate installs and job transitions.
- [ ] Add tables/repositories for catalog models, variants, installed models, download jobs, runtime instances and benchmarks.
- [ ] Verify secrets and raw model content are not persisted.

### Task 5: Implement safe download and install lifecycle

**Files:**

- Create: `src/models/downloads.ts`, `src/models/installed.ts`, `src/models/storage.ts`
- Test: `tests/unit/model-downloads.test.ts`, `tests/integration/model-downloads.test.ts`

- [ ] Write a local HTTP fixture test for progress, cancellation, resume, disk-space rejection, SHA-256 success and integrity failure.
- [ ] Implement one active job at a time, abort signals, bounded retries, normalized destination paths and atomic finalization.
- [ ] Register only verified artifacts; preserve previous active installs on failure.

### Task 6: Implement managed llama.cpp and external local runtime contracts

**Files:**

- Create: `src/runtimes/llama-cpp.ts`, `src/runtimes/local-target.ts`
- Modify: `src/runtimes/types.ts`, `src/runtimes/http.ts`, `src/runtimes/discovery.ts`
- Test: `tests/unit/llama-cpp-runtime.test.ts`, `tests/integration/local-runtime-contract.test.ts`

- [ ] Write tests for executable detection, safe argument construction, loopback port allocation, health, bounded stop and external model normalization.
- [ ] Implement managed runtime process ownership with no shell string interpolation and no arbitrary repository scripts.
- [ ] Keep LM Studio, Ollama, LocalAI, vLLM and generic localhost discovery optional and explicitly local.

### Task 7: Use llmfit plan data and recommendation tiers

**Files:**

- Modify: `src/hardware/types.ts`, `src/hardware/llmfit.ts`, `src/cli/control-plane.ts`
- Test: `tests/unit/hardware-plan.test.ts`, `tests/integration/recommendations.test.ts`

- [ ] Write parser tests for `plan --json` GPU, CPU-offload, CPU-only and unavailable paths.
- [ ] Add `analyzeModel` and map fit to `MAX QUALITY`, `RECOMMENDED`, `FAST`, `STRETCH`, `NOT_VIABLE` without hiding stretch models.
- [ ] Keep fallback guidance explicit when llmfit is absent.

### Task 8: Migrate route events, Models UI and CLI language

**Files:**

- Modify: `src/tui/app.tsx`, `src/tui/views/Centers.tsx`, `src/tui/components/ModelPicker.tsx`, `src/cli/commands.ts`, `src/tui/state/fixtures.ts`
- Test: `tests/integration/local-route-ui.test.tsx`, `tests/integration/model-hub-ui.test.tsx`, `tests/ui/fixtures/v4-local-models.ts`

- [ ] Add regression fixtures that fail on `quota headroom`, `paid route`, `cost gate`, or `free quota` in local route events.
- [ ] Render Local, Free Cloud, Installed, Downloads, Running, Maximum Quality and Stretch as separate user-facing concepts.
- [ ] Add actionable download/load/benchmark states without advertising unsupported actions.
- [ ] Capture 80/100/120/160 frames and run `NO_COLOR` checks.

### Task 9: Review cycles and release gate

**Files:**

- Create/update: `docs/local-models/FINAL-AUDIT.md`, `docs/local-models/TESTING.md`, `docs/local-models/CATALOG.md`, `docs/local-models/RUNTIMES.md`, `docs/local-models/RECOMMENDATION.md`, `docs/local-models/DOWNLOADS.md`, `docs/local-models/ROUTING.md`

- [ ] Run Pass 1 domain/functional review and fix P0/P1 findings.
- [ ] Run Pass 2 product/UX review and fix P0/P1 findings.
- [ ] Run Pass 3 adversarial review for offline, missing runtime, OOM, disk full, crash, cancellation, gated HF and tiny terminal.
- [ ] Run format, typecheck, full tests, build, smoke, real CLI/TUI path and inspect the final diff.
- [ ] Score the release gate honestly; keep `FAIL` if any required flow lacks current evidence.
