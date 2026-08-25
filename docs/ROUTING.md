# Routing

## Task classes

`SEARCH`, `EXPLAIN`, `SMALL_EDIT`, `MULTI_FILE_EDIT`, `TEST_GENERATION`, `DEBUGGING`, `REFACTOR`, `ARCHITECTURE`, `REVIEW`, and `COMMAND` are inferred from deterministic signals and user text.

## Gate order

1. Privacy hard gate.
2. Cost hard gate.
3. Required executable-tool gate. Empirical capability evidence is a weighted
   selection signal, not a hard stop by itself.
4. Usable context gate with safety margin.
5. Health/circuit-breaker gate.
6. Quota freshness/headroom gate.
7. Configurable score.

No score can revive a rejected candidate.

## Cost policy

Default mode is `strict-zero`. Local routes require no billing. Groq with a
configured key is represented as expiring `free_quota` capacity, and
OpenRouter is represented as `verified_free` only after its catalog has been
filtered to free model records. Both routes remain bounded by quota/health
gates and never upgrade or fall back to paid inference. Privacy/ZDR remains a
separate hard gate for remote repository content. OpenCode Zen is currently
billing-backed and therefore not a free route. Paid providers are not
evaluated in strict-zero.

If a provider omits rate-limit headers on `/models`, a fresh verified free-only
candidate may still be attempted with reduced score headroom. A normalized
`429`, `FREE_TIER_EXHAUSTED`, or other quota failure then drives the bounded
local/free fallback path; it never unlocks paid inference.

## Score

The initial weights are configurable and deliberately heuristic:

```text
0.30 task fit + 0.20 predicted success + 0.15 quota headroom
+ 0.12 reliability + 0.10 latency + 0.08 context headroom
+ 0.05 tool reliability - quota opportunity cost
```

## Local-first

Search, file inspection, deterministic edits, tests, lint/typecheck and Git
inspection remain local. Capability evidence influences score and fallback
preference, but it is not an independent reason to stop before attempting an
otherwise executable route. The agent loop, host verification, and bounded
fallback still decide whether the selected model actually completes the task.

## Explanation

Every decision stores task analysis, policy, gate outcomes, score components, selected route, and route failure/recovery history. `/explain-route` renders the same structured data used for execution; it is not a separate narrative calculation.
