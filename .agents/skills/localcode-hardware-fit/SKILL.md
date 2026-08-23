---
name: localcode-hardware-fit
description: Inspect LocalCode hardware and local-model recommendation functionality using llmfit, including system detection, coding-model recommendations, runtime discovery and graceful fallback when llmfit is unavailable.
---

# Hardware Fit

Prefer llmfit's machine-readable interface: `llmfit --json system` and `llmfit recommend --json --use-case coding --limit 10`. Parse only fields LocalCode needs and ignore unknown fields. Do not reimplement the hardware matrix. If llmfit is unavailable, report reduced capability, perform basic system/runtime discovery, and give actionable setup guidance.
