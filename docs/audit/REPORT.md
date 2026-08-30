# ShelraCode — Autonomy Report: why it fails, what's fixed, what's missing

> Executive report requested 2026-08-30. Grounded in **reproduced experiments +
> network capture + external research**, not inference. Honest about partial
> fixes. Snapshot: working tree at commit `230b557` + large uncommitted WIP.

## TL;DR

**The local model is NOT the bottleneck. The harness is.** The same 4B model
(`parable-qwen3-4b-claude-fable-5`) that the operator runs perfectly in LM Studio
produces valid tool calls in every isolated test we ran. It fails inside
ShelraCode because the harness stacks several strict gates/bugs, **each of which
alone can castrate a capable model.** We confirmed and fixed one, partially fixed
a second, and mapped the rest. This layered structure is why progress felt
impossible: fixing one gate reveals the next.

## The core truth (proven, not asserted)

The model produces a valid `EditFile` for the exact step that stalls, in THREE
independent conditions:
| Test | Result |
| --- | --- |
| Direct API, no tools (text mode) | valid tool-call JSON, `finish_reason: stop` |
| Direct API, 24 turns / 4.6k tokens of clutter | still valid |
| Direct API, native `tools` param | valid native `tool_calls`, `finish_reason: tool_calls` |
| Raw HTML generation | clean valid `<!DOCTYPE html>…` |

So "no crea una web simple" is a harness failure. Evidence: `docs/audit/HARNESS-FAILURE-ANALYSIS.md`.

## Confirmed root causes (with status)

### RC1 — Write-authority brick — **FIXED & verified**
`F-HARNESS-006`. All file writes were denied unless a stochastic per-session
capability probe certified the model; a single unlucky probe run left
`authority: none` → every `EditFile/WriteFile/CreateFile` `PERMISSION_DENIED` →
task blocked.
- Fix: `src/agent/capability-probe.ts` retries the executable edit probe (3x,
  fixture reset) so a capable model reliably certifies. Security gate unchanged.
- Verified: live write-denials **2 → 0** (deterministic across runs); full suite
  **942 pass / 0 fail**; `tsc` clean; security tests 929/957/1044 intact.

### RC2 — Orphan tool-message stall — **PARTIALLY FIXED**
`F-HARNESS-007` (P1). Found by capturing the exact HTTP requests the harness
sends. When the host runs verification (`bun test`), it injected the result as a
`role:"tool"` message with a **synthetic `tool_call_id` (`shelracode-verification-<stage>`)
that matches no model tool_call** (`src/agent/loop.ts:5848`). That is a
protocol-invalid native-tools conversation (every `tool` message must answer a
real `tool_call`). Local models reply to it **unreliably — intermittent EMPTY
responses** that the loop reads as "no executable action" → stall.
- Evidence: proxy capture — `req-24` (EMPTY) and `req-25` (valid) had *identical*
  message arrays; the orphan `tool_call_id shelracode-verification-test` was
  present with no matching assistant tool_call. Same malformed input → nondeterministic output.
- Fix applied: deliver host verification as a `role:"user"` observation instead
  (`loop.ts`, `tsc` clean).
- **Verification status (honest): partial.** 2 live runs after the fix: RUN 1 —
  no stall message (improved); RUN 2 — stalled once anyway. **Neither completed
  `multiply`.** So the orphan was ONE contributor to the empty responses, not the
  only one, and a separate completion problem remains (RC5).

### RC3 — Exact-match edit fragility — **open**
`F-HARNESS-003`. `editFileTool` requires a byte-exact `oldText`; a small model's
near-miss `oldText` hard-fails (`fail:EditFile`), wasting turns. External
evidence (Aider): tolerant/fuzzy apply logic mattered ~9× more than edit-format
choice; unknown models should default to the forgiving `whole_file` codec.

### RC4 — Calibrated protocol/edit-codec measured but not applied at generation — **open (static)**
`F-HARNESS-001`. The harness computes each model's best protocol + edit codec
(`driver/*`) and threads `driverProfile` into `runAgent`, but `loop.ts` never
reads it for prompt/parse; it uses a fixed prompt + a protocol-agnostic 11-format
text-recovery parser. (Static trace; not yet live-reproduced.)

### RC5 — Multi-step task doesn't complete — **open, needs investigation**
Even in the run with no stall message (RUN 1), the agent fixed `add` but never
implemented/exported/tested `multiply`, and ended blocked. So beyond the empty
responses there is a distinct multi-step-completion problem (turn budget,
work-unit staging, or repeated failed edits). Not yet root-caused.

