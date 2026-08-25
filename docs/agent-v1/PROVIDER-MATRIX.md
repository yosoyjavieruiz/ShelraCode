# Provider and runtime audit

This is a current local-source/runtime matrix. It does not refresh external
provider documentation and does not claim production connectivity.

| Provider/runtime surface          | Source evidence                                                                                                        | Fresh runtime evidence                                                                                                                                           | State                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| LM Studio OpenAI-compatible API   | src/providers/openai-compatible.ts; control-plane/runtime registry                                                     | 127.0.0.1:1234/v1/models returned four local models; 7B and 1.5B live fixture runs completed/blocked as recorded                                                 | Active, locally verified                                      |
| llama.cpp-compatible HTTP surface | Shared OpenAI-compatible adapter and runtime discovery code                                                            | No independent llama.cpp server was exercised in this audit                                                                                                      | Partial; live behavior unproven                               |
| Ollama runtime                    | src/runtimes/ollama.ts                                                                                                 | No live Ollama journey was exercised                                                                                                                             | Partial; live behavior unproven                               |
| OpenAI remote route               | Provider/router source exists where configured                                                                         | No credentials or remote request used                                                                                                                            | NO VERIFICABLE                                                |
| Groq remote route                 | Registry reads `GROQ_API_KEY`; adapter normalizes `/models` and `/chat/completions`; strict-zero marks it `free_quota` | `localcode providers` observed configured/healthy; `localcode models` observed Free-quota catalog; no inference request; account quota/privacy remain unverified | Active source path; live health/discovery verified            |
| OpenRouter remote route           | Registry reads `OPENROUTER_API_KEY`; catalog is hard-filtered to free records before routing                           | `localcode providers` observed configured/healthy; `localcode models` observed only `VERIFIED_FREE` entries; no inference request; privacy remains unverified    | Active source path; live filter and health/discovery verified |
| Tool streaming normalization      | Adapter buffers tool fragments by call/index and yields complete tool.call                                             | Regression test proves no partial tool JSON reaches transcript                                                                                                   | Active, but event granularity is narrower than target design  |
| Capability fingerprint            | src/agent/capability-probe.ts and control-plane cache path                                                             | Fresh exact probe matrix not run for all discovered models                                                                                                       | Partial                                                       |
| Strict-zero/cost gates            | src/router/router.ts, routing docs and tests                                                                           | Deterministic routing coverage passed; no paid route was invoked                                                                                                 | Locally verified, production policy unproven                  |

## Boundary

The agent kernel receives normalized provider events rather than provider
response objects. The current normalized event shape includes text, reasoning,
complete tool calls, usage, done and error. The provider adapter safely
accumulates incomplete tool arguments, but does not expose a separate
kernel-facing tool.call.arguments.delta event.

## Provider policy verified in source/tests

- Groq Free tier does not require a paid upgrade to be used; ShelraCode models
  it as expiring quota-bearing capacity and stops or falls back to another
  eligible local/free route when the quota is unavailable.
- OpenRouter paid model records are removed during discovery. Only `:free`,
  `openrouter/free`, or both-zero pricing records can become candidates.
- A provider key is authentication, not proof of privacy. ZDR and repository
  privacy policy remain independent gates.
- Strict-zero never evaluates paid providers and never upgrades either free
  provider.

## Not established

- Remote provider credentials, quotas, free capacity, billing behavior or
  production DNS/TLS/observability.
- Exact compatibility of every current LM Studio/llama.cpp/OpenAI/Groq
  version.
- A clean bundle or executable built from this exact working tree.
