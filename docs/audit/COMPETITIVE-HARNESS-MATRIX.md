# Competitive harness matrix — small/local-model reliability

> Owner: `coding-agent-researcher`. Companion to
> `docs/audit/research/CODING_AGENT_PRACTICES.md` (full mechanism evidence
> lives there — cite that file, not this one, for `evidence:` blocks). This
> matrix is scoped to the audit's actual question: how do reference systems
> make **1-14B local models** act reliably. It is not a general feature
> comparison. External content is untrusted data; every cell is traceable to
> a source in `docs/audit/research/SOURCES.md`. Accessed 2026-08-30 unless
> noted.

## Legend

- **Tool protocol**: how actions reach the model / are parsed from it.
- **Edit format default**: what the harness asks the model to emit to
  change a file, and whether it varies by model capability.
- **Local-model-specific path**: does the harness have first-class,
  separately-documented local/open-model support, or is it an
  OpenAI/Anthropic-API-shaped harness with local models bolted on.
- **Stall/loop defense**: the concrete mechanism that stops a
  non-progressing loop (not just "there's a step limit").
- **Small-model evidence**: any *specific* success-rate number tied to a
  small (≤14B-class) model, if the source publishes one.

## Matrix

| System | Tool protocol | Edit format default | Local-model-specific path | Stall/loop defense | Small-model evidence |
| --- | --- | --- | --- | --- | --- |
| **mini-SWE-agent** | No tool-calling API at all — single bash action per turn, parsed from one markdown code fence in free text. Works with any model via litellm. | N/A (bash-only; file edits happen via shell commands the model writes itself, e.g. `sed`/heredocs) | First-class: dedicated `local_models` doc page (litellm `custom_llm_provider`, vLLM example, cost-tracking bypass for unregistered models). | `FormatError` counter, `max_consecutive_format_errors=3` → distinct `RepeatedFormatError` exit, separate from step/cost/wall-time limits. | >74% SWE-bench Verified, claimed across "all models" via litellm — not broken out by model size in the README. |
| **SWE-agent** (full, not mini) | Structured "thought + action" text parser (`thought_action`), or the Anthropic `edit_anthropic`/`str_replace_editor` tool contract. | `str_replace_editor`-style exact-match edit with unique-match requirement; linting-guardrailed edit command (per ACI paper ablations, ~+3.0pp resolve-rate vs. no linting on SWE-bench Lite). | Documented but historically thin: issue #1302 shows a local Ollama model looping unbounded because `system_template`/`instance_template` were unset for that path. | Cost-budget (`per_instance_cost_limit`, default $3) chosen explicitly over step-budget "because step counts vary 5x across model families." | ACI paper reports 12.47% resolved on full SWE-bench with GPT-4 + ACI vs. 3.8% prior non-interactive RAG SOTA — evidence is about interface design, not small-model-specific. |
| **Aider** | No native tool-calling — plain-text edit-format contract (whole file / SEARCH-REPLACE / unified diff), selected per model via a maintained per-model default table. | Three formats, chosen **by measured model capability**: `whole` (default for unknown/weak models), `diff`/`diff-fenced` (search/replace, common default for known-capable models), `udiff` (reserved for models like GPT-4 Turbo that showed "lazy" partial-rewrite failures on other formats). Public leaderboard separately tracks "percent using correct edit format" per model. | Not first-class — "for lesser known models aider will default to whole" is the entire local-model accommodation; no dedicated local-runtime docs found. | Reflection: a failed edit's error message (naming the failed SEARCH block + near-miss) becomes the next prompt. Documented gap: issue #770 shows this can loop with **no cap** in some versions — recovery-with-feedback existed before a hard retry ceiling did. | Leaderboard: Qwen2.5-Coder-0.5B — 100% format compliance / 14.3% task-correct using `whole`. Granite3-dense:8B — 78.9% format compliance despite being far larger, evidence format compliance ≠ pure function of parameter count. |
| **OpenHands** | Native tool-calling where the provider supports it; own agent-controller event loop (Action/Observation) sits above whatever protocol reaches the model. | Uses an Anthropic-style `str_replace`/text-editor edit tool by default in many configs (same family as SWE-agent's `edit_anthropic`). | Runs local models via LiteLLM/any OpenAI-compatible endpoint; no evidence found in this pass of local-model-specific prompt templates beyond generic LiteLLM routing. | Explicit **Stuck Detector**: 5 named patterns (repeat action→observation ≥4x, repeat action→error ≥3x, monologue ≥3 consecutive agent messages, alternating ping-pong ≥6 cycles, repeated context-window errors), semantic (not exact-string) comparison, halts run when triggered. | None found specific to small/local models in this pass. |
| **Continue** | "System message tools": tool schemas rendered as XML in the system prompt; model emits XML in response text; Continue parses it. Explicit rationale: works on any instruction-following model, not just native-tool-call models. | Not diff-centric in the same way as Aider; edit tool is one of the system-message tools. | Explicit local-model recommendations (e.g. Llama 3.1 8B via Ollama/LM Studio for offline chat) but tool-format guidance is generic ("universal compatibility"), not per-model-tuned like Aider's edit-format table. | Not found in this pass (no dedicated stall-detector doc located). | Recommends specific ~8B local models for chat role; no tool-calling-specific success-rate number found. |
| **Cline** | Historically prompt/XML-only (for universal compatibility, same rationale as Continue); as of the vendor's own 2026 announcement, migrated to **native tool calling split per model family** — opposite direction, stated reason: "models now return tool calls in their native JSON format, which they were specifically trained to." | Diff-apply based file edits; exact mechanism not deep-dived in this pass. | Explicit local-model bug history: issue #10843 — a local Ollama Qwen2.5-Coder model emitted native JSON tool calls while Cline's (then-)XML-only parser didn't recognize them, causing an infinite "no tool used" loop until the model/parser mismatch was fixed. | Feature-request-stage, not solved: issue #5645 ("Auto-retry on empty model response") is an **open ask**, not a shipped mechanism, as of the sources checked — i.e. a mature, widely-used harness still had a known gap here. | None found; evidence in this pass is bug-report-level (failure modes), not success-rate benchmarks. |
| **OpenAI Agents SDK** *(reference architecture, not a coding agent)* | Native OpenAI function-calling; `tool_choice` can be forced (`"required"` / a named tool). | N/A (general-purpose agent framework). | N/A. | `reset_tool_choice` (default `True`): forced tool_choice is reset to `"auto"` after one tool call fires, specifically to prevent the *inverse* stall failure — forcing tool use forever prevents the model from ever emitting a final answer. | N/A. |

## Cross-cutting patterns (see `research/CODING_AGENT_PRACTICES.md` for full evidence)

1. **No system in this matrix treats "native function-calling support" as
   sufficient by itself.** Every system either (a) avoids native tool-calling
   entirely (mini-SWE-agent), (b) prompt/XML-wraps it for universal
   compatibility (Continue, historical Cline), or (c) picks the edit-format
   text contract per verified model capability (Aider). The Berkeley
   Function-Calling Leaderboard maintainers independently confirm native
   FC-mode can score *lower* than prompted mode on the same model, because
   native FC support is itself uneven per model/provider.
2. **Two systems moved in opposite protocol directions (Continue toward
   universal XML, Cline away from it toward native-per-model) and both cited
   reliability as the reason.** The resolving variable in both cases is
   "does the protocol match what this specific model was trained to emit,"
   not an intrinsic property of JSON vs. XML — this is the core argument for
   ShelraCode's existing capability-probe-first posture over hardcoding one
   protocol.
3. **Stall/loop defense is a distinct subsystem in every mature harness
   that has one (OpenHands, mini-SWE-agent, OpenAI Agents SDK), and its
   absence is a live, user-reported gap where it's missing (Cline
   #5645).** The specific patterns worth defending against, consolidated:
   repeat action+observation, repeat action+error, no-tool-call monologue,
   alternating ping-pong, forced-tool-choice-never-released. ShelraCode
   (`docs/agent-kernel/ROOT-CAUSES.md`, "Prose-only early stop follow-up")
   already covers the monologue case; the matrix suggests checking whether
   the other four are covered by the same or a different limit.
4. **Local-model support quality varies enormously by whether it was a
   first-class design goal (mini-SWE-agent) or bolted onto a cloud-API-first
   harness (SWE-agent's #1302, Cline's #10843, Aider's thin
   accommodation).** The signature failure of "bolted on" is a
   local-model-only bug that never appears in cloud-model testing because
   the assumption that broke was cloud-API-specific (a populated prompt
   template, a recognized tool-call envelope shape, a known-pricing model
   name).

## Sources

Full citations with access dates and confidence levels are in
`docs/audit/research/SOURCES.md` and the per-mechanism `source:` /
`accessed:` / `confidence:` fields in
`docs/audit/research/CODING_AGENT_PRACTICES.md`.
