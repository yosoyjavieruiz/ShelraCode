# Security and workspace safety audit

## Verified controls

| Control                         | Evidence                                                                  | State                                 |
| ------------------------------- | ------------------------------------------------------------------------- | ------------------------------------- |
| Workspace path boundary         | src/shared/paths.ts and workspace tools                                   | Locally verified                      |
| Symlink/root checks             | path and workspace execution path                                         | Locally verified in tests             |
| Read-only turn protection       | TurnPolicy plus permission gate; hostile EditFile test                    | PASS                                  |
| Tool schema validation          | tool registry/loop and typed error tests                                  | PASS                                  |
| Checkpoint before mutation      | src/checkpoint/checkpoint.ts and agent loop callbacks                     | Active                                |
| Stale external-change detection | content hashes and stale/conflict errors                                  | Active                                |
| User work preservation          | dirty-worktree tests and no destructive rollback commands in audited path | Locally verified for tested cases     |
| Secret-shaped trace redaction   | src/agent/trace.ts and unit tests                                         | PASS                                  |
| Network policy for Shell        | execution context and permission policy                                   | Active                                |
| Paid-route/strict-zero gates    | router and routing tests                                                  | Locally verified; no production proof |

## Residual boundaries

- Shell policy is not an operating-system sandbox. A subprocess can still
  have capabilities that must be restricted by the host environment.
- The audit did not run destructive-shell, credential, network-escape or
  external-file-modification adversarial journeys against a disposable
  process sandbox.
- No real credentials were used. Remote-provider privacy, quota, billing and
  production controls are NO VERIFICABLE.
- Checkpoints do not automatically cover every mutation made by external
  processes; Git and checkpoint evidence must remain separate.

## Acceptance rule

Do not call the security boundary production-ready until the disposable
adversarial matrix covers workspace escape, destructive command approval,
cancellation during write, external modification, secret redaction and dirty
worktree preservation.
