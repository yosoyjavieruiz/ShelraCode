# Acceptance

Evidence below is from the current checkout on 2026-08-24. Configured provider
health/model discovery is observed; account-specific free billing, quota and
privacy policy are deliberately not asserted.

- [x] `bun install --frozen-lockfile` completed with no changes.
- [x] `bun run format:check` passed.
- [x] `bun run typecheck` passed.
- [x] Canonical `bun run test` passed: 306 tests, 1032 expectations. The
      package command supplies `--conditions=browser`, required by the OpenTUI /
      Solid test runtime.
- [x] Source and bundle `--help`, `--version` and `doctor` smoke passed.
- [x] `localcode setup --non-interactive` reported hardware, runtimes, model fit, policy and routing state; repository settings persisted under `.localcode/config.json`.
- [x] `bun run catalog:refresh` completed and wrote 437 normalized models to the ignored `.localcode/model-catalog.json`; the snapshot contained no credential-like fields.
- [x] Current-source and bundled OpenTUI TUI launched through a real PTY; the command palette rendered, the bundled 80-column shell drew through the default `TERM=dumb` environment after the Windows bootstrap repair, and `/exit` restored the terminal. The isolated OpenTUI renderer lifecycle smoke exited with code 0.
- [x] Agent fixture read, edited, ran a deterministic test and returned a verified result.
- [x] Rebuilt bundle completed a real local LM Studio/Qwen read-only task through `ListFiles`; no cloud request or file mutation occurred.
- [x] Privacy fixture excluded `.env` and credential-shaped content, redacted high-confidence secrets, and blocked non-compliant cloud routing.
- [x] Strict-zero routing excluded an exhausted free route and a healthy paid route.
- [x] Provider contract tests covered normalized discovery, streaming/tool-call aggregation, usage, authentication, quota, billing, capacity, timeout and malformed responses.
- [x] Routing integration exercised local failure, free-provider circuit
      opening, compliant free fallback, and per-task pre-mutation route retry.
- [x] Checkpoint tests restored LocalCode-owned content and refused to overwrite an external edit.
- [x] TUI renderer tests covered 80, 100, 120 and 160 columns.

## Not established by this acceptance run

- Groq and OpenRouter health/model discovery were observed with the configured local environment credentials; no inference request was made, and free billing, quota and privacy eligibility were not verified. Zen was not configured.
- No llmfit installation was available; fallback hardware detection was the
  observed path.
- No standalone `.exe` was produced. `dist/index.js` is the verified Bun
  bundle; its OpenTUI native package remains an external platform dependency.
- Cloudflare and Gemini are not registered user-facing providers in v0.1.
- The automated PTY wrapper reports code 1 after injected interactive `/exit` or Ctrl+C even though terminal cleanup is visible; this status is not yet confirmed against the user's native terminal host.
