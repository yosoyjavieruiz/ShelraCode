# Phase 12 Report

**Phase:** Process, network, and workspace safety (level-10-agent-architecture
Phase 4)
**Source revision:** `230b5575a592897fa113e3d05407e6f93e4f01da`
**Working tree:** dirty; unrelated pre-existing uncommitted work was preserved
(`277` status entries at verification time)
**Gate:** PASS (with an explicitly scoped, documented residual gap)

## Repository evidence

- `src/security/execution-broker.ts` is the live host-side boundary for
  every model-requested workspace/process operation. `src/tools/workspace.ts`
  routes every tool through `executionBrokerFor(ctx)`; there is no
  model-facing path that bypasses it.
- `src/shared/process.ts` is the live process entry point. `runCommand`/
  `runShellCommand` are called by the broker and by host-internal callers
  (`GitStatus`, `GitDiff`, `RunTests`, `Shell`).
- `docs/security/execution-boundaries.md`, `strict-zero-network.md`,
  `secret-handling.md`, `threat-model.md` describe the intended boundary;
  `strict-zero-network.md` was updated this phase to match what the code
  actually enforces rather than the prior `osEnforced: false` claim.

## Changes

### OS-enforced process isolation on Windows (new: `src/shared/win32/`)

- `ffi.ts` / `job-object.ts` / `app-container.ts` / `isolated-process.ts`:
  drive `CreateProcessW` directly via `bun:ffi`, bypassing `Bun.spawn`,
  because a process's security context can only be set at creation time.
