# Status

This file tracks UI/TUI work specifically. For the agent kernel (turn
classification, tool contracts, agent loop, recovery, verification), see
[`docs/agent-kernel/STATUS.md`](agent-kernel/STATUS.md) — that work is
currently the priority and is tracked separately so it isn't lost in a
UI-focused log.

## Agent evaluation gate — 2026-08-26

The upgrade now has a reproducible, disposable evaluation command:
`bun run scripts/evaluate-agent.ts --deterministic --summary`. The current
matrix covers 18 heterogeneous journeys and returned:

```text
Deterministic matrix: PASS (18/18 passed; failed=0; unproven=0; skipped=0)
```

The evaluator records source HEAD, artifact hashes when present, Bun/Node/OS,
hardware, fixture revision, and exact probe generation settings. Its optional
`--local` path only contacts loopback runtimes, never downloads a model and
never falls back to paid/cloud inference. On the available runtime snapshot,
the first discovered model was reported as unloaded, so the local matrix was
correctly recorded as `UNPROVEN` rather than converted into a success claim:

```text
Local matrix: UNPROVEN (discovered=9; evaluated=1; policy=local_only_no_download_no_paid_fallback)
model lm-studio/qwen3-14b-claude-4.5-opus-high-reasoning-distill: skipped — runtime reports the model as unloaded
```

This is evaluation/release evidence, not proof of frontier-model parity. A
real local model must be loaded and explicitly selected before its capability
probe and disposable coding journey can be measured.

## Current product evidence — 2026-08-26

The current source has a green canonical suite (`643 pass, 1 skip, 0 fail`
across 644 tests and 2,196 expectations), a passing typecheck, a rebuilt
`dist/index.js`, and passing
source/bundle CLI smoke. The routing correction makes empirical capability a
score/fallback signal instead of an unconditional route veto, so an executable
1.5B local candidate can be attempted for an otherwise policy-valid task.
This does not promote 1.5B to unrestricted long-horizon autonomy; live
completion evidence remains task- and runtime-specific.
The file-domain controls now distinguish read/list/create/edit/overwrite/delete
operations, reject phantom objective paths, and surface rejected tool requests
as `BLOCKED` activity with a typed recovery explanation.

The ASK permission flow now has explicit `Approve once`, `Allow for this
session`, `Always allow in this project`, `Deny`, and `Cancel turn` decisions.
Session grants stay in memory; project grants are validated and persisted in
`.localcode/config.json`. Shell and RunTests grants retain an exact normalized
command, while file grants are explicit tool/risk rules. Secret-shaped command
grants are refused for persistence, and saved approval rules do not bypass
workspace, network, or process policy.

Fresh approval evidence:

```text
bun --conditions=browser test [permission and TUI approval focus]
  34 pass / 0 fail / 97 expectations
source TUI PTY (Windows)
  Approval modal rendered all five choices; `s` returned focus to the composer
  and `/permissions` opened the Permissions center with saved-rule state.
```

`bun run build` now also compiles `dist/shelra.exe`, installs the active Windows
user version under `%USERPROFILE%\.shelra\bin`, writes
`%USERPROFILE%\.shelra\active.json`, creates the `localcode.cmd`
compatibility shim, and updates the user PATH. A fresh shell can therefore run
`shelra` from another project directory without LM Studio or a repository-local
script path.

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
- Every no-argument `shelra`/`localcode`/`--tui` launch now enters the same
  conversation surface from any workspace. The onboarding surface remains an
  explicit `setup` command, so changing projects cannot change the main CLI.
- Slash commands, command palette entries and default help metadata share one
  registry.
- OpenTUI keymap is active in the real launcher with a timed Ctrl+X leader;
  `Ctrl+P` and a paced `Ctrl+X` → `M` sequence were exercised against a
  rebuilt bundle and opened the Models center.
- The fresh bundle exits with code 0 through `/exit` and `Ctrl+C` after
  restoring the alternate screen; the exit callback is deferred outside the
  active key event to keep OpenTUI teardown ordered.
- `bun run typecheck`, canonical `bun run test` (643 pass, 1 skip, 0 fail;
  644 tests and 2196 expectations) and `bun run build` pass from the current
  checkout. The full `bun run format:check` still reports formatting
  differences in 27 user/working files; those files were not rewritten during
  this packaging delivery. Targeted formatting checks for the packaging and
  classifier changes pass.
- `qwen2.5-coder-7b-instruct` and other LM Studio models are discovered by the
  current local runtime. Groq/OpenRouter catalogs are discovered from the
  configured environment without making an inference request.
- Standalone production packaging is active for Windows x64: `dist/shelra.exe`
  and the installed `shelra` command pass help/version/doctor smoke.

## In progress

- No UI implementation work is currently in progress. Further visual tuning
  should be driven by fresh terminal captures, not by changing core services.

## Blocked

- `llmfit` is not installed on this machine, so the hardware screen uses its
  documented basic-detection fallback.
- Groq/OpenRouter credentials are present. Strict-zero now treats Groq as
  expiring free-tier quota and OpenRouter as free-only catalog entries; paid
  variants are excluded before routing. Remote privacy/ZDR remains a separate
  hard gate, and live account quota/health evidence is still volatile.

## Next

- Exercise the remaining center views interactively at the desired terminal
  sizes when a resize-capable host is available.
- Keep the standalone packaging path aligned with future release signing and
  cross-platform artifacts; the current build/install path is Windows x64.

## Known limitations

- Cloudflare and Gemini are intentionally not advertised in this UI slice.
- OpenCode/Zen remains non-eligible for strict-zero unless its current free and
  privacy metadata is explicitly verified by the provider boundary.
- Ollama and LM Studio are detected/normalized; runtime execution remains
  subject to the existing generic local adapter contract.
