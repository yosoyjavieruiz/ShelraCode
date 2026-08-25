# Capability-Aware Routing

## Current policy — 2026-08-25

The capability class is no longer a hard stop by itself. A measured
`chat_only`, `workspace_reader`, or missing probe can influence task-fit score
and fallback preference, but an otherwise policy-valid candidate with the
required executable tools remains selectable. This keeps accessible 1.5B
local routes usable while leaving completion, verification, permissions,
privacy, cost, quota, and runtime health under host control. The historical
results below are retained as evidence from the previous hard-gate policy.

Routing order is structural:

1. privacy and secret gates;
2. strict-zero/paid policy;
3. required executable tools;
4. context fit, health, circuit breaker, and freshness;
5. quality/latency/headroom scoring.

`LOCAL ONLY`/strict-zero rejects remote paid or unverified-free candidates at
the route boundary. Local candidates have no artificial request, token, RPD,
RPM, or billing quota. They remain constrained by hardware, runtime,
context, and the non-progress watchdog.

Task requirements map conversational questions to `chat_only`, repository
questions to `workspace_reader`, ordinary edits to `coding_agent`, and
complex refactors/multi-file work to `advanced_coding_agent`. These are target
signals for scoring and context, not unconditional route floors. A failed
capability probe is execution evidence for fallback/verification, not by
itself a reason to stop before attempting an executable route.

Deterministic router tests cover stronger-local fallback, no local quota,
strict-zero remote rejection, soft capability preference, and per-task
execution fallback. `runWithRouteFallback` is connected to the TUI execution path: it
excludes an attempted candidate after a diagnosed provider/runtime failure and
will retry only before any mutation. Tool-contract errors, unknown provider
failures, and post-mutation failures never trigger model switching. A live
free-remote fallback has not been exercised in this run; no remote call was
authorized or needed for the harness suite.

## Current Qwen2.5 Coder 7B route — 2026-08-24

The discovered `qwen2.5-coder-7b-instruct` local candidate is eligible for
conversation and workspace-reader tasks, but its version-11 live probe is
below `coding_agent`. A simple disposable edit/test completed, while the
multi-file task blocked after read/planning activity. The router therefore
keeps it available for read work and refuses it for coding work; no local
usage quota is involved in that decision.

## Current eligible local route - 2026-08-24

With capability-aware discovery enabled, an actual `advanced_coding_agent`
route request under `local_only`/`strict-zero` produced:

```text
selected    lm-studio / qwen2.5-14b-instruct
capability  advanced_coding_agent
rejected    qwen2.5-coder-7b-instruct -> workspace_reader below required
            qwen2.5-coder-1.5b-instruct -> workspace_reader below required
remote      not evaluated
```

The stronger eligible local model is selected without a LocalCode
request/token quota, while weaker local models remain available for lower-
capability read tasks. The route is enforced at `selectRoute`, not inferred
from a UI label.
