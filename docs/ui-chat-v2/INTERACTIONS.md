# ShelraCode Chat V2 — Interaction Contract

## Composer

`Ask ShelraCode…` is a multiline textarea with submit, Shift+Enter newline,
clear and active-task interrupt behavior. The focused surface uses a quiet
violet accent; idle state uses the neutral surface. The footer keeps only
context, route mode and the currently useful action hint.

## Keyboard and mouse

- Enter submits; Shift+Enter inserts a newline.
- Escape clears a draft, closes an overlay or cancels the active task according
  to the existing navigation state machine.
- Up/Down browse recent unique prompts once the conversation has begun; the
  original draft is restored at the bottom of history.
- `@` opens the fuzzy context/file picker; Enter toggles a file, Escape closes.
- `/` and Ctrl+P open the searchable command palette backed by the shared
  command registry.
- Enter or mouse click expands/collapses a tool group.
- PageUp/PageDown and mouse wheel scroll the transcript without moving the
  composer.

The interrupt action remains wired to task lifecycle state, not to whether a
visual loader is currently mounted.

## Secondary surfaces

Approvals use a focused modal with one clear Allow once / Deny decision. Route
changes appear only when the selected route materially changes. Plans are
compact in-turn progress; errors show a human summary first and bounded
technical detail only when available.

## Accessibility and terminal compatibility

State uses labels and glyphs as well as color. `NO_COLOR` disables color while
preserving symbols and layout. Reduced motion removes matrix animation.
Focusable rows, the picker, palette and composer are keyboard reachable. The
implementation requires no Nerd Font; common Unicode glyphs have textual
labels and the core status remains understandable in ASCII-oriented terminals.
