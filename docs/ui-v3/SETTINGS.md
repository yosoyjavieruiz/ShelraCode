# LocalCode UI V3 settings contract

The current Settings workspace is a searchable list. At 110 columns and above it shows the category rail; below that it stacks each value under its setting title to protect narrow geometry.

## Backed settings

These values are written to `.localcode/config.json` and mirrored into the local SQLite settings table:

- Repository privacy: `private`, `private_zdr_only`, `local_only`, `public_free`.
- Routing mode: `strict-zero`, `ask-before-paid`.
- Permission mode: `PLAN`, `EDIT`, `AUTO`.

On persistence failure the candidate value is restored in memory and the failure remains in the status notice.

## Session presentation settings

- Interface density: `comfortable` / `compact`.
- Motion: `System` / `Reduced`.

These are currently session-local and the UI says so. They are not presented as durable configuration.

## Fixed policy values

- Theme: `Obsidian Violet`.
- Accent: `#8B5CF6`.
- Secondary chrome: conversation-first/transient.
- Tool activity: grouped and collapsed by default.
- Keybindings: registry defaults with `Ctrl+P` palette and timed `Ctrl+X` leader.
- Telemetry: off.

Only values already represented in the current configuration/control-plane contract are editable. Settings do not bypass privacy, permission, strict-zero, or provider freshness gates.
