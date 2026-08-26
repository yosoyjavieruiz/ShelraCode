# Adaptive autonomy evaluation

The primary metric is end-to-end task success, not unit-test count or tool
volume.

The suite should cover conversation, repository questions, read-only review,
simple edits, greenfield artifacts, multi-file changes, debugging,
verification diversity, malformed tools, recovery, dirty worktrees,
cancellation, compaction/resume and long-horizon work.

Compare the same model/runtime/hardware under the baseline and the improved
harness. Report task success, false completion, false blocking, invalid action
rate, recovery rate, context tokens, model/tool calls, wall time and
verification accuracy. Hold out task shapes, repositories and languages to
detect task-specific overfitting.

The current repository baseline is recorded in the root audit and must be
refreshed after implementation; no live 1.5B–14B generalization claim is made
without current model/runtime/quantization evidence.
