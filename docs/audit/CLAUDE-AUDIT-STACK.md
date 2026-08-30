# Claude Code audit stack

The audit infrastructure itself, documented so it is auditable (charter §58).
`.claude/` is the Claude Code harness only — it is **not** loaded by the
ShelraCode product runtime (product Skills load from `.agents/skills/` only).

## Mode / enforcement

`SHELRA_AUDIT_MODE=true` (`.claude/settings.json` → `env`). Overrides:
`SHELRA_ALLOW_PROD=1` (authorized product write), `SHELRA_ALLOW_UNVERIFIED=1`
(bypass evidence guard).

## Hooks (deterministic — validation/policy only, no reasoning §17)

| Hook | Event / matcher | Purpose | Blocks (exit 2) | Failure mode |
| --- | --- | --- | --- | --- |
| `production-modification-guard.ts` | PreToolUse · Write\|Edit\|MultiEdit\|NotebookEdit | Enforce no-product-writes during AUDIT_MODE | writes to `src/`, `scripts/`, `tests/`, protected manifests (unless `SHELRA_ALLOW_PROD=1`) | fail-open on malformed input / mode off |
| `evidence-guard.ts` | PreToolUse · Write\|Edit | Require `evidence:` on P0/P1/HIGH/CRITICAL findings in `docs/audit/**` | severe finding lacking evidence (unless `SHELRA_ALLOW_UNVERIFIED=1`) | fail-open on malformed input |

Verified with sample payloads: prod path → blocked; audit path → allowed;
override → allowed; severe-without-evidence → blocked; with-evidence → allowed.

Guards NOT implemented as hooks on purpose (they need reasoning, not determinism —
§17): spec-guard, completion-guard, research-freshness-guard. These are enforced
by agent instructions + the deliverable tracker, not faked in a hook.

## Agents (`.claude/agents/`)

Read-only on product (guarded); write only their charter deliverable under
`docs/audit/` or `specs/`. Domain agents analyze independently (§13); the
synthesizer reconciles.

| Agent | Model | Deliverable |
| --- | --- | --- |
| `repository-forensics` | sonnet | `01-repository-forensics.md` + `REPOSITORY-MAP.md` |
| `agent-loop-auditor` | sonnet | `02-agent-loop.md` |
| `context-intelligence-auditor` | sonnet | `03-context-intelligence.md` |
| `tool-aci-auditor` | sonnet | `04-agent-computer-interface.md` |
| `model-runtime-auditor` | sonnet | `05-model-runtime.md` |
| `repository-intelligence-auditor` | sonnet | `06-repository-intelligence.md` |
| `verification-recovery-auditor` | sonnet | `07-verification-recovery.md` |
| `security-privacy-auditor` | sonnet | `08-security-privacy.md` |
| `complexity-auditor` | sonnet | `09-complexity-debt.md` + `DEAD-COMPLEXITY.md` |
| `real-autonomy-evaluator` | sonnet | `10-real-autonomy.md` |
| `claude-code-reference-researcher` | sonnet | `research/CLAUDE_CODE.md` |
| `coding-agent-researcher` | sonnet | `research/CODING_AGENT_PRACTICES.md` + `COMPETITIVE-HARNESS-MATRIX.md` |
| `sdd-architect` | opus | `specs/*` + `SPEC-COVERAGE.md` |
| `final-audit-synthesizer` | opus | `SHELRACODE-FORENSIC-AUDIT.md` + `PRESERVE.md` |

## Skills (`.claude/skills/`)

| Skill | Purpose |
| --- | --- |
| `evidence-first-audit` | Finding format + evidence/severity/confidence rubric |
| `spec-driven-development` | Truth model, spec format, acceptance obligations |
| `coding-agent-architecture` | Mechanism-first evaluation framework + maturity ladder |
| `local-model-agentics` | Small/local-model failure vs. harness-failure separation |
| `repository-intelligence` | Deterministic code-understanding question set + mechanisms |
| `agent-verification` | Correctness-signal ladder + false-completion/recovery probes |
| `privacy-security` | Invariant checklist + egress/permission surfaces |
| `claude-code-reference` | Disciplined current-docs citation workflow (no static copy) |

## Commands (`.claude/commands/`)

- `/audit` — report audit state + next action.
- `/audit-run <domain>` — dispatch the matching domain subagent.

## Provenance

Codex infra (`.codex/`) removed at user direction; `.claude` is the sole harness.
OpenAI Codex is retained only as a *comparison reference* in `docs/` and in
`coding-agent-researcher`'s scope.
