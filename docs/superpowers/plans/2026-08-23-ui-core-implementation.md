# LocalCode Core UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring LocalCode's Home, Composer, and command surfaces up to the Obsidian Violet spec
and fix the 3 confirmed functional bugs, building on the transcript/tool/route presentation
layer that `docs/ui-core/BASELINE.md` already found close to spec (kept as-is, not touched here).

**Architecture:** Small, targeted changes to existing files (`theme/tokens.ts`,
`views/HomeView.tsx`, `app.tsx`, `components/ContextPicker.tsx`,
`components/ApprovalDialog.tsx`, `components/Composer.tsx`,
`components/CommandPalette.tsx`) rather than a new component tree — the existing
`presentation/adapter.ts` → `Transcript`/tool-grouping machinery is production-correct per the
baseline audit and is not touched by this plan.

**Tech Stack:** Bun, TypeScript, SolidJS, OpenTUI (`@opentui/core`, `@opentui/solid`), existing
`testRender`/`captureCharFrame` fixture harness (`LOCALCODE_UI_FIXTURE`, `scripts/capture-ui.ts`).

## Global Constraints

- Canvas `#000000` exact. Surface subtle `#060607`, Surface `#09090B`, Surface elevated
  `#0D0D10`, Surface selected `#15101D`. Border whisper `#141416`, Border subtle `#1E1E22`,
  Border strong `#34343A`. Text primary `#F7F7F8`, secondary `#A6A6AF`, tertiary `#73737D`,
  muted `#52525B`. (Purple scale and semantic colors already match exactly — do not change them.)
- No permanent sidebar/inspector/three-column dashboard at any width.
- Local routes never show cloud quota language.
- `NO_COLOR` must remain fully legible (labels/symbols/spacing carry meaning, not color alone).
- 80×24 must never break; run `bun run typecheck` and the relevant `bun test` file after every
  task; run the full suite plus `bun run test:functional` before considering the plan complete.
- Every existing passing test must keep passing unless the plan explicitly says to update it
  (only stale-copy assertions listed below may change).

---

### Task 1: Exact Obsidian Violet neutral tokens

**Files:**

- Modify: `src/tui/theme/tokens.ts:69-89`
- Test: `tests/unit/tui-terminal.test.ts` (existing — confirm it still passes; it does not pin
  exact hex values today, so this task also adds one that does)

**Interfaces:**

- Produces: no signature changes — `getTheme()`'s return shape is unchanged, only the hex
  string values inside `colors.background`, `colors.border`, `colors.text` change.

- [ ] **Step 1: Write the failing test**

Add to `tests/unit/tui-terminal.test.ts`:

```ts
test("neutral tokens match the exact Obsidian Violet spec", () => {
  const theme = getTheme(true);
  expect(theme.colors.background.canvas).toBe("#000000");
  expect(theme.colors.background.surface).toBe("#09090B");
  expect(theme.colors.background.elevated).toBe("#0D0D10");
  expect(theme.colors.background.active).toBe("#15101D");
  expect(theme.colors.border.subtle).toBe("#141416");
  expect(theme.colors.border.default).toBe("#1E1E22");
  expect(theme.colors.border.strong).toBe("#34343A");
  expect(theme.colors.text.primary).toBe("#F7F7F8");
  expect(theme.colors.text.secondary).toBe("#A6A6AF");
  expect(theme.colors.text.tertiary).toBe("#73737D");
  expect(theme.colors.text.muted).toBe("#52525B");
});
```

