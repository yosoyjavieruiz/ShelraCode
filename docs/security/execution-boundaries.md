# Execution boundaries

ShelraCode treats model output as a request, never as authority. Model-facing
workspace tools cross `src/security/execution-broker.ts` before a side effect.

The broker currently enforces:

- workspace-root canonicalization and symlink-aware path checks;
- process working-directory containment and rejection of outside path
  arguments/shell escapes;
- strict-zero network policy before a child process is spawned;
- checkpoint and stale-edit checks before file writes/deletes;
- current certified Driver profile required for model-facing mutations;
- fail-closed local process allowlist when no OS isolation adapter exists;
- filtered child environments through the existing process runner;
- secret redaction for process output and live output before tool results,
  provider continuation, or persistence.

The existing permission/checkpoint services remain host-owned controls. The
broker does not widen permission mode or task authority; it is an additional
boundary underneath those services.

## Scope

This boundary covers model-requested `ReadFile`, `WriteFile`, `CreateFile`,
`EditFile`, `DeleteFile`, repository search/Git tools, `Shell`, and `RunTests`.
Host maintenance operations such as database migrations and checkpoint storage
remain trusted runtime internals and must not be exposed as model actions.

If a broker is supplied in a tool context, its root and network mode must match
the current task. A broker bound to another root or a weaker network policy is
rejected before execution. Model-facing contexts also reject a broker that
grants write authority or opaque process execution without a current certified
Driver profile; host-only compatibility callers are explicitly distinguishable
from that path.
