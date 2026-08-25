<p align="center"><strong>◆ ShelraCode</strong></p>
<p align="center">Maximum intelligence. Your way.</p>
<p align="center">A local-first, privacy-gated AI coding agent for the terminal — routes every task between local models and verified-free cloud, and never spends money without your explicit say-so.</p>

---

```text
 ◆ ShelraCode   ~/shelra · main                                                 Local · Private

                      ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░ ░░░░ ░░░░ ░░░░ ░░░░
                      ░███ █░░█ ████ █░░░ ███░ ░██░ ░░░ ████ ░██░ ███░ ████
                      █    █░░█ █    █░░░ █  █ █  █ ░░░ █    █  █ █  █ █
                       ██░ ████ ███░ █░░░ ███  ████ ░░░ █░░░ █░░█ █░░█ ███░
                      ░  █ █  █ █  ░ █░░░ █  █ █  █ ░░░ █░░░ █░░█ █░░█ █  ░
                      ███  █░░█ ████ ████ █░░█ █░░█ ░░░ ████  ██  ███  ████
                         ░  ░░             ░░   ░░  ░░░      ░  ░    ░
                      ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░ ░░░░ ░░░░ ░░░░ ░░░░


                                 Maximum intelligence. Your way.


                            shelra · main · Local-first routing ready


                                   Try
                                     Explain this repository
   ╭────────────────────────────────────────────────────────────────────────────────────────╮
   │› Ask ShelraCode…                                                                       │
   │                                                                                        │
   │                                                                                        │
   │ @ context   Auto · local first                         Shift+Enter newline · Esc clear │
   ╰────────────────────────────────────────────────────────────────────────────────────────╯
 Ready
```

*A real capture of the running TUI (`bun run src/index.ts`, 96×27), not a mockup — see `docs/assets/readme-home.txt`.*

---

## Why ShelraCode

Every other terminal coding agent — Claude Code, Codex, Cursor CLI — assumes
you're paying for a frontier model on someone else's servers. ShelraCode
starts from a different premise: **route to whatever local model your
machine can already run, fall back to verified-free cloud capacity when it
genuinely helps, and only touch a paid route if you explicitly approve it.**

That's a real trade-off, not a marketing line, and we'd rather be honest
about it: a small local model (1.5B–14B, coder-tuned, quantized) does not
match frontier reasoning depth. What it *can* do — with a harness that
classifies the task, gates on empirically-probed capability instead of
assumed capability, and independently verifies evidence before ever
reporting success — is complete everyday, bounded coding work reliably,
for free, without your code leaving your machine. Closing the gap between
"basic local agent" and genuine day-to-day parity with Claude Code/Codex is
the whole point of this project, not a side effect of it.

## Quickstart

There's no published package yet — run it straight from the repository:

```bash
git clone https://github.com/yosoyjavieruiz/shelra.git
cd shelra
bun install
bun run src/index.ts
```

The first launch opens onboarding (hardware, local runtimes, providers,
privacy and routing policy) and continues straight into the TUI when it
finishes. Run `bun run setup` any time to reopen it intentionally.

```text
localcode setup       reopen onboarding intentionally
localcode doctor      print safe diagnostics
localcode doctor --agent   live model/tool capability probe results
localcode models      inspect normalized model state
localcode providers   inspect provider readiness
localcode config      show effective global and repository policy
localcode              onboarding on first run, then the full-screen TUI
```

(The npm package/binary are still named `localcode` internally — the
`ShelraCode` rename you see in the TUI itself is in progress.)

## How routing works

1. **Classify** — every objective is classified by task type and complexity
   (`SEARCH`, `SMALL_EDIT`, `MULTI_FILE_EDIT`, `REFACTOR`, …), which sets how
   much model capability the task actually needs. A one-line fix doesn't
   require the same bar as an autonomous multi-file refactor.
2. **Probe, don't assume** — local models are empirically capability-probed
   (`localcode doctor --agent`): can it hold a conversation without forcing a
   tool call, read the repository, select and apply a real edit, iterate on a
   failing test? The result — `chat_only` → `workspace_reader` →
   `coding_agent` → `advanced_coding_agent` — is cached per model/runtime and
   is what the router gates on, never a model's name or size.
