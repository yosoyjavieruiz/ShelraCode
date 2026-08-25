# LocalCode UI V3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current dashboard-like LocalCode TUI with a functional, conversation-first, responsive Obsidian Violet interface backed by the existing control plane.

**Architecture:** Keep the existing Bun + TypeScript + SolidJS + OpenTUI stack and keep domain services unchanged. Move presentation state into focused shell/workspace components, use typed semantic view models instead of `string[]`, and use a single command registry for slash commands, palette, help and keymap actions. Workspaces replace the conversation viewport temporarily; navigation and inspection are overlays or explicit drawers.

**Tech Stack:** Bun 1.3+, TypeScript ESM, SolidJS 1.9.12, `@opentui/core`/`@opentui/solid`/`@opentui/keymap` 0.5.7, Bun test, OpenTUI test renderer.

**Spec:** `docs/superpowers/specs/2026-08-23-localcode-ui-v3-design.md`

## Global Constraints

- Canvas is exactly `#000000`; primary accent is exactly `#8B5CF6`.
- Purple is an accent for focus, selection, brand and primary action, not a universal surface color.
- Default shell is conversation-first with no permanent sidebar or inspector at any width.
- Core routing, provider, model, privacy, storage and agent logic is not rewritten.
- Live UI data must come from existing application services; fixture data is test/capture-only.
- `NO_COLOR`, reduced motion, keyboard-only operation, 80/100/120/160/200 widths and terminal cleanup are required.
- Preserve all unrelated dirty work; do not reset, checkout, stage broadly, or commit without explicit request.

---

### Task 1: Establish UI V3 audit and capture infrastructure

**Files:**

- Create: `docs/ui-v3/REFERENCE-MATRIX.md`
- Create: `docs/ui-v3/AUDIT-BASELINE.md`
- Create: `docs/ui-v3/FUNCTIONAL-AUDIT.md`
- Create: `docs/ui-v3/IA.md`
- Create: `docs/ui-v3/BEFORE-AFTER.md`
- Create: `scripts/capture-ui.ts`
- Create: `tests/ui/fixtures/fixture-data.ts`

**Interfaces:**

- `captureUiState(state: FixtureState, width: number, height: number): Promise<string>` returns a deterministic OpenTUI frame.
- `FixtureState` contains only presentation data and is never loaded by the normal CLI path.

- [ ] Record 15 web references from at least eight products with direct URLs, date observed, screen studied, transferable pattern, non-transferable pattern, and LocalCode decision. Use official OpenCode, Claude Code, Codex, Gemini CLI, Raycast, Linear, Warp, Zed, Yazi, Lazygit, Superfile, K9s and OpenTUI sources collected during research.
- [ ] Write the baseline scorecard from the observed 80/100/120/160/200 frames and the real PTY journey. Keep every score under 8 tied to evidence and mark unsupported claims `NO VERIFICABLE`.
- [ ] Add fixture data for empty conversation, active conversation, tools, model list, provider error, settings, sessions and diff without placing fake data in `src/tui/app.tsx`.
- [ ] Add a capture command that renders source components with `testRender`, writes plain-text frames under `docs/ui-v3/baseline/` or `docs/ui-v3/concepts/`, and destroys every renderer in `finally`.
- [ ] Run `bun run typecheck` and a focused capture test; expected result is deterministic frames at 80x24, 120x40 and 160x50.

### Task 2: Consolidate tokens, layout priorities and semantic primitives

**Files:**

- Modify: `src/tui/theme/tokens.ts`
- Modify: `src/tui/state/layout.ts`
- Modify: `src/tui/components/primitives.tsx`
- Create: `src/tui/components/StatusMark.tsx`
- Create: `src/tui/components/WorkspaceHeader.tsx`
- Create: `src/tui/components/SelectableRow.tsx`
- Create: `src/tui/components/ProgressBar.tsx`
- Test: `tests/unit/tui-v3-foundation.test.ts`

**Interfaces:**

- `getLayoutProfile(width: number): LayoutProfile` returns `conversation`, `workspace`, `overlayWidth`, `composerRows`, and `showOptionalHints` without sidebar/inspector reservation.
- `StatusMark` accepts `{state, label, detail?, theme}` and always emits a textual state.
- `SelectableRow` accepts `{selected, focused, title, subtitle?, trailing?, onActivate?}` and exposes focus through marker/text as well as color.

- [ ] Replace scattered layout assumptions with explicit priority fields for 80, 100, 120, 160 and 200 columns; ensure the conversation content gets all remaining width.
- [ ] Keep exact canvas/accent tokens and add semantic role helpers for selected, focus, disabled, local, free, paid, error, warning and success.
- [ ] Add ASCII-safe glyph fallbacks and ensure `NO_COLOR` retains selection markers, labels and status words.
- [ ] Add focused rows, section labels, muted metadata, a compact horizontal meter and a workspace header using one border language.
- [ ] Add unit tests for breakpoints, no-color token behavior, status words and layout invariants.

