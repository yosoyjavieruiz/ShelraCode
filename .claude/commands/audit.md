---
description: Show the ShelraCode forensic-audit state and the next action
---

Report the current state of the ShelraCode forensic SDD audit.

1. Read `docs/audit/README.md` (charter + deliverable tracker) and
   `docs/audit/AUDIT-BOOTSTRAP.md`.
2. Confirm audit mode: is `SHELRA_AUDIT_MODE=true` in `.claude/settings.json`?
3. List each tracker deliverable with its current status (TODO/WIP/DONE/BLOCKED),
   checking whether its file exists under `docs/audit/`.
4. Recommend the single highest-value next step per the execution order
   (repository-forensics first). Do NOT modify product code. Do NOT fabricate
   findings for deliverables that are still TODO.
