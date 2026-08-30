# Capability paired evaluation

`src/evals/paired-capability.ts` compares one optional capability OFF and ON
under the same exact Driver profile, configuration digest, and task set.

Each trial records only observable host outcomes: success, false success,
actions, tokens, wall time, interventions, loops, and security failures. The
runner rejects duplicate or mismatched task sets and rejects trials produced by
another Driver identity or configuration.

Trials have an explicit `trialId`. By default, automatic promotion requires at
least two repeated trials for every task in both OFF and ON arms. Every
observable metric must be present in both arms before it can support an
efficiency comparison; missing metrics are reported as incomplete coverage, not
as zero-cost outcomes.

An automatic promotion requires both:

1. a measurable success gain, or a material efficiency gain without lowering
   success; and
2. no increase in false success, loops, or security failures.

The report is one of:

- `auto_enable`: safe paired benefit for this exact profile;
- `opt_in_only`: valid comparison with no demonstrated benefit;
- `revise`: invalid pairing or a regression;
- `remove`: reserved for future policy that removes a capability entirely.

The DCS consumes the report's exact evidence. A report for one quantization,
runtime, template, or configuration cannot grant automatic activation to
another profile.
