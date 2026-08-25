# Storage

LocalCode uses SQLite through Bun's native `bun:sqlite` driver. The application database lives under the user's LocalCode data directory, while tests use `:memory:` or a temporary directory.

Core tables are `schema_migrations`, `settings`, `sessions`, `messages`, `tool_runs`, `routes`, `provider_health`, `quota_snapshots`, `model_observations`, `task_memory`, `checkpoints`, and `files_changed`. Repository services expose typed methods so SQL rows do not leak into the router or TUI.

Global state is stored in the user LocalCode state directory (by default
`~/.localcode/state.sqlite`). Repository overrides are validated from
`.localcode/config.json` and take precedence over global settings; the file
contains policy values only, never provider credentials.

Remote telemetry is off. Operational records are local and omit credentials/raw secret values.
