# Competitor Gap: Effective Autonomous Engineering

Checked 2026-08-24. This is a capability gap analysis, not a feature-count
comparison. The comparison is against public current documentation and the
fresh LocalCode baseline in [BASELINE.md](BASELINE.md).

| Capability            | LocalCode now                                                                                               | Mature public pattern                                                                                                             | Gap consequence                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Iterative loop        | Multi-turn loop works with scripted providers; live local model can terminate after malformed/unknown calls | Codex describes repeated inference/tool/result iterations as the core harness; Claude Code and OpenCode expose tool-driven agents | Make observation, recovery, and stop conditions structured and testable                              |
| Intent and modes      | Four regex/task modes; plan and review are not structurally safe                                            | Public agents distinguish permissions, primary/subagent roles, and task execution controls                                        | Add the seven requested turn modes and derive tools from policy, not prose                           |
| Repository context    | Manifest-priority prompt string                                                                             | Codex aggregates scoped project instructions and environment context; Claude Code uses project instructions and Skills            | Build a deterministic repository snapshot, scoped instructions, and evidence ledger                  |
| Tool interface        | Small inventory with schema validation, but no GlobFiles and inconsistent errors                            | SWE-agent documents bounded file views, concise search, and edit validation                                                       | Complete bounded tool contracts and typed recovery observations                                      |
| Permissions/sandbox   | PLAN/EDIT/AUTO and approval heuristics; no central dispatcher or shell containment                          | Codex separates sandbox boundary, approvals, network policy, and audit telemetry; OpenCode has ordered permissions                | Enforce boundaries below the model and preserve exact approval decisions                             |
| Error recovery        | Loop feeds failures back; watchdog only recognizes repeated exact calls                                     | Mature agents continue through recoverable tool/test errors and replan                                                            | Add error taxonomy, reflect state, alternative strategy, and escalation evidence                     |
| Task state            | SQLite sessions/messages/routes/checkpoints but no authoritative task ledger                                | OpenCode compaction checkpoints and Codex long-running context preserve task state                                                | Add phases, success criteria, actions, evidence, blockers, plan, verification, and resume state      |
| Planning              | No structured plan state                                                                                    | Codex/Claude Code/OpenCode expose plan/context controls for complex work                                                          | Plan only when complexity warrants it, and replan from observations                                  |
| Verification          | One configured `bun test` after mutation; boolean `verified` defaults true                                  | Public coding-agent patterns treat tests, review, and completion as separate outcomes                                             | Discover commands, run focused-to-broad checks, and make completion host-authoritative               |
| Long context          | No compaction                                                                                               | Codex uses automatic compaction; OpenCode serializes a checkpoint plus tail                                                       | Implement state-preserving compaction before long-task claims                                        |
| Capability evaluation | Probe exists but is not wired to routing or doctor                                                          | Runtime docs warn tool behavior is model/template dependent                                                                       | Persist exact model/runtime/template/quant evidence and hard-gate coding routes                      |
| Routing               | Privacy/cost/quota/health scoring; no empirical capability gate                                             | OpenRouter/provider docs distinguish tool support, privacy, and provider route behavior                                           | Require minimum capability class before quality scoring; enforce LOCAL ONLY at provider boundary     |
| Subagents             | Missing                                                                                                     | Claude Code/OpenCode document fresh bounded child contexts; worktree isolation is explicit                                        | Add read-only Explorer/Verifier only after the main kernel is reliable                               |
| Observability         | Missing developer trace                                                                                     | Codex documents agent-native approval/tool/network telemetry                                                                      | Add redacted trace for selection, policy, tools, recovery, verification, and stop                    |
| Evaluation            | 9-test functional suite passes, full suite has 7 failures; no model/harness matrix                          | SWE-bench and mature agents use replayable task trajectories/evaluations                                                          | Create deterministic fixture, fake adapter, required E2E matrix, and baseline/new-kernel experiments |

## Effective gap conclusion

LocalCode already has the beginnings of a useful vertical: a source CLI/TUI,
local provider discovery, a small workspace tool set, a scripted agent loop,
checkpoints, and a green functional-MVP suite. It is not yet an autonomous
coding agent because the host does not own intent boundaries, evidence
sufficiency, task lifecycle, capability eligibility, verification authority,
or truthful completion. Adding subagents or more providers before those gates
would increase surface area without closing the primary capability gap.

## Reconciled current gap — 2026-08-24

The single-agent kernel now closes the first deterministic gaps: explicit
policy, evidence/task state, bounded tools, recovery, verification,
completion, capability probing, compaction, a verifier, and trace support are
implemented and covered by the functional fixture. The remaining effective
gap is not peripheral feature count:

- the configured live qwen model is `workspace_reader`, so no current local
  model has fresh evidence for autonomous coding;
- no live advanced-model benchmark or authorized zero-cost remote benchmark
  has been completed;
- parallel/subagent/worktree/background execution and a lower-level shell
  sandbox remain absent;
- the focused agent-kernel, functional, and full browser-conditioned suites are
  green (`bun run test`: 306/306 tests); this does not supply a coding-capable
  live model.

Therefore LocalCode has a credible deterministic kernel vertical, but it is
not yet Claude/Codex-class autonomous engineering on the current machine.

## Latest deterministic reconciliation — 2026-08-24

The source/kernel comparison above predates the latest contract-hardening pass.
Current local evidence is `311/311` canonical tests, `24/24` functional
acceptance scenarios, and source/current-dist CLI smoke passing. The current
effective gap remains live-model capability and long-horizon product depth:
the downloaded LM Studio model has not yet been re-probed in this continuation,
so no strong-local, remote, or hybrid task-success claim is made. Structured
tools, host-owned verification, evidence quality, cancellation, and capability
hard gates are now deterministic kernel behavior; subagents, worktrees,
lower-level sandboxing, and a live complex coding journey remain open.

The latest canonical run is `312/312` tests with `1053` expectations; the
earlier `306` and `311` counts in this document are retained only as historical
snapshots.

The current deterministic suite is `317/317` with `1065` expectations and the
live endpoint is reachable, but the only generative local model remains below
the measured autonomous-coding capability gate. This keeps the effective gap
focused on eligible model capability and live long-horizon evidence rather
than adding peripheral features.

The latest deterministic suite is `319/319` with `1076` expectations. LM Studio
native model identity, metadata enrichment, and provider-key routing are now
covered. The effective Claude/Codex-class gap remains unchanged: no eligible
live coding model has completed the complex objective, and long-horizon live
comparison evidence is still absent.

## Live model update — 2026-08-24

Qwen2.5 Coder 7B Q6_K is now available locally and has been measured through
the actual LM Studio adapter. It improves the local baseline enough to pass a
real disposable one-file edit/test task, but it remains `workspace_reader`:
the multi-file task stopped after planning/read activity and never reached
mutation or verification. The kernel correctly records `BLOCKED` rather than
claiming completion. This narrows the remaining gap to capable model/runtime
tool behavior and long-horizon evidence, not to adding more peripheral UI or
provider surface area.
