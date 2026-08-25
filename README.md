# LocalCode

LocalCode is a Bun/TypeScript terminal coding agent with a local-first,
privacy-gated and strict-zero routing policy.

## Run

```bash
bun install
bun run typecheck
bun test
bun run src/index.ts
```

The first interactive launch opens the onboarding flow and continues directly
into the workspace when it finishes. The normal CLI entry point is `localcode`
when the package is installed or linked. The repository scripts use `bun run`
so the source path is explicit.

Useful commands:

```text
localcode setup       reopen onboarding intentionally
localcode doctor      print safe diagnostics
localcode models      inspect normalized model state
localcode providers   inspect provider readiness
localcode config      show effective global and repository policy
localcode              onboarding on first run, then open the full-screen TUI
```

## Safety defaults

- Repository privacy defaults to `private`.
- Routing defaults to `strict-zero`.
- Paid routes are never selected by strict-zero.
- `.env*`, credential-shaped paths and high-confidence secret findings block
  cloud routing.
- LocalCode checkpoints only its own file mutations and refuses rollback over
  an external change.
- Remote telemetry is not implemented.

Provider credentials are read from environment variables. A credential alone
does not establish free billing or private-data eligibility. The current
provider confirmations are explicit environment controls documented in
`docs/PROVIDERS.md` and `.env.example`.

## Build and verify

```bash
bun run format:check
bun run typecheck
bun test
bun run build
bun run smoke
```

`bun run build` creates `dist/index.js` plus OpenTUI parser/native runtime
assets. The native OpenTUI package remains an external runtime dependency so
the bundle uses the matching platform artifact installed by `bun install`.

## Scope

The v0.1 vertical slice includes hardware fallback and optional llmfit
integration, local runtime discovery, normalized OpenAI-compatible providers,
privacy-aware context, strict-zero routing, a provider-independent agent loop,
checkpointed tools, SQLite state, TUI centers and fixture tests. Cloudflare,
Gemini and an OpenCode/Zen paid adapter are intentionally not advertised as
automatic free routes until their current account and privacy behavior can be
verified for the configured account.

See `docs/STATUS.md`, `docs/ACCEPTANCE.md` and `docs/RESEARCH-SNAPSHOT.md` for
current evidence and limitations.
