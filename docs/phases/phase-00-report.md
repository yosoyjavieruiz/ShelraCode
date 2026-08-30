# Phase 0 Report

**Phase:** Establish the truth baseline  
**Evidence snapshot:** 2026-08-27, `America/Santo_Domingo`  
**Source revision:** `230b5575a592897fa113e3d05407e6f93e4f01da`  
**Worktree:** dirty user work preserved; no staged changes

## Repository evidence

- The current repository is one Bun 1.3.14 / TypeScript ESM package using
  SolidJS and OpenTUI; it contains 135 `src/` files and 131 `tests/` files.
- Actual commands, package versions, repository areas, persistence, model,
  routing, security, evaluation, and test boundaries are recorded in
  `docs/research/current-repo-baseline.md`.
- The authoritative source path was traced from `src/index.ts` through
  `src/tui/launch.tsx` and `AppShell`/`runTask` in `src/tui/app.tsx` to
  `runAgent` in `src/agent/loop.ts`.
- The historical concentration targets still exist: `src/agent/loop.ts` has
  5,615 physical lines including blanks (5,522 nonblank), and `src/tui/app.tsx`
  has 4,189 physical lines including blanks (4,123 nonblank). Both continue to
  own substantial lifecycle authority.
- Useful existing task-contract, context, repository, verification, checkpoint,
  persistence, permissions, privacy, and routing assets were identified for a
  strangler migration.
- The current process boundary is not an OS-enforced sandbox, strict-zero is a
  routing policy rather than a demonstrated global egress boundary, and every
  side effect does not yet cross one ExecutionBroker.
- The installed executable resolves to
  `C:\Users\Javie\.shelra\bin\shelra.exe` and is byte-identical to
  `dist/shelra.exe`; neither artifact is tied to the current dirty source by a
  provenance manifest.
- Git baseline before Phase 0 files: 96 modified, 90 deleted, and 12 untracked
  entries; 186 tracked files in the diff (+2,377 / -21,924). No user change was
  restored, reverted, staged, or rewritten.

## Changes

- Added `docs/research/current-repo-baseline.md` with the current source,
  artifact, architecture, evaluation, persistence, and security evidence.
- Added `docs/evals/evaluation-policy.md` with real-vs-fake separation,
  exact-identity, reproducibility, held-out, completion, metric, and phase-gate
  rules.
- Added `docs/adr/ADR-000-self-calibrating-runtime.md`, accepting a phase-gated
  strangler migration in which measured exact-configuration behavior controls
  authority.
- Added this Phase 0 report.
- No production code, generated binary, installed executable, test, fixture,
  runtime configuration, model configuration, or pre-existing documentation
  was changed.

## Tests/evals executed

- command: `bun run typecheck`
  - result: exit 0.
- command: `bun run format:check`
  - result: exit 1; Prettier reported 35 existing/worktree files.
  - interpretation: the repository-wide format gate is a recorded baseline
    failure; it was not hidden by formatting unrelated user changes.
- command: `bun run test:functional`
  - result: 26 pass, 0 fail, 102 assertions.
- command: `bun run test`
  - result: exit 1; 744 pass, 1 fail, 1 skip, 2,505 assertions, 746 tests across
    121 files.
  - failing case: `tests/unit/code-review-agent.test.ts` expected `PASS` and
    observed `BLOCKED`.
- command:
  `bun --conditions=browser test tests/unit/code-review-agent.test.ts`
  - result: the failure reproduced with 2 pass and 1 fail.
  - cause evidence: the test uses `process.cwd()` as its workspace; the review
    implementation runs `git diff --check --`; the dirty worktree has current
    whitespace/format findings, so the supposedly passing fixture is not
    isolated from repository state.
- command:
  `bun run scripts/evaluate-agent.ts --deterministic --summary`
  - result: `PASS (18/18 passed; failed=0; unproven=0; skipped=0)`.
  - evidence class: scripted/fake-provider deterministic host evidence only.
- command:
  `bun run scripts/evaluate-agent.ts --local-only --json --max-models=1`
  - result: exit 0; one real-model temporary-fixture micro journey passed; the
    remaining 17 local journey types were explicitly `UNPROVEN`.
- command: `bun run smoke`
  - result: exit 0 for source/bundle/executable help, version, doctor, and the
    deterministic evaluator smoke.
  - boundary: not a keyboard-driven TUI or current-source provenance proof.
