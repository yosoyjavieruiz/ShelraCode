# Tool Errors and Recovery

`ToolErrorCode` is the stable machine-readable boundary:

`INVALID_ARGUMENT`, `NOT_FOUND`, `PATH_NOT_FOUND`, `PATH_IS_FILE`,
`PATH_IS_DIRECTORY`, `OUTSIDE_WORKSPACE`, `PERMISSION_DENIED`, `BINARY_FILE`,
`OUTPUT_TRUNCATED`, `COMMAND_FAILED`, `COMMAND_TIMEOUT`, `TEST_FAILED`,
`STALE_EDIT`, `CONFLICT`, `RUNTIME_UNAVAILABLE`, `MODEL_ERROR`, and
`CANCELLED`.

Each error carries `recoverable`, and may carry `field`, `path`, and
`suggestedAction`. The agent loop serializes this structured observation into
the next model request and keeps the task alive for recoverable failures.

Examples:

- `ListFiles(file)` -> `PATH_IS_FILE`, use `ReadFile`.
- invalid `ReadFile` range or hidden host argument -> `INVALID_ARGUMENT`.
- missing path -> `PATH_NOT_FOUND`, search or inspect its parent.
- external edit after checkpoint -> `STALE_EDIT`, reread before retrying.
- aborted process/provider -> `CANCELLED`, task phase `cancelled`.
- provider crash -> task status `failed` with a persisted blocker.

Repeated identical calls or repeated same-code failures trigger the
non-progress watchdog. This protects the task lifecycle; it is not a local
inference usage quota.

The Phase 9 recovery boundary additionally normalizes failures into the shared
`FailureClass` taxonomy in `src/agent/recovery.ts`, hashes action/state/failure
signatures, and evaluates a bounded `RecoveryPolicy`. A repeated failure must
change strategy (relocalize, re-encode, rollback, escalate, or stop); security
and cancellation failures remain terminal.

Execution results are normalized at the agent-loop boundary: a non-zero
`RunTests` exit becomes recoverable `TEST_FAILED` evidence and a non-zero
`Shell` exit becomes recoverable `COMMAND_FAILED` evidence. The structured
result remains available to the host/UI, while the next model request receives
bounded output (4,000 characters for command/test output and 8,000 for other
tool text) with an explicit truncation marker.
