# LocalCode UI V4 implementation plan

> Design contract: `docs/ui-v4/CORE-CONCEPT.md`

## Goal

Replace the rejected core Home/Chat presentation with the selected compact-timeline experience while preserving routing, hardware, catalog, quota, storage, and provider business logic. Correct the event boundary so structured tool calls and route decisions become deliberate transcript view models.

## Task 1: Lock responsive geometry and root layout

Files:

- Modify `src/tui/state/layout.ts`
- Modify `src/tui/app.tsx`
- Modify `src/tui/components/TopBar.tsx`
- Modify `src/tui/components/StatusBar.tsx`
- Add focused layout tests under `tests/unit/` and `tests/integration/`

Steps:

1. Add failing tests for the requested width breakpoints and invariants: shared x/width, in-bounds content, non-overlap, and status width.
2. Implement one pure responsive geometry function.
3. Rebuild the core root as Header / flexible viewport / intrinsic composer / one-row status.
4. Remove the conversation-workspace label, transcript instruction line, duplicate state, arbitrary wide offsets, and unrelated width calculations.
5. Render and inspect Stage A at 80×24, 100×30, 120×40, 140×45, 160×50, and 200×60 before continuing.

## Task 2: Introduce the presentation model

Files:

- Add `src/tui/presentation/types.ts`
- Add `src/tui/presentation/adapter.ts`
- Modify `src/shared/events.ts`
- Modify `src/agent/types.ts`
- Modify `src/agent/loop.ts`
- Replace the old transcript-message reducer/tests

Steps:

1. Add failing reducer tests for a single assistant turn containing prose, tool start, tool completion, more prose, tests, and completion.
2. Define discriminated transcript items and `ToolActivityViewModel` fields for kind, label, target, state, duration, summary, details, and risk.
3. Add stable turn and tool-call identifiers to presentation-facing agent events.
4. Update started activities in place when their completion arrives; do not append duplicate tool rows.
5. Keep raw domain objects and route score breakdowns outside transcript components.

## Task 3: Repair provider/agent tool-call continuity

Files:

- Modify `src/providers/types.ts`
- Modify `src/providers/openai-compatible.ts`
- Modify `src/agent/loop.ts`
- Modify `docs/RESEARCH-SNAPSHOT.md`
- Extend provider contract and agent-loop tests

Steps:

1. Verify official current tool-calling message contracts for every executable OpenAI-compatible path and record the research snapshot.
2. Add failing tests proving assistant tool calls are carried into the next provider request with their IDs.
3. Preserve native structured `tool_calls` in normalized assistant messages.
4. Add strict, schema-validated text recovery at the agent boundary only for a complete tool envelope emitted as text. Buffer a possible envelope so it cannot stream into the UI; do not use visual regex or presentation-layer filtering.
5. Prove local generic, LM Studio, llama.cpp, Groq, and OpenRouter adapters normalize the same contract. Document that Ollama remains discovery-only unless a current executable adapter exists.

## Task 4: Build Home, transcript, composer, and streaming behavior

Files:

- Replace core behavior in `src/tui/components/Transcript.tsx`
- Replace core behavior in `src/tui/components/Composer.tsx`
- Modify the Home branch in `src/tui/app.tsx`
- Add focused renderer/interaction tests

Steps:

1. Add failing tests for Home suggestions, editor submission/newline, adaptive height, focus, and `NO_COLOR` focus indication.
2. Implement the selected compact-timeline hierarchy with one assistant heading per turn.
3. Make contextual Home suggestions full-row keyboard and mouse targets.
4. Use native sticky-scroll semantics, detect when the user leaves the bottom, and display an actionable `New activity` affordance without forcing the viewport.
5. Preserve composer focus and scroll anchor through resize.
6. Capture and review Stage B before tool rendering.

## Task 5: Build structured activity, tests, route, error, and completion views

Files:

- Replace `src/tui/components/ActivityGroup.tsx`
- Add small presentation components only where they have current consumers
- Extend fixtures and focused tests

Steps:

1. Add failing tests for tool start/update, grouping, expansion, failure details, compact shell output, file changes, test pass/fail, local/free route, route change, error recovery, plan, and completion.
2. Implement neutral tree/timeline connectors with violet only on the active item.
3. Collapse output by default; reveal useful error lines automatically and full details only by explicit expansion.
4. Render local routes without quota, billing, score, provider-selection, or cost-gate language.
5. Capture and review Stages C and D separately.

## Task 6: Repair core overlays

Files:

- Modify `src/tui/components/CommandPalette.tsx`
- Modify `src/tui/components/ModelPicker.tsx`
- Modify `src/tui/components/ApprovalDialog.tsx`
- Add a focused context picker component and tests
- Modify overlay coordination in `src/tui/app.tsx`

Steps:

1. Add failing tests for open, close, filter, navigation, Enter, Escape, shortcut text, mouse selection, focus ownership, and focus restoration.
2. Center overlays with bounded width and height relative to the terminal.
3. Implement a searchable workspace context picker using plain file names and paths.
4. Make Escape deny/close approvals safely and return focus to the composer.
5. Capture and review Stage E.

## Task 7: Complete fixtures, captures, and three red-team passes

Files:

- Replace/extend `src/tui/state/fixtures.ts`
- Modify `scripts/capture-ui.ts`
- Create the required `docs/ui-v4/after/` captures
- Complete `docs/ui-v4/PASS-1.md`, `PASS-2.md`, and `PASS-3.md`

Steps:

1. Add every requested deterministic fixture state with realistic content.
2. Capture all 20 named final states and all target resolutions, including `NO_COLOR` frames.
3. Run a fresh functional red team; fix major findings.
4. Run a fresh layout/hierarchy red team; fix major findings.
5. Run a fresh public-launch visual red team; fix major findings and repeat research if quality is below 9/10.

## Task 8: Release evidence

Files:

- Complete `docs/ui-v4/LAYOUT.md`, `EVENT-PRESENTATION.md`, `STREAMING.md`, and `FINAL.md`

Steps:

1. Run formatting, typecheck, focused tests, full tests, fixture E2E, privacy E2E, strict-zero E2E, doctor smoke, TUI smoke, and clean-install/build checks that do not require paid inference.
2. Build the current distributable and record its hash.
3. Launch the built artifact through a PTY and exercise keyboard input, cancellation, overlays, scroll, resize, and terminal restoration.
4. Exercise the real local agent path only when a connected local runtime is available; never substitute a fixture for this claim.
5. Report unresolved external/runtime gaps as unverified and set RELEASE to FAIL if any hard blocker remains.