- **Job Object containment (shipped, unconditional on win32):** every
  spawned process is assigned to a Job Object with
  `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. Verified empirically against a real
  process tree: killing only the direct child left a `ping.exe` grandchild
  running indefinitely; terminating the job killed both. `ProcessResult.
  isolation.osEnforced` now reports `true` on Windows for every call.
- **AppContainer network denial (implemented, verified, disabled by
  default):** a zero-capability AppContainer token blocks outbound network
  access at the Windows Filtering Platform layer -- verified directly with
  `ping`/`curl` against a live host (both failed inside the container,
  succeeded outside it). Requires a per-workspace ACL grant (`ALL
  APPLICATION PACKAGES:(OI)(CI)RX`) for the sandboxed process to read
  workspace files at all; this is implemented and cached per root
  (`grantWorkspaceAccess`). **Not wired into the default execution path**
  (`denyNetwork: false` in `src/shared/process.ts`, with an inline TODO):
  `git` fails inside the container ("unable to get current working
  directory: Permission denied" in a fresh, otherwise-accessible directory,
  or `CreateProcessW` itself intermittently failing with `ERROR_DIRECTORY`
  against a large real repository) in a way that does not reproduce with
  `cmd.exe`/`dir`/`type` against the same paths -- not simply the ACL gap
  the workspace grant already closes. Given how central `git`/`RunTests`
  are to the product, this ships disabled rather than enabled-but-broken.
- `src/shared/process-isolation.ts`: `ProcessIsolationStatus` gained
  `networkEnforced` (distinct from `osEnforced`) so the two guarantees are
  never conflated in a single boolean; `statusFromIsolatedSpawn` reports
  the mechanism that actually applied to each specific call.

### Execution-broker security fixes (8 findings from the 2026-08-29 code
review of this phase's own deliverable, all fixed and regression-tested)

1. Streaming secret redaction could pass through raw private-key bytes when
   a BEGIN/END PEM block was split across two live-output chunks --
   `redactText` now redacts the whole chunk when `scanSecrets` flags it,
   not only what `redactEvaluationValue` already matched.
2. `src/agent/capability-probe.ts` never set `modelAuthority`, so an
   uncertified candidate model being probed got a trusted-host default
   (bounded write authority + unverified process execution) instead of the
   intended fail-closed gate. Fixed with an explicit `executionBroker`:
   `writeAuthority: "bounded"` stays intentional (the probe's whole point
   is testing edits inside a disposable sandbox), but
   `allowUnverifiedProcesses: false` closes the real gap (process execution
   isn't confined to the disposable directory the way file writes are).
3. The strict-zero local process allowlist was hardcoded to Bun-specific
   test/lint commands, so `RunTests` failed for any non-Bun target project.
   The broker now accepts the project's actual configured test command
   verbatim (wired from `verificationPlan.find(stage === "test")` in
   `app.tsx` and from `ToolExecutionContext.defaultTestCommand` in
   `executionBrokerFor`).
4. `src/agent/subagents/coordinator.ts` built its child broker without an
   explicit `writeAuthority`, defaulting to `"bounded"`, which mismatched
   `executionBrokerFor`'s validation (`"none"`, derived from the inherited
   `modelAuthority: "model"` + an uncertified/undefined parent
   `driverProfile`) -- every delegated tool call, including plain reads,
   threw `PERMISSION_DENIED` whenever the parent task had no certified
   Driver profile (the default case for a new task). Fixed with an explicit
   `writeAuthority: "none"`, which is also the semantically correct value
   since delegates only ever receive `risk: "read"` tools.
5. The destructive-command policy check was nested inside the
   strict-zero-only branch of `assertCommandBoundary`, so the broker did
   not independently enforce it when `networkMode` was `"allow"` (masked
   only by redundant tool-layer classification in `shellTool`/
   `runTestsTool`). Moved outside the branch so it applies unconditionally.
6. `OUTSIDE_ARGUMENT_PATTERN` only rejected a `..` traversal segment at the
   very start of an argument, missing one embedded mid-path (`sub/../../
   secret.txt`). Tightened to match a `..` segment bounded by separators
   anywhere in the argument.
7. `isStrictZeroProcessAllowlisted` and `classifyShellCommand`
   (`src/tools/permissions.ts`) were two independently-maintained "safe
   command" pattern sets that had already drifted apart. Added
   `isKnownSafeShellCommand` to `permissions.ts` as the single source of
   truth; the broker now builds on it and keeps only its genuinely
   broker-specific extras (version probes, `cmd /c echo|exit`).
8. `writeFile`/`deleteFile` performed a discarded-result `resolvePath()`
   re-check immediately before `canonicalWriteTarget`/`canonicalParent`,
   which already re-derive the canonical path with their own fresh
   `realpath` calls right after -- removed the redundant call.

## Real-model evidence

- Exact model identity: `parable-qwen3-4b-claude-fable-5` (Q8_0
  quantization), served locally by LM Studio at `127.0.0.1:1234`.
- `scripts/live-agent-eval.ts` (default, one-file journey): the real model
  read `src/message.ts`, edited the greeting to `"hello world"`, and host
  verification (`bun test`) passed -- `status: "completed"`, `verified:
  true`.
- `scripts/live-agent-eval.ts --complex` (multi-file journey, 14 turns):
  read/edited `src/math.ts`, `src/index.ts`, `tests/math.test.ts` across 4
  edit+verify cycles; all 4 verification stages passed (exit code 0) and
  all 4 content checks passed (`addFixed`, `multiplyImplemented`,
  `multiplyExported`, `multiplyTested`). `status: "completed"`, `verified:
  true`.
- `scripts/evaluate-agent.ts --local-only` (the production capability-probe
  path, `src/agent/capability-probe.ts`, the exact code whose
  `modelAuthority` gap this phase fixed -- finding #2 above): model
  auto-discovered, capability probe passed (`probe=coding_agent
  eligible=true version=14`), representative journey
  `one-file-modification: completed PASS`. Aggregate status **UNPROVEN**
  by design -- only the representative journey runs per model, the rest of
  the matrix is honestly left unproven rather than inferred.
- This does not promote autonomy claims beyond what these specific runs
  demonstrated; deterministic/fake-provider results below are not
  relabeled as real-model capability.

## Metrics

- Deterministic agent journey matrix (`scripts/evaluate-agent.ts`, scripted
  fake provider, `tests/evals/agent-journeys.ts`): **18/18 PASS** (0
  failed, 0 unproven, 0 skipped) -- conversation, repository-question,
  symbol-lookup, architecture-analysis, plan-only, one-file-modification,
  multi-file-modification, failing-test-repair, greenfield-creation,
  configuration-modification, refactor, error-recovery,
  long-horizon-compaction, resume, dirty-worktree-safety,
  false-completion, false-blocking, strict-zero-rejection.
- Full unit suite (`bun test tests/unit/`): **692 pass, 0 fail**, including
  new regression coverage: `tests/unit/win32-isolated-process.test.ts`,
  `tests/unit/win32-app-container.test.ts` (both exercise the real Windows
  mechanism, not mocks), and one new test per execution-broker finding
  above in `tests/unit/execution-broker.test.ts` /
  `tests/unit/subagents.test.ts`. Each regression test was verified to
  actually fail against the pre-fix code before the fix was accepted.
- `bun run typecheck`: clean. `prettier --check`: clean on all
  touched/added files.

## Risks / regressions

- AppContainer network denial ships implemented but inactive
  (`denyNetwork: false`); strict-zero's network guarantee for spawned
  processes remains application-policy-only until the `git`/AppContainer
  interaction is root-caused. This is the one explicitly deferred item
  from this phase's original scope ("Windows restricted-token/Job Object
  or cross-platform network namespace adapter").
- The Job Object mechanism showed non-deterministic behavior in one tested
  configuration (`CREATE_SUSPENDED` + assign-before-resume, when the
  calling process is itself nested inside an ambient job -- common under
  sandboxed dev-tool harnesses like this one). The shipped implementation
  uses the verified-reliable ordering (non-suspended, immediate
  post-spawn assign) and does not use `CREATE_SUSPENDED`; this is
  documented in `job-object.ts` so it isn't silently reintroduced.
- Non-Windows hosts are unaffected by this phase (all new code is
  `process.platform === "win32"`-gated with the pre-existing honest
  `mechanism: "none"` fallback preserved).

## Gate decision

**PASS.** Process-lifecycle containment is real, OS-enforced, and
unconditional on Windows -- a genuine strengthening of the boundary this
phase exists to build, not an application-level convention. Network
denial's second mechanism is implemented and independently verified but
shipped inactive rather than enabled with a known compatibility bug against
`git`, matching this project's own non-goal: no self-approval based only on
model prose. All 8 findings from an adversarial code review of this
phase's own new code were fixed and regression-tested before this report
was written, not deferred to a later phase.

## Next phase eligibility

**YES** — Phase 13 (level-10-agent-architecture Phase 5, Skills and
instruction hierarchy) may begin, though a repository survey during this
phase found `src/instructions/` (`instruction-loader.ts`, `skill-loader.ts`
with lazy content loading, `trust-policy.ts` with an explicit
system/project/user/memory precedence model that already excludes
repository data from policy) already implemented and wired into
`src/context/context-builder.ts` and `src/agent/dynamic-capabilities.ts` --
this phase may consist primarily of verification and gap-closing rather
than new construction. The same survey found `src/agent/subagents/`
(`coordinator.ts`, `worktree.ts`, parallel delegation) already implemented
and wired for Phase 6 (isolated delegation), and a substantial evaluation
harness already built for Phase 7 (`src/evals/`, `scripts/evaluate-agent.ts`,
`scripts/live-agent-eval.ts`) -- the gap there is running it for fresh
evidence and re-scoring the product, not building new infrastructure.
