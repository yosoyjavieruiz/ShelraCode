# LocalCode Local Model Hub Design

**Goal:** Make local inference a first-class, zero-cost execution domain and
deliver a testable local model discovery/install/run vertical without
weakening strict-zero remote policy.

## Approved scope from the master implementation prompt

- Separate local runtime targets from remote provider targets.
- Remove cloud quota/cost language and gates from local routing.
- Use llmfit for hardware intelligence with a basic fallback.
- Make llama.cpp the first managed runtime target and treat LM Studio/Ollama/
  generic local HTTP as external runtimes.
- Add HF-backed model metadata discovery, variants, installed state and safe
  download jobs.
- Add `MAX QUALITY`, `LOCAL ONLY`, `FREE ONLY` and `FAST` only where behavior is
  executable and tested.
- Migrate the Models UI and route events to the new terminology.

## Deliberate MVP limits

- No automatic runtime binary installation.
- No real large-model download in CI or fixture captures.
- No arbitrary model-repository code execution and no `trust_remote_code`.
- MLX is modeled/detected as a platform-specific adapter boundary; Windows CI
  does not claim MLX execution.
- Existing remote provider adapters remain in place and continue to own remote
  privacy/quota/billing semantics.

## Data flow

```text
Runtime discovery + HF metadata + llmfit
  → ModelCatalog
  → ModelVariant / InstalledModel
  → LocalExecutionTarget
  → local score or remote gates/score
  → AgentTask / route event / Models UI
```

## Verification contract

- Domain tests prove local scores contain no quota/cost fields and local route
  explanations contain no cloud-commercial language.
- Routing integration tests prove local candidates do not call quota or paid
  gates, while remote candidates still do.
- Catalog tests cover search, variant grouping, stale metadata and offline
  fallback.
- Download tests use a local HTTP fixture to cover progress, cancellation,
  resume, disk rejection and SHA-256 failure/success.
- Runtime contract tests cover llama.cpp executable detection/argument safety,
  health, bounded stop and external local HTTP model normalization.
- TUI fixtures cover Local/Free Cloud separation, Maximum Quality, Stretch and
  local failure states at 80/100/120/160 columns.
