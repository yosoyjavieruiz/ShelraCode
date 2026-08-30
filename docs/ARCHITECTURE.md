# ShelraCode Architecture

## Shape

ShelraCode is one Bun package with a typed application core and adapter boundaries:

```text
CLI / TUI
   ↓
Application services and event bus
   ↓
Agent harness / router / setup / doctor
   ↓
Domain contracts
   ↓
Adapters: SQLite, filesystem/Git, llmfit, local runtimes, cloud providers
```

The core does not import OpenTUI. Provider-specific response shapes stop at adapter boundaries. Local runtime differences stop at `LocalRuntimeAdapter`.

## Domain boundaries

- `shared`: IDs, result/error primitives, clock and subprocess contracts.
- `models/catalog`: normalized model candidates and freshness.
- `hardware/runtimes`: machine and local endpoint discovery.
- `providers`: normalized cloud discovery, health, quota, stream and failure taxonomy.
- `privacy/security`: repository policy, path rules, secret scanning, context sanitization.
- `router`: task analysis, hard gates, scoring, circuit breaker and explanation.
- `agent/context/tools/checkpoint`: coding loop, repository context, permissions, verification and safe rollback.
- `storage`: SQLite migrations and repositories; no database types leak into domain APIs.
- `tui`: rendering and input only; application services feed typed state/events.

## State ownership

Durable settings, sessions, route records, quotas, health, observations and checkpoints belong to SQLite. In-flight task state belongs to the application service and emits typed events. Solid signals mirror view state only. Renderer lifecycle owns terminal cleanup.

## Execution flow

```text
user task → task analysis → sensitivity/context → candidate generation
→ privacy gate → capability admission → cost gate
→ executable-tool/context/health/quota gates → score/explain
→ stream response/tool calls → permission check
→ execute tool → verify → accept, reroute, or stop
```

## Failure boundaries

External JSON, headers and subprocess output are validated at adapters. Provider failures become `ProviderFailure` values. A policy or cost rejection is terminal for that route, not a retry signal. Abort propagates through fetch, subprocess, tools and agent loop. SQLite errors are surfaced as doctor/session failures, never silently ignored.

## Current vertical slice

The MVP uses a deterministic local/fake provider path in tests, HTTP OpenAI-compatible adapters for legitimate endpoints, real filesystem/Git tools, llmfit fallback detection, and a real OpenTUI app. Optional provider entries are only shown as configured/available when their adapter and policy metadata support the action.

## Authoritative agent flow

The runtime order is privacy, capability admission, cost, executable-tool,
context, health/circuit-breaker and quota gates, followed by score selection.
Capability is therefore a hard admission requirement for the requested role;
it is not merely a quality score. A small model can be selected for a bounded
role only when that role's measured requirement is satisfied.
