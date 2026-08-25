# TUI

LocalCode's implemented terminal experience is documented in
[`docs/UI-V2.md`](UI-V2.md). Its visual system is Obsidian Violet: a true-black
canvas, deep neutral surfaces, amethyst focus and semantic state colors.

## Layout

The shell has a top bar, responsive navigation, a conversation/center viewport,
an optional task inspector, a multiline composer and a quiet status bar.

The layout profile is tested at 80x24, 100x30, 120x40 and 160x50. It removes
secondary metadata before hiding task state, model/route, privacy, errors,
approvals or the composer.

## Interaction

Enter submits; Shift+Enter creates a composer newline. `Ctrl+P` opens the unified
command palette. `Ctrl+X` is the timed OpenTUI leader for navigation commands.
Escape closes the highest overlay or returns to idle. Ctrl+C cancels active work
and exits only while idle. Slash commands and palette entries share one registry.

## Rendering

The transcript uses OpenTUI `ScrollBox` with sticky-bottom behavior and viewport
culling. Assistant prose uses OpenTUI Markdown, active streaming remains
incremental, and Changes uses the OpenTUI Diff renderer. Tool, route,
verification and error events are compact semantic rows rather than raw logs.

Core services remain outside presentation components. The launcher owns the
OpenTUI keymap and renderer lifecycle; the renderer is destroyed on exit so the
terminal is restored.
