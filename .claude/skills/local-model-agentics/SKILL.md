---
name: local-model-agentics
description: Use when evaluating why a small/local model (1-14B) succeeds or fails as an agent in ShelraCode, or when judging whether a limitation is the model or the harness. Covers tool-protocol sensitivity, edit-format sensitivity, quantization, chat templates, structured output, and small-model cognitive load.
---

# Local-model agentics

The goal is autonomy on 1-14B local models. Most failures are harness-shaped, not
proof the model "can't do it." Always separate the two.

## Sensitivity axes
- **Tool protocol**: native tool-calling vs. constrained-JSON vs. XML/system
  tools. A model that fails one protocol may pass another. Check the driver
  profile / protocol calibration before concluding incapacity.
- **Edit format**: search-replace vs. unified-diff vs. whole-file. Small models
  differ sharply in reliability per format.
- **Context load**: tool-description bloat, long histories, and low-relevance
  context degrade small models fastest. Fewer, sharper tokens win.
- **Action horizon**: number of tools and steps a small model can hold before
  losing the thread; recovery cost after an error.
- **Quantization / runtime / chat template**: wrong template or aggressive
  quant silently wrecks tool use and structured output.
- **Structured output**: grammar/JSON-schema constraints vs. free generation.

## Root-cause rule (§43)
"Model M failed the current protocol" ≠ "Model M cannot act as an agent." State
which protocols/formats were tried. Recommend protocol/format adaptation before
declaring a model unfit.
