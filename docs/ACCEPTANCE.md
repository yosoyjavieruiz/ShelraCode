# Acceptance

Evidence below is from the current checkout on 2026-08-24. Configured provider
health/model discovery is observed; account-specific free billing, quota and
privacy policy are deliberately not asserted.

## Current source update — 2026-08-25

The previous count and checks below are retained as dated acceptance history.
The current source additionally passes:

```text
bun run test       -> 474 pass / 1 skip / 0 fail
bun run typecheck  -> PASS
bun run build      -> PASS; dist/index.js rebuilt from current source
bun run smoke      -> PASS for source and bundle help/version/doctor
bunx prettier --check README.md and changed routing docs -> PASS
```

The active router no longer rejects a policy-valid local candidate solely
because its empirical class is `chat_only`, `workspace_reader`, or unmeasured.
A direct discovery/selection check selected the actual
`lm-studio/qwen2.5-coder-1.5b-instruct` candidate for a complex debugging task
when it was the only local candidate; it exposed tools and had no route
rejections. This proves selection behavior, not successful completion of an
arbitrary complex task.

The latest regression pass also proves the path-domain boundary: a dependency
name such as `Moment.js` is not staged as a file, a real `index.html` target is
canonicalized before mutation, and blocked writes are shown as blocked rather
than successful writes. Create, edit, overwrite, and destructive delete
operations now return bounded diff evidence and typed path errors.

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

- Groq and OpenRouter credentials are present and source/tests verify their
  no-paid policy: Groq is quota-bearing Free and OpenRouter filters paid model
  records. No inference request was made in this acceptance run, so live
  account quota/health/privacy behavior remains unverified. Zen was not configured.
- No llmfit installation was available; fallback hardware detection was the
  observed path.
- No standalone `.exe` was produced. `dist/index.js` is the verified Bun
  bundle; its OpenTUI native package remains an external platform dependency.
- Cloudflare and Gemini are not registered user-facing providers in v0.1.
- The automated PTY wrapper reports code 1 after injected interactive `/exit` or Ctrl+C even though terminal cleanup is visible; this status is not yet confirmed against the user's native terminal host.
