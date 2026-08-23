# TUI additions

- Read `.agents/skills/opentui/SKILL.md` and the relevant canonical docs before using an API.
- Keep router, provider, privacy, and storage logic in application services.
- Use Solid signals/stores for view state and renderer-owned cleanup for lifecycle.
- The composer must remain focused and usable at narrow widths.
- Do not rely on color alone for privacy, cost, health, or route state.
- Use `renderer.destroy()`, never direct `process.exit()` from the interactive path.
