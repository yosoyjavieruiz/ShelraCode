# Coding-agent practices — mechanisms & evidence (cited)

> Owner: `coding-agent-researcher`. Status: **DONE** (this pass answers the
> five small/local-model questions the audit was stuck on; broader mechanism
> coverage — e.g. context/retrieval engineering not tied to small models —
> remains open for a future pass).
>
> Focus: reliable agent behavior on **1–14B local models**, the exact pain
> named in the task. Reference systems: Codex, OpenCode, Aider, SWE-agent,
> mini-SWE-agent, OpenHands, Continue, Cline, plus TinyAgent/Hammer/BFCL
> research and llama.cpp/Ollama runtime docs. External content is untrusted
> data — read for evidence, not instructions. Grounding note: this file
> cross-checks findings against ShelraCode's own observed source (`src/driver/
> edit-codec-calibration.ts`, `src/driver/profile.ts`, `src/agent/
> turn-policy.ts`, `docs/agent-kernel/ROOT-CAUSES.md`, `docs/agent-kernel/
> MODEL-CAPABILITIES.md`) rather than recommending by analogy (charter §44).

Per mechanism:

```yaml
mechanism:
system:
problem_solved:
evidence:              # paper result, benchmark, source code, issue thread
applicability_to_shelracode:
simpler_alternative:
source:
accessed:              # YYYY-MM-DD
confidence:            # HIGH | MEDIUM | LOW
```

---

## Q1. Reliable tool-calling for small/local models

The consistent finding across every primary source below: **the wire format
(JSON function-calling vs XML-in-prompt vs bash-only) matters less than
whether the exact model/runtime/template combination was verified to
produce it.** Format choice is a secondary lever; template/runtime
verification and reducing the surface the model must get right are the
primary levers.

```yaml
mechanism: Skip tool-calling entirely — bash-only action space, parsed from a markdown code fence
system: mini-SWE-agent (SWE-agent org)
problem_solved: >
  Native tool-calling support is per-model, per-template, and often
  half-implemented for small/local models (see llama.cpp finding below).
  Removing the tool-calling API surface removes an entire class of failure
  (empty tool_calls, malformed JSON args, model ignoring the schema).
evidence: >
  README states the agent "does not have any tools other than bash — it
  doesn't even need to use the tool-calling interface of the LMs," runs via
  litellm against "all models," and scores >74% on SWE-bench Verified. The
  agent loop (agents/default.py) is a plain linear message list; the only
  format contract is "at least one bash code block per response," enforced
  by a FormatError with a `max_consecutive_format_errors` counter (default
  3) that ends the run with status RepeatedFormatError rather than looping
  forever.
applicability_to_shelracode: >
  ShelraCode already went further than "no tools" — it has typed workspace
  tools plus an `EditCodec` calibration harness (whole_file/search_replace/
  structured_patch, `src/driver/edit-codec-calibration.ts`,
  `src/driver/profile.ts`). The lesson to take is not "remove tools" but
  "the fallback path for a model that can't reliably emit structured tool
  calls should be the *simplest possible* single-action-per-turn text
  contract (e.g. one shell command or one whole-file write), not a partial
  JSON/XML envelope repair." MODEL-CAPABILITIES.md already shows LocalCode
  recovering `<response>`/fenced XML/JSON envelopes from Qwen2.5-Coder
  7B/1.5B on LM Studio — that repair path is the right instinct; mini-SWE-agent
  is evidence it can be pushed all the way to "no schema at all" for the
  weakest local models and still work.
simpler_alternative: >
  For models below the empirical tool-calling threshold, drop to a
  single-command-per-turn plaintext contract (already partially present via
  the envelope recovery) rather than adding more parsers for more envelope
  shapes.
source: https://github.com/SWE-agent/mini-swe-agent/blob/main/README.md ; https://github.com/SWE-agent/mini-swe-agent/blob/main/src/minisweagent/agents/default.py ; https://github.com/SWE-agent/mini-swe-agent/blob/main/src/minisweagent/config/mini.yaml
accessed: "2026-08-30"
confidence: HIGH
```

```yaml
mechanism: Grammar-constrained decoding (GBNF) forces syntactically valid tool-call JSON at the sampling level
system: llama.cpp (server, --grammar / JSON-schema-to-GBNF)
problem_solved: >
  Small/undertrained models emit near-valid-but-broken JSON (trailing
  commas, unescaped quotes, wrong key names) even when they "understand"
  the task. Grammar constraint makes the *syntax* failure mode structurally
  impossible by restricting the next-token distribution to only
  grammar-legal continuations.
