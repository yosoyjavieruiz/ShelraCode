# Verification and completion

Coding completion is host-owned. The loop requires objective satisfaction,
required verification evidence, final diff review, user-work preservation, and
no unresolved blockers. Provider stop generation is not completion.

Current fresh evidence:

```text
bun run test       -> 474 pass / 1 skip / 0 fail
bun run typecheck  -> PASS
bun run build      -> PASS before the latest context/plan edits; rerun at handoff
bun run smoke      -> PASS before the latest context/plan edits; rerun at handoff
```

The disposable current-source LM Studio Qwen2.5 Coder 1.5B Q8_0 complex
fixture completed in 9 turns with three staged mutation/verifications and
truthful host completion. This remains bounded fixture evidence, not
arbitrary-repository frontier parity.

## Handoff evidence - 2026-08-25

The latest deterministic run is 474 pass / 1 skip / 0 fail / 1529
expectations. Typecheck, build, CLI smoke and the scoped formatting gate all
pass. The rebuilt bundle TUI was exercised at 80 columns: a greeting used no
repository tools, reached the verified completion state, and Ctrl+C restored
the terminal.

The exact Qwen2.5 Coder 1.5B Instruct / LM Studio / Q8_0 configuration passed
two consecutive final runs of the disposable three-file fixture. Each run
completed in 10 turns, reported completed and verified, changed only expected
fixture files, and passed three host-controlled verification stages.
