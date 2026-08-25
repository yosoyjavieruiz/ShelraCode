# ShelraCode agent-v1 architecture

The production path is host-controlled:

```text
TUI input
 -> turn mode/policy
 -> bounded repository context
 -> capability-aware route
 -> normalized provider adapter
 -> agent loop and task ledger
 -> schema/permission/workspace guards
 -> typed tool result
 -> host verification and objective review
 -> completion gate
 -> presentation events
```

The model proposes text or actions; it does not own permission, task state,
verification, or completion. `src/agent/loop.ts` owns the execution lifecycle,
`src/agent/task-state.ts` owns the ledger, and `src/tui/app.tsx` supplies the
repository-specific host criteria and route policy.

For a small local model, explicit multi-file paths are staged one target at a
time. For sufficiently complex objectives without explicit paths, the host
may infer a small candidate set from objective-content search and apply the
same guarded staging. A passing verification stage advances the next target.
This is a measured accessibility path, not a claim that raw 1.5B reasoning
equals a frontier model on arbitrary repositories.

Detailed kernel source mapping: [docs/agent-kernel/ARCHITECTURE.md](../agent-kernel/ARCHITECTURE.md).
