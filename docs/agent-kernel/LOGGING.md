# LocalCode observability and logs

Checked 2026-08-24 against the active source path in `src/tui/app.tsx`,
`src/cli/control-plane.ts`, `src/agent/loop.ts`, and the normalized provider
adapters.

## Enable logs for a test session

Structured logs are disabled by default. In PowerShell, use a disposable
workspace or a path that is already excluded from Git:

```powershell
$logDir = Join-Path $PWD ".localcode\logs"
New-Item -ItemType Directory -Force $logDir | Out-Null
$env:LOCALCODE_LOG_LEVEL = "debug"
$env:LOCALCODE_LOG_PATH = Join-Path $logDir "agent.jsonl"
$env:LOCALCODE_LOG_STDERR = "0"
$env:LOCALCODE_AGENT_TRACE = "1"
```

For a short interactive run, logs can go to the terminal instead:

```powershell
$env:LOCALCODE_LOG_LEVEL = "info"
$env:LOCALCODE_LOG_PATH = ""
$env:LOCALCODE_LOG_STDERR = "1"
```

The `.env.example` values keep logging off until a tester explicitly enables
it. `LOCALCODE_AGENT_TRACE=1` also enables the legacy developer trace; it does
not change routing, permissions, privacy, or model selection.

## Record contract

Each JSONL line is a `LogRecord`:

```json
{
  "timestamp": "2026-08-24T12:00:00.000Z",
  "level": "info",
  "event": "agent.tool.finished",
  "context": {
    "component": "agent.loop",
    "taskId": "task-123",
    "turnId": "turn-2",
    "providerId": "lm-studio",
    "modelId": "qwen2.5-coder-7b-instruct"
  },
  "data": {
    "tool": "SearchText",
    "ok": true,
    "matchCount": 3
  }
}
```

The correlation fields are host-owned. They allow a tester to reconstruct one
task without relying on assistant prose:

```text
sessionId -> taskId -> turnId -> provider/model -> tool/process -> verification
```

The logger records metadata and bounded summaries, not hidden reasoning. It
does not log raw prompts, assistant message content, file contents, shell
stdout/stderr, tool JSON arguments, API keys, authorization headers, or secret
environment values. Secret-shaped fields are redacted again immediately before
each sink, including custom test sinks.

## Event areas

| Area              | Representative events                                                                              | What it answers                                                     |
| ----------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| TUI/control plane | `control-plane.opened`, `tui.task.started`, `tui.task.finished`                                    | Which user-visible task/session was running?                        |
| Context           | `context.discovery.started`, `context.discovery.finished`, `context.discovery.failed`              | What evidence was selected and how much context was built?          |
| Routing           | `route.selection.started`, `route.candidate.rejected`, `route.selected`, `route.fallback.selected` | Why was a model/runtime eligible or rejected?                       |
| Agent loop        | `agent.task.started`, `agent.turn.started`, `agent.model.response`, `agent.phase.transition`       | Where was the lifecycle and how many turns occurred?                |
| Tools             | `agent.tool.started`, `agent.tool.finished`, `tool.permission.*`                                   | Which bounded action ran, did it succeed, and was it allowed?       |
| Processes         | `process.started`, `process.finished`, `process.timed_out`, `process.cancelled`                    | Did Git, search, shell, or tests finish, fail, time out, or cancel? |
| Checkpoints       | `checkpoint.*`, `storage.checkpoint.*`                                                             | Was user work captured, preserved, stale, or conflicting?           |
| Providers         | `provider.request.started`, `provider.response.received`, `provider.stream.completed`              | Did the adapter reach the runtime and complete the stream?          |
| Runtime           | `runtime.health.*`, `runtime.models.*`, `runtime.discovery.*`                                      | Was LM Studio/Ollama/OpenAI-compatible discovery healthy?           |
| Verification      | `agent.verification.started`, `agent.verification.finished`, `agent.completion.evaluated`          | What evidence allowed or blocked completion?                        |
| Persistence       | `storage.session.*`, `storage.task.persisted`, `storage.route.recorded`                            | Was task/session state saved without recording content?             |

`error` records identify an operation that failed. `warn` records identify a
recoverable or policy-relevant condition such as a rejected route, denied
permission, stale edit, or failed test observation. A warning is not evidence
that the whole task failed.

## Inspect a run

The built-in report intentionally aggregates events instead of printing raw
records:

```powershell
bun run logs:inspect -- .localcode\logs\agent.jsonl
```

For ad-hoc filtering in PowerShell:

```powershell
Get-Content .localcode\logs\agent.jsonl |
  ForEach-Object { $_ | ConvertFrom-Json } |
  Group-Object event |
  Sort-Object Count -Descending
```

For a task timeline without content fields:

```powershell
Get-Content .localcode\logs\agent.jsonl |
  ForEach-Object { $_ | ConvertFrom-Json } |
  Where-Object { $_.context.taskId -eq "task-id-here" } |
  Select-Object timestamp, level, event, context, data
```

Useful questions and the evidence to find:

| Question                         | Events to inspect                                                                                        |
| -------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Why did it touch the repository? | `agent.task.started`, `agent.turn.started`, `context.discovery.*`                                        |
| Why was a model rejected?        | `route.candidate.rejected`, `route.none`                                                                 |
| Why did it stop?                 | `agent.completion.evaluated`, `agent.task.completed`, `agent.task.failed`, `agent.task.cancelled`        |
| Why did it retry?                | `agent.tool.finished` with an error code, `agent.tool.envelope_recovered`, `agent.non_progress.detected` |
| Why was completion blocked?      | `agent.criteria.evaluated`, `agent.verification.finished`, `checkpoint.preservation.failed`              |
| Did a test really pass?          | `process.finished` / `agent.verification.finished` with exit code and stage summaries                    |

## Retention and safety

Logs may reveal repository paths, model identifiers, command names, and timing.
Keep them local, add `.localcode/logs/` to ignore rules for any test fixture,
and remove them before sharing a repository or support bundle. Do not paste a
whole log file into an external provider. Use `logs:inspect` or a filtered
event subset first. Log rotation is currently an operator responsibility;
delete or archive old JSONL files between long experiments.