### Task 3: Rebuild the shell around conversation-first navigation

**Files:**

- Modify: `src/tui/app.tsx`
- Modify: `src/tui/launch.tsx`
- Modify: `src/tui/components/TopBar.tsx`
- Modify: `src/tui/components/StatusBar.tsx`
- Remove from default composition: `src/tui/components/Navigation.tsx` sidebar/inspector usage
- Test: `tests/integration/tui.test.tsx`

**Interfaces:**

- `ShellState` contains `screen`, `overlays`, `focus`, `notice`, `activeTask`, `route`, `model`, `privacy` and `dimensions`.
- `openWorkspace(screen: CenterScreen): void`, `closeWorkspace(): void`, `pushOverlay(overlay: Overlay): void`, and `popOverlay(): void` are the only shell navigation transitions.

- [ ] Extract app orchestration helpers so domain loading remains in `AppShell` but rendering is delegated to shell/workspace components.
- [ ] Remove permanent sidebar and inspector rendering at every width; retain explicit command-driven drawer/overlay only when requested.
- [ ] Render a quiet top line with actual working-directory label/branch when available and intentional truncation at narrow widths.
- [ ] Render the composer directly above a compact footer; reserve rows for conversation, current task, route/model, privacy and errors before optional hints.
- [ ] Make Escape close the highest overlay, then return from a center, then clear/cancel according to active focus; keep Ctrl+C cancel/exit semantics.
- [ ] Add frame assertions that no default width contains both `WORKSPACE` navigation and `INSPECTOR` labels, while the shell still contains `LocalCode`, composer and privacy state.

### Task 4: Rebuild conversation, composer and activity presentation

**Files:**

- Modify: `src/tui/components/Transcript.tsx`
- Modify: `src/tui/components/Composer.tsx`
- Create: `src/tui/components/ActivityGroup.tsx`
- Create: `src/tui/components/RouteEvent.tsx`
- Create: `src/tui/components/ApprovalDialog.tsx`
- Create: `src/tui/state/conversation.ts`
- Test: `tests/integration/tui-conversation.test.tsx`

**Interfaces:**

- `ConversationMessage` distinguishes `user`, `assistant`, `activity`, `route`, `approval`, `error` and `verification` with typed fields.
- `ActivityGroup` accepts `{items, expanded, onToggle, theme}` and renders a compact summary row plus details only when expanded.
- `Composer` emits `onInput`, `onSubmit`, `onCancel` and `onReferenceRequest` only for backed behavior; visible hints include Enter, Shift+Enter and Escape.

- [ ] Render transcript as an editorial document with labels, indentation, Markdown and restrained separators instead of chat bubbles.
- [ ] Group repeated tool events by phase/tool and render duration, count, result and textual state; Enter toggles details.
- [ ] Preserve incremental Markdown streaming and implement sticky-bottom/new-activity semantics without layout jumps.
- [ ] Make the composer the strongest interactive region: multiline text, focused cursor, subtle active surface, mode/route chips, paste, slash completion and backed `@` context affordance.
- [ ] Add approval/error/route rows with action, target, risk, consequence and clear safe/destructive labels.
- [ ] Test type, paste, submit, Shift+Enter, Escape, cancellation, grouped activity expansion, streaming updates and no-color output.

### Task 5: Make the command palette and model picker first-class

**Files:**

- Modify: `src/tui/commands/registry.ts`
- Modify: `src/tui/commands/keybindings.ts`
- Modify: `src/tui/components/CommandPalette.tsx`
- Create: `src/tui/components/ModelPicker.tsx`
- Create: `src/tui/state/search.ts`
- Test: `tests/unit/tui-search.test.ts`
- Test: `tests/integration/tui-navigation.test.tsx`

**Interfaces:**

- `rankCommands(commands, query, recentIds): UICommand[]` returns stable fuzzy-ranked results with category and shortcut metadata.
- `ModelPickerProps` receives live `ModelCenterData`, `activeModelId`, `query`, `selectedIndex`, `onSelect`, `onClose`.

- [ ] Replace substring-only command filtering with stable fuzzy scoring across label, slash, description and keywords, preserving category order for ties.
- [ ] Render palette as a focused modal with search, recent actions, category headers, selected-row treatment, descriptions, shortcuts and empty/error states.
- [ ] Ensure slash autocomplete and Ctrl+P use the same registry and share keyboard navigation/close behavior.
- [ ] Add model picker sections `Auto`, `Recent`, `Local`, `Free Cloud`; show model primary, provider secondary, capability/privacy/health text and explicit active state.
- [ ] Add keyboard tests for open/search/up/down/Enter/Escape and model selection without claiming selection persistence unless a backed service exists.

### Task 6: Rebuild live workspaces as focused list/detail views

**Files:**

