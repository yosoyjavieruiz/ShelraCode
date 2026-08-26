# Recovery contracts

Recovery is a state transition, not a raw error string:

```text
ACT -> OBSERVE -> CLASSIFY -> CONTROLLER REPAIR / MODEL REPLAN / ASK / STOP
```

Each recovery records the failed requirement, evidence, attempted strategies,
forbidden repeats and the selected next strategy. Identical retries are
blocked unless the context, tool, hypothesis, model or decomposition changes.

Completion blockers must remain actionable. If missing evidence can reasonably
be produced, the controller creates recovery work and returns to scheduling;
otherwise it reports the precise external/user blocker.
