# LocalCode UI V4 references

Research refreshed on 2026-08-23. Primary sources are official docs, official
repositories, or official changelogs. The goal is to extract interaction and
composition principles, not to reproduce another product's branding.

## Reference matrix

### 1. OpenCode — conversation TUI

- **Screen:** main conversation, composer, file references and slash commands
- **Source:** [OpenCode TUI documentation](https://dev.opencode.ai/docs/tui/)
- **What works:** one composer accepts prompts, `@` file context, `!` shell and
  `/` commands; sessions, model selection and details are discoverable commands.
- **Why it works:** command entry and conversation share one locus of attention.
- **LocalCode should learn:** keep the core canvas conversation-first and make
  backed context/model actions reachable from the composer and palette.
- **Do not copy:** OpenCode branding, Git-based undo behavior, sharing, or any
  command LocalCode cannot execute safely.

### 2. OpenCode — session and launch continuity

- **Screen:** TUI launch, continue, session and fork flows
- **Source:** [OpenCode CLI documentation](https://opencode.ai/docs/cli/)
- **What works:** continue, session, fork, model and agent are explicit launch
  choices rather than hidden state.
- **Why it works:** the user understands what context the next prompt will use.
- **LocalCode should learn:** keep route/model/session state legible and use
  plain session names in pickers.
- **Do not copy:** raw session IDs as primary UI or unsupported fork semantics.

### 3. OpenTUI Solid — application composition

- **Screen:** Solid layout, input, overlays and reactive resize
- **Source:** [OpenTUI Solid bindings](https://opentui.com/docs/bindings/solid/)
- **What works:** native `scrollbox`, `textarea`, `markdown`, `code` and `diff`
  renderables participate in one Yoga layout; resize and lifecycle are explicit.
- **Why it works:** interaction is expressed through real components rather
  than formatted stdout and terminal-coordinate calculations.
- **LocalCode should learn:** one vertical flex shell, renderer-owned cleanup,
  reactive terminal dimensions and focused overlays.
- **Do not copy:** APIs from memory or DOM assumptions OpenTUI does not support.

### 4. OpenTUI — ScrollBox

- **Screen:** long transcript and streaming output
- **Source:** [OpenTUI ScrollBox documentation](https://opentui.com/docs/components/scrollbox/)
- **What works:** sticky scrolling, manual scrolling, viewport culling,
  scrollbars and programmatic child visibility are separate capabilities.
- **Why it works:** new content can follow only while the reader remains at the
  end; large histories do not require rendering every off-screen cell.
- **LocalCode should learn:** expose follow/pause state and a “New activity”
  return action; do not force the viewport while the user reads history.
- **Do not copy:** state changes from render hooks while culling is enabled.

### 5. OpenTUI — scoped keymaps

- **Screen:** application, composer, list and modal shortcuts
- **Source:** [OpenTUI keymap overview](https://opentui.com/docs/keymap/overview/)
  and [Solid keymap bindings](https://opentui.com/docs/keymap/solid/)
- **What works:** commands, bindings, host integration and focus-local layers
  are distinct; displayed hints can derive from the active command model.
- **Why it works:** overlay and editor shortcuts do not compete with global
  handlers.
- **LocalCode should learn:** one command registry with scoped layers for the
  composer, transcript and overlays.
- **Do not copy:** a second global key handler that duplicates the keymap.

### 6. OpenTUI — Code and Diff

- **Screen:** expanded tool output and file-change review
- **Source:** [OpenTUI Code](https://opentui.com/docs/components/code/) and
  [OpenTUI Diff](https://opentui.com/docs/components/diff/)
- **What works:** syntax-aware code, unified/split diff, wrapping and scroll
  synchronization are native presentation primitives.
- **Why it works:** structured content retains its semantics and can adapt to
  the available width.
- **LocalCode should learn:** keep code/diffs collapsed in chat, then use the
  real renderers inside aligned details.
- **Do not copy:** split diffs at widths where two readable panes cannot fit.

### 7. Claude Code — permission and continuation vocabulary

- **Screen:** interactive CLI launch, resume and permission modes
- **Source:** [Claude Code CLI reference](https://docs.anthropic.com/en/docs/claude-code/cli-usage)
- **What works:** continue, resume, model and permission mode are explicit and
  operational rather than decorative.
- **Why it works:** the safety boundary is understandable before execution.
- **LocalCode should learn:** approval UI must name the exact action, scope and
  consequence; the current permission mode belongs near the decision point.
- **Do not copy:** permission bypasses or cloud assumptions that conflict with
  LocalCode privacy and strict-zero gates.

### 8. Codex CLI — command and session surface

- **Screen:** interactive launch, resume/fork picker and inline mode
- **Source:** [official Codex developer commands](https://developers.openai.com/codex/cli/reference)
  plus local `codex-cli 0.149.0 --help` evidence
- **What works:** model, sandbox, approval, working directory, resume/fork and
  no-alternate-screen behavior are explicit entry options.
- **Why it works:** users can predict execution context and recover a session.
- **LocalCode should learn:** show current model/execution state quietly and
  keep terminal restoration/scrollback modes testable.
- **Do not copy:** dangerous bypass controls, remote/cloud controls, or options
  without a LocalCode service behind them.

### 9. Gemini CLI — keyboard and queued input

- **Screen:** composer, transcript scrolling, history and dialogs
- **Source:** [Gemini CLI keyboard shortcuts](https://github.com/google-gemini/gemini-cli/blob/main/docs/reference/keyboard-shortcuts.md)
- **What works:** submit/newline, page scrolling, list navigation and history
  have named actions; queued input is explicit while work continues.
- **Why it works:** shortcuts correspond to focus and state instead of being a
  permanent wall of help text.
- **LocalCode should learn:** preserve PageUp/PageDown and Ctrl+C; show a queue
  only if it is genuinely supported.
- **Do not copy:** overload Tab when completion, focus movement and queueing
  would be ambiguous.

### 10. Warp — Blocks

- **Screen:** command/agent input and output blocks
- **Source:** [Warp Blocks](https://docs.warp.dev/terminal/blocks) and
  [Block actions](https://docs.warp.dev/terminal/blocks/block-actions)
- **What works:** an invocation and its result remain one addressable unit;
  details, copy and navigation are progressive disclosures.
- **Why it works:** output is no longer an undifferentiated log stream.
- **LocalCode should learn:** an assistant turn and its tools form one visual
  group; shell output stays collapsed with useful summaries.
- **Do not copy:** card-heavy transcript chrome or cloud-sharing features.

### 11. Raycast — root search and action panel

- **Screen:** searchable root list, recent actions and secondary actions
- **Source:** [Raycast Quicklinks](https://manual.raycast.com/quicklinks) and
  [Raycast Settings](https://manual.raycast.com/settings)
- **What works:** search, categories, recents, shortcuts and contextual actions
  share a restrained list language.
- **Why it works:** primary results remain scannable while advanced actions are
  one layer deeper.
- **LocalCode should learn:** a centered command palette with recent and
  contextual groups, subtle selection and real shortcuts.
- **Do not copy:** macOS-specific visual chrome or mouse-dependent actions.

### 12. Linear — quiet hierarchy and contextual commands

- **Screen:** dark shell, contextual command menu and navigation hierarchy
- **Source:** [Linear UI redesign](https://linear.app/changelog/2024-03-20-new-linear-ui)
  and [contextual command menu](https://linear.app/changelog/2019-10-07-contextual-command-menu)
- **What works:** tabs, headers, filters and panels were reduced to improve
  hierarchy, balance, density and contrast; commands follow current context.
- **Why it works:** fewer visible treatments make the active view obvious.
- **LocalCode should learn:** use spacing, contrast and placement before violet
  or borders; remove duplicated state.
- **Do not copy:** GUI dropdown geometry or decorative navigation that does not
  map to a TUI action.

### 13. Zed — Agent Panel

- **Screen:** assistant thread, message editor, model selector and tool stream
- **Source:** [Zed Agent Panel](https://zed.dev/docs/ai/agent-panel)
- **What works:** the model selector is adjacent to the message editor and
  responses show structured tool use while streaming.
- **Why it works:** the model is visible where the user can change it, and
  activity is presented as part of the assistant turn.
- **LocalCode should learn:** model/context pickers belong to the composer
  workflow; tool state needs compact structured rows.
- **Do not copy:** capabilities not shared by every LocalCode adapter.

### 14. Zed — command palette and key contexts

- **Screen:** command palette and context-aware keymap
- **Source:** [Zed Command Palette](https://zed.dev/docs/command-palette) and
  [Zed key bindings](https://zed.dev/docs/key-bindings)
- **What works:** commands depend on focus, filter immediately and reveal their
  semantic action names and shortcuts.
- **Why it works:** the palette never advertises an action invalid in the
  current context.
- **LocalCode should learn:** scope palette results to idle/running/overlay and
  current screen state.
- **Do not copy:** JSON-only configuration as the primary discovery path.

### 15. Lazygit — focused pane and confirmations

- **Screen:** focused list/detail panes, diff review and confirmation panel
- **Source:** [Lazygit keybindings](https://github.com/jesseduffield/lazygit/blob/master/docs/keybindings/Keybindings_en.md)
- **What works:** focus-local actions, PageUp/PageDown, `?` help, Enter confirm
  and Escape cancel are predictable.
- **Why it works:** dense information remains navigable because only one region
  owns the active keys.
- **LocalCode should learn:** use this pattern in pickers/diff workspaces, not
  as a permanent dashboard around chat.
- **Do not copy:** destructive Git operations or a large single-letter command
  vocabulary in the core conversation.

### 16. Yazi — keymap layers and responsive areas

- **Screen:** manager, input, picker, confirmation and help layers
- **Source:** [Yazi keymap layers](https://yazi-rs.github.io/docs/configuration/keymap/)
  and [layout API](https://yazi-rs.github.io/docs/plugins/layout/)
- **What works:** eight interaction layers prevent key collisions; layout
  regions are computed rather than positioned ad hoc.
- **Why it works:** focus and geometry have explicit owners.
- **LocalCode should learn:** composer, transcript, palette, picker and approval
  need independent key scopes over one shared layout model.
- **Do not copy:** Vim navigation as a requirement for ordinary use.

### 17. Superfile — modern terminal density

- **Screen:** multi-panel file manager, themes and hotkey help
- **Source:** [official Superfile repository](https://github.com/yorukot/superfile)
- **What works:** clear panel hierarchy, visible selection and theme cohesion
  make a dense file manager approachable.
- **Why it works:** borders and color support structure rather than replace it.
- **LocalCode should learn:** use its density lessons only in model/context/diff
  pickers, never in the default chat canvas.
- **Do not copy:** its panel count, Nerd Font dependence, or claim Windows
  stability—the project still describes Windows support as incomplete.

## Synthesized direction

LocalCode should combine OpenTUI's real layout/scroll/keymap primitives,
Warp-like activity grouping, Raycast/Linear/Zed contextual command discovery,
and the explicit safety vocabulary of current coding CLIs. The distinctive
LocalCode signature is a restrained neutral activity rail inside one aligned
conversation column. Violet identifies only brand, focus, selection and active
execution.
