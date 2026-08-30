# ShelraCode Identity and OpenTUI Audit Fix Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ShelraCode the single product identity exposed by the CLI, agent prompts, terminal UI, diagnostics, and canonical documentation, while preserving safe read-only compatibility for existing state and environment data.

**Architecture:** Keep the existing `shelra` entry point, Bun package, SolidJS reconciler, and renderer-owned lifecycle. Centralize product-facing text and canonical configuration names, then make legacy state/environment names migration inputs only; do not create a second runtime or UI.

**Tech Stack:** Bun 1.3+, strict TypeScript ESM, SolidJS, OpenTUI 0.5.7, Bun SQLite, Bun test, Prettier.

**Spec:** `AGENTS.md`, `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/PRIVACY.md`, `docs/ROUTING.md`, `docs/DECISIONS.md`, `docs/agent-kernel/STATUS.md`, and the installed `.agents/skills/opentui/SKILL.md`.

## Global Constraints

- ShelraCode remains local-first and `strict-zero` never intentionally selects paid inference.
- Core business logic must not import TUI code; provider-specific shapes stay behind adapters.
- OpenTUI uses the Solid reconciler, focused keyboard input, renderer-owned cleanup, and no direct `process.exit()` in the interactive path.
- Product-facing names use `ShelraCode`; the executable remains `shelra`.
- Existing user changes remain untouched unless a file is explicitly listed below.
- Do not build, install, replace, commit, or publish `dist/shelra.exe`; verify the existing artifact separately.
- Canonical names are `SHELRACODE_*`, `~/.shelracode`, and `.shelracode`; old names may be read as compatibility inputs but must not be emitted as new product state.

### Task 1: Establish canonical identity and configuration contracts

**Files:**
- Create: `src/product/identity.ts`
- Modify: `src/index.ts`, `src/cli/commands.ts`, `src/cli/control-plane.ts`, `src/config/settings.ts`, `src/shared/logging.ts`, `src/shared/process-policy.ts`, `src/runtimes/discovery.ts`, `src/agent/trace.ts`
- Test: `tests/unit/product-identity.test.ts`, `tests/unit/settings.test.ts`, `tests/unit/process.test.ts`

**Interfaces:**
- `src/product/identity.ts` exports `PRODUCT_NAME`, `CLI_NAME`, `PRODUCT_STATE_DIR_NAME`, and compatibility-aware environment lookup helpers.
- `readSettings`, state location, runtime discovery, logging, and trace read canonical `SHELRACODE_*` first and legacy values second without exposing legacy names in normal output.
- Repository settings and runtime exclusions use `.shelracode`; existing `.localcode` settings remain readable during migration.

- [ ] **Step 1: Write the failing identity and migration tests**

  Add assertions that `ShelraCode` is returned by the identity contract, canonical environment values win over legacy values, legacy values are accepted only when canonical values are absent, and the default repository/global state names are `.shelracode`/`~/.shelracode`.

- [ ] **Step 2: Run the focused tests and verify the expected failure**

  Run `bun test tests/unit/product-identity.test.ts tests/unit/settings.test.ts tests/unit/process.test.ts` and confirm the missing canonical contract or old defaults cause the failure.

- [ ] **Step 3: Implement the smallest canonical identity/configuration change**

  Add the identity helpers, update consumers to use them, and retain compatibility reads without adding a second execution path.

- [ ] **Step 4: Run the focused tests and verify green**

  Run `bun test tests/unit/product-identity.test.ts tests/unit/settings.test.ts tests/unit/process.test.ts` and confirm all assertions pass.

### Task 2: Replace user-visible legacy branding and internal UI command labels

**Files:**
- Modify: `src/cli/commands.ts`, `src/index.ts`, `src/checkpoint/checkpoint.ts`, `src/tools/workspace.ts`, `src/agent/loop.ts`, `src/agent/compaction.ts`, `src/tui/app.tsx`, `src/tui/launch.tsx`, `src/tui/terminal.ts`, `src/tui/state/fixtures.ts`, `src/tui/concepts/CoreConceptsV4.tsx`, `src/tui/views/HomeView.tsx`, `src/cli/installation.ts`
- Test: `tests/integration/cli.test.ts`, `tests/integration/functional-acceptance.test.ts`, `tests/integration/ui.test.tsx`, `tests/unit/ui-keymap.test.ts`, `tests/unit/product-identity.test.ts`

**Interfaces:**
- CLI headings, errors, agent system prompts, checkpoint/tool recovery messages, composer text, home/concept surfaces, and command identifiers use ShelraCode.
- The installation surface exposes `shelra` only; no new compatibility shim is generated.
- A product-output assertion rejects `LocalCode`/`localcode` in canonical CLI and TUI output while allowing explicit legacy-input coverage to name the migration contract.

