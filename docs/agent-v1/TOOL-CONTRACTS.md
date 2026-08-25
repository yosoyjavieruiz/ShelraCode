# Tool contracts

The MVP tool surface is intentionally small: `ListFiles`, `GlobFiles`,
`SearchText`, `ReadFile`, `EditFile`, `CreateFile`, `WriteFile`,
`DeleteFile`, `Shell`, `RunTests`, `GitStatus`, and `GitDiff`.

File-domain ownership is explicit:

- `ReadFile` reads an existing file and rejects directories;
- `ListFiles` lists an existing directory and returns `PATH_IS_FILE` for a
  file path;
- `EditFile` changes exact text in an observed existing file;
- `CreateFile` creates a new file and refuses `PATH_EXISTS`;
- `WriteFile` writes complete content and reports `created` versus
  `overwritten`;
- `DeleteFile` removes one existing file only after destructive approval.

Mutation results contain a bounded, redaction-aware line diff and before/after
existence. The presentation layer displays the operation and path before it
displays a summary. Rejected requests are rendered as `BLOCKED`, with the
typed error and recovery hint, so a model request cannot look like a mutation
that actually happened.

Inputs are validated before execution, output is bounded, and failures are
typed (`INVALID_ARGUMENT`, `NOT_FOUND`, `PATH_IS_FILE`, `TEST_FAILED`,
`EDIT_CONFLICT`, `CANCELLED`, and related codes). A recoverable observation is
fed back to the agent as evidence instead of terminating the task.

The permanent regressions are covered by
[FAILURE-REPRODUCTIONS.md](FAILURE-REPRODUCTIONS.md).
