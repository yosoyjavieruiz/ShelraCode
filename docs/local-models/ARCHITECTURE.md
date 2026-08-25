# LocalCode Local Model Hub — Target Architecture

## Domain split

```text
ExecutionCandidate
├── LocalExecutionTarget
│   ├── managed runtime (llama.cpp first)
│   └── external runtime (LM Studio, Ollama, LocalAI, vLLM, generic localhost)
└── RemoteExecutionTarget
    └── ProviderAdapter (Groq, OpenRouter, OpenCode/Zen, future providers)
```

The model identity, model variant, installed artifact and running instance
remain separate:

```text
Model
  └── ModelVariant (GGUF/MLX/SafeTensors, quant, revision, size)
        └── InstalledModel (path, integrity, ownership, benchmark)
              └── RunningModel (runtime instance, endpoint, state, context)
```

## Responsibilities

| Boundary    | Owns                                                                                | Must not know                   |
| ----------- | ----------------------------------------------------------------------------------- | ------------------------------- |
| `models`    | normalized metadata, variant grouping, search, fit labels, installed/download state | TUI widgets or provider billing |
| `runtimes`  | detection, health, load/unload, process ownership, local stream                     | remote quota or paid policy     |
| `providers` | remote discovery, privacy, quota, health, stream and failure normalization          | local process lifecycle         |
| `router`    | target eligibility, separate local/remote scoring, explainable decisions            | HTTP/CLI wire shapes            |
| `storage`   | durable catalog/install/download/runtime/benchmark records                          | routing policy decisions        |
| `tui`       | render state and user input                                                         | HF/API/process details          |

## Local route scoring

Local candidates use `LocalScoreBreakdown`:

```text
quality + task fit + tool reliability + context capability
+ hardware fit + runtime reliability + measured speed + memory headroom
```

Remote candidates retain cost/privacy/quota gates and a remote score. A local
decision never creates a quota snapshot, checks paid approval, or emits a cloud
cost gate. `LOCAL_ONLY` rejects every remote target; `FREE_ONLY` permits local
and verified free-cloud candidates; `MAX_QUALITY` can select a slower but
stronger technically viable local candidate.

## Catalog flow

```text
HF search / curated seed / runtime discovery
  → normalize Model + ModelVariant
  → llmfit inspect/plan
  → group variants and label fit
  → persist catalog freshness
  → search/recommend in Models workspace
```

The catalog is bounded in the UI by categories and pagination/search. It does
not copy the entire Hub into memory or claim that a remote repository is
installed.

## Download and process safety

- One active large download by default; jobs are persisted and resumable when
  the source supports byte ranges.
- Destination is under the LocalCode model directory or an explicit user path;
  paths are normalized and disk space is checked before writing.
- Every completed artifact records size, SHA-256 when available/computed,
  source revision and ownership. Integrity failure leaves the previous working
  model untouched.
- Managed llama.cpp starts only a known executable with an explicit argument
  list, loopback bind and allocated port. Stop is graceful first and forced
  only after bounded timeout. LocalCode never kills an unknown PID.