- command:
  `bunx prettier --check docs/research/current-repo-baseline.md docs/evals/evaluation-policy.md docs/adr/ADR-000-self-calibrating-runtime.md`
  - initial result: the three new Markdown files required formatting.
  - remediation: formatted only the new Phase 0 files; unrelated dirty files
    remained untouched.

## Real-model evidence

- model identity: LM Studio `qwen2.5-coder-7b-instruct`, Qwen2/approximately 7B,
  `Q6_K`, runtime-reported artifact size 6,254,199,296 bytes.
- runtime: loopback LM Studio at `127.0.0.1:1234`; catalog maximum context 32,768
  and separately observed loaded-instance context 16,384. Runtime version,
  artifact SHA-256, tokenizer, and exact chat/tool templates remain unproven.
- policy: local-only discovery/evaluation; no cloud route, download, paid
  inference, or non-loopback network request was used.
- probe result: conversation, bounded read, multi-turn, tool selection,
  arguments, edit, and verification passed in this run; injected-error recovery
  failed; repository reasoning was unmeasured.
- journey result: one isolated one-file edit completed in two turns/two tool
  runs and passed its fixture `bun test` verifier.
- authority decision: this evidence is not a C2 certificate and grants no new
  write authority. The current evaluator's `coding_agent` classification is
  weaker than the new certification policy.

## Metrics

| Metric                                | Phase 0 observation                |
| ------------------------------------- | ---------------------------------- |
| Typecheck                             | pass                               |
| Full deterministic tests              | 744 pass / 1 fail / 1 skip         |
| Functional acceptance                 | 26 pass / 0 fail                   |
| Deterministic evaluator               | 18/18 pass, scripted/fake provider |
| Real-model micro journey              | 1/1 attempted journey pass         |
| Other real-model journeys             | 17 `UNPROVEN`                      |
| Real-model recovery probe             | fail                               |
| Repository-wide format check          | fail; 35 files reported            |
| Real keyboard TUI acceptance          | `UNPROVEN`                         |
| Exact source-to-executable provenance | `UNPROVEN`                         |
| Protected held-out certification      | absent / `UNPROVEN`                |

No stochastic success rate, confidence interval, or C-level score is reported
from the single real-model trial.

## Risks / regressions

- The full test suite is not green because one test depends on the current dirty
  checkout. Phase 0 records this permitted baseline failure; it does not weaken
  or repair the test.
- The repository-wide formatting gate remains red. Phase 0 formatted only its
  four new documents.
- The evaluator does not yet persist a raw, replayable real-model run bundle and
  does not capture the full exact identity required by the new policy.
- The current real-model fixture is visible and not protected from
  implementation context; it is smoke evidence, not held-out certification.
- The active executable can be smoke-tested but is not proven to represent the
  current dirty source or the same real-model path.
- No real PTY/OpenTUI keyboard journey, narrow-terminal matrix, cancellation,
  or terminal-restoration journey was performed in Phase 0.
- Persistence, strict-zero egress, TOCTOU/symlink behavior, secret-at-rest
  handling, and crash/resume require later independent executable suites.
- No architecture code changed, so this phase introduces no new runtime path;
  its principal regression risk is inaccurate documentation, covered by the
  independent read-only review below.

## Independent verification

- status: `PASS` on 2026-08-28.
- method: two focused read-only reviews checked the four Phase 0 documents
  against current repository paths, file measurements, test evidence, model
  evidence, artifact boundaries, and the explicit exit conditions.
- corrections required before acceptance: replace an invented `src/model/`
  row with the real provider/runtime/probe paths; correct repository
  intelligence to `src/context/repository-intelligence.ts`; disambiguate
  physical and nonblank line counts for the two lifecycle concentrations.
- final result: repository/command/lifecycle baseline `PASS`; known-failure
  recording `PASS`; real local-model attempt `PASS`; fake/real evidence
  separation `PASS`; documentation-only/no-rewrite scope `PASS`.
- remaining risks in this report are deliberately unproven later-phase
  obligations, not unmet Phase 0 exit conditions.

## Gate decision

PASS

## Next phase eligibility

YES — Phase 1 is eligible. Phase 1 implementation has not started in this
change set.
