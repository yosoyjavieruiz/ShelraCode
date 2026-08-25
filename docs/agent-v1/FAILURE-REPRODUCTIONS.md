# Regression reproduction ledger

All deterministic cases below were run on 2026-08-24 against the current
working tree. The focused command was:

```text
bun --conditions=browser test tests/unit/tool-error-recovery.test.ts tests/unit/turn-policy.test.ts tests/unit/completion-gate.test.ts tests/unit/verifier.test.ts tests/integration/agent-loop.test.ts tests/integration/functional-acceptance.test.ts
```

Result: 79 pass, 0 fail, 302 expect().

## Matrix

| Case                          | Expected                                   | Observed                               | Evidence                                                                        |
| ----------------------------- | ------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------- |
| Greeting discipline: Hola     | Conversation; zero repository tools/writes | PASS                                   | tests/unit/turn-policy.test.ts, tests/integration/functional-acceptance.test.ts |
| Capability question           | No repository access                       | PASS for policy coverage               | turn-policy tests                                                               |
| Repository language           | Manifest/language evidence; read-only      | PASS; hostile EditFile is denied       | functional acceptance test, current dirty test change                           |
| ReadFile(path: package.json)  | Positive internal default                  | PASS; default is 20,000 chars          | tool-error recovery tests, src/tools/workspace.ts                               |
| ReadFile(maxChars: 0)         | Typed INVALID_ARGUMENT                     | PASS                                   | tool-error recovery tests                                                       |
| ListFiles(path: package.json) | Typed PATH_IS_FILE                         | PASS; no raw ENOTDIR                   | tool-error recovery tests                                                       |
| Missing path                  | Typed recoverable path error               | PASS                                   | tool-error recovery tests; current dirty test adds path assertion               |
| Read-only mutation defense    | Write structurally rejected                | PASS; PERMISSION_DENIED                | functional acceptance test                                                      |
| Partial/native tool stream    | No partial JSON in transcript              | PASS in agent-loop regression          | tests/integration/agent-loop.test.ts                                            |
| False completion              | Failed verification cannot complete        | PASS                                   | completion-gate, verifier and agent-loop tests                                  |
| Cancellation                  | Cancelled task is not completed            | PASS in deterministic agent-loop tests | tests/integration/agent-loop.test.ts                                            |

## Live fixture observations

The live script used a temporary fixture repository and did not mutate the
user worktree.

| Scenario                           | Result                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------- |
| Qwen2.5-Coder-7B bounded edit      | Completed and verified in 5 turns                                                |
| Qwen2.5-Coder-7B multi-file change | Blocked, verification failed, no false completion                                |
| Qwen2.5-Coder-1.5B bounded edit    | Correct file/test outcome, but blocked after an extra search and no final answer |

## Interpretation

The original P0 symptoms are no longer current deterministic failures. The
remaining failure is a capability/recovery/release problem, not permission
to claim that the entire autonomous coding objective works.

## Final current evidence - 2026-08-25

The prior 1.5B observation was superseded by the final recovery path. Two
consecutive runs of the same disposable three-file fixture completed and
verified through the real LM Studio adapter. The observed recovery sequence
included invalid edit arguments, a typed conflict, a required fresh read,
precise edits, and three passing verification stages. No user worktree was
used.

The regression remains valuable as an adversarial case: a single successful
run is not enough to promote a model to unrestricted coding. The current
acceptance is deliberately bounded by explicit target paths, host-owned
verification and a capability gate.
