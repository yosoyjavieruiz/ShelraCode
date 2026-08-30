---
description: Run one ShelraCode audit domain via its specialized subagent
argument-hint: repository-forensics | agent-loop | context | aci | model-runtime | repo-intel | verification | security | complexity | real-autonomy | research-claude | research-agents | sdd | synthesize
---

Dispatch the correct audit subagent for the domain: **$ARGUMENTS**.

Mapping (domain → `.claude/agents` subagent):
- repository-forensics → `repository-forensics`
- agent-loop → `agent-loop-auditor`
- context → `context-intelligence-auditor`
- aci → `tool-aci-auditor`
- model-runtime → `model-runtime-auditor`
- repo-intel → `repository-intelligence-auditor`
- verification → `verification-recovery-auditor`
- security → `security-privacy-auditor`
- complexity → `complexity-auditor`
- real-autonomy → `real-autonomy-evaluator`
- research-claude → `claude-code-reference-researcher`
- research-agents → `coding-agent-researcher`
- sdd → `sdd-architect`
- synthesize → `final-audit-synthesizer` (only after domain deliverables exist)

Before dispatching: confirm the agent works read-only on product code
(`SHELRA_AUDIT_MODE`), follows the evidence-first finding format, and writes only
its charter-assigned deliverable under `docs/audit/` or `specs/`. After it
returns, update the tracker in `docs/audit/README.md`.
