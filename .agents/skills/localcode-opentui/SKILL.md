---
name: localcode-opentui
description: Build or modify LocalCode's OpenTUI + SolidJS terminal interface, including components, responsive layouts, keybindings, dialogs, streaming state and terminal lifecycle.
---

# LocalCode OpenTUI

Use for any LocalCode TUI work. Read `.agents/skills/opentui/SKILL.md` and the relevant canonical docs before implementation; do not rely on remembered API signatures.

Rules:

- SolidJS reconciler and renderer-owned cleanup.
- Business logic stays outside leaf UI components.
- Keyboard-first, focused composer, and predictable Escape/Ctrl+C behavior.
- Test 80/100/120/160 columns, `NO_COLOR`, resize, and cancellation.
- Important state cannot rely only on color.
- Collapse verbose tool output by default and render streaming incrementally.
- Never call `process.exit()` from the interactive path.

Required validation: typecheck, TUI smoke, narrow-width smoke, keyboard navigation smoke, and terminal cleanup observation.
