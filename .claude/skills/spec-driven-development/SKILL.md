---
name: spec-driven-development
description: Use when reconstructing ShelraCode intended behavior, writing capability specs, or turning a requirement into acceptance obligations. Applies the SDD truth model and the spec + acceptance-obligation formats. Rule — no implementation recommendation without a spec or explicit SPECIFICATION_GAP.
---

# Spec-driven development

Specification is the source of truth BEFORE implementation. Code is
implementation evidence, not intent.

Hierarchy: PRODUCT INTENT → SPECIFICATION → ACCEPTANCE OBLIGATIONS →
ARCHITECTURAL CONTRACTS → IMPLEMENTATION → VERIFICATION → OBSERVED BEHAVIOR.

## Truth model (per capability)
Reconstruct intended / documented / implemented / tested / observed behavior.
Classify: ALIGNED · PARTIALLY_ALIGNED · UNDOCUMENTED_IMPLEMENTATION ·
DOCUMENTED_BUT_MISSING · TEST_ONLY_BEHAVIOR · IMPLEMENTATION_TEST_CONTRADICTION ·
SPECIFICATION_GAP · UNKNOWN. Never silently resolve a contradiction — record it.

## Spec format (specs/<capability>.md)
Purpose · User Value · Current Observed Behavior · Intended Behavior · Invariants
· Inputs · Outputs · State · Failure Modes · Security Boundaries · Privacy
Boundaries · Acceptance Obligations · Verification Strategy · Observability ·
Open Questions · Explicit Non-Goals.

## Acceptance obligations (machine-verifiable)
```yaml
obligation: changed_code_verification
when: { production_files_changed: true }
must_produce: [verification_command, exit_code, output_digest, changed_files]
completion_blocked_if: [verification_not_executed, verification_failed]
```

## Rule
No implementation recommendation without an identified spec or an explicit
SPECIFICATION_GAP. Specify obligations; do not implement them during the audit.
