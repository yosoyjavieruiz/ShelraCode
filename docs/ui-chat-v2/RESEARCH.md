# UI Chat V2 — Research Notes

Grounded via web search 2026-08-24 (not memory alone, per the brief's instruction). Condensed to what actually changed a decision below — see AUDIT.md and AGENT-MATRIX.md for what it fed into.

## Codex CLI

Confirmed working-indicator format: **`• Working (10s • esc to interrupt)`** — a bullet marker, a state verb, elapsed time, and the interrupt hint, all on one line. `Esc` interrupts the current task only, it does not quit the CLI. This is the direct precedent for AgentMatrixPulse's own label line (`Agent · {verb}` / `{elapsed} · Esc interrupt`) — same shape, ShelraCode's own verbs (see AGENT-MATRIX.md) instead of Codex's single generic "Working".

Sources: [openai/codex#7017](https://github.com/openai/codex/issues/7017), [openai/codex#5905](https://github.com/openai/codex/issues/5905), [openai/codex#28104](https://github.com/openai/codex/issues/28104)

## Claude Code

The spinner **warms to amber after 10 seconds** to signal it's still alive on a long turn — a real, cheap idea for later (AgentMatrixPulse currently stays a constant violet regardless of duration; not implemented in this pass, noted in STATUS.md). Also confirmed: a *custom* status line replaces the built-in footer badges entirely, including the interrupt hint — a caution for ShelraCode if a user-configurable status line is ever added, the interrupt hint must not be able to silently disappear with it.

Sources: [code.claude.com/docs/statusline](https://code.claude.com/docs/en/statusline), [claudefa.st changelog](https://claudefa.st/blog/guide/changelog)

## OpenCode

Confirmed built directly on **OpenTUI** in production (the same core ShelraCode uses) — no framework-migration risk, per spec §3/§6. Their own team flags **zero extensibility in tool rendering** as an open issue: "Tool rendering is a hardcoded Switch block... every plugin tool falls through to GenericTool" (opencode#21018). ShelraCode's `activityMetadata()` (`presentation/adapter.ts`) is the same shape (a lookup table keyed by tool name) but centralized in one data-driven map rather than a switch spread through render code — a real structural advantage worth preserving when the tool-renderer registry work happens (AUDIT.md gap #4), not rebuilding from scratch.

OpenCode also ships a **"Compact Mode"** with a 4-level display hierarchy and click-to-expand/collapse, explicitly for "token efficiency and casual observer protection" — direct precedent validating spec §29's FOCUS/DEFAULT/VERBOSE density modes as a real, shipped pattern in this exact category of tool, not a speculative idea.

Sources: [opencode.ai/docs/tui](https://opencode.ai/docs/tui/), [opencode#21018](https://github.com/anomalyco/opencode/issues/21018), [opencode#9017](https://github.com/anomalyco/opencode/issues/9017), [@opentui/core on npm](https://www.npmjs.com/package/@opentui/core)

## What this did *not* change

No visual redesign of message typography, tool grouping shape, or transcript geometry — the audit found those already match the researched precedents closely enough (see AUDIT.md "what already works well"). Research this pass was scoped tightly to the two areas actually implemented: the working indicator (AgentMatrixPulse) and confirming the tool-renderer registry's future shape without doing the full rebuild yet.

## Current product research refresh — 2026-08-24

This refresh covers the full research list in the brief and records only
patterns relevant to ShelraCode's terminal chat. It is not a pixel-copying
exercise.

| Product | Current evidence | Decision for ShelraCode |
| --- | --- | --- |
| Claude Code | [Fullscreen rendering](https://code.claude.com/docs/en/fullscreen) documents alternate-screen rendering, visible-content handling, reduced flicker and fewer scroll jumps. [Status line](https://code.claude.com/docs/en/statusline) documents a separate status row and the risk of hiding the interrupt hint in a custom status line. | Keep the composer outside the transcript viewport, keep interrupt ownership in lifecycle state, and do not duplicate status signals. |
| OpenAI Codex CLI | [Codex issue #35348](https://github.com/openai/codex/issues/35348) records the failure mode where Esc became unavailable during final-answer streaming when tied to a visible working indicator. [Issue #29368](https://github.com/openai/codex/issues/29368) documents the separate risk of blocking the event loop and freezing input/animation. | Cancellation must be available for the whole interruptible turn, independent of whether a spinner or matrix is visible; provider work must not block the TUI loop. |
| OpenCode | [TUI documentation](https://opencode.ai/docs/tui/) documents `@` file references, `!` shell input, `/` commands, details toggling and scroll configuration. The [TUI package specification](https://github.com/anomalyco/opencode/blob/dev/specs/tui-package.md) describes known tool renderers with a generic fallback. | Keep one command/reference registry, use fuzzy references, and make known tools specialized while keeping malformed/unknown metadata safe. |
| Gemini CLI | [Configuration reference](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/configuration.md) exposes compact tool output, incremental rendering, spinner visibility/loading phrases, error verbosity and alternate-buffer settings independently. | Make loading presentation, incremental text updates and tool density separate settings; do not use one global spinner as the lifecycle source. |
| OpenTUI | [Renderer documentation](https://github.com/anomalyco/opentui/blob/main/packages/web/src/content/docs/core-concepts/renderer.mdx) documents target FPS, demand-driven rendering and live rendering requests. The installed 0.5.7 skill documents `ScrollBox` sticky behavior, viewport culling, `testRender`, `requestLive()` and alternate-screen defaults. | Preserve OpenTUI; use live rendering only for the matrix/active micro-state, and test layout/keyboard/mouse with the real browser-condition runtime. |
| Warp | [Agent Mode](https://www.warp.dev/blog/agent-mode) and [Agent platform](https://www.warp.dev/ai) emphasize visible command execution, explicit approval and user control during autonomous work. | Keep approval and interruption close to the current action; never hide external side effects behind a decorative progress state. |
| Zed | [Agent Panel](https://zed.dev/docs/ai/agent-panel) documents streaming tool indicators, queue/steer, stop/send-now and checkpoints. [Tools](https://zed.dev/docs/ai/tools) documents read/search/edit/terminal tool boundaries and permission profiles. | Treat tool activity as first-class structured conversation content, while keeping a long-lived side panel out of the terminal layout. |
| Raycast | [Search Bar](https://manual.raycast.com/search-bar) documents keyboard-first real-time fuzzy search and compact action presentation. [AI Extensions](https://manual.raycast.com/ai/ai-extensions) documents approval before tool actions. | Use one focused, searchable command/file palette with explicit actions and no permanent dashboard surface. |

### Research synthesis

Across the current references, maturity comes from stable input geometry,
structured event renderers, bounded detail, explicit interruption and a small
number of independently controlled motion/verbosity settings. The common
failure modes are also consistent: tying lifecycle to a visual spinner,
blocking the input loop, dumping raw tool output, and allowing the transcript
to own the composer geometry. These findings directly support the Phase 1
foundation described in `AUDIT.md`.
