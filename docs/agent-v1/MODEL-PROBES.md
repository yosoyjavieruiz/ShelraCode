# Model capability probes

Eligibility is measured for the complete configuration:

```text
model × runtime × quantization × chat template × tool parser × harness
```

The probe suite measures no-tool discipline, repository reads, tool selection,
argument validity, error recovery, multi-turn continuation, editing, test
iteration, verification truthfulness, and cancellation. A model name or
"Coder" label is not sufficient.

The current 1.5B Q8_0 LM Studio run has a guarded progressive coding path for
explicit multi-file objectives. It is not advertised as unrestricted advanced
coding until the exact configuration passes the strict capability probe.