- Modify: `src/tui/views/Centers.tsx` or split into focused files under `src/tui/views/`
- Create: `src/tui/views/ModelsWorkspace.tsx`
- Create: `src/tui/views/ProvidersWorkspace.tsx`
- Create: `src/tui/views/RoutingWorkspace.tsx`
- Create: `src/tui/views/SettingsWorkspace.tsx`
- Create: `src/tui/views/SessionsWorkspace.tsx`
- Create: `src/tui/views/ChangesWorkspace.tsx`
- Create: `src/tui/views/workspace-types.ts`
- Test: `tests/integration/tui-workspaces.test.tsx`

**Interfaces:**

- `WorkspaceRow` has `id`, `title`, `subtitle?`, `status?`, `trailing?`, `detail?`, `enabled?`.
- `SettingsWorkspace` accepts only a typed list of settings with `get`, `set`, `options` and `persist` callbacks backed by existing control-plane/config services.
- `ChangesWorkspace` accepts parsed file patches and creates one OpenTUI Diff per selected file; empty state is backed by the current Git result.

- [ ] Replace raw `string[]` center rendering with semantic rows and details while preserving the current control-plane calls.
- [ ] Make Models selectable/searchable and show active model, local/free grouping, health, fit, context, privacy and quota details.
- [ ] Make Providers a list/detail surface with configuration, health, freshness, quota and privacy explanation; never imply eligibility from a credential alone.
- [ ] Render Routing as a readable gate sequence and selected/rejected route explanation; add compact inline route events in conversation.
- [ ] Make Settings searchable and keyboard navigable; persist only real settings and show immediate confirmation or an actionable failure.
- [ ] Make Sessions searchable from existing SQLite records, with honest empty state when there are no records.
- [ ] Make Changes navigable by file and render the selected patch with OpenTUI Diff in unified/split based on width; keep review actions limited to backed operations.
- [ ] Add workspace tests at 80/100/120/160/200 widths and verify no clipped primary labels in captures.

### Task 7: Implement deterministic fixture mode and baseline/concept captures

**Files:**

- Modify: `src/tui/app.tsx`
- Create: `src/tui/fixtures/UiFixture.tsx`
- Create: `src/tui/fixtures/shell-concepts.tsx`
- Create: `tests/ui/fixtures/shell-concepts.test.tsx`
- Create: `docs/ui-v3/SHELL-DECISION.md`
- Create: `docs/ui-v3/DESIGN-SYSTEM.md`
- Create: `docs/ui-v3/RESPONSIVE.md`

**Interfaces:**

- `readUiFixture(env: NodeJS.ProcessEnv): UiFixtureName | undefined` recognizes only test/capture values and returns `undefined` in normal operation.
- `ShellConcept` renders realistic fixture content for `minimal-canvas`, `context-ribbon` and `adaptive-edge`.

- [ ] Render all three concepts at 80x24, 120x40 and 160x50 using realistic conversation/tool/composer content.
- [ ] Review the three frames independently and document the chosen Minimal Canvas decision with evidence, not preference language.
- [ ] Document actual tokens, spacing, border language, glyphs, responsive priorities, motion and component states in `DESIGN-SYSTEM.md`.
- [ ] Document the responsive matrix and fixture-only environment variables in `RESPONSIVE.md`.
- [ ] Keep fixture mode off the normal launcher path and ensure no fixture data reaches live control-plane views.

### Task 8: Run QA and three genuine refinement passes

**Files:**

- Create: `docs/ui-v3/PASS-1-REVIEW.md`
- Create: `docs/ui-v3/PASS-2-REVIEW.md`
- Create: `docs/ui-v3/PASS-3-REVIEW.md`
- Create: `docs/ui-v3/COMMANDS.md`
- Create: `docs/ui-v3/SETTINGS.md`
- Create: `docs/ui-v3/FINAL-AUDIT.md`
- Modify: `docs/ui-v3/BEFORE-AFTER.md`
- Modify: `docs/STATUS.md`
- Modify: `docs/TUI.md`

**Interfaces:**

- `scripts/capture-ui.ts` emits named captures under `docs/ui-v3/final/`.
- `docs/ui-v3/FINAL-AUDIT.md` records baseline, rebuild, pass 1, pass 2, pass 3 and final scores with observed evidence.

- [ ] Run focused formatting, typecheck, unit and workspace tests, then full `bun test`.
- [ ] Exercise the real source and rebuilt bundle through PTY: start, type, send, stream/cancel where provider permits, palette, model picker, Models, Providers, Routing, Settings, Sessions, Diff, error/approval and exit.
- [ ] Capture 80x24, 100x30, 120x40, 160x50 and 200x60 plus `NO_COLOR`; inspect every primary screen and record clipping/overflow.
- [ ] Pass 1: fix all P0/P1 structural and interaction findings, then regenerate captures and rerun tests.
- [ ] Pass 2: research any weak interaction again, fix hierarchy/spacing/focus/empty/error states, then regenerate captures and rerun tests.
- [ ] Pass 3: red-team the complete capture set, fix remaining amateur inconsistencies, then regenerate captures and rerun tests.
- [ ] Document actual commands, settings and remaining limitations. Do not report PASS or a score above the observed evidence.
