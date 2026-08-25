# Evaluation boundary

Deterministic CI uses a fake provider and disposable fixture repositories for
greetings, read-only questions, malformed/partial tool calls, path errors,
recovery, edits, failing tests, cancellation, dirty worktrees, false
completion, routing, and context relevance.

Live evaluations are separate and record the exact model/runtime/quantization/
context identity. Never turn a live local result into a universal claim about
all 1.5B models.

## Current acceptance evidence - 2026-08-25

Deterministic release suite:

    474 pass / 1 skip / 0 fail / 1529 expectations

The exact Qwen2.5 Coder 1.5B Instruct / LM Studio / Q8_0 configuration passed
two consecutive final runs of the disposable three-file fixture. Each run
completed in 10 turns with verified completion and three passing
host-controlled verification stages. The acceptance target is bounded
progressive coding, not unrestricted arbitrary-repository autonomy.

The current deterministic regressions also cover the file-domain boundary:
dependency names are not phantom paths, explicit root documents are staged
correctly, and create/edit/overwrite/delete activity carries typed path and
diff evidence to the TUI.

The current agent doctor matrix detects three local models: Qwen3 8B as
chat_only, Qwen2.5 Coder 7B as workspace_reader, and Qwen2.5 Coder 1.5B as
workspace_reader. It reports Progressive coding READY, Bounded coding NOT
READY, and Autonomous coding NOT READY. This confirms that model labels and
parameter count do not replace measured capability probes, while still making
the accessible progressive route visible to users.
