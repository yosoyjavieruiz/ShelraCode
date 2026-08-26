# Changelog

## 0.1.1

- Added the standalone Windows `shelra.exe` production build and per-user installer.
- Added the global `shelra` command with `localcode` compatibility alias.
- Added active-version metadata and idempotent user PATH registration.
- Updated the CLI version identity to ShelraCode.
- Kept the no-argument `shelra`/`localcode` entry on the same conversation
  surface from every workspace; onboarding is explicit through `setup`.

## 0.1.0

- Added Bun/TypeScript/OpenTUI + SolidJS application bootstrap.
- Added llmfit integration with basic hardware fallback and local runtime discovery.
- Added normalized OpenAI-compatible provider adapters for Groq and OpenRouter boundaries.
- Added privacy scanning, strict-zero routing, quota freshness, circuit breakers and explanations.
- Added provider-independent coding loop, workspace tools, permissions, verification and conflict-safe checkpoints.
- Added SQLite state, setup/doctor/models/providers commands and responsive TUI centers.
- Added fixture, contract, routing, privacy, zero-spend, checkpoint and terminal layout tests.

Known limitations are recorded in `docs/STATUS.md` and `docs/ACCEPTANCE.md`.
