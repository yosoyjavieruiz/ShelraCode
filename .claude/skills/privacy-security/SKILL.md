---
name: privacy-security
description: Use when auditing ShelraCode against its local-first, privacy-aware guarantees — network/provider routing, secrets, strict-zero/local-only modes, shell/filesystem/process sandboxing, approvals, telemetry, and log redaction. Maps each check to a product invariant.
---

# Privacy & security

Measure guarantees against product invariants, not stated intentions. A violated
privacy invariant is at least P1.

## Invariant checklist (from AGENTS.md / docs/PRODUCT.md)
1. Privacy hard gates precede model quality.
2. `strict-zero` never intentionally executes a paid route (stops when billing
   unverified or free capacity is exhausted).
3. Local remains a first-class execution path.
4. Never send secrets to remote providers; never harvest third-party credentials.
5. Never destroy user git work as rollback.
6. No remote telemetry by default.
7. Every routing decision is explainable.

## Attack/leak surfaces to trace
- Network egress + provider routing paths; what leaves the machine and when.
- Secret handling in requests, tests, fixtures, logs, screenshots.
- Shell permission model, filesystem escape, symlink traversal, destructive
  commands, process isolation/policy.
- User-approval flow (approve once / session / project / deny / cancel).
- Persisted conversations + log redaction.

## Method
Trace real egress and permission code paths; cite `file:line`. Never place real
credentials anywhere. Prove local-only / strict-zero with evidence, not config
labels alone.
