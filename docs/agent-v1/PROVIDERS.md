# Provider boundary

Provider wire formats stop at the adapter. The agent kernel consumes the
normalized provider contract from `src/providers/types.ts`; LM Studio,
llama.cpp-compatible, Ollama-compatible, OpenAI-compatible, and Groq-like
differences must not leak into task state or the TUI.

Tool-shaped text from providers is recovered only through bounded, validated
envelopes. Partial arguments never enter assistant Markdown. The provider
model ID, runtime identity, quantization, context, and capability-probe
version are retained as reproducibility metadata.

Current evidence is summarized in [PROVIDER-MATRIX.md](PROVIDER-MATRIX.md) and
the detailed runtime contract in [docs/agent-kernel/RUNTIMES.md](../agent-kernel/RUNTIMES.md).
