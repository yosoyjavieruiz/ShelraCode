# Tool contract audit

## Current contract status

| Tool       | Validation and boundary                                                             | Error normalization                                                          | Status                                   |
| ---------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------- |
| ReadFile   | Workspace path, file/dir classification, binary guard, line/range and bounded chars | PATH_IS_DIRECTORY, BINARY_FILE, PATH_NOT_FOUND, INVALID_ARGUMENT             | Active; omission default verified        |
| ListFiles  | Stats target before enumeration; bounded depth/limit                                | PATH_IS_FILE, PATH_NOT_FOUND, command failure                                | Active; ENOTDIR regression passes        |
| GlobFiles  | Workspace path and bounded result set                                               | Typed path/command errors                                                    | Active                                   |
| SearchText | Bounded matches, regex validation, rg/fallback                                      | INVALID_ARGUMENT, command/path errors                                        | Active                                   |
| EditFile   | Exact edit, workspace policy, checkpoint/hash protection                            | conflict/stale edit and permission errors                                    | Active, live multi-file conflicts remain |
| CreateFile | New-file-only semantics, existing-parent check, checkpoint/hash protection          | PATH_EXISTS, path and permission errors                                      | Active; overwrite regression passes      |
| WriteFile  | Coding permission, workspace boundary, create/overwrite classification              | typed permission/path errors                                                 | Active; bounded diff evidence            |
| DeleteFile | File-only destructive operation, checkpoint/hash protection, approval               | PATH_NOT_FOUND, PERMISSION_DENIED, typed path errors                         | Active; no recursive delete              |
| Shell      | Workspace/cwd, network policy, timeout and abort signal                             | command failed/timeout/cancelled                                             | Active, not an OS sandbox                |
| RunTests   | Discovered/default command, bounded output                                          | nonzero execution is converted by the agent to test/command failure evidence | Active                                   |
| GitStatus  | Read-only structured status                                                         | typed command failure                                                        | Active                                   |
| GitDiff    | Read-only bounded diff                                                              | typed command failure                                                        | Active                                   |

## Important mismatch

The host accepts an omitted ReadFile.maxChars and applies an internal
20,000-character default. The model-facing schema currently does not expose
that optional field, so the regression is safe but continuation/range control
is not a fully explicit model contract yet.

## Error taxonomy

Current src/tools/errors.ts contains the requested core categories plus
project-specific aliases such as PATH_NOT_FOUND, STALE_EDIT, CONFLICT,
RUNTIME_UNAVAILABLE and MODEL_ERROR. This is useful for implementation but
needs one canonical public taxonomy before provider/runtime errors are treated
as stable API.

## Structural safety

The execution path is:

```text
tool request -> schema validation -> TurnPolicy -> workspace boundary
-> permission policy -> risk classification -> execution
```

Deterministic tests prove that a read-only repository-language turn cannot
execute EditFile. Shell remains a subprocess boundary with policy checks, not
a complete operating-system sandbox.
