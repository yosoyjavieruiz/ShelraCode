# Week One

The one-week scope was executed as a single vertical slice. The current
checkout contains the following delivered boundaries.

## Day 1 - foundation and control plane

Done: Bun/TypeScript/OpenTUI bootstrap, strict compiler settings, lockfile,
root and nested instructions, Codex agents, repository skills, docs, SQLite
migrations, CLI parsing and local smoke scripts.

## Day 2 - hardware and local models

Done: llmfit JSON integration with fallback detection, local OpenAI-compatible
endpoint discovery, Ollama/LM Studio/llama.cpp detection, normalized local
model candidates and setup/doctor/models views.

## Day 3 - provider mesh

Done: normalized OpenAI-compatible transport, Groq/OpenRouter provider
boundaries, paid-only Zen boundary, streaming/tool-call aggregation, quota
headers, freshness metadata, provider health and circuit breaker. Cloudflare
and Gemini remain deferred and are not advertised.

## Day 4 - coding agent

Done: repository context, bounded file/search/shell/Git/test tools, PLAN/EDIT/
AUTO permission classification, cancellation propagation, streaming agent loop,
deterministic verification, checkpoints and conflict-safe rollback.

## Day 5 - intelligent routing

Done: deterministic task analysis, sensitivity scanning, path/content policy,
privacy-before-cost gates, strict-zero exclusion, quota headroom, scoring,
structured explanations and circuit-aware fallback tests.

## Day 6 - TUI productization

Done: OpenTUI + Solid shell, responsive width behavior, transcript, composer,
slash-searchable command palette, live models/providers/quota/privacy/doctor/
context/plan/diff/routing centers, streaming task events, Ctrl+K, Escape and
Ctrl+C lifecycle behavior.

## Day 7 - release proof

Done: frozen-lockfile install, format, typecheck, 51-test suite, source and
bundle smoke, real PTY source/bundle launch, local Qwen tool journey, terminal
restoration, docs and changelog.

## Post-week-one production packaging - 2026-08-26

Done: `bun run build` now creates `dist/shelra.exe`, atomically activates it
under `%USERPROFILE%\.shelra\bin`, writes the active version manifest,
updates the user PATH, preserves the `localcode` compatibility shim, and is
verified from an external disposable project directory.

## Deferred

Cloudflare/Gemini adapters, account-specific live-provider verification,
advanced model benchmarking, richer dialogs and V1 memory/decomposition remain
outside the evidenced v0.1 slice. Cross-platform native packaging and signed
public distribution remain future release work.
