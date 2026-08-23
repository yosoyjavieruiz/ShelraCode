# Decisions

## ADR-001: Single Bun package

**Date:** 2026-08-23  
**Decision:** Use one strict TypeScript ESM Bun package.  
**Context:** v0.1 has a seven-calendar-day product boundary.  
**Alternatives:** monorepo, service split, hosted backend.  
**Reason:** keeps the execution path local, inspectable, and testable without infrastructure.  
**Consequence:** modules must maintain explicit directional boundaries.

## ADR-002: OpenTUI Solid with pinned peer

**Date:** 2026-08-23  
**Decision:** Use `@opentui/core`, `@opentui/solid`, `@opentui/keymap` 0.5.7 and `solid-js` 1.9.12.  
**Context:** current official OpenTUI docs require Solid 1.9.12 exactly.  
**Alternatives:** Core-only imperative UI, React binding, unpinned Solid.  
**Reason:** Solid gives fine-grained streaming state while respecting the current compatibility contract.  
**Consequence:** Bun preload and JSX settings are mandatory.

## ADR-003: Strict-zero deny by default

**Date:** 2026-08-23  
**Decision:** credentials do not establish free billing, privacy, or ZDR; uncertain routes are excluded.  
**Context:** provider policies and quotas are volatile and provider docs currently distinguish free allocations, paid overage, and data improvement.  
**Alternatives:** optimistic free inference, user-managed provider list only.  
**Reason:** unexpected spending and privacy violations are P0 failures.  
**Consequence:** setup may show unverified readiness, but routing stops until evidence is configured.

## ADR-004: Native bun:sqlite

**Date:** 2026-08-23  
**Decision:** use Bun's native SQLite driver behind repositories.  
**Context:** v0.1 needs sessions, quota, health, routes and checkpoints without a server database.  
**Alternatives:** Postgres, Supabase, ORM, JSON files only.  
**Reason:** local-first persistence and low dependency surface.  
**Consequence:** database migrations and typed repositories are part of the package.

## ADR-005: Zen is paid, not free

**Date:** 2026-08-23  
**Decision:** OpenCode Zen is a paid provider boundary and never an automatic free route.  
**Context:** current official Zen docs describe billing details and per-request charges.  
**Reason:** the product invariant outranks the initial provider list.  
**Consequence:** the adapter can exist for explicit future paid mode without appearing as free capacity.
