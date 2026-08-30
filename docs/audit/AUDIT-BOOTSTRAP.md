# ShelraCode — Audit Bootstrap

> Stage A output (Sections 61/65 of the audit charter). Read-only discovery.
> No production behavior was audited yet; no conclusions are drawn here.
> Captured: 2026-08-29.

## Bootstrap facts

| Field | Value (evidence) |
| --- | --- |
| **Repository** | `D:\PROYECTS\shelra` — package `shelra` v0.1.1, "A local-first, privacy-aware AI coding agent for the terminal." (`package.json`) |
| **Branch** | `main` |
| **Commit** | `230b557` — "docs: spec autonomous-completion overhaul (watchdog recovery, prompt, reasoning-effort)" |
| **Working tree** | **DIRTY — large uncommitted WIP.** ~289 pending changes: many deletions under `.agents/skills/opentui/docs/*.mdx` (vendored skill doc prune); heavy modifications to production source (`src/agent/loop.ts`, `src/agent/*`, `src/context/*`, `src/providers/*`, `src/router/*`, `src/tui/*`); and whole untracked new dirs (`src/core/`, `src/driver/`, `src/evals/`, `src/evidence/`, `src/product/`, `src/security/`). The audit therefore targets a **moving working-tree state**, not a committed snapshot. |
| **Languages** | TypeScript (ESM), SolidJS TSX (TUI) |
| **Runtime** | Bun 1.3+ (`bun:sqlite`), TypeScript 7 |
| **Package manager** | Bun (`bun.lock`, `bunfig.toml`) |
| **Test system** | `bun --conditions=browser test` (133 test files under `tests/`); `tsc --noEmit` typecheck; `scripts/evaluate-agent.ts` (deterministic + `--local`), `scripts/live-agent-eval.ts`; `tests/integration/functional-acceptance.test.ts` |
| **Source size** | ~139 `.ts` files in `src/`, ~47,485 LOC; ~30 subsystems |
| **Existing specifications** | No root `specs/`. Spec-like material lives in `docs/architecture/` (context-compiler, dcs, evidence-verification, recovery, repository-intelligence, shelra-driver, swe-core), `docs/phases/` (phase-00…12 reports), `docs/ACCEPTANCE.md`, `docs/adr/ADR-000`, `docs/evals/` |
| **Existing CLAUDE.md** | **None.** Project uses `AGENTS.md` (root) + `src/providers/AGENTS.md` as the agent-instruction layer |
| **Existing Claude agents** | **None** (`.claude/` held only `scheduled_tasks.lock` + a coupling skills symlink) |
| **Existing Skills** | Product skills under `.agents/skills/`: `localcode-agent-harness`, `localcode-hardware-fit`, `localcode-opentui`, `localcode-provider-adapter`, `localcode-release-gate`, `localcode-routing`, `opentui` (tracked in `skills-lock.json`) |
| **Existing hooks** | **None** |
| **Existing benchmark/eval infra** | `src/evals/` (artifact-store, held-out, paired-capability, protocol-trial, provider-recorder, replay, schema, local-run/local-runner, provenance, redaction); `tests/evals/` (agent-journeys, fixtures); `scripts/evaluate-agent.ts` + `scripts/live-agent-eval.ts`. Both **recorded/replay** (fake) and **real local** paths exist. `docs/STATUS.md` records "Deterministic matrix: PASS (18/18)" but "Local matrix: UNPROVEN" (model reported unloaded). |
| **Known local-model integrations** | Ollama (`SHELRACODE_OLLAMA_URL=http://127.0.0.1:11434`), LM Studio (`:1234/v1`), llama.cpp (`:8080/v1`), generic OpenAI-compatible base URL; cloud free tiers Groq / OpenRouter / OpenCode; routing mode `strict-zero`, privacy `private` (`.env.example`, `src/runtimes/`, `src/providers/`) |
| **Safe audit write locations** | `.claude/` (harness), `docs/audit/`, `specs/`, `docs/adr/`. Blocked during AUDIT_MODE: `src/**`, `scripts/**`, `tests/**`, build/config manifests (enforced by `.claude/hooks/production-modification-guard.ts`) |

## Naming note (candidate finding, not resolved)

The product is mid-rename: `package.json`/`.env`/`docs/PRODUCT.md` say **ShelraCode / `shelra`**, while `AGENTS.md` and phase docs still say **LocalCode**, and `.agents/skills/localcode-*` keep the old prefix. There is an untracked plan `docs/superpowers/plans/2026-08-27-shelracode-identity-opentui-audit.md`. Recorded as an alignment gap for the `sdd-architect` / `repository-forensics` agents; not resolved during bootstrap.

## User-directed changes applied this session (outside pure audit, explicitly requested)

1. **Codex removed totally.** Deleted `.codex/` (8 agent `.toml` + `config.toml`) and removed the dead `.codex/skills` root from `src/instructions/skill-loader.ts`. Doc references to *OpenAI Codex* as a reference/competitor were kept (required audit comparison material).
2. **`.claude` decoupled from the product runtime.** Removed the machine-specific symlink `.claude/skills/opentui → .agents/skills/opentui`, and removed `.claude/skills` from `DEFAULT_SKILL_ROOTS` in `src/instructions/skill-loader.ts`. ShelraCode product Skills now load **only** from `.agents/skills`; `.claude/` is reserved exclusively for the Claude Code harness. Verified: `tests/unit/skills.test.ts` + `tests/unit/dynamic-capabilities.test.ts` → 14 pass / 0 fail.

## Stop-condition check (Section 62)

- Repository inspectable: **OK**.
- Test commands identified: **OK** (`bun test`, `tsc --noEmit`, eval scripts).
- Working tree contains large modifications: **FLAGGED** — this is the user's own WIP, not unknown/dangerous, but it means the audit runs against an uncommitted state. Recommendation carried into the audit: snapshot (branch/stash) before deep domain audits so findings anchor to a stable revision.
- Real local model: **BLOCKED_REAL_MODEL** at last check (`docs/STATUS.md`: model reported unloaded). Real-model diagnostics (Stage E) require a loaded, explicitly selected local model.

## Unknowns to resolve in later stages

- Actual production agent execution path (folder names are not proof) → `agent-loop-auditor`.
- Whether eval "PASS" reflects real-model autonomy or fake-provider/replay success → `real-autonomy-evaluator`.
- Which of `src/core`, `src/driver`, `src/evals`, `src/evidence`, `src/product`, `src/security` (untracked) are integrated vs. structural → `repository-forensics` + `complexity-auditor`.
- Whether the `.codex/agents` roles encoded intent that should migrate to `.claude/agents` → `sdd-architect`.
