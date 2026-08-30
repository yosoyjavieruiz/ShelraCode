---
name: coding-agent-architecture
description: Use when evaluating any coding-agent subsystem (ShelraCode's or a reference system's) to apply a consistent mechanism-first framework — agent loop, ACI, context engineering, repository intelligence, editing, execution, observation, verification, recovery, state, persistence, security. Does not encode conclusions about ShelraCode.
---

# Coding-agent architecture (evaluation framework)

Evaluate mechanisms by the problem they solve and the evidence they work — never
by feature count or analogy.

## Dimensions
- **Agent loop**: turn structure, stop conditions, action horizon, does the model
  see the observation it needs for the next decision.
- **ACI (agent-computer interface)**: tool schemas, argument complexity, output
  size/truncation, error legibility, edit format, syntax feedback, recovery.
- **Context engineering**: what's in-context per decision; % that helps the
  current step; accumulation vs. relevance; compaction.
- **Repository intelligence**: deterministic answers (defs/refs/callers/deps/
  tests/diagnostics) vs. LLM guessing.
- **Editing**: representation(s); parse/apply failure; stale/wrong-location edits.
- **Execution & observation**: real shell/tools; observation fidelity.
- **Verification & recovery**: correctness signals kept distinct; false-completion
  detection; loop/rollback/changed-strategy recovery.
- **State & persistence**: single source of truth; durability; resume.
- **Security**: permissions, sandboxing, network/secret boundaries.

## Maturity ladder
ABSENT · STUB · STRUCTURAL · FUNCTIONAL · INTEGRATED · REAL-MODEL-VALIDATED ·
MEASURABLY_EFFECTIVE (last two need empirical evidence).

## Reasoning discipline (§44)
observed problem → candidate mechanism → evidence it addresses the problem →
simpler alternative → recommend evaluating. Not "system X has it, so we need it."
