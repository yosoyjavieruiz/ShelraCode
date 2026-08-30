# CLAUDE.md — ShelraCode harness layer

Concise navigation + invariants for Claude Code. This file is a **map, not an
encyclopedia** (audit charter §59). Detail lives behind the pointers below.

`.claude/` is the **Claude Code harness** (agents, skills, hooks, commands) and
is *ours* to maintain. It is deliberately **decoupled from the ShelraCode
product runtime**: the product loads Skills only from `.agents/skills/` — never
from `.claude/`. Do not re-couple them.

## Product identity (do not replace)

ShelraCode is **a local-first, privacy-aware coding agent for the terminal**,
targeting strong software-engineering autonomy on small local models (~1–14B).
Full definition: `docs/PRODUCT.md`. Agent build rules: `AGENTS.md`.

## Product invariants (from `AGENTS.md` — authoritative there)

1. Privacy hard gates precede model quality.
2. `strict-zero` never intentionally executes a paid route.
3. Local is a first-class execution path.
4. Core logic must not import TUI; provider objects must not leak into the core.
5. Never destroy user Git work as rollback.
6. "Types compile" is not proof — exercise the user-visible flow and show evidence.

## Current mode: AUDIT

We are performing a forensic SDD audit (see `docs/audit/`). While
`SHELRA_AUDIT_MODE=true` (set in `.claude/settings.json`):

- **No production modifications.** `src/`, `scripts/`, `tests/`, and build
  manifests are read-only. Enforced by `.claude/hooks/production-modification-guard.ts`.
  Explicit, authorized product changes require `SHELRA_ALLOW_PROD=1`.
- **Evidence first.** Every P0/P1/HIGH/CRITICAL finding needs an `evidence:`
  block. Enforced by `.claude/hooks/evidence-guard.ts`.
- **Discover, don't assume.** Never infer behavior from filenames; trace the
  real path and cite source lines, tests, or runtime traces.
- **Claude Code claims need current sources.** Do not state "Claude Code does X"
  from memory — consult current official docs and record the source + date.

## Where things live

| Need | Location |
| --- | --- |
| Product spec / architecture | `docs/PRODUCT.md`, `docs/ARCHITECTURE.md`, `docs/architecture/` |
| SDD capability specs (new) | `specs/` |
| Audit charter + methodology | `docs/audit/README.md` |
| Audit evidence / findings | `docs/audit/`, `docs/audit/findings/` |
| Research evidence (cited) | `docs/audit/research/` |
| Harness stack docs | `docs/audit/CLAUDE-AUDIT-STACK.md` |
| Audit agents / skills / hooks | `.claude/agents/`, `.claude/skills/`, `.claude/hooks/` |
| Product Skills (runtime) | `.agents/skills/` (NOT `.claude/`) |

## Stack

Bun 1.3+ · TypeScript ESM · SolidJS · OpenTUI · `bun:sqlite`. Tests:
`bun --conditions=browser test`. Typecheck: `tsc --noEmit`. Do not replace the
stack casually (`AGENTS.md`).
