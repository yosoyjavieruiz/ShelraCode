# Active ShelraCode call graph

Evidence status is verified_local unless explicitly marked UNPROVEN. This
graph follows the source entrypoint exercised by the audit.

```text
CLI/TUI input
  -> src/index.ts:14-47
  -> src/tui/launch.tsx:11+
  -> src/tui/app.tsx:2250+
  -> runTask()
  -> turn classification and policy
  -> repository context/compiler when policy.repositoryRead
  -> control-plane model/runtime discovery and capability probe
  -> router/selectRoute()
  -> provider adapter stream
  -> runAgent()
  -> permission and schema validation
  -> workspace tool executor
  -> normalized ToolResult returned to the model
  -> continuation or terminal decision
  -> verification and final diff review
  -> completion gate / task status
  -> AppEventBus
  -> presentation adapter/event buffer
  -> OpenTUI transcript and composer
```

## Source proof

| Edge                        | Source proof                                                                                               | Status         |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------- |
| CLI -> TUI                  | src/index.ts:14-47 imports and calls launchTui for no args/--tui                                           | verified_local |
| TUI lifecycle -> renderer   | src/tui/launch.tsx:11+ creates the CLI renderer, installs signal handling, and destroys it during teardown | verified_local |
| User submit -> task         | src/tui/app.tsx:2250+ invokes runTask from the composer/session action                                     | verified_local |
| Task -> turn policy         | src/tui/app.tsx:1031+, src/agent/turn-policy.ts:259+                                                       | verified_local |
| Direct fact -> host context | src/tui/app.tsx:1094+, src/context/repository.ts:217+                                                      | verified_local |
| Context -> route request    | src/tui/app.tsx:1189+, src/router/router.ts:142+                                                           | verified_local |
| Route -> provider           | src/tui/app.tsx:1250+, provider registry/control-plane imports                                             | verified_local |
| Provider stream -> kernel   | src/providers/types.ts, src/providers/openai-compatible.ts:357+, src/agent/loop.ts:1099+                   | verified_local |
| Kernel -> tools             | src/agent/loop.ts:454+ receives tool map and executes validated calls                                      | verified_local |
| Tool -> structured failure  | src/tools/errors.ts, src/tools/workspace.ts                                                                | verified_local |
| Mutation -> checkpoint      | src/tui/app.tsx:1252+, src/checkpoint/checkpoint.ts, src/agent/loop.ts:742+                                | verified_local |
| Verification -> completion  | src/agent/verifier.ts, src/agent/completion-gate.ts, src/agent/loop.ts:843+, 950+, 1588+                   | verified_local |
| Kernel -> presentation      | src/tui/app.tsx event subscription and src/tui/presentation/adapter.ts                                     | verified_local |
| Presentation -> OpenTUI     | src/tui/app.tsx, views/components under src/tui                                                            | verified_local |

## Important boundaries

- Core agent modules do not import TUI modules in the inspected path.
- Provider-specific response objects terminate in the provider adapter.
- Tool calls are separate provider events and do not enter the assistant text
  buffer in the tested paths.
- The source graph proves the source runtime, not a separately rebuilt
  standalone executable.

## Unproven or incomplete edges

| Question                                                                                 | Status                                                                                       |
| ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Does every advertised provider have fresh live tool-loop evidence?                       | UNPROVEN; only LM Studio was exercised                                                       |
| Is the current dist/index.js reproducibly attributable to this exact dirty source state? | UNPROVEN                                                                                     |
| Is there a production Explore/Build/Verify delegation path?                              | UNPROVEN; no active subagent path found                                                      |
| Does trace persistence capture every graph edge as JSONL with stable IDs?                | UNPROVEN; current recorder is opt-in and console-sink based                                  |
| Does the real TUI meet 80/100/120/160-column keyboard/resize requirements?               | UNPROVEN by this audit; automated coverage exists but is not equivalent to every PTY journey |
