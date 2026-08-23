# LocalCode v0.1 MVP Design

## Intent

Build a one-package Bun/TypeScript terminal coding agent whose default policy is private/local and strict-zero. The MVP favors a complete safe vertical slice over decorative provider breadth.

## Architecture

The CLI parses non-interactive commands before loading the TUI. The TUI uses OpenTUI Solid and receives state from an application service. Domain types are adapter-independent. Storage is SQLite. Providers and local runtimes expose normalized interfaces. The router applies privacy and cost gates before capability and score.

## Vertical slice

The first proof path is a fixture task: classify a request, build sanitized context, choose a local/fake route, stream text/tool calls, check permissions, mutate through checkpointed tools, run deterministic tests, and return an explainable completion. A second path simulates local verification failure, a free provider 429, circuit opening, and a compliant fallback. A third proves private secret blocking and paid exclusion.

## TUI

Use a top bar, transcript scrollbox, composer, status bar, palette and center dialogs. The initial user-visible state must render without external probes. All long probes are asynchronous and cancellable. OpenTUI renderer destruction is the terminal cleanup boundary.

## Research-driven constraints

OpenTUI's current Solid contract pins `solid-js` 1.9.12. llmfit is optional. Groq/OpenRouter/Cloudflare free capacity is volatile and must be confirmed/fresh. Gemini Free is public-only by default. OpenCode Zen is paid according to current official docs and is excluded from strict-zero.

## Error model

Provider errors normalize to auth, quota, billing, model, capability, context, capacity, timeout, network, bad request, privacy and unknown categories. Router explanations store every gate outcome. Policy failures stop rather than silently degrade.

## Testing

Unit tests target the policy moat. Integration tests use fake providers and fixture repositories. TUI tests use OpenTUI's headless test renderer; a real PTY smoke covers help/version, launch, input, command palette, cancellation and exit. Live providers are optional and never required for release proof.

## Explicit deferrals

No automatic paid mode, hosted accounts, embeddings, browser automation, provider credential harvesting, advanced model benchmarking, or background daemon. Cloudflare/Gemini are adapter-ready but remain policy-limited if current account evidence is insufficient.
