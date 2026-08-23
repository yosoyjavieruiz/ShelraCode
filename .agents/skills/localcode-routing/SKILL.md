---
name: localcode-routing
description: Implement, review or debug LocalCode model routing, privacy gates, strict-zero enforcement, quota-aware scoring, circuit breakers, fallbacks and route explanations.
---

# LocalCode Routing

The order is mandatory: privacy, cost, capability, context, health, quota, score, execute, verify, reroute or finish.

`STRICT_ZERO` never intentionally uses paid inference. Every decision generates structured reasons. Do not silently weaken privacy after provider failure. Free quota has opportunity cost. Test paid exclusion, privacy blocking, quota exhaustion, stale metadata, circuit breakers, fallback, and `/explain-route`.
