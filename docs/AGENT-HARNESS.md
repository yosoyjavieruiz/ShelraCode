# Agent Harness

The loop is provider-independent:

```text
task → context → normalized model stream → permission check
→ tool execution → result → model continuation → deterministic verification
→ completion or policy-safe reroute
```

MVP tools are read/write/edit/list/search, shell, Git status/diff, and test execution. Each has a risk class, input validator, structured result, and `AbortSignal` path. ASK is the interactive default and asks before every workspace action, including reads. PLAN allows read-only work automatically and asks before writes/execution; EDIT allows ordinary workspace edits and asks for destructive commands; AUTO allows safe in-scope work but never paid use, credential actions, force pushes, or destructive Git. A user approval is one-shot for the exact action.

Checkpoints snapshot each LocalCode-owned path before its first mutation. Rollback refuses to overwrite a file changed after the checkpoint and never uses `git reset --hard`, `git clean`, or broad checkout.
