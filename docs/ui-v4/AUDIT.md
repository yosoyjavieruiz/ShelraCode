# LocalCode UI V4 audit

## Evidence boundary

- Checkout: `main` at `4cc7ba7a3a017028c4b06703864493c5445220b9`.
- State before V4: 17 tracked modifications and 53 untracked paths. All are
  treated as user-owned work.
- Active source: `src/index.ts` -> `src/tui/launch.tsx` -> `AppShell` in
  `src/tui/app.tsx`.
- User-facing artifact: ignored `dist/index.js`, launched with
  `bun run dist/index.js --tui`.
- The pre-V4 bundle is stale relative to `src/tui/app.tsx` and
  `src/tui/launch.tsx`; it is baseline evidence only.
- The supplied defect list is accepted as screenshot evidence. No original
  raster/pixel dimensions were available in this session, so 160x50 and
  200x60 are the wide screenshot-equivalent baselines.

## Reproduction

The real pre-V4 bundle was launched in a PTY with
`LOCALCODE_UI_FIXTURE=conversation` at 80x24. It visibly reproduced:

- `Conversation workspace` above the transcript;
- a permanent transcript instruction row;
- repeated LocalCode/route/privacy/readiness labels;
- a bordered composer with permanent send/newline/clear instructions;
- overloaded footer text;
- the same log-like activity summary shown in the rejected screenshot.

Deterministic frames at 80x24, 100x30, 120x40, 160x50 and 200x60 are in
`docs/ui-v4/before/`. The 160x50 frame confirms the transcript and composer are
independently composed inside the wide shell rather than sharing an exported
content-column geometry contract.

## Proven root causes

### 1. No single content-layout owner

`src/tui/app.tsx:1711-1715` computes a general workspace width, while
`src/tui/app.tsx:1793-1800` separately caps the conversation at 112 columns and
`src/tui/app.tsx:1847-1852` separately computes composer width. Children still
receive the terminal width (`app.tsx:1820`, `1864`) instead of the actual
content width. Header and footer each apply their own padding/partition logic.

Result: alignment is incidental, not invariant. It can change at breakpoints
and child components wrap against a width different from their rendered box.

### 2. Raw domain strings are the transcript model

`TranscriptMessage` is `{role, text, detail, status}` and
`groupTranscriptMessages()` only groups consecutive `tool` strings. There is
no typed presentation model for a tool call, route, test, plan, file change,
approval or completion. `AppShell` converts events directly to strings at
`src/tui/app.tsx:791-825`.

Result: the component cannot reliably group an assistant turn, derive a tool
target, preserve call identity, summarize output, or distinguish initial route
selection from a route change.

### 3. Tool-shaped assistant JSON reaches presentation

The OpenAI-compatible adapter normalizes native `delta.tool_calls`, but any
tool protocol emitted inside `delta.content` becomes normal text. `runAgent`
streams that text immediately as `assistant.delta`; only native `tool.call`
events execute tools.

`safeAgentText()` in `src/tui/app.tsx:303-319` is a visual regex guard. It only
recognizes a leading object whose first key is `name`, `tool`, or `arguments`.
It misses `tool_calls`, arrays, fenced JSON and restored sessions, and it
violates the requested boundary by trying to hide the symptom in the TUI.

This is the P0 path. The repair must normalize a deliberately supported textual
tool envelope in the agent/provider boundary, preserve native structured tool
calls, and map the resulting typed event through a presentation adapter. The
production transcript must have no raw-JSON item type.

### 4. Native multi-turn tool context is incomplete

`NormalizedMessage` has no assistant `tool_calls` field. After native tool
calls, `runAgent` appends only an empty/text assistant message and then tool
results containing `toolCallId`. The following provider request therefore lacks
the assistant tool-call record that relates results to calls.

Result: fake tests pass, but OpenAI-compatible multi-turn tool behavior is not
faithfully represented for LM Studio, llama.cpp, Groq or OpenRouter.

### 5. Route diagnostics are deliberately leaked

`src/router/router.ts:269-276` builds an explanation containing privacy gate,
cost gate, score, quota headroom, reliability, latency, context and tool-use
metrics for every selected route. Local candidates receive synthetic quota
headroom. `src/tui/app.tsx:815-821` inserts that explanation into the normal
transcript and adds the hard-coded detail “No paid route was considered.”

Result: a local run speaks in cloud billing/quota language. Those facts belong
in `/explain-route`; the normal presentation needs a source-aware route summary.

### 6. Assistant-turn ordering is fragmented

Submit inserts a fabricated assistant preamble before routing. Route text is
then appended as its own message. Streaming text lives in a separate panel,
tool rows are appended to the durable list, checkpoint events can split a tool
start from its finish, and final assistant text is appended last.

Result: one logical assistant turn becomes several unrelated transcript
messages with repeated headings and unstable ordering.

### 7. Scroll instructions exist without a reachable focus model

The composer remains focused whenever no overlay is open. Transcript scrolling
is handled inside the ScrollBox key handler, but there is no product action that
focuses the transcript. The narrow hint advertises Ctrl+Up/Down while the
handler listens for unmodified arrows. Sticky-bottom itself respects manual
scrolling, but the UI neither exposes follow state nor a “New activity” action.

### 8. Duplicate status sources and unbacked hints

Route and privacy appear in TopBar, Composer and StatusBar. StatusBar also adds
model, context, cost and Git readiness. The composer advertises `@ context`,
but the only special input integration implemented by `AppShell` is `/`.

### 9. Overlay key/focus ownership is ambiguous

Ctrl+P is registered in the OpenTUI keymap and again in AppShell's global
handler. Escape is handled globally, by overlay inputs and by the approval
dialog. Existing tests do not prove which handler wins or whether the composer
focus is restored exactly once.

### 10. Previous prompts optimized artifacts, not acceptance

V3 produced large capture sets and documentation, but the production component
remained a 1,993-line `AppShell` mixing domain loading, routing, agent events,
commands, state and rendering. Tests assert visible strings at fixed widths;
they do not assert shared geometry, overlap, focus, scroll stability, dynamic
resize, event ordering or the actual PTY journey.

Targeted pre-V4 evidence: TypeScript passed and 38 focused tests passed. The
rejected UI therefore demonstrates a test-design failure, not a missing green
checkmark.

## Provider-path boundary

- LM Studio, llama.cpp and the generic local OpenAI-compatible runtime use the
  shared OpenAI-compatible adapter.
- Groq and OpenRouter use the same adapter.
- Ollama is discovery-only in the current checkout and has no execution
  provider bridge. It must not be presented as an executable chat route until
  that separate product gap is addressed.

No paid or remote inference was run during this audit. The exact configured
model that produced the screenshot's textual tool JSON is therefore not
re-verified; the source path that permits it is verified.

## Acceptance tests required before repair claims

1. Content-column geometry at 80, 100, 120, 140, 160 and 200 columns.
2. Native fragmented tool calls plus deliberately supported textual fallback
   calls, with no raw invocation JSON in frames or restored sessions.
3. One assistant turn containing prose, tool start/finish, tests and final
   prose in actual order.
4. Local route summaries containing none of: cost gate, paid route, quota
   headroom, free quota, API credits or requests remaining.
5. Manual scroll pause during streaming and explicit return to latest content.
6. Ctrl+P, Ctrl+C, Escape, PageUp/PageDown, mouse activation and focus restore.
7. Live resize across 160 -> 120 -> 100 -> 80 -> 120 with no overlap.
8. Current source build followed by the real bundle journey and terminal
   restoration; the pre-existing ignored bundle is not release proof.
