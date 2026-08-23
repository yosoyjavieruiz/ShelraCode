# Acceptance

- [ ] Clean checkout installs with `bun install`.
- [ ] `bun run typecheck` passes.
- [ ] `bun test` passes without live provider credentials.
- [ ] `localcode --help` and `localcode --version` work.
- [ ] `localcode setup` reports hardware/runtime/provider/privacy state.
- [ ] `localcode doctor` emits safe diagnostics.
- [ ] TUI launches from the current source, accepts input, opens palette/centers, and restores the terminal on exit.
- [ ] Local/fake-provider agent fixture reads, edits, tests, and reports a result.
- [ ] Privacy fixture excludes secrets and blocks non-compliant remote routes.
- [ ] Strict-zero fixture never calls a healthy paid adapter.
- [ ] Provider failures normalize without crashing and route explanations match decisions.
- [ ] Checkpoint rollback preserves unrelated external edits.
