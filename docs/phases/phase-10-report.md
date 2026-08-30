# Phase 10 Report

**Phase:** Dynamic Capability System (DCS), measured Skills, and paired
evaluation
**Source revision:** `230b5575a592897fa113e3d05407e6f93e4f01da`
**Working tree:** dirty; unrelated user changes were preserved (258 status
entries at verification time)
**Gate:** PASS

## Repository evidence

- `src/agent/dynamic-capabilities.ts` is the host-owned metadata registry and
  resolver. Registration accepts metadata only; host evidence is incorporated
  only through a validated paired report.
- `src/evals/paired-capability.ts` compares OFF/ON trials for one exact Driver
  profile and configuration. It records parse-independent observable outcomes,
  repeated `trialId` samples, metric coverage, and a tamper-evident report
  digest.
- `src/instructions/skill-loader.ts` discovers bounded Skill metadata and
  keeps Skill bodies unloaded unless the context layer receives a host-approved
  activation decision.
- `src/context/repository.ts` registers `skillEvaluations` before resolving
  Skills. Repository-authored frontmatter evidence is discarded by
  `registerSkill()` and cannot promote a Skill.
- The existing product baseline still has no qualifying real local-model
  evidence for broad coding autonomy; this phase does not upgrade that claim.

## Changes

- Added DCS activation modes (`disabled`, `opt_in`, `auto`) with exact Driver
  identity, configuration, capability-level, protocol, task, and authority
  checks.
- Added host-owned paired evaluation reports with repeated-trial requirements
  (two trials per task by default), complete observable metric coverage, and
  conservative promotion decisions.
- Added explicit configuration-digest matching at automatic activation time.
- Added Skill metadata-only discovery and progressive body loading.
- Added context integration for host-owned paired reports.
- Added report-integrity verification and rejected preloaded/bare promotion
  evidence from registry registration.
- Added adversarial and integration coverage for forged frontmatter, stale
  configuration, missing metrics, insufficient repetitions, tampered reports,
  and positive host-approved Skill activation.
- Documented the DCS and paired-evaluation contracts in
  `docs/architecture/dcs.md`, `docs/evals/capability-paired-evaluation.md`,
  and `docs/evals/evaluation-policy.md`.

## Tests/evals executed

- command: `bun test tests/unit/dynamic-capabilities.test.ts tests/unit/paired-capability.test.ts tests/unit/skills.test.ts tests/integration/context-skills-dcs.test.ts`
- result: **22 pass, 0 fail, 87 expectations**
- command: `bun run typecheck`
- result: **PASS** (`tsc --noEmit`)
- command: `bunx prettier --check` on all Phase 10 source, test, and document
  paths
- result: **PASS**
- command: `bun test`
- result: **860 pass, 24 fail, 1 skip, 3091 expectations**. The failures are
  concentrated in pre-existing dirty OpenTUI interaction/golden tests and the
  existing `code-review-agent` diff-check baseline; all Phase 10 focused tests
  pass and no Phase 10 failure was observed in the non-UI host suites.
- command: independent Phase 10 gate review by `phase1_gate_verifier`
- result: **PASS** after the four initial blockers were fixed; fresh focused
  evidence was **22 pass / 0 fail**, typecheck PASS, and scoped Prettier PASS.

## Real-model evidence

- exact model identity: unchanged from the Phase 0 baseline
- runtime: no new real-model trial was required or available for this host
- result: **UNPROVEN** for automatic Skill benefit and broad coding autonomy;
  deterministic tests are not relabeled as real-model evidence.

## Metrics

- focused DCS/Skill/context tests: `22/22` pass
- paired-evaluation automatic-promotion tests: positive, non-beneficial,
  regression, missing-metric, and insufficient-sample cases covered
- repository-authored forged-evidence activation: rejected
- stale configuration activation: rejected
- tampered report digest: rejected
- default Skill body auto-loading: disabled
- real-model autonomy success: no new qualifying sample; remains unproven

## Risks / regressions

- `skillEvaluations` is currently an in-process host-owned boundary. If reports
  are later loaded from persistence or an external service, add strict parsing,
  provenance/authentication, and full cross-field consistency checks before
  allowing them to promote authority.
- The full dirty-worktree suite has unrelated OpenTUI and code-review failures;
  they remain explicitly recorded rather than weakened or hidden.
- No Skill is auto-enabled merely because its frontmatter claims a paired
  result. Automatic activation still requires an exact certified profile and
  current configuration digest.

## Gate decision

**PASS**

The Phase 10 acceptance surface is implemented and independently verified.
The known broader-suite failures and absent real-model evidence do not support
any higher autonomy claim.

## Next phase eligibility

**YES** — Phase 11 may begin, subject to preserving the documented in-process
evidence boundary and the known baseline failures.
