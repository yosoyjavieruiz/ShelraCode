# Agent Kernel Security

- All workspace paths are resolved and checked under the task root.
- Repository writes require policy permission and a checkpoint.
- Stale or externally changed checkpoint files are never silently overwritten.
- Shell/test processes receive a bounded timeout and `AbortSignal`; sensitive
  environment variable names are filtered from tool execution.
- Noisy command/test output is bounded before it is sent into a model
  continuation; non-zero exits are typed as recoverable command/test evidence.
- Verification discovery parses only allowlisted command forms from manifests,
  recognized targets, and documentation; shell operators and mutating format
  flags are rejected rather than copied into an automatic verification plan.
- Read-only, plan, and review modes do not expose write tools.
- Strict-zero/local-only routing rejects paid or unverified remote routes.
- Context redacts sensitive paths/content and does not preload `.agents` skill
  documents as repository evidence.
- Tool arguments are schema-validated before execution and raw tool payloads
  are not emitted as assistant transcript text.
- Developer traces are opt-in and redact secret-shaped fields; hidden model
  reasoning and raw prompts are not traced.
- The kernel does not enable arbitrary remote code execution or
  `trust_remote_code` by default.

Remaining security work includes a stronger shell sandbox below the controller,
adversarial repository prompt-injection tests, and isolated worktrees for any
future parallel writers.

## Logging boundary - 2026-08-24

Structured logs are opt-in and redact secret-shaped keys, bearer tokens, common
provider token prefixes, long values, circular values, and oversized arrays or
objects before a custom or file sink receives them. Agent/provider/process logs
store lengths, counts, exit codes, error codes, paths, and identifiers; they do
not store raw prompts, assistant messages, file contents, shell output, or tool
argument JSON. Log files can still reveal repository paths, command names,
model IDs, and timing, so they remain local test artifacts and are not sent to
remote models. Long-term rotation and deletion are currently operator-owned.
