# LocalCode v0.1 MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use inline execution with the repository's TDD and release-gate instructions. Each task is independently testable.

**Goal:** Ship a current-source-verifiable LocalCode v0.1 vertical slice with safe local/free routing, real tools, persistence, and a keyboard-first OpenTUI application.

**Architecture:** One Bun ESM package. CLI parsing and services remain independent of TUI rendering; normalized adapters isolate providers/runtimes; SQLite stores durable operational state; safety gates precede model scoring.

**Tech Stack:** Bun 1.3.14, TypeScript, SolidJS 1.9.12, OpenTUI 0.5.7, `@opentui/keymap`, `bun:sqlite`, Bun test, Prettier.

**Spec:** `docs/superpowers/specs/2026-08-23-localcode-mvp-design.md`

## Global Constraints

- `STRICT_ZERO` never intentionally invokes paid inference.
- Privacy hard gates precede cost, capability, context, health, quota, and score.
- Local remains an eligible first route.
- Free/privacy metadata is timestamped and stale data is excluded from strict-zero.
- No real provider credentials in tests; no remote telemetry by default.
- No destructive Git rollback and no second UI/runtime path.
- Every user-visible provider/action is backed by a real adapter or clearly marked unavailable.

### Task 1: Bootstrap and first render

**Files:** `package.json`, `tsconfig.json`, `bunfig.toml`, `src/index.ts`, `src/tui/app.tsx`, `scripts/build.ts`, `scripts/smoke.ts`, `tests/integration/cli.test.ts`.

- Write a failing help/version test.
- Run it and observe missing entry behavior.
- Implement argument parsing, version/help, and a minimal OpenTUI shell with clean renderer ownership.
- Run help/version, typecheck, and a PTY smoke.

### Task 2: Domain contracts and storage

**Files:** `src/shared/types.ts`, `src/shared/errors.ts`, `src/shared/events.ts`, `src/storage/database.ts`, `src/storage/migrations.ts`, `src/storage/repositories.ts`, `tests/unit/storage.test.ts`.

- Write failing tests for migration idempotency and route/session persistence.
- Implement typed domain records, event union, SQLite migrations, and repositories using `bun:sqlite`.
- Run focused tests and typecheck.

### Task 3: Privacy, secrets, context, and permissions

**Files:** `src/privacy/policy.ts`, `src/security/secrets.ts`, `src/context/repository-map.ts`, `src/context/context-builder.ts`, `src/tools/permissions.ts`, tests under `tests/unit` and `tests/integration`.

- Write failing path/content blocking, root containment, context budget, and shell approval tests.
- Implement denylist, high-confidence scanner, sanitized context, permission modes and conservative shell classification.
- Prove prohibited content is absent from captured provider requests.

### Task 4: Router, quota, health and explanation

**Files:** `src/router/*`, `src/quota/*`, `src/providers/circuit-breaker.ts`, `tests/unit/router.test.ts`, `tests/integration/routing.test.ts`.

- Write failing tests for gate ordering, stale/unverified/paid exclusion, scoring, opportunity cost, circuit opening, fallback and explanation parity.
- Implement task analysis, sensitivity, candidate gates, score, quota snapshots, and circuit breaker.
- Run route integration simulation: local failure → free provider 429 → compliant fallback.

### Task 5: Hardware and local runtimes

**Files:** `src/hardware/*`, `src/runtimes/*`, `src/models/catalog.ts`, tests under `tests/unit` and `tests/integration`.

- Write failing JSON parsing and missing-llmfit fallback tests.
- Implement cancellable command execution, llmfit adapter, basic system fallback, HTTP endpoint/Ollama discovery, and model normalization.
- Run `doctor` and local model listing on this Windows machine.

### Task 6: Provider adapters

**Files:** `src/providers/*`, `tests/integration/provider-contract.test.ts`, `docs/PROVIDERS.md`, `docs/RESEARCH-SNAPSHOT.md`.

- Write failing normalized stream/error/quota tests against fake HTTP servers.
- Implement generic OpenAI-compatible, Groq, OpenRouter, Cloudflare, Gemini-public, and Zen-paid adapters; keep strict-zero eligibility explicit.
- Run contract tests without credentials and confirm no provider is advertised as free without evidence.

### Task 7: Agent tools, checkpoints and loop

**Files:** `src/tools/*`, `src/checkpoint/*`, `src/git/*`, `src/agent/*`, `tests/integration/agent-loop.test.ts`, `tests/e2e/*`.

- Write failing fixture loop and checkpoint conflict tests.
- Implement structured tools, verification, checkpoint snapshots, conflict-safe rollback, provider-independent stream loop, and cancellation.
- Run the fixture edit/test/diff journey.

### Task 8: Setup, doctor and TUI centers

**Files:** `src/cli/*`, `src/tui/*`, `tests/e2e/tui.test.ts`, `docs/TUI.md`.

- Write failing headless frame tests for 80/120 columns, composer focus, palette and route/privacy state.
- Implement AppShell, transcript/tool rows, composer, status bar, command palette, setup/doctor, models/routing/quota/privacy/providers dialogs, approvals, diff/checkpoint/rollback actions.
- Run headless and real PTY keyboard/resize/exit smoke.

### Task 9: Release proof

**Files:** `CHANGELOG.md`, `docs/STATUS.md`, `docs/ACCEPTANCE.md`, `docs/WEEK-ONE.md`, `scripts/smoke.ts`.

- Run clean install, format check, typecheck, full tests, build, source/compiled smoke, doctor smoke, TUI smoke, privacy/strict-zero/rollback/cancellation E2E.
- Fix only evidenced failures, update status and known limitations, inspect Git diff, and report PASS/FAIL separately for source and built artifact.
