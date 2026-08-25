# LocalCode Core UI — Reference Research

Researched 2026-08-23 via web search. Principles extracted, not pixels — nothing here is a
license to copy layout, iconography, or copy verbatim; it informs the three concepts in
`docs/ui-core/CORE-LAYOUT-DECISION.md`.

## AI coding agent TUIs

### 1. OpenCode

Terminal-native coding agent (95k GitHub stars in two weeks, per recent coverage) built with
Bubble Tea. Explicit **Plan vs Build** mode separation — the agent that reasons doesn't touch
files; the agent that writes code doesn't second-guess architecture. UI has a prompt area, a
real-time action log, and a mode indicator.
**Principle for LocalCode:** a visible, unambiguous "what mode is this turn in" signal —
directly reinforces our own turn-policy work (conversation/knowledge/workspace-read/coding) —
the UI should make that classification visible, not just enforce it silently.
[opencode.ai/docs](https://opencode.ai/docs/) ·
[GitHub](https://github.com/opencode-ai/opencode)

### 2. Claude Code

React-based terminal renderer (custom Yoga-layout engine, later replaced for scroll
performance) driving collapsible tool results, multi-line input, animated spinners — while
staying terminal-compatible. Structured `stream-json` protocol separates text deltas, tool-use
events, and status changes as distinct event types before anything reaches the renderer.
**Principle for LocalCode:** the normalized event boundary we already built
(`AgentEvent`/`presentAppEvent`) is the right architecture — this reference validates keeping
raw provider/tool data out of the render layer entirely, and treating tool results as
collapsible units rather than inline text.
[Claude Code from Source, ch. 13](https://claude-code-from-source.com/ch13-terminal-ui/) ·
[DeepWiki UI/UX](https://deepwiki.com/anthropics/claude-code/3.9-uiux-and-terminal-integration)

### 3. Codex CLI (OpenAI)

Full-screen `ratatui` TUI. **Plan mode is a distinct, read-only UI state** — Codex explores and
drafts a plan but cannot write or run code until the plan is explicitly approved; entered via
`/plan` or Shift+Tab to cycle collaboration modes.
**Principle for LocalCode:** approval and plan states deserve to be _visually_ distinct UI
modes, not just backend permission checks — the user should be able to tell "I am reviewing,
not executing" from the screen alone.
[DeepWiki TUI](<https://deepwiki.com/openai/codex/4.1-terminal-user-interface-(tui)>) ·
[Plan Mode mechanics](https://codex.danielvaughan.com/2026/04/08/plan-mode-mechanics/)

## Command surfaces

### 4. Raycast

Keyboard-first; hands never leave the keyboard, attention never leaves the task. Reframes
search as "search, then act immediately" rather than search-then-navigate. Visual design uses a
layered shadow system to simulate depth on a dark surface — but the load-bearing principle is
behavioral, not visual: nested navigation (typing a command can drill into a sub-menu instead
of firing immediately) is what makes a palette read as a real surface rather than a filtered
list.
**Principle for LocalCode:** the command palette needs sub-navigation (e.g. selecting "Models"
could drill into a model list within the same palette) and every entry needs a description, not
just a label — this is the single biggest gap the baseline audit found.
[Fountn: Command Palette Interfaces](https://fountn.design/resource/command-palette-interfaces/) ·
[Raycast design system](https://oh-my-design.kr/design-systems/raycast)

### 5. Linear

Popularized Cmd+K as expected UX for power-user tools. Two principles matter more than the
visual chrome: **contextual scoping** (don't show actions that make no sense from the current
screen) and **omnipotent but filtered access** — every action is reachable, but only relevant
actions are surfaced by default.
**Principle for LocalCode:** the palette's "Recent" section and context-aware ordering (already
speced in master-prompt §46) should genuinely filter by current screen state (conversation vs.
overlay vs. setup), not show a static full command list every time.
[techinterview: Cmd+K like Linear](https://www.techinterview.org/post/3233475212/build-command-palette-cmd-k/)

## Terminal-native craft

### 6. Warp

Blocks divide each command's input/output with a clear horizontal seam; users can disable the
divider or switch to "Compact mode" to condense spacing. Command palette (Cmd+P) surfaces past
commands _and_ actions from one keyboard-first surface.
**Principle for LocalCode:** density should be a real, user-controllable axis (matches
master-prompt §88's "comfortable default, compact tool activity") rather than one fixed
spacing — Warp proves users want to choose.
[Warp Blocks docs](https://docs.warp.dev/terminal/blocks/block-basics/)

### 7. Zed (Agent Panel)

Not a chat bubble list — a real editor surface. Streams token-by-token so the user reads and
reacts as it happens. Every AI-driven edit gets a **visible "Restore Checkpoint" affordance** —
the undo mechanism is a first-class UI element, not a hidden command.
**Principle for LocalCode:** we already have real checkpoint/rollback machinery
(`CheckpointService`) — this reference argues it should be _visible_ in the completion/file-change
event, not just usable via a slash command.
[Zed: Introducing the assistant panel](https://zed.dev/blog/assistant) ·
[DeepWiki Agent Panel](https://deepwiki.com/zed-industries/zed/8.1-agent-panel-and-ui)

### 8. Lazygit

Six fixed panels, each with one job; users build a mental map through **spatial consistency** —
panels never move, so location becomes memory. Every action is undoable (`ctrl+z`/`ctrl+y`) and
logged.
**Principle for LocalCode:** confirms the master-prompt's "no permanent dashboard" instinct is
still compatible with hierarchy — Lazygit's lesson isn't "add panels," it's "whatever regions
you do have must never move," which for LocalCode means: header/composer/status stay in the
same rows at every width; only the transcript region and overlay stack change.
[lazygit.dev](https://lazygit.dev/) · [Features](https://lazygit.dev/features/)

### 9. Yazi

Async-everything: every operation runs on a background thread, the UI has the next state
pre-computed before the user asks for it, so it "never freezes, never stutters." Preview pane
renders markdown/images/PDF inline via terminal graphics protocols rather than dumping raw text.
**Principle for LocalCode:** directly reinforces master-prompt §14/§61 (stable, non-blocking
streaming; viewport culling for large transcripts) — Yazi is proof this is achievable natively
in a terminal, not just aspirational.
[Yazi docs / x-cmd](https://www.x-cmd.com/pkg/yazi/)

### 10. Synthesis — "The Terminal Renaissance" (Hyperbliss)

A 2026 essay specifically about designing beautiful AI-agent TUIs. Key transferable rules:

- **Semantic color slots, not scattered hex** — "green means success, red means danger, yellow
  means caution" as a fixed vocabulary, color reinforces hierarchy already established by layout
  rather than carrying meaning alone.
- **Spatial consistency** — fixed panel positions build a mental map through location memory.
- **Progressive disclosure** — footer shows 3-5 essential shortcuts; full keybindings live one
  level deeper (`?` / command palette), not printed permanently.
- **"Async everything is non-negotiable"** — never block the UI; Escape must always reach a
  responsive interface.
- **Symbols carry state redundantly with color** (`●` vs `○`) so meaning survives `NO_COLOR`.
  [hyperbliss.tech: The Terminal Renaissance](https://hyperbliss.tech/blog/2026.04.04_terminal-renaissance/)

## What this means for the three concepts (Phase C)

Every reference converges on the same handful of ideas already latent in the master prompt, so
the three concepts should differentiate on **how much structure is visible by default**, not on
whether these principles apply — all three concepts must:

- keep header/composer/status in fixed rows (Lazygit, Hyperbliss),
- treat tool results as collapsible/groupable units, never inline log text (Claude Code),
- make the current mode (conversation/knowledge/read/coding, plan-vs-execute) visible, not just
  enforced (OpenCode, Codex),
- carry state redundantly through symbols, not color alone (Hyperbliss, `NO_COLOR` requirement).

Where they should genuinely differ is **command-surface depth** (flat list vs. Raycast/Linear-style
drill-down) and **density** (Warp's user-controllable compact mode vs. one fixed rhythm) — those
become real trade-offs to score in Phase D.
