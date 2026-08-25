# ShelraCode final audit

Date: 2026-08-25

## Delivered outcome

The current source contains a functional, controller-owned coding-agent
vertical for low-resource local models. It separates conversation from
workspace work, controls tools by turn policy, compiles bounded context,
tracks evidence and task state, normalizes tool failures, stages localized
mutations, verifies after each stage, reviews the objective and diff, and
blocks unearned completion.

The 1.5B route is intentionally progressive. It is suitable for bounded,
explicitly localized work after the exact model/runtime configuration passes
capability checks. It is not advertised as an unrestricted replacement for a
frontier model on arbitrary repositories.

## Current proof

    bun run typecheck -> PASS
    bun run test      -> 474 pass / 1 skip / 0 fail / 1529 expectations
    bun run build     -> PASS
    bun run smoke     -> PASS
    scoped Prettier   -> PASS

The rebuilt dist/index.js was exercised through the real TUI entrypoint at
80 columns. A greeting used no repository tools, reached the verified
completion state, Ctrl+C restored the terminal, and the process exited
successfully.

The exact Qwen2.5 Coder 1.5B Instruct / LM Studio / Q8_0 configuration passed
two consecutive final runs of a disposable three-file fixture. Each run:

- completed in 10 turns;
- reported completed with verified=true;
- passed three host-controlled verification stages;
- changed only the expected fixture files;
- did not mutate the user worktree.

## Regression coverage

The deterministic suite covers greeting discipline, repository evidence,
read-file defaults, typed PATH_IS_FILE handling, malformed/partial tool
streams, permission boundaries, recoverable tool errors, fresh-read recovery,
verification failure, false completion, cancellation, dirty worktree
preservation, capability routing and TUI state.

## Release boundary

The current release surface is the TypeScript source and dist/index.js
bundle. A standalone product .exe is not present in this checkout, so an exe
release claim is not made.

The following remain explicitly open rather than silently promoted to PASS:

- full live contract coverage for every configured provider/runtime;
- repeated arbitrary-repository super-complex tasks;
- a complete capability matrix across all local model sizes and templates;
- full PTY resize/width acceptance beyond the exercised 80-column journey;
- unrestricted 1.5B long-horizon architecture work.

The next engineering gate is to expand the disposable benchmark and live
provider matrix while preserving the current deterministic safety and
completion guarantees.

The agent doctor now reports all executable local candidates and aggregate
progressive/bounded/autonomous readiness. It does not treat an llmfit
recommendation as an executable model, and it selects the strongest measured
local profile for the detailed diagnostic.
