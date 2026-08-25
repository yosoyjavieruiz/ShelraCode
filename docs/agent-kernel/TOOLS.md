# Kernel Tools

The current inventory is deliberately small:

| Tool         | Risk            | Contract                                                       |
| ------------ | --------------- | -------------------------------------------------------------- |
| `ReadFile`   | read            | path plus optional line range; host-owned truncation           |
| `ListFiles`  | read            | directory listing; file path returns `PATH_IS_FILE`            |
| `GlobFiles`  | read            | bounded filename glob                                          |
| `SearchText` | read            | bounded regex search; invalid regex is typed                   |
| `EditFile`   | workspace-write | exact replacement with checkpoint/stale-edit protection        |
| `CreateFile` | workspace-write | new file only; refuses to overwrite an existing path           |
| `WriteFile`  | workspace-write | full-content create/overwrite with operation and diff evidence |
| `DeleteFile` | destructive     | one-file delete with checkpoint and explicit approval          |
| `Shell`      | execute         | bounded command, timeout, cancellation, sanitized environment  |
| `RunTests`   | execute         | structured command, exit code, counts, failures, output        |
| `GitStatus`  | read            | concise status; command failure is typed                       |
| `GitDiff`    | read            | bounded diff; command failure is typed                         |

Every model-visible schema is closed with `additionalProperties: false` where
appropriate. Host defaults such as read size, output limits, workspace root,
timeouts, and encoding are not model decisions.

Mutation creates a checkpoint before the first write. A later write must match
the checkpoint's latest hash; otherwise it returns `STALE_EDIT` and does not
overwrite the user's edit.

`Shell` and `RunTests` keep their structured exit/output fields for host-side
verification, but the loop marks non-zero exits as typed recoverable failures
(`COMMAND_FAILED` or `TEST_FAILED`). Model-facing tool observations are
bounded so a noisy test command cannot consume the entire continuation
context.

## Current contract verification — 2026-08-24

- `ReadFile` keeps `maxChars` host-only, validates line ranges, and returns a
  typed `BINARY_FILE` observation for NUL-containing content.
- `SearchText` advertises canonical `query`/`path?`/`glob?` inputs, accepts the
  historical `pattern` alias for compatibility, and returns bounded
  `{ path, line, column?, preview }` matches.
- `Shell` returns `command`, `cwd`, `exitCode`, `stdout`, `stderr`,
  `durationMs`, and `timedOut`; non-zero exit semantics remain recoverable at
  the agent-loop boundary.
- mutation results identify whether the host created, overwrote, edited, or
  deleted the target and carry bounded line-level diff evidence;
- `CreateFile` refuses `PATH_EXISTS`; `DeleteFile` never recursively removes
  directories and cannot bypass destructive approval;
- a rejected or invalid request is presented as a typed blocked observation,
  not as a successful write activity.
- The focused tool/policy tests and canonical suite pass after this contract
  pass: `311 pass / 0 fail / 1052 expectations` under `bun run test`.
