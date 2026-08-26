# Agent evaluation fixtures

The evaluation matrix creates each fixture in a disposable operating-system
temporary directory at runtime. This directory documents the fixture boundary
without putting mutable repositories in the checkout.

`tests/evals/agent-journeys.ts` is the source of truth for the fixture revision
`agent-evals-2026-08-26-v1`. It covers TypeScript/Bun, Python, Go, Git, dirty
worktrees, failed tests, greenfield files, compaction pressure, resume, and
strict-zero routing. Every run removes its temporary repository and database.
