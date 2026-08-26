# Routing

## Task classes

`SEARCH`, `EXPLAIN`, `SMALL_EDIT`, `MULTI_FILE_EDIT`, `TEST_GENERATION`, `DEBUGGING`, `REFACTOR`, `ARCHITECTURE`, `REVIEW`, and `COMMAND` are inferred from deterministic signals and user text.

## Gate order

1. Privacy hard gate.
2. Required capability admission gate.
3. Cost/billing hard gate (`strict-zero` excludes paid and unverified free
   routes).
4. Required executable-tool gate.
5. Usable context gate with safety margin.
6. Health/circuit-breaker gate.
7. Quota freshness/headroom gate.
8. Configurable score and selection.

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
inspection remain local. Capability evidence is an admission requirement
before score selection. A model may be useful for a smaller bounded role, but
no score can promote a `chat_only` model into `advanced_coding_agent`, and
missing evidence cannot authorize a non-chat autonomous role. The agent loop,
host verification, and bounded work units decide whether the admitted model
actually completes the task.

For complex coding objectives without a host-proven scope, the controller uses
a read-only `discovery` stage before progressive coding. That stage may select
a local `chat_only` model only with `toolNeed=false` and no mutation tools; it
validates any proposed paths against the workspace, then re-runs routing with
`progressive` and requires a measured `coding_agent`. This prevents the UI from
turning a safe preparation step into `STOP · ASK USER` while preserving the
mutation capability gate.

## Explanation

Every decision stores task analysis, policy, gate outcomes, score components, selected route, and route failure/recovery history. `/explain-route` renders the same structured data used for execution; it is not a separate narrative calculation.
