# Capability-Aware Routing

## Current policy — 2026-08-25

Capability is an admission gate before scoring. A candidate must have measured
capability at or above the task requirement; a `chat_only` candidate cannot be
selected for coding, and an unmeasured candidate cannot be advertised as
coding-capable. Bounded single-file work can deliberately require the lower
`workspace_reader` role, while complex refactors and multi-file work require
`advanced_coding_agent`. This keeps an accessible 1.5B route useful for small
verified work without pretending it is a frontier autonomous worker.

Routing order is structural:

1. privacy and secret gates;
2. strict-zero/paid policy;
3. required executable tools;
4. context fit, health, circuit breaker, and freshness;
5. quality/latency/headroom scoring.

### Complex-task preparation route — 2026-08-25

The TUI no longer jumps directly from an unlocalized complex coding objective
to `advanced_coding_agent`. When the host has not proven a bounded mutation
scope, it requests a `discovery` execution strategy. This is a local,
read-only preparation stage: `chat_only` may be selected there because the
route has `toolNeed=false` and receives no mutation tools. The model/context
stage can propose or read candidate files, but every proposed path is checked
against the current workspace before it becomes scope.

Only after a non-empty, host-validated scope exists does the controller issue a
second route request with `strategy=progressive`. That request still requires a
measured `coding_agent`; `chat_only` is never promoted to write authority.
Therefore the explainable route should show `Local discovery execution` for
the first stage instead of `STOP · ASK USER` merely because the preferred local
model cannot own the entire advanced objective in one invocation.

`LOCAL ONLY`/strict-zero rejects remote paid or unverified-free candidates at
the route boundary. Local candidates have no artificial request, token, RPD,
RPM, or billing quota. They remain constrained by hardware, runtime,
context, and the non-progress watchdog.

Task requirements map conversational questions to `chat_only`, repository
questions to `workspace_reader`, bounded edits to `workspace_reader` or
`coding_agent` according to the analyzed complexity, and complex
refactors/multi-file work to `advanced_coding_agent`. These are executable
route floors. A failed or missing capability probe is an honest route
rejection, not a reason to force an unproven model into mutation.

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
