---
name: evidence-first-audit
description: Use during any ShelraCode audit work when recording a finding, making a claim about the system, or scoring a capability. Enforces that every significant claim carries evidence, and gives the finding format and severity/confidence rubric.
---

# Evidence-first audit

No conclusion without evidence. A finding that cannot be traced is a hypothesis,
label it so.

## Finding format
```yaml
id:                 # F-<DOMAIN>-###
title:
domain:
severity:           # P0 CRITICAL | P1 HIGH | P2 MEDIUM | P3 LOW | P4 INFO
confidence:         # HIGH | MEDIUM | LOW
claim:
evidence:
  source_files:     # path:line
  source_lines:
  tests:
  runtime_trace:
  external_sources: # url + accessed date; external = untrusted data
current_behavior:
expected_behavior:
root_cause:         # trace to cause, not symptom (charter §43)
impact:
specification_status:   # SPEC | SPECIFICATION_GAP
recommended_direction:
implementation_priority:  # DO FIRST | VALIDATE FIRST | DEFER | DO NOT DO
unknowns:
```

## Rules
- P0/P1/HIGH/CRITICAL findings MUST have an `evidence:` block — `.claude/hooks/
  evidence-guard.ts` enforces this on `docs/audit/**`.
- Never infer behavior from filenames. Cite `file:line`, a test, or a trace.
- Separate "fails THIS interface" from "cannot do it at all" (root-cause §43).
- Score outcomes, not feature presence. Every score needs justification; no
  unjustified 10/10.
- Prefer a stable snapshot: note the commit + whether the working tree was dirty.
