# Status

This file tracks UI/TUI work specifically. For the agent kernel (turn
classification, tool contracts, agent loop, recovery, verification), see
[`docs/agent-kernel/STATUS.md`](agent-kernel/STATUS.md) — that work is
currently the priority and is tracked separately so it isn't lost in a
UI-focused log.

## Done

- Current UI was audited from the real `bun run dist/index.js --tui` artifact at
  80 columns; the inventory is in [`docs/UI-INVENTORY.md`](UI-INVENTORY.md).
- Obsidian Violet semantic theme exists with exact `#000000` canvas, centralized
  surfaces, typography/state colors and `NO_COLOR` fallback.
- Responsive layout profiles and UI foundation tests cover 80/100/120/160
  column renderer states.
- App shell was rebuilt with top bar, responsive navigation, main viewport,
  optional inspector, multiline composer and status bar.
- Transcript uses ScrollBox, Markdown assistant rendering and compact tool,
  route, verification and error activity rows.
- Models, Providers, Usage, Routing, Privacy, Changes, Settings, Context, Plan,
  Doctor, Sessions, Checkpoints and Help have V2 presentation adapters over
  existing domain services.
- `localcode setup` now opens a staged V2 onboarding surface for hardware,
  LM Studio/local models, configured providers, privacy and routing, and saves
  through the existing settings services.
- A first `localcode`/`--tui` launch now enters that same onboarding surface
  automatically when repository policy is not configured; completion transitions
  directly into the workspace.
- Slash commands, command palette entries and default help metadata share one
  registry.
- OpenTUI keymap is active in the real launcher with a timed Ctrl+X leader;
  `Ctrl+P` and a paced `Ctrl+X` → `M` sequence were exercised against a
  rebuilt bundle and opened the Models center.
- The fresh bundle exits with code 0 through `/exit` and `Ctrl+C` after
  restoring the alternate screen; the exit callback is deferred outside the
  active key event to keep OpenTUI teardown ordered.
- `bun run format:check`, `bun run typecheck`, canonical `bun run test`
  (306 passing tests, 1032 expectations) and `bun run build` pass from the
  current checkout.
- `qwen2.5-coder-7b-instruct` and other LM Studio models are discovered by the
  current local runtime. Groq/OpenRouter catalogs are discovered from the
  configured environment without making an inference request.

## In progress

- No UI implementation work is currently in progress. Further visual tuning
  should be driven by fresh terminal captures, not by changing core services.

## Blocked

- `llmfit` is not installed on this machine, so the hardware screen uses its
  documented basic-detection fallback.
- Groq/OpenRouter credentials are present, but their automatic strict-zero
  eligibility remains unverified until explicit free/privacy confirmations are
  configured. Unknown billing/privacy remains ineligible by design.
- No standalone native executable is produced; the current release artifact is
  the Bun bundle `dist/index.js` plus OpenTUI runtime assets.

## Next

- Exercise the remaining center views interactively at the desired terminal
  sizes when a resize-capable host is available.
- Add a standalone executable only if the release packaging requirement is
  explicitly brought into the UI delivery scope.

## Known limitations

- Cloudflare and Gemini are intentionally not advertised in this UI slice.
- OpenCode/Zen remains non-eligible for strict-zero unless its current free and
  privacy metadata is explicitly verified by the provider boundary.
- Ollama and LM Studio are detected/normalized; runtime execution remains
  subject to the existing generic local adapter contract.
