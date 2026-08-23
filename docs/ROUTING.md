# Routing

## Task classes

`SEARCH`, `EXPLAIN`, `SMALL_EDIT`, `MULTI_FILE_EDIT`, `TEST_GENERATION`, `DEBUGGING`, `REFACTOR`, `ARCHITECTURE`, `REVIEW`, and `COMMAND` are inferred from deterministic signals and user text.

## Gate order

1. Privacy hard gate.
2. Cost hard gate.
3. Required tool/capability gate.
4. Usable context gate with safety margin.
5. Health/circuit-breaker gate.
6. Quota freshness/headroom gate.
7. Configurable score.

No score can revive a rejected candidate.

## Cost policy

Default mode is `strict-zero`. A route must be explicitly established as guaranteed/confirmed free for the current account/tier and have unexpired metadata. A configured credential alone is `unverified`. OpenCode Zen is currently billing-backed and therefore not a free route. Paid providers are not evaluated in strict-zero.

## Score

The initial weights are configurable and deliberately heuristic:

```text
0.30 task fit + 0.20 predicted success + 0.15 quota headroom
+ 0.12 reliability + 0.10 latency + 0.08 context headroom
+ 0.05 tool reliability - quota opportunity cost
```

## Local-first

Search, file inspection, deterministic edits, tests, lint/typecheck and Git inspection remain local. Escalation requires capability, context, repeated verification, or reliability evidence.

## Explanation

Every decision stores task analysis, policy, gate outcomes, score components, selected route, and route failure/recovery history. `/explain-route` renders the same structured data used for execution; it is not a separate narrative calculation.