## Why it has been "so hard" (the honest structural answer)

The harness has **stacked gates**, each a hard blocker on its own: write
certification (RC1), protocol-invalid history (RC2), exact-match edits (RC3),
unused calibration (RC4), and multi-step completion (RC5). A single green unit
suite (942 tests) hid all of them because **0 of ~128 tests exercise a real model
through the loop** (`docs/audit/10-real-autonomy.md`) — the failing part (the
model) is exactly the part the tests hold constant. Fixing one gate exposes the
next; that is the "misma basura" experience.

## External research — simplest-first levers (cited)

From `docs/audit/research/CODING_AGENT_PRACTICES.md` (+ `SOURCES.md`,
`COMPETITIVE-HARNESS-MATRIX.md`):
1. **Default unknown/small models to the `whole_file` edit codec** — Aider's
   leaderboard: format compliance is ~saturated even at 0.5B *if the format is
   forgiving*; exact-match diff/search-replace is where small models fail.
2. **Bounded format-error / stuck detection** — mini-SWE-agent's
   `max_consecutive_format_errors` (3) and OpenHands' semantic stuck-detector
   (same-action-4×, same-error-3×, agent-monologue) — extend ShelraCode's
   non-progress limit to repeated identical edit-fails/tool-errors.
3. **Native tool-calling is unreliable on small local models** — mini-SWE-agent
   (>74% SWE-bench) uses NO tool-calling API, just one bash block per turn;
   Continue/Cline use prompted XML; llama.cpp offers grammar-constrained (GBNF)
   decoding. For weak models, prefer a single-action text/grammar contract over
   native `tools` + multi-format recovery.
4. **Highest-evidence lever (model selection, not harness):** fine-tuned-for-agentics
   small models (TinyAgent 1.1B beat GPT-4-Turbo on tool-calling; Devstral 24B →
   68% SWE-bench) beat raw parameter count.

## Honest review of OUR `.claude` agents & skills (you asked)

- **Worked:** `repository-forensics` (precise, cited map); `coding-agent-researcher`
  (strong cited external context); the **proxy network-capture method** (turned a
  guess into a proven root cause). The 2 deterministic guard hooks work.
- **Did NOT work well:**
  - **Session-limit fragility:** launching 9–14 agents at once exhausted the
    account session limit **three times**, killing whole waves mid-run. Lesson:
    small, sequenced waves that persist output per step — not big fleets.
  - **Over-engineering:** the stall-fix agent added **~950 lines to `loop.ts`**
    and did NOT fix the stall (caught only because we verified in the real flow).
    Lesson: surgical fixes; verify before trusting an agent's self-report.
  - **My own methodology error:** the RC1 fix was first verified in the eval
    *script*, not the *product* flow — violating "types compiling is not proof."
    Corrected by capturing the real request path.
- **Net:** the audit stack is useful for investigation but must run in small,
  verified steps, and every fix must be proven against the real product path.

## What's missing

- Real-model E2E tests through the live loop (0 today) — the reason all of this
  went undetected.
- A per-turn "assembled-prompt-tokens vs runtime context window" log (cheap
  diagnostic; Ollama silently truncates at 4096 by default).
- Applied edit-codec/protocol per model (RC4).
- A stuck/format-error detector beyond the already-closed prose-only case (RC2/RC5).

## Prioritized plan (smallest path to real autonomy)

**DO FIRST**
1. Finish RC2: capture the remaining EMPTY requests (proxy) to find any other
   orphan/protocol-invalid message sources; make the provider serialization
   **guarantee** every `tool` message has a matching assistant `tool_call`
   (defensive fix at `providers/openai-compatible.ts`), not just the one source.
2. Root-cause RC5 (multi-step completion) with the same trace method.
3. Add ONE real-local-model E2E test ("create + verify a small multi-file
   artifact") to CI so regressions surface.

**VALIDATE FIRST (experiment before building)**
4. Default `whole_file` edit codec for unknown/small models (RC3) — measure edit
   success delta on the live journey.
5. For weak models, try a single-action contract or GBNF grammar instead of
   native `tools` (RC4) — measure empty-response rate.

**DEFER**
6. Broader complexity cleanup (`core/` dead code, etc. — `DEAD-COMPLEXITY.md`).

## Next action
Continue RC2 (remaining empty sources + serialization guard) and RC5, verifying
each against the real product flow, in small steps. Snapshot the uncommitted WIP
to a branch first so nothing is lost.
