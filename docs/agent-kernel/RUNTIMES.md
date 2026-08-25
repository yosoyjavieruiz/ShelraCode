# Runtime Boundary

LocalCode keeps provider-specific protocol details inside adapters implementing
`ProviderAdapter`. The kernel receives normalized text, tool-call, usage,
done, and error events.

Current practical targets are managed/local OpenAI-compatible runtimes,
LM Studio, Ollama, and llama.cpp discovery. Remote Groq/OpenRouter adapters
remain policy-gated. Runtime endpoint health is not capability proof: the
exact model, quantization, chat template, parser, generation settings, and
hardware combination must be probed.

Current machine evidence on 2026-08-24:

- LM Studio endpoint: reachable.
- `qwen2.5-coder-1.5b-instruct`: live capability probe version 8 classifies it
  `workspace_reader`. Native metadata reports `Q8_0` and context `32768`.
  Host recovery handles LM Studio's textual `<tools>` envelope and duplicate
  continuation, but edit, test-iteration, and verification probes still fail.
- Ollama and llama.cpp: unavailable in the local runtime discovery.
- No remote inference was called during this implementation; strict-zero
  remains active.

The live source TUI language journey now receives a 2.3k-character host-built
fact context, exposes no model workspace tools for this deterministic question,
and completed with visible `Done`/`TypeScript` on the capped request path.
This is workspace-reader evidence only; no live coding task was authorized or
completed.

No runtime is advertised as autonomous-coding capable from a model name or a
catalog `tools: true` flag alone.

## Latest runtime reconciliation — 2026-08-24

The current LM Studio `/v1/models` response contains the generative
`qwen2.5-coder-1.5b-instruct` model and an embedding-only
`text-embedding-nomic-embed-text-v1.5` entry. LocalCode now filters embedding,
reranking, and cross-encoder identifiers before capability probing so auxiliary
models cannot be selected as coding routes or contaminate `doctor --agent`.

Provider requests now carry host-controlled sampling temperature. Coding and
command turns default to `0.2`; capability probes use `0` for reproducibility.
The live probe remains `workspace_reader` with recovery passing but the full
autonomous-coding gate failing.

## LM Studio native model metadata — 2026-08-24

When the runtime id is `lm-studio`, LocalCode optionally queries the native
`/api/v1/models` endpoint and accepts only entries whose native type is `llm`.
The adapter maps `key`, `display_name`, `quantization.name`, `size_bytes`,
`architecture`, `params_string`, `max_context_length`, and
`capabilities.trained_for_tool_use` into the normalized candidate. A failed or
non-native response falls back to `/v1/models`, preserving compatibility with
older or generic OpenAI-compatible endpoints. The native model list is
metadata enrichment, not a capability certificate; the empirical probe and
router gate remain authoritative.

## Qwen2.5 Coder 7B runtime evidence — 2026-08-24

LM Studio `/api/v1/models` exposed:

```text
key                  qwen2.5-coder-7b-instruct
display              Qwen2.5 Coder 7B Instruct
type                 llm
quantization         Q6_K
size                  6,254,199,296 bytes
context              32768
architecture         qwen2
trained_for_tool_use false
```

The native metadata is consistent with the observed behavior: the OpenAI
compatible response carried an empty `tool_calls` array and put tool-shaped
content in assistant text. The adapter/parser recovery is deliberately
bounded and transcript-safe, but the runtime/model pair remains below the
coding capability gate. The official LM Studio tool-use guidance also warns
that small or non-tool-trained models may emit malformed tool calls; this live
result is concrete evidence of that boundary, not an endpoint-health failure.

## Current LM Studio local inventory - 2026-08-24

```text
Qwen2.5 14B Instruct        qwen2.5-14b-instruct           Q4_K_M  32768
Qwen2.5 Coder 7B Instruct   qwen2.5-coder-7b-instruct     Q6_K    32768
Qwen2.5 Coder 1.5B Instruct qwen2.5-coder-1.5b-instruct  Q8_0    32768
```

The 14B pair passed probe version 11 as `advanced_coding_agent` and is the
current local route for complex coding. The 7B and 1.5B pairs remain
`workspace_reader`. Direct LM Studio responses in these runs used textual
tool envelopes rather than native OpenAI `tool_calls`; LocalCode recovers
bounded valid envelopes inside the adapter/kernel and keeps their JSON out of
the transcript.