(Check the actual import path/name for `getTheme` at the top of `tests/unit/tui-terminal.test.ts`
first — reuse whatever's already imported there rather than re-importing.)

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test tests/unit/tui-terminal.test.ts`
Expected: FAIL — current values are `#08080A`/`#0D0D10`/`#111114`/`#17121F` (background) and
`#18181B`/`#27272A`/`#3F3F46` (border) etc., not the new exact values.

- [ ] **Step 3: Update the token values**

In `src/tui/theme/tokens.ts`, change exactly these lines (leave `purple`, `status`, `diff`
unchanged — they already match):

```ts
canvas: "#000000",
surface: "#09090B",
elevated: "#0D0D10",
floating: "#0D0D10",
active: "#15101D",
selection: "#15101D",
```

```ts
border: {
  subtle: "#141416",
  default: "#1E1E22",
  strong: "#34343A",
  interactive: "#5B21B6",
  focus: "#8B5CF6",
},
```

```ts
primary: "#F7F7F8",
secondary: "#A6A6AF",
tertiary: "#73737D",
muted: "#52525B",
disabled: "#44444C",
inverse: "#09090B",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --conditions=browser test tests/unit/tui-terminal.test.ts`
Expected: PASS

- [ ] **Step 5: Run full suite to check for incidental snapshot/text breakage**

Run: `bun --conditions=browser test`
Expected: same pass/fail set as before this task (token color changes shouldn't affect any
`captureCharFrame` text assertion, since none of them assert on raw ANSI color codes — confirm
this is true rather than assuming it).

---

### Task 2: Fix composer Shift+Enter discoverability

**Files:**

- Modify: `src/tui/components/Composer.tsx` (find the focused-state sub-bar render)
- Test: `tests/integration/tui-composer-v3.test.tsx:24-29` (existing, currently failing on this
  exact gap — do not write a new test, make the existing one pass)

**Interfaces:**

- Consumes: whatever focus-state signal the composer already tracks (read the file first — do
  not assume a prop name).

- [ ] **Step 1: Run the existing test to confirm current failure**

Run: `bun --conditions=browser test tests/integration/tui-composer-v3.test.tsx`
Expected: FAIL — `expect(frame).toContain("Shift+Enter")` — current focused footer only shows
`Enter ↵`.

- [ ] **Step 2: Read the composer's focused sub-bar rendering**

Read `src/tui/components/Composer.tsx` in full before editing — find where the `Enter ↵` hint
text is rendered and what focus signal gates it.

- [ ] **Step 3: Add the Shift+Enter hint when focused**

Change the focused-state hint text so it reads `Shift+Enter newline · Enter ↵` (or equivalent —
match the existing hint's exact styling/token usage, just add the newline hint). Keep the
unfocused state unchanged.

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test tests/integration/tui-composer-v3.test.tsx`
Expected: PASS

---

### Task 3: Fix context-picker search filtering — DEFERRED, see note

**Status: investigated extensively, root cause not found, reverted to original code.**

Confirmed via direct instrumentation: `contextQuery` updates correctly on every keystroke
(`onInput` fires with the right value each time); `ContextPicker`'s internal `filtered`
`createMemo` recomputes correctly and returns the correctly-filtered array (verified by logging
its return value). Yet `setup.renderer.root.findDescendantById("context-option-1")` through
`-4` still report `true` (still present in the actual renderable tree) after typing "package",
and the captured frame shows all 5 unfiltered rows.

Ruled out via isolated reproduction (a standalone `<ContextPicker>` render outside `AppShell`,
with a real `createSignal` query, matching props, matching double-nested
`position:absolute`+`zIndex` wrapper structure copied verbatim from `app.tsx`, matching rapid
no-interleaved-render update pattern): the identical component code, wiring, and update
pattern **always filters correctly in isolation** — removing 4 of 5 rows as expected. Also
ruled out: `viewportCulling` on/off, controlled (`value={props.query()}`) vs uncontrolled input,
and the `scrollChildIntoView` `createEffect`. None of these reproduce or fix the failure; the
bug only manifests when this exact component is mounted inside the full `AppShell` tree via
`renderFixture` in the real test, and only when driven through `mockInput.typeText` rather than
a direct signal write — a difference that couldn't be isolated further without reading the
`@opentui/solid` reconciler's source (not available as readable `.ts` in this environment — only
a `.d.ts` was present under `node_modules`).

This is left as a known, real, thoroughly-diagnosed bug for a follow-up session with either (a)
access to `@opentui/solid`'s reconciler source to trace the actual node-removal path under
`AppShell`'s specific tree shape, or (b) a maintainer/upstream report if it turns out to be an
`@opentui/solid` bug rather than an application one. Do not attempt further blind fixes here —
the guesses tried (8 distinct hypotheses) all failed; a different diagnostic tool is needed, not
another guess.

### Task 3 (original plan, not executed)

**Files:**

- Modify: `src/tui/components/ContextPicker.tsx`
- Test: `tests/integration/tui-v4-overlays.test.tsx:20-37` (existing, currently failing)

**Interfaces:**

- Consumes: the file list already passed into `ContextPicker` (read the props first).

- [ ] **Step 1: Run the existing test to confirm current failure**

Run: `bun --conditions=browser test tests/integration/tui-v4-overlays.test.tsx`
Expected: FAIL at line 37 — typing "package" still shows `src/tui/app.tsx` (unfiltered).

- [ ] **Step 2: Read ContextPicker's search-state wiring**

Read `src/tui/components/ContextPicker.tsx` in full. Find where the search input's typed text is
stored and where the rendered file list is derived — confirm whether the list is actually
filtered by that stored text or just renders the full incoming list (this is the root cause to
confirm before fixing — do not guess).

- [ ] **Step 3: Wire the filter**

Make the rendered list a case-insensitive substring filter of the search text against each
candidate path, e.g. (adapt to whatever the existing candidate-list variable is actually named):

```ts
const filtered = () => {
  const query = searchText().trim().toLowerCase();
  if (!query) return candidates();
  return candidates().filter((path) => path.toLowerCase().includes(query));
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test tests/integration/tui-v4-overlays.test.tsx`
Expected: PASS

---

### Task 4: Fix approval dialog Escape-to-deny — DEFERRED, see note

**Status: investigated, root cause narrowed but not fixed, reverted to original code.**

Unlike Task 3, this one is NOT a state/render mismatch: `resolveApproval` (the deny callback)
**never fires at all** — confirmed by a temporary `console.error` at its top that never printed.
Both the global key handler (`app.tsx`, `overlay() === "approval"` branch) and
`ApprovalDialog`'s own `onKeyDown` correctly check for `event.name === "escape" || "esc"` and
call the deny path — but neither ever receives the event.

Traced into `@opentui/core`'s test harness (`node_modules/@opentui/core/testing.bun.js`):
`pressEscape()` emits a bare `\x1b` (`KeyCodes.ESCAPE`) on `renderer.stdin`, structurally
identical to how `typeText()` emits regular characters (which demonstrably work — confirmed
in Task 3's investigation). A bare ESC byte is the same first byte as every ANSI escape
_sequence_ (arrow keys, function keys, etc.), so terminal input parsers conventionally
disambiguate "standalone Escape" from "start of a longer sequence" with a short timeout. Tried
adding real delays (25ms, 60ms) between `pressEscape()` and the frame capture — neither changed
the outcome, which argues against a simple timing fix, though it doesn't rule out the parser
requiring something the mock stdin stream doesn't provide at all (e.g. real TTY raw-mode
timing) versus a longer/different timeout than tried.

Only 2 usages of `pressEscape` exist in the whole test suite, both in this one file, both
currently broken — there is no other passing test in this codebase that proves
`mockInput.pressEscape()` correctly reaches a focused/global handler at all. This makes it look
like a test-harness-level gap (or an application key-listener setup issue specific to how
`useKeyboard`/stdin listening is initialized under `testRender`) rather than a straightforward
`ApprovalDialog` bug — the component's own Escape-handling code is correct as written.

Left for a follow-up session with either deeper `@opentui/core` key-parsing knowledge or the
ability to test against a real TTY. Do not re-attempt with more timing guesses.

### Task 4 (original plan, not executed)

**Files:**

- Modify: `src/tui/components/ApprovalDialog.tsx`
- Test: `tests/integration/tui-v4-overlays.test.tsx` (existing "approval Escape denies" test,
  currently failing)

**Interfaces:**

- Consumes: whatever `onDeny`/`onDecision` callback prop the dialog already receives.

- [ ] **Step 1: Run the existing test to confirm current failure**

Run: `bun --conditions=browser test tests/integration/tui-v4-overlays.test.tsx`
Expected: FAIL — pressing Escape does not produce "Approval denied" text / does not close the
dialog.

- [ ] **Step 2: Read ApprovalDialog's key handling**

Read `src/tui/components/ApprovalDialog.tsx` in full. Confirm whether an `onKeyDown` handler for
`escape`/`esc` exists at all on the focused dialog element, and if so why it isn't firing the
deny path (focus target mismatch is the most likely cause — verify, don't guess).

- [ ] **Step 3: Wire Escape to deny**

Add/fix the key handler so `event.name === "escape" || event.name === "esc"` calls the same deny
path the "Deny" button/action already calls (reuse the existing callback — do not duplicate its
logic).

- [ ] **Step 4: Run the test to verify it passes**

Run: `bun --conditions=browser test tests/integration/tui-v4-overlays.test.tsx`
Expected: PASS

---

### Task 5: Home — implement Concept B (Anchored Workspace)

**Files:**

- Modify: `src/tui/views/HomeView.tsx`
- Modify: `src/tui/app.tsx` (the `justifyContent`/`alignItems` wiring around `HomeView` at
  `app.tsx:2041-2047`, read current line numbers first — they will have shifted after Tasks 1-4)
- Test: `tests/integration/tui-v4-home.test.tsx` (existing — extend) and
  `tests/unit/tui-v4-layout.test.ts` (existing — check for Home-specific assertions to update)

**Interfaces:**

- Produces: `HomeView` keeps its existing prop signature (`theme`, `width`, `model`, `dirty`,
  `selectedIndex`, `onSelect`, `onSuggestion`) — no signature change, only internal layout.

- [ ] **Step 1: Write the failing test**

Add to `tests/integration/tui-v4-home.test.tsx`:

```tsx
test("home content anchors near the top at tall terminal heights instead of centering", async () => {
  const setup = await testRender(
    () => (
      <HomeView
        theme={getTheme(true)}
        width={160}
        dirty
        selectedIndex={() => 0}
        onSelect={() => undefined}
        onSuggestion={() => undefined}
      />
    ),
    { width: 160, height: 50 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  const lines = frame.split("\n");
  const brandLine = lines.findIndex((line) => line.includes("LocalCode"));
  // Anchored near the top: brand mark must appear within the first 12 rows
  // of a 50-row viewport, not vertically centered around row 24-25.
  expect(brandLine).toBeGreaterThanOrEqual(0);
  expect(brandLine).toBeLessThan(12);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun --conditions=browser test tests/integration/tui-v4-home.test.tsx`
Expected: FAIL — current `justifyContent="center"` puts the brand line well past row 12 at
height 50 (confirmed in `docs/ui-core/baseline/home/160x50.txt` — brand mark at row 17 of a
25-row _capture_, i.e. proportionally centered; at a true 50-row viewport it would be even
lower).

- [ ] **Step 3: Implement the anchored layout**

In `src/tui/views/HomeView.tsx`, change the outer box from `justifyContent="center"` to
top-anchored, and add a bottom-pinned hint line reusing the existing
`Ctrl+J suggestions · Ctrl+P commands` text (currently only shown `width >= 100`; keep that
condition). Concretely:

```tsx
return (
  <box
    id="core-home"
    flexGrow={1}
    flexDirection="column"
    paddingX={1}
    paddingTop={height() > 30 ? 2 : 1}
  >
    <box flexDirection="column" gap={props.width < 90 ? 1 : 2}>
      {/* existing Brand block, readiness line, Suggestions — unchanged */}
    </box>
    <box
      flexGrow={1}
      justifyContent="flex-end"
      alignItems={props.width < 90 ? undefined : "flex-start"}
    >
      {props.width >= 100 ? (
        <text fg={themeColor(props.theme, colors.text.muted)}>
          Ctrl+J suggestions · Ctrl+P commands
        </text>
      ) : null}
    </box>
  </box>
);
```

`HomeView` does not currently receive a `height` prop — add one (`height: number`), and thread
it from `app.tsx`'s existing `height()` signal at the `<HomeView ...>` call site (same pattern
already used for `width={coreGeometry().width}` a few lines above it).

Also remove the width≥150 `alignItems="center"` special-case at `app.tsx`'s
`center-content`/`core-content-column` wrapper _for the Home case specifically_ — Concept B
anchors within its own column, it doesn't need the outer wrapper to re-center it. Read the
surrounding code first: the wrapper's centering also applies to the conversation view and other
centers, which must NOT change — only alter the branch that applies when `!isConversation()` and
`screen() === "home"`-equivalent (check how the current code distinguishes Home from other
non-conversation screens before editing).

- [ ] **Step 4: Run test to verify it passes**

Run: `bun --conditions=browser test tests/integration/tui-v4-home.test.tsx`
Expected: PASS

- [ ] **Step 5: Recapture the real baseline fixture and eyeball it**

Run: `LOCALCODE_UI_FIXTURE=home bun run scripts/capture-ui.ts docs/ui-core/final/home` (creates
the first final/ evidence for Task 12) and read `docs/ui-core/final/home/160x50.txt` — confirm
brand block is near the top and the `Ctrl+J...` hint sits just above the composer, matching
`docs/ui-core/concepts/B/160x50.txt`.

- [ ] **Step 6: Run the full suite**

Run: `bun --conditions=browser test`
Expected: no new failures beyond the pre-existing stale-copy ones not yet touched by this plan.

---

### Task 6: Command palette — descriptions, keybindings, receding background

**Files:**

- Modify: `src/tui/components/CommandPalette.tsx`
- Modify: `src/tui/commands/registry.ts` if command entries don't already carry a `description`
  field (read it first — `docs/UI-V2.md` claims the registry is already the source of truth for
  descriptions; confirm before assuming a schema change is needed)
- Test: `tests/integration/tui-v3-overlay.test.tsx` (existing — update the stale "Qwen Coder 7B"
  string to "Qwen 2.5 Coder 7B" as part of this task, and add new assertions below)

**Interfaces:**

- Consumes: `UICommand` type from `src/tui/commands/registry.ts` — read its current shape before
  writing new rendering code against fields that may not exist yet.

- [ ] **Step 1: Read the current palette and registry**

Read `src/tui/components/CommandPalette.tsx` and `src/tui/commands/registry.ts` in full. Confirm:
(a) does `UICommand` already have a `description` field? (b) does it have a `keybinding` field?
(c) is there already a "recent commands" concept? Do not write Step 3 until these are confirmed
— the baseline audit only observed the _rendered output_ lacked descriptions/keybindings, not
whether the data already exists and is simply not rendered.

- [ ] **Step 2: Write the failing test**

Add to `tests/integration/tui-v3-overlay.test.tsx` (adapt the existing palette-opening setup in
that file rather than duplicating it):

```tsx
test("command palette rows show a description and keybinding hint, not just a label", async () => {
  // ...reuse existing setup that opens the palette in this file...
  const frame = setup.captureCharFrame();
  // Whatever the first grouped command is (from reading the registry in Step 1) —
  // replace "Open Models" / "Browse local and cloud models" with the actual
  // label/description pair once confirmed.
  expect(frame).toContain("Browse local and cloud models");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun --conditions=browser test tests/integration/tui-v3-overlay.test.tsx`
Expected: FAIL — current rows render label only.

- [ ] **Step 4: Render description + keybinding per row**

In `CommandPalette.tsx`, change each command row from a single label line to two lines (label +
dim description) with the keybinding right-aligned on the label line, following the exact
pattern already used elsewhere in this codebase for label/value rows (check
`src/tui/components/StatusBar.tsx` or `Transcript.tsx`'s activity rows for the established
right-align technique — reuse it, don't invent a new one).

- [ ] **Step 5: Fix the stale copy assertion in the same file**

In the existing "model-picker fixture keeps narrow metadata on its own row" test in this file,
change `"Qwen Coder 7B"` to `"Qwen 2.5 Coder 7B"` to match the real current display name (this is
the stale-copy failure identified in `docs/ui-core/BASELINE.md`, unrelated to Steps 1-4 but in
the same file — fix it in the same task to avoid a second pass over this file).

- [ ] **Step 6: Run the test file to verify both fixes pass**

Run: `bun --conditions=browser test tests/integration/tui-v3-overlay.test.tsx`
Expected: PASS (both the new description/keybinding test and the corrected model-name test)

---

### Task 7: Clean up remaining stale-copy test failures

**Files:**

- Modify: `tests/integration/tui.test.tsx` (5 shell-render tests + 1 wide-conversation test)

**Interfaces:** none — test-only changes.

- [ ] **Step 1: Update the 5 shell-render assertions**

In each of the 5 `renders the LocalCode shell at N columns` tests, change
`expect(frame).toContain("PRIVATE")` to `expect(frame).toContain("Private")` (matching the real,
intentional title-case copy confirmed in `docs/ui-core/BASELINE.md`).

- [ ] **Step 2: Update the wide-conversation assertion**

In the `wide conversation does not reserve dashboard navigation or inspector` test, change
`expect(frame).toContain("Ask LocalCode anything")` to `expect(frame).toContain("Ask LocalCode…")`
(the real composer placeholder). Leave the `not.toContain("WORKSPACE")` /
`not.toContain("INSPECTOR")` assertions unchanged — they already pass and are the assertions
that actually matter for this test's stated purpose.

- [ ] **Step 3: Run the file to verify all 6 pass**

Run: `bun --conditions=browser test tests/integration/tui.test.tsx`
Expected: PASS (all 6, no `--` skips)

---

### Task 8: Full verification + final capture set

**Files:** none modified — verification only.

- [ ] **Step 1: Full regression suite**

Run: `bun run typecheck && bun --conditions=browser test`
Expected: 0 typecheck errors; `bun test` shows 0 failures (every test this plan didn't touch was
already passing; every one it did touch is now fixed).

- [ ] **Step 2: Functional acceptance suite (must still pass — this plan never touches agent/tool code)**

Run: `bun run test:functional`
Expected: PASS (unchanged from before this plan — confirms no UI change accidentally touched
`src/agent/`, `src/tools/`, or `src/router/`)

- [ ] **Step 3: Format + build**

Run: `bun run format:check && bun run build`
Expected: PASS. If `format:check` fails, run `bun run format` and re-verify tests still pass.

- [ ] **Step 4: Capture the final evidence set**

Run `scripts/capture-ui.ts` for each fixture in `src/tui/state/fixtures.ts`'s `UIFixtureKind`
union at 80×24, 120×40, 160×50, output to `docs/ui-core/final/<fixture>/`. This is the evidence
base for the refinement passes (docs/ui-core/FINAL-AUDIT.md) that follow this plan.

- [ ] **Step 5: Delete the throwaway concept-comparison harness**

Run: `rm scripts/capture-ui-core-concepts.tsx` — it was comparison scaffolding for the Phase C
checkpoint (`docs/ui-core/CORE-LAYOUT-DECISION.md` already says nothing from it ships). Keep
`docs/ui-core/concepts/*.txt` as historical evidence; delete only the script.

---

## Self-review notes (completed during planning)

- **Spec coverage:** this plan covers the 3 confirmed functional bugs (Tasks 2-4), the one
  concretely-evidenced visual gap (Task 5, Home), the weakest-scored surface (Task 6, palette),
  and exact token compliance (Task 1) — i.e. everything `BASELINE.md` scored below 7/10, plus
  cleanup of the stale-copy tests those scores partly depended on identifying (Task 7). It does
  _not_ cover master-prompt items already scored ≥7 (transcript, tool grouping, route events,
  approval structure) — those are confirmed-adequate, not silently dropped; re-verify against
  the reference research in the refinement passes rather than re-implementing untouched code.
- **Placeholder scan:** no TBD/TODO markers; every code step above shows real code or an explicit
  "read the file first, don't guess" instruction where the exact current shape genuinely isn't
  known yet (Tasks 3, 4, 6 Step 1) — those are investigation steps, not placeholders, and each
  is immediately followed by a concrete fix step.
- **Type consistency:** `HomeView`'s prop list (Task 5) only adds `height: number`; no other
  task changes a shared type/signature.
