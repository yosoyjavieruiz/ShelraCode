---
name: localcode-agent-harness
description: Implement or review LocalCode's coding-agent loop, tools, context handling, permissions, verification, cancellation, checkpoints and task lifecycle.
---

# Agent Harness

Keep the loop provider-independent. Prefer deterministic verification. Every mutation tool passes the permission layer, every long operation accepts `AbortSignal`, and rollback never uses destructive Git commands. Preserve the user objective, active constraints, changed files, unresolved failures, and approvals. Keep the MVP tool inventory small.
