# Agent-v1 research status

The supplied research report is useful architectural hypothesis material. This
audit did not re-verify external documentation or change a volatile provider
integration, so no external API claim is used as current implementation proof.

For the implementation phase, refresh official documentation for the exact
versions actually used by ShelraCode before changing LM Studio, llama.cpp,
OpenAI, Groq, OpenTUI or model-download integrations. Record the runtime
version, wire format, tool-call framing, streaming behavior and privacy/cost
semantics in this file before relying on them.

Current local conclusions that are independently evidenced:

- the harness is a model-plus-controller system, not only a prompt;
- structural turn policy prevents the named greeting/read-only regressions;
- complete tool-call buffering prevents partial JSON from entering the
  assistant transcript;
- verification and completion gates can block false completion;
- exact model/runtime/template/quantization capability must be measured;
- local live evidence currently covers LM Studio only.

These conclusions are based on current repository source and fresh local
tests/live runs, not on unverified external claims.