3. **Gate on privacy and cost** — `strict-zero` routing (the default) never
   selects a paid route. Repository content that looks like a credential or
   high-confidence secret blocks cloud routing outright, regardless of task.
4. **Verify, don't trust** — the agent loop's completion gate independently
   checks real evidence (files actually changed, tests actually passing)
   before ever reporting a task done. A model that attempts and fails is
   reported as failed — never a confident lie.
5. **Explain** — every routing decision is inspectable: which candidates were
   considered, why each rejected one was rejected, and the score breakdown
   for the one selected.

## Providers and local runtimes

| Local runtime | Env var                     | Default                         |
| -------------- | ---------------------------- | -------------------------------- |
| LM Studio      | `LOCALCODE_LM_STUDIO_URL`    | `http://127.0.0.1:1234/v1`       |
| Ollama         | `LOCALCODE_OLLAMA_URL`       | `http://127.0.0.1:11434`         |
| llama.cpp      | `LOCALCODE_LLAMA_CPP_URL`    | `http://127.0.0.1:8080/v1`       |

| Cloud provider | Free-tier eligible for strict-zero |
| -------------- | ----------------------------------- |
| Groq           | Only with explicit `GROQ_FREE_CONFIRMED`/`GROQ_ZDR_CONFIRMED` |
| OpenRouter     | Only explicit `:free` models with data-collection/ZDR preferences enforced |

A provider credential alone never establishes free or private eligibility —
see `docs/PROVIDERS.md` and `.env.example` for the explicit confirmation
flags each one requires. Cloudflare Workers AI, Gemini and OpenCode Zen are
recognized as paid/unverified boundaries and are intentionally not
advertised as automatic free routes.

## Safety defaults

- Repository privacy defaults to `private`; routing defaults to `strict-zero`.
- Paid routes are never selected by strict-zero, ever.
- `.env*`, credential-shaped paths and high-confidence secret findings block
  cloud routing outright.
- ShelraCode checkpoints only its own file mutations and refuses rollback
  over a change it didn't make.
- No remote telemetry.

## Build and verify

```bash
bun run format:check
bun run typecheck
bun test
bun run build
bun run smoke
```

`bun run build` produces `dist/index.js` plus the OpenTUI native runtime
assets; the native package stays an external runtime dependency so the
bundle uses whatever platform artifact `bun install` resolved.

## Documentation

| Topic | Doc |
| --- | --- |
| Product thesis, target user, non-goals | [`docs/PRODUCT.md`](docs/PRODUCT.md) |
| Provider adapters and eligibility rules | [`docs/PROVIDERS.md`](docs/PROVIDERS.md) |
| Storage/checkpoint model | [`docs/STORAGE.md`](docs/STORAGE.md) |
| Terminal UI conventions | [`docs/TUI.md`](docs/TUI.md) |
| Current status, in-progress and blocked work | [`docs/STATUS.md`](docs/STATUS.md), [`docs/agent-kernel/STATUS.md`](docs/agent-kernel/STATUS.md) |
| Acceptance evidence | [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md) |
| Live capability-probe evidence per model | [`docs/agent-kernel/MODEL-CAPABILITIES.md`](docs/agent-kernel/MODEL-CAPABILITIES.md) |

## Project status

ShelraCode is a working v0.1 vertical slice, not a finished product: hardware
detection, local runtime discovery, normalized OpenAI-compatible providers,
privacy-aware context, strict-zero routing, a provider-independent agent
loop with checkpointed tools, SQLite state, and a full-screen TUI all run
end to end today. It has real, documented limitations — no standalone
native executable yet, `llmfit` hardware detection falls back when the
package isn't installed, and several cloud providers are deliberately not
wired up until their free/privacy behavior can be verified in code, not just
assumed. `docs/STATUS.md` and `docs/ACCEPTANCE.md` are kept current with
what's actually been exercised, not what's aspirational.

## Contributing

Read [`AGENTS.md`](AGENTS.md) first — it documents the product invariants
(privacy gates before quality, strict-zero by default, evidence-based
completion, no silent paid inference) that every change, human or agent
authored, is expected to hold to.
