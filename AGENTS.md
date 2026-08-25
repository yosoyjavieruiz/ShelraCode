# LocalCode Agent Instructions

## Mission

Build LocalCode: a hardware-aware, local-first AI coding agent that uses verified free cloud capacity only when useful and never creates unexpected paid inference.

## Read first

Before architectural changes read:

- `docs/PRODUCT.md`
- `docs/ARCHITECTURE.md`
- `docs/ROUTING.md`
- `docs/PRIVACY.md`
- `docs/DECISIONS.md`
- `docs/STATUS.md`

## Product invariants

1. Privacy hard gates precede model quality.
2. `STRICT_ZERO` never intentionally executes a paid route.
3. Local remains a first-class execution path.
4. Volatile model/provider data has freshness metadata.
5. Never harvest credentials from third-party consumer applications.
6. Never send secrets to remote providers.
7. Never destroy user Git work as rollback.
8. Never advertise a provider, runtime, or TUI action that is not functional.
9. No remote telemetry by default.
10. Every routing decision is explainable.

## Stack

- Bun 1.3+
- TypeScript ESM
- SolidJS
- OpenTUI
- `bun:sqlite`

Do not replace the stack casually.

## Architecture

Core business logic must not import TUI code. Provider-specific objects must not leak into the agent core. Local runtime and cloud differences live behind adapters. No architecture-only abstraction without a current consumer.

## Implementation rules

- strict TypeScript and validated external data;
- explicit domain errors and normalized failures;
- `AbortSignal` for cancellable operations;
- no ignored promises, empty catches, or undocumented `any`;
- tests before production behavior for new features;
- preserve pre-existing user changes and never use destructive Git rollback.

## External APIs

Before implementing or modifying a volatile provider/runtime integration, inspect current official docs, update `docs/RESEARCH-SNAPSHOT.md`, and add contract coverage. Never infer free status or privacy from a credential alone.

## TUI

Use the installed repository OpenTUI skill and current canonical docs. Keep business state outside leaf components. Test 80, 100, 120, and 160 columns, `NO_COLOR`, focus, cancellation, resize, and terminal restoration.

## Security and cost

Never place real credentials in tests, fixtures, screenshots, or logs. Any paid external action requires explicit user authorization. `strict-zero` stops when billing is unverified or free capacity is exhausted.

## Testing gate

Before declaring work done run formatting, typecheck, focused tests, relevant integration tests, and the real user-visible smoke path. Before v0.1 completion run the full suite, fixture E2E, privacy E2E, strict-zero E2E, doctor smoke, TUI smoke, and clean-install smoke.

## Scope

The week-one boundary is in `docs/WEEK-ONE.md`. Do not add V1/V2 product ideas before MVP acceptance passes.

## Agent kernel

The agent kernel (turn classification, tool contracts, agent loop, recovery,
verification) is functional correctness, not a feature — it precedes visual
work. Status and open gaps live in `docs/agent-kernel/STATUS.md`. Never
remove or weaken a regression test to make a failure disappear; fix the
root cause it caught instead.

## Completion

Types compiling is not proof. Exercise the user-visible command or TUI flow and report exact evidence.
