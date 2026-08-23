# Testing

## Unit

Privacy path/content matching, strict-zero filtering, scoring, quota parsing, circuit breaker, provider errors, freshness, context budgets, checkpoint conflicts, and capability filters use deterministic tests.

## Contract

Fake HTTP responses exercise each provider adapter for discovery, health, stream normalization, usage, quota, 401/403/429/5xx, timeout, abort, and malformed response behavior.

## Integration/E2E

Fixture repositories exercise the agent loop, tools, verification, privacy exclusion, strict-zero paid exclusion, route fallback, rollback conflict, and cancellation without external providers.

## TUI

OpenTUI `testRender` covers the app frame at 80/100/120/160 columns and focused composer/dialog rendering. A real PTY smoke launches the current source, verifies help/version and the interactive launch/exit path; output is never treated as proof until the process terminates cleanly.

## Live smoke

Optional and credential-gated. It never runs in CI and cannot be the only proof of provider contract behavior.