evidence: >
  Official grammars/README.md: GBNF is llama.cpp's format for constraining
  output ("force the model to generate valid JSON... the JSON schema is
  only used to constrain the model output and is not injected into the
  prompt"), used by tools/server for structured output. The official
  docs/function-calling.md documents a separate mechanism for tool-calling
  specifically: llama-server with --jinja parses tool defs through the
  model's own chat template and extracts tool_calls from the response; for
  models without a template llama.cpp knows, it falls back to a "Generic"
  handler that is explicitly documented as "may consume more tokens and be
  less efficient than a model's native format." The function-calling doc
  does NOT describe the Generic fallback as grammar-constrained — grammar
  constraint and the tool-call template parser are two distinct, separately
  invoked mechanisms in llama.cpp today.
applicability_to_shelracode: >
  Important correction to a common assumption: enabling `--jinja` tool
  calling on llama.cpp does not automatically mean the output is
  grammar-guaranteed-valid. If ShelraCode drives llama.cpp directly (vs.
  LM Studio/Ollama as adapters, per `docs/local-models/RESEARCH.md`), the
  two knobs (chat-template tool parsing vs. grammar-constrained sampling)
  need to be verified and possibly combined per model, not assumed
  bundled. This matches the audit's existing finding
  (`docs/agent-kernel/RESEARCH.md`) that "a model name or endpoint health
  check is not a capability proof."
simpler_alternative: >
  For the smallest local models, apply a GBNF/JSON-schema grammar to the
  *whole-file or search/replace envelope* (not just abstract "tool
  calling") so a malformed edit payload becomes as syntactically
  impossible as a malformed tool call currently is targeted to be.
source: https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md ; https://github.com/ggml-org/llama.cpp/blob/master/docs/function-calling.md
accessed: "2026-08-30"
confidence: HIGH
```

```yaml
mechanism: Prompted/XML "system message tools" instead of native function-calling API
system: Continue.dev; Cline (historically, pre-native-migration)
problem_solved: >
  Native function-calling is a per-provider, per-model API surface; many
  local runtimes/models only partially implement it. A tool protocol
  described in the system prompt and parsed from plain-text output works
  on *any* model that can follow instructions, including ones with zero
  native tool-calling support.
evidence: >
  Continue's docs describe "system message tools": tools are converted to
  XML and included in the system message, the model emits XML in its
  response text, and Continue parses/executes it — stated rationale is
  "universal compatibility... any model capable of following instructions
  can use tools, not just those with native tool support" and "consistent
  behavior across OpenAI, Anthropic, local models, and others." Cline's own
  official account states they migrated *away* from a single universal
  prompted format toward native tool calling split per model family,
  reasoning that native JSON is what many models "were specifically"
  trained to emit — the opposite direction, for the opposite reason (match
  the model's own trained format rather than impose one universal format).
  Cline issue #10843 is a concrete failure instance of the mismatch: a
  local Ollama Qwen2.5-Coder model emitted raw JSON tool calls while
  Cline's parser only recognized its XML format, so the call was never
  registered and the model was told "no tool used," producing an infinite
  loop.
applicability_to_shelracode: >
  These two systems moved in opposite directions and both cite reliability
  as the reason — because the real variable is "does this specific model's
  training match the protocol I'm asking for," not "which protocol is
  intrinsically better." This directly supports ShelraCode's existing
  empirical-probe-first posture (`docs/agent-kernel/MODEL-CAPABILITIES.md`)
  over hardcoding one tool protocol for all local models. The Cline #10843
  failure mode (parser only understands one envelope shape, forced format
  mismatch → infinite "no tool used" loop) is the same shape of bug
  ShelraCode's own envelope-recovery code already defends against for
  LM Studio/Qwen — evidence the defense is worth keeping and extending
  rather than assuming native tool_calls alone are sufficient.
simpler_alternative: >
  Do not add a fourth/fifth envelope parser reactively per bug report;
  invest once in a small, tested "known local tool-call envelope shapes"
  registry keyed by model capability probe result, matching what the
  capability probe already measures.
source: https://docs.continue.dev/ide-extensions/agent/model-setup ; https://x.com/cline/status/1984334385626411397 ; https://github.com/cline/cline/issues/10843
accessed: "2026-08-30"
confidence: MEDIUM
```

```yaml
mechanism: Native function-calling API mode can score *lower* than prompted text mode on the same model
system: Berkeley Function-Calling Leaderboard (Gorilla)
problem_solved: n/a — this is a negative/counter-intuitive finding, not a fix.
evidence: >
  BFCL maintainer discussion #606: "Different models have very limited
  capability when it comes to function-calling. For example, some models
  might not even support multiple or parallel function calling." Prompted
  mode lets the model fall back on general instruction-following for
  features (parallel calls, multi-turn chains) the model's native FC
  implementation doesn't support, which is why prompted scores can exceed
  native-FC-mode scores for the same underlying model.
applicability_to_shelracode: >
  Do not assume "the model advertises OpenAI-compatible tool_calls
  support" implies that mode is the *best* mode for that model on
  multi-step coding tasks. This is exactly the kind of claim the audit
  charter requires probing empirically rather than trusting a capability
  flag — reinforces the existing `capability-probe.ts` approach, and
  argues for probing both native-tool-call and prompted-envelope modes per
  local model rather than only the one the runtime advertises as default.
simpler_alternative: n/a
source: https://github.com/ShishirPatil/gorilla/discussions/606 ; https://gorilla.cs.berkeley.edu/leaderboard.html
accessed: "2026-08-30"
confidence: MEDIUM
```

```yaml
mechanism: Fine-tune a small model specifically on the tool-call/format distribution + shrink the tool surface via retrieval, instead of relying on prompting a generic small model
system: TinyAgent (UC Berkeley/ICSI, EMNLP 2024); Hammer (function masking, on-device FC)
problem_solved: >
  Generic small models (not fine-tuned for function calling) are
  unreliable at tool-call syntax and at picking the right tool among many
  in-context tool definitions, because in-context tool selection and exact
  schema adherence are themselves capabilities that scale with training,
  not just parameter count.
evidence: >
  TinyAgent (arXiv 2409.00608): fine-tuned 1.1B and 7B models, trained on a
  curated function-calling dataset with an LLMCompiler-style planner, plus
  a *tool-retrieval* step that reduces the number of tool schemas shown
  in-context. Reported success rates: 80.06% (1.1B) and 84.95% (7B) vs.
  79.08% for GPT-4-Turbo on the same fixed toolset — i.e. a 1.1B model
  fine-tuned + retrieval-augmented beat GPT-4-Turbo prompted generically.
  Hammer (arXiv 2410.04587) separately shows 1.5B-7B "on-device" models
  trained with function-masking (explicit training signal to reject
  irrelevant functions, reducing over-fitting to naming conventions)
  achieve state-of-the-art robustness across FC benchmarks vs. larger
  generalist models. BFCL leaderboard corroborates: a 3B model fine-tuned
  specifically for function calling (xLAM-2-3b-fc-r, 65.74% overall)
  outperforms a same-class instruction-tuned 4B general model (Qwen3-4B,
  62.04%) on tool-calling accuracy specifically.
applicability_to_shelracode: >
  This is the strongest lever ShelraCode does not currently pull: it is a
  *model selection/curation* signal, not a harness-format signal. If
  ShelraCode's local-model catalog can prefer/flag models fine-tuned for
  function-calling (or code-agent trajectories, see Devstral below) over
  same-size generalist chat models, that alone changes reliability more
  than any prompt/parser change. Directly relevant to
  `docs/agent-kernel/MODEL-CAPABILITIES.md`'s recommendation logic and the
  hardware-fit catalog work (`docs/local-models/RESEARCH.md`).
  Tool-retrieval (only show the 2-4 tool schemas relevant to the current
  turn, not all tools) is also a cheap, harness-only change independent of
  model choice — reduces prompt length and in-context selection burden,
  which matters more for small models with weaker long-context attention.
simpler_alternative: >
  Before fine-tuning anything: (1) shrink the number of tool schemas shown
  per turn to what's relevant for the current turn mode (ShelraCode's
  `turn-policy.ts` already gates tool *lists* by mode — verify it is also
  minimizing schema *token count*, not just the count of tools); (2) when
  recommending a local model in the catalog, prefer models whose card
  states function-calling fine-tuning over same-size generalist models.
source: https://arxiv.org/abs/2409.00608 ; https://arxiv.org/abs/2410.04587 ; https://gorilla.cs.berkeley.edu/leaderboard.html
accessed: "2026-08-30"
confidence: HIGH
```

```yaml
mechanism: Runtime default context window silently truncates the prompt (including tool schemas), producing malformed/empty tool calls that look like a model-capability failure but are a configuration failure
system: Ollama
problem_solved: n/a — this is a root-cause/diagnostic finding.
evidence: >
  Ollama's official FAQ (docs.ollama.com/faq, checked 2026-08-30) states
  the default context window is 4096 tokens, overridable via
  `OLLAMA_CONTEXT_LENGTH`, `/set parameter num_ctx`, or the API `num_ctx`
  field. Multiple independent reports (Hacker News discussion of the
  Modelfile spec, community guides) describe this default as silent —
  no error, no truncation warning — meaning a tool schema + repo context +
  history that exceeds 4096 tokens is silently cut, which can present
  identically to "the model can't call tools" or "the model returned
  malformed JSON." NOTE: multiple Ollama surfaces (FAQ vs. Modelfile
  reference vs. context-length page) have historically stated different
  default values (4096 vs 2048 vs VRAM-dependent) — this is exactly the
  kind of volatile runtime fact the audit charter requires re-verifying
  per version, not trusting from memory.
applicability_to_shelracode: >
  This is a distinct failure class from "model is too weak for tool
  calling" and from "envelope shape mismatch" (the two failure classes
  already documented in MODEL-CAPABILITIES.md/ROOT-CAUSES.md). If
  ShelraCode's Ollama adapter does not explicitly set `num_ctx` based on
  the assembled prompt size (system prompt + tool schemas + repo context +
  history), some fraction of observed "malformed/empty tool call"
  failures in the capability probes could be silent truncation rather than
  model capability — this should be checked empirically (log the assembled
  prompt token count vs. the runtime's active `num_ctx`) before being
  attributed to model capability class.
simpler_alternative: >
  Set `num_ctx` explicitly per request from the actual assembled prompt
  size (with headroom), and treat "prompt token count > configured
  context" as a structural pre-flight error distinct from a model
  capability failure.
source: https://docs.ollama.com/faq ; https://news.ycombinator.com/item?id=43274296
accessed: "2026-08-30"
confidence: MEDIUM
```

---

## Q2. Edit formats — what Aider's benchmark data actually says

```yaml
mechanism: Match edit-format precision to model capability; default unknown/weak models to "whole file" rewrite instead of diff-style formats
system: Aider
problem_solved: >
  Diff-style formats (search/replace blocks, unified diff) require the
  model to reproduce existing file text *exactly* (including whitespace)
  as an anchor before or after the change. Weak/small models are unreliable
  at exact reproduction even when they understand the required change,
  which manifests as an unrelated failure mode (exact-match errors) that
  masks otherwise-correct reasoning.
evidence: >
  Official docs (aider.chat/docs/more/edit-formats.html, checked
  2026-08-30): "for lesser known models aider will default to using the
  'whole' editing format since it is the easiest format for an LLM to
  use," while diff-based formats are reserved for models Aider has
  verified handle them ("configured to use the best edit format for the
  popular OpenAI and Anthropic models"). The public edit-format leaderboard
  (aider.chat/docs/leaderboards/edit.html) tracks a *separate* "percent
  using correct edit format" column from "percent completed correctly" —
  and on that leaderboard, format-compliance is close to saturated even at
  very small scale when "whole" is used: Qwen2.5-Coder-0.5B scores 100%
  format compliance (only 14.3% task-correct — the bottleneck is reasoning,
  not format), whereas Granite3-dense:8B is a counter-example at only
  78.9% format compliance despite being 16x larger — i.e. format
  compliance is not purely a function of parameter count, it is a function
  of format *choice* matched to that specific model's training.
applicability_to_shelracode: >
  ShelraCode's `EditCodec` calibration (`src/driver/
  edit-codec-calibration.ts`) already measures `parseValidityRate`,
  `schemaValidityRate`, `applySuccessRate`, `semanticSuccessRate` per codec
  (`whole_file` / `search_replace` / `structured_patch`,
  `src/driver/profile.ts`) — this is directly aligned with what Aider's
  data says to do (measure, don't assume one format for all models). The
  refinement the evidence suggests: confirm the calibration's default/
  fallback codec for *unclassified* or newly-seen models is `whole_file`
  (Aider's empirically-chosen safe default), not `search_replace` or
  `structured_patch`, until a probe proves otherwise — and confirm the
  scoring formula weights `parseValidityRate`/`applySuccessRate` heavily
  enough that a format-compliant-but-token-expensive whole_file codec can
  still win over a token-cheap but exact-match-fragile diff codec for a
  small model.
simpler_alternative: >
  If the calibration harness does not already special-case "no calibration
  data yet for this exact model" to `whole_file`, that one-line default is
  cheaper than running (or waiting on) a full calibration pass per new
  model.
source: https://aider.chat/docs/more/edit-formats.html ; https://aider.chat/docs/leaderboards/edit.html
accessed: "2026-08-30"
confidence: HIGH
```

```yaml
mechanism: Unified-diff format reduces "lazy" partial rewrites (elided code with placeholder comments) on capable models, but is not universally better
system: Aider
problem_solved: >
  Some models (GPT-4 Turbo circa 2023-2024) would rewrite files but elide
  unchanged sections with comments like "// rest of code unchanged,"
  destroying the file when Aider applied the "whole file" output verbatim.
evidence: >
  Official docs (aider.chat/docs/unified-diffs.html, checked 2026-08-30):
  on `gpt-4-1106-preview`, SEARCH/REPLACE format scored 20% correct with
  lazy-comment failures in 12/89 tasks; switching to unified diff raised
  the score to 61% with lazy failures down to 4/89 — a 3x reduction in
  laziness. On `gpt-4-0613`: 26% (S/R) vs 59% (udiff). Stated mechanism:
  "With unified diffs, GPT acts more like it's writing textual data
  intended to be read by a program, not talking to a person" — i.e. the
  format's rigidity (designed for `patch`, not prose) shifts the model's
  completion distribution toward mechanical correctness. Aider also notes
  disabling *flexible/fuzzy* patch application (accepting slightly
  malformed diffs) increased edit errors by 900% on their benchmark — the
  format alone was not sufficient; a forgiving *applier* was required too.
applicability_to_shelracode: >
  This finding is model/era-specific (GPT-4 Turbo's laziness bug) and is
  the weakest-evidence item in this file for small local models
  specifically — Aider's own current per-model defaults (above) show
  unified/structured diff is reserved for *strong* models, and small local
  models default away from it. The transferable lesson is the *applier*
  point: a flexible/fuzzy patch applier reduced errors 9x more than the
  format choice alone did. This validates having an "apply with tolerance
  before failing hard" step in `edit-codec-calibration.ts`'s apply logic,
  whichever codec is selected, rather than requiring byte-exact matches at
  every codec level.
simpler_alternative: n/a — this is itself already the simpler-alternative
  lesson (fuzzy apply > format switching) for local models.
source: https://aider.chat/docs/unified-diffs.html
accessed: "2026-08-30"
confidence: HIGH
```

```yaml
mechanism: Recovery from a failed exact-match edit — feed the precise mismatch back as the next turn's tool-result/error, not a generic "edit failed"
system: Aider; Anthropic's official `str_replace`-based text-editor tool (used directly or copied by OpenHands, SWE-agent's `edit_anthropic` tool, and others)
problem_solved: >
  A bare "edit failed" error gives the model nothing to correct against and
  frequently causes a repeat of the identical failing call. Small models
  especially need the retry prompt to contain the actual reason (which
  SEARCH text didn't match, or that the match was ambiguous) rather than a
  generic failure.
evidence: >
  Aider GH issue #3651 and community documentation: on a
  SearchReplaceNoExactMatch, Aider's error path raises with a message that
  becomes the next prompt — it names the failed SEARCH block and asks for
  a resend; some Aider issue threads (#3713, Gemini 2.5 Pro) show this
  succeeding within a few retries in practice. Failure mode when this goes
  wrong: issue #770, "edit does not conform to the edit format," reports
  Aider getting stuck in a loop with *no* retry cap — i.e. the recovery
  mechanism (resend with error) is necessary but not sufficient; it also
  needs a bounded retry count (mini-SWE-agent's `max_consecutive_format_errors`,
  above, is the fix for exactly this gap). Anthropic's official
  `str_replace_based_edit_tool` contract (docs.anthropic.com,
  agents-and-tools/tool-use/text-editor-tool) requires the *caller* to
  guarantee a unique match and surface a structured error otherwise — "if
  file is bigger, the string-matching may not be unique and it becomes
  responsibility of the model to find a unique combination"; production
  bug reports (anthropics/claude-code#51986, #1657) show that even
  official implementations of this tool have shipped bugs around
  `replace_all` silently only applying to some matches — i.e. even a
  well-specified contract needs its *own* apply-time verification
  (re-check the target string is actually gone / count changed) rather
  than trusting "no exception" as success.
applicability_to_shelracode: >
  ShelraCode's `EditCodecApplyResult` already distinguishes
  `errorClass: "AMBIGUOUS_EDIT" | "NOT_FOUND" | "STALE_EDIT" | "NO_PROGRESS"
  | "ATTEMPTED_FAILURE"` (`edit-codec-calibration.ts`), which is already
  finer-grained than a generic "edit failed" — that is the right shape per
  this evidence. Two things to verify empirically rather than assume: (1)
  does the *retry prompt* actually surface the specific `errorClass` and
  the near-miss text to the model (Aider's design), or a generic message;
  (2) is there a hard retry/consecutive-failure cap on the same edit
  (mini-SWE-agent's pattern) independent of the overall turn/step budget,
  matching what closed the "prose-only early stop" gap in
  `ROOT-CAUSES.md` — that fix used a "non-progress limit"; confirm the
  same limit (or an analogous one) also bounds repeated *edit* failures,
  not just repeated *no-tool-call* turns.
simpler_alternative: >
  If not already wired, the cheapest fix is ensuring the existing
  `errorClass` + near-miss context reaches the model's next-turn prompt
  verbatim (Aider's mechanism), bounded by the existing non-progress
  limit — no new subsystem required.
source: https://github.com/Aider-AI/aider/issues/3651 ; https://github.com/paul-gauthier/aider/issues/770 ; https://github.com/Aider-AI/aider/issues/3713 ; https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/text-editor-tool ; https://github.com/anthropics/claude-code/issues/51986
accessed: "2026-08-30"
confidence: MEDIUM
```

---

## Q3. Multi-step loops that don't stall

```yaml
mechanism: Explicit, semantically-compared "stuck" pattern detector (repeat action+observation, repeat action+error, monologue, alternation, context-window errors) with numeric thresholds, that halts the run rather than looping forever
system: OpenHands
problem_solved: >
  A model producing no forward progress (identical action, identical
  error, or pure narration with no tool call) will otherwise consume the
  entire step/cost budget doing nothing, and — without a distinct signal —
  looks identical in logs to a slow-but-working task.
evidence: >
  Official docs (docs.openhands.dev/sdk/guides/agent-stuck-detector,
  checked 2026-08-30) enumerate five concrete patterns with thresholds:
  same action->same observation 4+ times; same action->error 3+ times;
  3+ consecutive agent messages with no user input ("monologue"); 6+
  cycles of two alternating action/observation pairs ("ping-pong"); and
  repeated context-window errors. Detection compares *semantic* content
  (tool name + content, not exact string) so near-identical-but-not-exact
  repeats are still caught. When triggered, the run halts rather than
  continuing to burn budget. NOTE: the docs do not publish a benchmark
  showing these specific thresholds were tuned against data (no ablation
  found) — treat the exact numbers (3/4/6) as a reasonable existing
  practice, not as independently-validated optimal thresholds.
applicability_to_shelracode: >
  `docs/agent-kernel/ROOT-CAUSES.md` ("Prose-only early stop follow-up")
  documents ShelraCode already closing the *monologue* case specifically
  (prose with no tool call → one bounded reflective retry → blocked if
  still unresponsive, gated by a "non-progress limit"). The gap this
  evidence suggests checking: does the same non-progress limit also cover
  the other four OpenHands patterns — identical action+observation repeat,
  identical action+error repeat, and alternating ping-pong — or only the
  no-tool-call case? SWE-agent's local-model failure
  (issue #1302, below) is a live example of the "repeat action->error"
  pattern going unbounded in a different harness, which is exactly the
  pattern class OpenHands' detector targets.
simpler_alternative: >
  Reuse the single non-progress counter ShelraCode already has for the
  no-tool-call case and add the other pattern classes as additional
  triggers into the *same* counter/limit, rather than building five
  separate detectors.
source: https://docs.openhands.dev/sdk/guides/agent-stuck-detector ; https://github.com/OpenHands/OpenHands/issues/10350
accessed: "2026-08-30"
confidence: MEDIUM
```

```yaml
mechanism: Bounded consecutive-format-error counter distinct from the step/cost budget, with a dedicated exit status
system: mini-SWE-agent
problem_solved: >
  A model that cannot produce the expected output shape at all (zero or
  malformed action blocks) should fail fast and distinctly from "ran out
  of budget while making progress" — conflating the two makes triage of
  "is this a model-capability problem or a task-difficulty problem"
  impossible from the exit status alone.
evidence: >
  `agents/default.py`: a `FormatError` on parse failure increments
  `n_consecutive_format_errors`; at `max_consecutive_format_errors`
  (default 3) the run ends with an explicit `exit`/`RepeatedFormatError`
  status, separate from the `step_limit`, `cost_limit`, and
  `wall_time_limit_seconds` exits. A successful step resets the counter to
  0 (transient format slips don't accumulate toward the same failure as
  systematic ones).
applicability_to_shelracode: >
  This is directly the same shape as ShelraCode's existing capability
  classification (`workspace_reader` vs. higher classes in
  MODEL-CAPABILITIES.md) — the exit *status* itself is diagnostic
  evidence, not just a stop signal. Verify the turn/step loop
  (`src/agent/turn-policy.ts` and whatever owns the outer loop) emits a
  status that distinguishes "systematic format failure" from "hit step/cost
  budget while progressing" from "blocked on missing verification
  criteria" (the last of which `ROOT-CAUSES.md`'s "Partial-success false
  completion" entry shows is already a distinct, correctly-handled case) —
  three different exit reasons currently, worth confirming a fourth
  (systematic format failure) is not being collapsed into one of them.
simpler_alternative: >
  A single incrementing counter + threshold + reset-on-success, as above —
  no ML or heuristic scoring needed.
source: https://github.com/SWE-agent/mini-swe-agent/blob/main/src/minisweagent/agents/default.py
accessed: "2026-08-30"
confidence: HIGH
```

```yaml
mechanism: Reset a forced tool_choice back to "auto" after one tool call, rather than leaving tool_choice="required"/a named tool set for every subsequent turn
system: OpenAI Agents SDK (openai-agents-python)
problem_solved: >
  If an orchestrator forces tool use every turn (to avoid the "model
  returns prose and does nothing" failure — the same problem ShelraCode's
  `command` mode's `toolChoice: "required"` targets, per
  `docs/agent-kernel/TURN-POLICY.md`), and never relaxes it, the model is
  mechanically prevented from ever producing a final answer: it will be
  asked to call a tool on every turn including after the task is actually
  done, which is a *different* infinite loop than the "model stalls with
  no tool call" problem forcing was meant to fix.
evidence: >
  Official docs (openai.github.io/openai-agents-python/running_agents/ and
  /ref/agent/, checked 2026-08-30): `reset_tool_choice` (default `True`)
  "resets tool_choice to the default value after a tool has been called...
  ensures the agent doesn't enter an infinite loop of tool usage," with
  the documented failure mode being exactly "tool_choice remains set after
  execution, the LLM is again forced to call the same tool in the next
  turn, creating an infinite loop."
applicability_to_shelracode: >
  ShelraCode's turn policy already avoids the naive version of this bug by
  scoping `toolChoice: "required"` to `command` mode only, and using
  `"auto"` for `coding` (per `docs/agent-kernel/TURN-POLICY.md`'s table) —
  so `coding` mode is not directly exposed to this failure today. Worth
  confirming as a targeted check rather than assumed: if `command` mode's
  `required` tool choice can span more than one turn (e.g. multi-step
  command flows), whether it is reset to `auto` once the required tool has
  fired once, per this evidence, or whether it stays pinned to `required`
  for the whole mode — the latter would reproduce this exact failure class
  in that one mode.
simpler_alternative: n/a — the mechanism described is already the minimal
  fix.
source: https://openai.github.io/openai-agents-python/running_agents/ ; https://openai.github.io/openai-agents-python/ref/agent/
accessed: "2026-08-30"
confidence: MEDIUM
```

```yaml
mechanism: A model's output not matching the expected single-action shape (e.g. multi-line Python instead of one bash command) with no system/instance template describing the contract leads to an unbounded format-mismatch loop ending in an empty submission
system: SWE-agent (regression/failure case, not a fix)
problem_solved: n/a — negative evidence: what happens without the fix.
evidence: >
  GitHub issue #1302 (SWE-agent + Ollama CodeLlama 13B, `thought_action`
  parser): with `system_template`/`instance_template` unset ("using empty
  string"), the local model was not told the required single-command
  format and reverted to emitting multi-line Python in a fenced block.
  SWE-agent extracted it and ran it as bash, which threw a syntax error;
  the agent looped (re-prompt → same mistake → repeat) and the run
  eventually exited with an empty patch. The issue author's proposed fixes
  are exactly the mechanisms already covered above: reject/re-prompt on a
  detected wrong-shape block (bounded, per mini-SWE-agent's counter) and
  ship a complete reference prompt template for local models specifically
  (not just for OpenAI/Anthropic models).
applicability_to_shelracode: >
  This is direct evidence that local-model-specific prompt/template
  completeness is not automatically inherited from a harness's default
  cloud-model prompt — a harness can have working format-error recovery
  *in general* and still fail catastrophically on a local model if that
  model's system/instance template was never populated with the format
  contract. Concretely check: does ShelraCode's prompt assembly guarantee
  the format contract (what a valid single action/edit looks like) is
  always present for local models, or could a code path (e.g. a
  fallback/default) ship an empty or generic template the way SWE-agent's
  did here.
simpler_alternative: n/a
source: https://github.com/SWE-agent/SWE-agent/issues/1302
accessed: "2026-08-30"
confidence: MEDIUM
```

---

## Q4. How Aider, Cline, OpenHands, SWE-agent, mini-SWE-agent, Continue structure the loop for local/open models — and the simplest design that works

```yaml
mechanism: Linear, unedited message history + single action type (bash) + minimal harness code (~100 lines) as the reliability strategy itself
system: mini-SWE-agent
problem_solved: >
  Every layer of harness complexity (stateful shell sessions, multiple tool
  types, history editing/compaction, custom parsers per tool) is a
  potential mismatch point against a small/local model's training
  distribution and a debugging surface when something goes wrong. Minimal
  harnesses have fewer places to fail and are easier to reason about when
  they do.
evidence: >
  Official README/docs (SWE-agent/mini-swe-agent, checked 2026-08-30): "As
  LMs have become more capable, a lot of the emphasis on tools and special
  interfaces for agents is not needed at all to build a useful agent." Each
  action executes via `subprocess.run` independently (no persistent shell
  state to get out of sync); message history is append-only, no
  editing/branching; the harness reports >74% on SWE-bench Verified with
  this design, run through litellm against "all models" including local
  ones. This is the *only* system in this review whose central claim is
  architectural simplicity itself as the reliability mechanism, backed by
  a competitive benchmark number, rather than simplicity as a byproduct of
  something else.
applicability_to_shelracode: >
  ShelraCode is intentionally not this minimal (it has typed tools, an
  edit-codec calibration harness, capability probing, turn-mode policy —
  more structure than mini-SWE-agent by design, for privacy/routing
  reasons mini-SWE-agent doesn't need to solve). The transferable lesson
  is narrower: for the *specific* sub-case of "model capability class is
  low / probe failed," ShelraCode's fallback path should look more like
  mini-SWE-agent (one action type, no persistent state assumptions, linear
  history) rather than the full-featured path with reduced guardrails —
  i.e. simplify the *floor*, not the whole system. This is consistent with
  MODEL-CAPABILITIES.md already gating a `workspace_reader` capability
  class below full coding — the evidence here supports making that low
  class's action space even narrower (e.g. bash-only or single-edit-only)
  rather than the same tool surface with lower expectations.
simpler_alternative: n/a — this mechanism is itself the "simpler
  alternative" answer to Q4.
source: https://github.com/SWE-agent/mini-swe-agent/blob/main/README.md ; https://github.com/SWE-agent/mini-swe-agent/blob/main/src/minisweagent/agents/default.py
accessed: "2026-08-30"
confidence: HIGH
```

```yaml
mechanism: Cost-budget (not step-count-budget) as the primary loop limiter
system: SWE-agent v2 (per official docs)
problem_solved: >
  A fixed step count is not comparable across models: a small/local model
  may need many more (cheap, fast, small) turns to reach the same
  progress a frontier model reaches in few turns, so a shared step limit
  either starves small models or lets expensive models run too long.
evidence: >
  Official reference docs (swe-agent.com/latest/reference/agent_config/,
  checked 2026-08-30): SWE-agent "explicitly chose cost-budget over
  step-budget because step counts vary 5x across model families," with a
  documented default `per_instance_cost_limit` of $3. mini-SWE-agent
  (same org) keeps *all three* limiters (`step_limit`, `cost_limit`,
  `wall_time_limit_seconds`) rather than picking one.
applicability_to_shelracode: >
  For local inference, "cost" is not meaningful the same way (no token
  billing) — the evidence's actual lesson is the *reasoning* (don't use a
  cross-model-comparable metric that in fact isn't comparable), which for
  ShelraCode's local-first case maps to wall-clock time and/or step count
  scaled by an empirically-observed steps-to-completion distribution per
  capability class, not a flat step limit shared by a `workspace_reader`
  1.5B model and a stronger local model. Worth checking whether
  ShelraCode's non-progress/step limits are currently flat across
  capability classes or already scaled.
simpler_alternative: >
  Keep a flat wall-clock ceiling as the hard backstop (simplest, always
  correct regardless of model), and treat step-count limits as
  model-class-relative rather than a single constant, per the evidence.
source: https://swe-agent.com/latest/reference/agent_config/ ; https://github.com/SWE-agent/mini-swe-agent/blob/main/src/minisweagent/agents/default.py
accessed: "2026-08-30"
confidence: MEDIUM
```

```yaml
mechanism: Explicit local-model provider/registry configuration is a first-class, separately-documented path (not an afterthought of the cloud-model config)
system: mini-SWE-agent (docs/models/local_models); OpenCode (Ollama integration docs); Continue (recommends specific local models per role)
problem_solved: >
  Harnesses built API-provider-first (OpenAI/Anthropic) tend to leak
  provider assumptions (cost tracking that requires known pricing tables,
  context-length assumptions, tool-call template assumptions) into paths
  local models must also traverse, causing local-model-specific crashes
  unrelated to model capability (e.g. a cost calculator crashing on an
  unregistered model name).
evidence: >
  mini-SWE-agent issue #303: local/custom models crashed the harness's
  cost calculator (which has no pricing data for unknown local models),
  fixed by forcing `custom_llm_provider = "openai"` in litellm kwargs and
  wrapping cost calculation in try/except defaulting to $0 on unknown
  models — a structural bug, not a model-capability one. OpenCode's own
  Ollama integration guidance (and third-party confirmations) repeatedly
  centers on context-window misconfiguration (Ollama's default 4K vs. the
  64K+ recommended for agentic tool use) as the primary blocker to "it
  doesn't work," ahead of any model-capability discussion.
applicability_to_shelracode: >
  This is direct evidence for treating local-model support as its own
  code path with its own failure modes to test (already the stated
  posture in `docs/local-models/RESEARCH.md`: "Managed runtime process
  ownership is explicit... local endpoint security and bind address must
  be surfaced explicitly") — reinforces continuing to test the local
  adapter paths (context length, cost-irrelevant accounting, template
  presence) as structural correctness, separate from and prior to model
  capability probing.
simpler_alternative: n/a
source: https://github.com/SWE-agent/mini-swe-agent/issues/303 ; https://mini-swe-agent.com/latest/models/local_models/ ; https://docs.continue.dev/ide-extensions/agent/model-setup
accessed: "2026-08-30"
confidence: MEDIUM
```

---

## Q5. Small-model agent success rates — the biggest levers, ranked by evidence strength

```yaml
mechanism: Fine-tuning a small/mid model specifically on agentic SWE trajectories (not just code completion) closes most of the gap to much larger generalist models
system: Mistral Devstral Small 2 (24B, Apache 2.0, explicitly marketed as runnable on consumer/RTX hardware)
problem_solved: >
  Generalist coding models (trained on code completion/chat) are not the
  same distribution as "agent that edits real repos across many tool
  calls to close a GitHub issue" — the latter needs training signal from
  actual multi-step agentic trajectories.
evidence: >
  Official vendor materials (mistral.ai/news/devstral-2-vibe-cli/,
  huggingface.co/mistralai/Devstral-Small-2-24B-Instruct-2512, checked
  2026-08-30): Devstral Small 2 (24B) reports 68.0% on SWE-bench Verified,
  described as competitive with models "up to five times its size,"
  explicitly trained to "run over code agent scaffolds such as OpenHands
  or SWE-Agent, which define the interface between the model and the test
  cases" — i.e. the model was fine-tuned *against* a specific
  agent-computer-interface, not evaluated as a generic chat model dropped
  into one. (Treat the 68.0%/"5x smaller" framing as a vendor claim —
  HIGH confidence on the fine-tuned-for-scaffold methodology being real
  and documented, MEDIUM confidence on the exact percentage vs.
  independently reproduced SWE-bench numbers, which this pass did not
  verify against the SWE-bench leaderboard directly.)
applicability_to_shelracode: >
  Confirms the TinyAgent/Hammer lesson (Q1) at agent-task scale, not just
  tool-call scale: the single highest-leverage change for small/local-model
  reliability that this whole research pass found is *model selection*
  (prefer models fine-tuned on agentic coding trajectories over same-size
  generalist chat/code models) — ahead of any prompt, parser, or loop
  change. Directly actionable for ShelraCode's local-model catalog
  scoring/recommendation logic (`docs/local-models/RESEARCH.md`,
  `docs/agent-kernel/MODEL-CAPABILITIES.md`): this is evidence to weight
  "trained/fine-tuned for agentic coding" as a first-class catalog signal,
  not just parameter count and quantized memory fit.
simpler_alternative: n/a — this is the highest-leverage lever identified,
  not something to simplify further.
source: https://mistral.ai/news/devstral-2-vibe-cli/ ; https://huggingface.co/mistralai/Devstral-Small-2-24B-Instruct-2512
accessed: "2026-08-30"
confidence: MEDIUM
```

```yaml
mechanism: Position/survey claim — 3-10B "small language models" are already sufficient for most individual agentic sub-tasks (tool calls, single-step edits) even though they are not sufficient for long-horizon autonomous coding as a whole
system: NVIDIA position paper, "Small Language Models are the Future of Agentic AI"
problem_solved: n/a — framing evidence, not a mechanism.
evidence: >
  arXiv 2506.02153 (Belcak et al., 2025; checked 2026-08-30): a position
  paper (not a new benchmark/method) arguing SLMs (defined as models
  runnable on a single consumer device with fast single-user response,
  ~3-10B) are "already powerful enough for many errands agents ask for,"
  and economically necessary for agentic systems given how narrow most
  individual agent sub-tasks are.
applicability_to_shelracode: >
  Directly matches ShelraCode's product thesis (1-14B local models,
  `docs/PRODUCT.md`) but this is a *position paper's argument*, not
  independent empirical proof — treat it as framing/motivation evidence,
  not as evidence that any specific 1-14B model will succeed at
  ShelraCode's actual coding tasks. ShelraCode's own live probes
  (MODEL-CAPABILITIES.md: Qwen2.5-Coder 7B and 1.5B both landing in
  `workspace_reader`, not a coding-capable class) are stronger,
  first-party evidence than this paper for what ShelraCode's specific
  local models can currently do — this paper explains *why it's worth
  continuing to try* (task decomposition into narrow sub-tasks is the
  lever), not that today's installed models already work.
simpler_alternative: n/a
source: https://arxiv.org/abs/2506.02153
accessed: "2026-08-30"
confidence: LOW — position paper, not independently reproduced benchmark evidence.
```

---

## What ShelraCode should try — simplest-first

Ordered by (evidence strength × implementation cost), not by novelty. Each
item is a *thing to evaluate*, not a prescription — per audit charter §44.

1. **Verify/confirm the `EditCodec` calibration's unclassified-model default
   is `whole_file`** (`src/driver/edit-codec-calibration.ts`,
   `src/driver/profile.ts`). Aider's leaderboard shows format compliance
   near-saturated at even 0.5B parameters *when the format is "whole"* —
   this is close to a one-line check/change, backed by the strongest,
   most directly-applicable evidence in this file (Q2).
2. **Log assembled-prompt token count vs. active runtime context window
   (`num_ctx` for Ollama) per local-model turn**, to separate "silent
   context truncation" from "model capability" as failure causes before
   attributing a malformed/empty tool call to model capability class. Ollama's
   documented default (4096, official FAQ) is smaller than many repo+tool
   prompts; this is a logging/diagnostic change, not a behavior change (Q1).
3. **Extend the existing non-progress limit (already closing the
   "prose-only early stop" gap per `ROOT-CAUSES.md`) to also cover repeated
   identical edit failures and repeated identical tool errors**, matching
   OpenHands' documented pattern set and mini-SWE-agent's
   `max_consecutive_format_errors`, using ShelraCode's own existing
   `errorClass` taxonomy rather than a new subsystem (Q2, Q3).
4. **Weight "fine-tuned for agentic coding/tool-calling" as a local-model
   catalog signal**, not just parameter count/quantized memory fit — the
   TinyAgent/Hammer/BFCL/Devstral evidence is the single highest-leverage,
   though highest-cost (catalog/curation work, not code) lever found (Q1, Q5).

---

## Coverage note

This pass answered the five specific stuck-questions on small/local-model
reliability. It intentionally did not re-cover ground already logged in
`docs/agent-kernel/RESEARCH.md` (Claude Code, Codex, OpenCode general
architecture) or `docs/local-models/RESEARCH.md` (runtime detection/catalog
mechanics) except where directly load-bearing for these five questions.
Broader mechanism sweep (context/retrieval engineering, verification loops,
TDD-agent patterns, long-horizon agents) beyond the small-model tool-calling/
edit-format/loop-stability scope remains open for a future pass if the audit
needs it.
