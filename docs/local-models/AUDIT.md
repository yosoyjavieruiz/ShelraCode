# LocalCode Local Model Hub — Architecture Audit

Audit date: 2026-08-23. This audit uses the active checkout at `main`, commit
`4cc7ba7`, with the existing dirty worktree preserved. The active application
path is `src/index.ts` → `src/tui/launch.tsx` → `src/tui/app.tsx`; the built
artifact is `dist/index.js`.

## Current implementation map

| Concern              | Current path                                                      | Current behavior                                                                                                                | Boundary status                                                         |
| -------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Candidate model      | `src/shared/types.ts:ModelCandidate`                              | One record contains source, provider identity, cloud free metadata, privacy, health, quality, and optional local runtime fields | Mixed local/remote domain                                               |
| Cloud transport      | `src/providers/types.ts`, `src/providers/openai-compatible.ts`    | Normalized discovery, stream, health and quota adapter                                                                          | Usable for remote providers                                             |
| Local HTTP transport | `src/runtimes/http.ts`                                            | Discovers local `/v1/models`, then exposes a `ProviderAdapter` through `provider()`                                             | Transport is local, domain is still provider-shaped                     |
| Ollama               | `src/runtimes/ollama.ts`                                          | Discovers `/api/tags` and returns local candidates                                                                              | No load/unload/stream adapter of its own                                |
| Runtime discovery    | `src/runtimes/discovery.ts`                                       | Probes Ollama, generic local HTTP, LM Studio and llama.cpp endpoints                                                            | No managed process lifecycle                                            |
| Hardware fit         | `src/hardware/llmfit.ts`                                          | Uses `llmfit --json system` and `recommend --json`; basic fallback                                                              | No model-specific `plan` contract or fit path classification            |
| Model catalog        | `src/cli/control-plane.ts`                                        | Merges llmfit recommendations, runtime models and remote provider models in memory                                              | No source/revision/variant/install catalog                              |
| Routing              | `src/router/router.ts`                                            | One score formula includes `quotaHeadroom` for every candidate; local is special-cased after the formula is built               | Local route explanation still emits cloud language                      |
| Persistence          | `src/storage/database.ts`                                         | Sessions, routes, quotas, health and observations exist                                                                         | No model variants, installed models, download jobs or runtime instances |
| Models UI            | `src/tui/views/Centers.tsx`, `src/tui/components/ModelPicker.tsx` | Local and free-cloud rows are separated visually, but records still expose `providerId` and local metadata as provider metadata | Presentation is ahead of the domain model                               |

## Reproduced incorrect coupling

1. A local candidate has `free.status = verified_free` and a synthetic
   `providerId` because `ModelCandidate` requires cloud-shaped fields.
2. `scoreCandidate()` calculates `quotaHeadroom` and
   `quotaOpportunityCost` for the same structure used by local candidates.
3. The route explanation always includes `Privacy gate passed`, `Cost gate
passed`, and `quota headroom`, even when the selected target is local.
4. `OpenAICompatibleLocalRuntime.provider()` converts an external local
   runtime into a cloud-style `ProviderAdapter`; this prevents runtime-specific
   lifecycle operations from becoming first-class.
5. `discoverModels()` uses one flat array for llmfit recommendations,
   installed/external runtime models and remote catalog models. There is no
   distinction between a model, a variant, an installed artifact and a running
   instance.
6. There is no safe download manager, integrity record, disk-space check,
   resumable job state or explicit ownership boundary for local model files.

## Product and safety consequences

- Local usage can be incorrectly explained as consuming free-cloud capacity.
- A model that is technically executable through CPU/GPU offload cannot be
  represented with a meaningful fit classification.
- LM Studio looks like a required model source because it is the only observed
  local catalog with product-facing rows; llama.cpp is only an endpoint probe.
- A catalog refresh cannot be made offline-first because model metadata and
  installed state are not persisted independently.
- Process ownership is undefined, so a future managed runtime could leak a
  child process or kill an unrelated process if it used a fixed port.

## Current evidence boundary

`verified_local`:

- Existing source and integration tests cover the current provider/router
  contracts, privacy moat, strict-zero exclusion and local runtime discovery.
- `llmfit` has a tested fallback path when the executable is unavailable.
- The actual TUI bundle builds and the current models center can be opened.

`NO VERIFICABLE` before this change:

- A local target with a distinct route score and explanation contract.
- HF-backed live discovery and variant grouping.
- Model download, cancellation, resume, integrity verification and storage
  accounting.
- A LocalCode-owned llama.cpp process lifecycle.
- A local-only 100-task run proving no LocalCode quota is enforced.
- MLX execution on Apple Silicon from this Windows workstation.

## Migration boundary

The implementation will preserve the existing `ProviderAdapter` for remote
providers and preserve compatibility fields while introducing a typed
`ExecutionTarget` and local domain records. The first functional vertical is:

```text
ExecutionTarget separation
  → local/cloud route scoring and explanations
  → HF metadata discovery and search
  → safe single-file/snapshot download jobs
  → installed model registry
  → managed llama.cpp detection/start/health/stop contract
  → Models UI language and regression coverage
```

Automatic binary installation, arbitrary repository code execution, and live
large-model downloads remain deliberately out of the default test path.
