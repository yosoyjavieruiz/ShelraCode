# Audit trace status

No synthetic trace has been written here. The audit does not fabricate raw
runtime events from memory.

The current source trace recorder is src/agent/trace.ts. It is opt-in through
LOCALCODE_AGENT_TRACE=1, redacts secret-shaped fields, excludes raw prompts
and hidden reasoning, and defaults to a JSON console sink.

Current event types are:

```text
task.started
context.built
route.selected
turn.started
tool.observed
verification.observed
task.completed
task.blocked
task.failed
task.cancelled
```

This is sufficient for developer diagnostics but not for the requested
per-turn JSONL evidence package. A future implementation should persist
stable session, turn, task, model-request and tool-call IDs and add context,
phase, plan, tool-start/completion/failure, route-change and verification
records without exposing secrets or hidden reasoning.
