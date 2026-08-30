# Dynamic Capability System

Phase 10 introduces a small, host-owned Dynamic Capability System (DCS).
It treats Skills and other optional helpers as metadata-backed hypotheses, not
as mandatory stages in the agent loop.

## Activation contract

Every capability declares:

- activation selectors for task tags, languages, frameworks, and required
  capabilities;
- a minimum certified Driver capability level and compatible action
  protocols;
- a narrow authority declaration (`mayWrite`, `mayExecute`, `mayNetwork`);
- exact-profile paired-evaluation evidence.

The registry resolves a capability for one task using one of three host policy
modes:

- `disabled`: metadata may be visible, but no body or handler is activated;
- `opt_in`: an operator explicitly enables a compatible capability for a
  certified Driver;
- `auto`: activation requires a positive paired OFF/ON evaluation for the same
  Driver profile and configuration.

The default repository-context mode is `disabled`. The historical
`loadSkills: true` option is treated as explicit opt-in, while
`loadSkills: false` remains a disable signal.

Skill frontmatter is repository-authored input. Its claimed paired-evaluation
fields are exposed as metadata for inspection but are deliberately discarded
when the DCS registers the Skill; only a host-owned Shelra Lab report recorded
through `recordPairedEvaluation()` can supply automatic-activation evidence.

## Exact evidence

Automatic Skill activation is rejected when any of these are absent or do not
match the current certified Driver:

- paired evaluation ID;
- evaluation decision `auto_enable`;
- Driver profile ID;
- Driver identity digest;
- Driver configuration digest;
- evaluation timestamp.

The current context/compiler configuration digest is also required at resolve
time and must equal the digest recorded by the paired report. A matching model
identity with a changed tool surface, context budget, edit codec, or other
runtime setting therefore remains inactive until it is re-evaluated.

An evaluation that is equal, inconclusive, or regressive is retained as
evidence but remains `opt_in_only` or `revise`; it cannot silently become an
automatic capability.

The registry stores metadata only. Skill bodies are loaded by the context layer
after an activation decision, so disabling the DCS does not require changing
the Core or exposing procedural content to the model.

## Authority containment

DCS authority never upgrades the Driver. A capability requesting write or
network access is inactive when the certified profile does not carry that
authority, and execution requests require at least the bounded coding tier.
ExecutionBroker and task policy remain the final side-effect boundary.