- [ ] **Step 1: Add a failing public-output regression**

  Capture `runDoctor`, `runModels`, `runProviders`, `runConfig`, `runSetup`, agent diagnostics, the error path, and the primary TUI fixtures; assert each product-facing result contains `ShelraCode` where appropriate and does not contain the old product label.

- [ ] **Step 2: Run the regression and observe the old label**

  Run `bun test tests/integration/cli.test.ts tests/integration/ui.test.tsx tests/unit/product-identity.test.ts`; the test must fail against the current `LocalCode Doctor` and remaining legacy UI strings.

- [ ] **Step 3: Replace the user-visible labels and command namespace**

  Route visible copy through the canonical identity constant, change agent prompts and recovery copy, and rename UI command IDs to a ShelraCode namespace without changing the key bindings or behavior.

- [ ] **Step 4: Run focused CLI/TUI tests**

  Run `bun test tests/integration/cli.test.ts tests/integration/ui.test.tsx tests/unit/ui-keymap.test.ts tests/unit/product-identity.test.ts` and confirm the regression is green.

### Task 3: Update canonical docs, fixtures, and repository exclusions

**Files:**
- Modify: `AGENTS.md`, `README.md`, `.env.example`, `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/PROVIDERS.md`, `docs/STORAGE.md`, `docs/TUI.md`, `docs/UI-INVENTORY.md`, `docs/UI-V2.md`, `docs/AGENT-HARNESS.md`, `docs/ACCEPTANCE.md`, `docs/STATUS.md`, `docs/agent-kernel/ARCHITECTURE.md`, `docs/agent-kernel/LOGGING.md`, `tests/ui/golden/conversation/*.txt`, `tests/support/fixture-repo.ts`
- Test: `tests/integration/context-relevance.test.ts`, `tests/integration/privacy-context.test.ts`, `tests/unit/ui-fixtures.test.ts`

**Interfaces:**
- Canonical docs and golden frames describe ShelraCode and `.shelracode`/`SHELRACODE_*`.
- Context discovery excludes both canonical runtime state and the legacy directory so migration data cannot become repository evidence.
- Historical audit/spec documents are not rewritten as if old evidence were current; any retained legacy term is explicitly marked historical or compatibility-only.

- [ ] **Step 1: Add exclusion/migration assertions**

  Extend context and fixture tests so `.shelracode` is excluded, `.localcode` remains excluded, and canonical fixture variables take precedence.

- [ ] **Step 2: Run the focused context and fixture tests**

  Run `bun test tests/integration/context-relevance.test.ts tests/integration/privacy-context.test.ts tests/unit/ui-fixtures.test.ts` and verify the old implementation does not satisfy the canonical path assertions.

- [ ] **Step 3: Update canonical documentation and golden frames**

  Replace current product-facing branding and command/configuration examples, preserving dated historical claims only when they are clearly labeled as history.

- [ ] **Step 4: Run documentation and golden-frame checks**

  Run `bunx prettier --check AGENTS.md README.md .env.example docs/PRODUCT.md docs/ARCHITECTURE.md docs/PROVIDERS.md docs/STORAGE.md docs/TUI.md docs/UI-INVENTORY.md docs/UI-V2.md docs/AGENT-HARNESS.md docs/ACCEPTANCE.md docs/STATUS.md tests/ui/golden/conversation` and the focused UI tests.

### Task 4: Full evidence gate and real artifact boundary

**Files:**
- Modify: only files required by the preceding failing tests
- Test: `bun run typecheck`, `bun run test`, `bun run test:functional`, `bun run format:check`, `bun run smoke`, and the source/bundle/standalone CLI and TUI journeys

- [ ] **Step 1: Run source verification**

  Run `bun run typecheck`, `bun run test`, `bun run test:functional`, and `bun run smoke`; record exact counts and separate pre-existing formatting failures from changed-file formatting.

- [ ] **Step 2: Exercise OpenTUI through the real launch path**

  Launch the source TUI through a real PTY, type a normal prompt, submit it, open a slash command, cancel a task with Escape, resize or run the supported width captures at 80/100/120/160 columns, run with `NO_COLOR`, and exit through `/exit` or Ctrl+C while observing terminal restoration.

- [ ] **Step 3: Verify existing artifacts without rebuilding**

  Run `dist/index.js` and `dist/shelra.exe` for `--help`, `--version`, and `doctor`; record their hashes/timestamps and state clearly if they predate the source fix.

- [ ] **Step 4: Review the final diff and report boundaries**

  Run `git diff --check`, inspect `git status --short`, verify no unrelated dirty files were overwritten, and report any external/model/runtime/standalone acceptance that remains unverified.
