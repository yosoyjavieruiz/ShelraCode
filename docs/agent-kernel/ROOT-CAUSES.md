# Root Causes — Reported Agent Failure

Reported failure: asked _"¿Qué lenguaje de programación está usando el
proyecto?"_, the agent read `.agents/skills/localcode-agent-harness/SKILL.md`,
got `maxChars must be a positive integer` then `ENOTDIR` (from listing that
same file path as if it were a directory), did not recover, and returned an
unrelated CLI instruction as "Done".

Each question from the audit brief, answered against the real code
(`git show HEAD` / direct execution — see commands below, not inference):

## Why did context selection choose `SKILL.md`?

**Not reproducible against the current harness.** `buildRepositoryContext()`
(`src/context/repository.ts`) ranks files by a fixed `priorityNames` set
(`package.json`, `tsconfig.json`, `README`, lockfiles, `AGENTS.md`, …) plus
objective-term matches — `SKILL.md` is in neither set and is not
force-loaded anywhere in `src/`. `resolveTurnMode()` also gates repository
context to `workspace_read`/`coding` turns only (`src/tui/app.tsx:897-912`);
nothing auto-loads `.agents/skills/**` for an ordinary question.

Two explanations are consistent with the evidence, and both point the same
direction: either (a) the screenshot predates this context-builder/turn-policy
code (the working tree shows this as substantial _uncommitted_ work — `git
status` marks `src/agent/`, `src/tools/`, `src/context/` as untracked — so an
older harness could plausibly have had no priority ordering at all and just
handed the model a raw file listing that included skill files), or (b) the
model chose that path on its own initiative — a 1.5B model asked "what
language is this project" can plausibly free-associate to a file whose name
contains "agent"/"harness" without any harness code steering it there. This
audit cannot distinguish (a) from (b) without the original session's trace,
but it does not matter for the fix: §"What was fixed" below removes the
failure mode regardless of which path led the model to a bad target.

## Why did `maxChars` become invalid?

The tool's own `validate()` was never the bug — `readFileTool.validate()`
already rejected a non-integer/non-positive `maxChars` before this pass, with
a clear message. Reproduced directly:

```
readFileTool.validate({ path: "package.json", maxChars: 0 })
→ threw "maxChars must be a positive integer"
```

The gap was what happened _after_ that throw: the message didn't say what a
valid value looks like (no mention of the default), and — more importantly —
nothing in the system prompt told the model that a tool error is something to
read and correct rather than a dead end (see "why did the agent not
recover" below).

## Why did `ListFiles` receive a file path, and why `ENOTDIR`?

Reproduced directly against `src/tools/workspace.ts` before this pass:

```
listFilesTool.execute(
  listFilesTool.validate({ path: ".agents/skills/localcode-agent-harness/SKILL.md" }),
  ctx,
)
→ threw "ENOTDIR: not a directory, scandir 'D:\...\SKILL.md'"
```

`listFilesTool` never checked whether the given path was a file before
handing it to `rg --files --hidden ... ` with `cwd` set to that path (and,
on the ripgrep-fallback path, to `readdir()`). Both fail with a raw,
OS-specific errno string. `ListFiles` accepting a file path at all is
expected — the tool doesn't know in advance — but surfacing that failure as
an opaque `ENOTDIR` instead of an actionable instruction is the actual bug:
a small model has no reliable way to map `ENOTDIR` to "call `ReadFile`
instead."

## Why did the agent not recover?

Two compounding causes, both now fixed:

1. **The signal was low-quality.** The agent loop _did_ already catch
   `tool.execute()`/`tool.validate()` exceptions and feed them back to the
   model as a structured `{ tool, ok: false, error }` tool-result message
   (`src/agent/loop.ts`, unchanged by this pass) — so the harness was never
   silently swallowing the failure. But `error` was a raw message string
   with no machine-checkable code, so "was this my tool choice, my
   argument, or a repository problem?" had to be inferred from free text a
   1.5B model is not reliable at parsing.
2. **Nothing told the model recovery was expected.** None of the three
   system-prompt profiles in `loop.ts` said anything about what to do when a
   tool call fails — the model had no stated expectation that it should
   read the error and retry rather than stop.

## Why did it declare "Done" after failure?

The agent loop's completion path (`runAgent`'s final `return` in `loop.ts`)
returns whatever `finalText` the model last produced once it stops calling
tools — there is no separate "declare success" step to gate. If the model's
last turn is prose instead of a tool call, that prose becomes the result
regardless of whether it answered the question. This is inherent to a model
that gives up after an unrecovered error: it produces _some_ text, and that
text is treated as the answer. This audit did not add a completion gate that
verifies the answer actually cites evidence (spec §106–109, §107) — that
remains open (see AUDIT.md).

## Why did the final answer ignore the user's question?

Direct consequence of the above: once both tool calls failed with
unrecoverable-looking errors, the model's only remaining move (per its
system prompt at the time, which had no repository evidence and no recovery
instruction) was to produce _some_ text. It filled that gap with a generic
CLI instruction rather than admit it lacked evidence, because nothing told
it that "I don't have enough evidence yet, let me try a different tool" was
an available, expected move.

## What was fixed this pass

- `src/tools/errors.ts` (new): `ToolError` with a closed set of codes
  (`INVALID_ARGUMENT`, `PATH_NOT_FOUND`, `PATH_IS_FILE`, `PATH_IS_DIRECTORY`).
- `listFilesTool` and `readFileTool` now stat the target path first and throw
  a `ToolError` with an instruction naming the correct tool, instead of
  letting `ENOTDIR`/`ENOENT`/`EISDIR` reach the model.
- `ToolResult.code` (new, optional) carries the `ToolError` code through the
  agent loop into the serialized tool-result message the model sees.
- Both `workspace`/`coding` system-prompt profiles gained one explicit
  sentence: a tool error is something to read and correct, not a stop sign.
- Regression coverage: `tests/unit/tool-error-recovery.test.ts` (tool-level,
  5 cases) and a new end-to-end case in
  `tests/integration/agent-loop.test.ts` that replays the exact reported
  sequence (`ListFiles` on the skill file → typed `PATH_IS_FILE` result →
  model switches to `ReadFile` → correct answer), asserting the loop
  completes with an evidence-based answer instead of giving up.

## What is still open (see AUDIT.md for the full table)

The completion gate (verifying an answer actually rests on evidence before
returning it), the capability-probe → routing eligibility wire-up, and the
independent verification agent are the highest-value next items — none of
them were required to fix the specific reported failure, and claiming them
done without evidence would repeat the exact "false Done" failure this pass
just fixed.

## Current live findings — 2026-08-24

The source-level fixes described earlier are present, but they do not close
the broader autonomous-agent failure. Fresh live and deterministic evidence
found these additional causes:

1. **Turn policy is under-specified and misclassifies intent.**
   `src/agent/turn-policy.ts` now has the seven explicit modes and structural
   read/write/shell policies. Direct repository fact questions additionally
   retain host context while disabling model workspace tools. This original
   **TURN POLICY** cause is covered by unit and functional tests.

2. **The live model/runtime/tool contract is not capability-safe.**
   On 2026-08-24 the real `src/index.ts --tui` path used LM Studio's
   `qwen2.5-coder-1.5b-instruct`. The endpoint emits a textual
   `<tools>...</tools>` envelope and can repeat a call after an observation.
   The shared parser and duplicate fallback now make the read path recoverable,
   but the exact model/template/parser combination still fails edit, test, and
   verification probes. This is a **MODEL / RUNTIME / TOOL PROTOCOL**
   interaction.

3. **The loop treats model stop as enough to return.**
   `src/agent/loop.ts` now persists phase, evidence, actions, blockers, and
   verification state. Generation stop alone cannot complete; recoverable
   errors produce observations and the watchdog can replan or block. The
   original **AGENT LOOP / COMPLETION GATE** cause is covered by deterministic
   loop and completion-gate tests.

4. **The current validation boundary is too narrow.**
   `src/tools/errors.ts` and the provider/process boundaries now expose the
   closed typed taxonomy, including command/test/provider/cancellation and
   stale-edit cases. The model-facing request also has host-owned output
   bounds. This original **TOOL CONTRACT** cause is covered by focused
   contract and recovery tests.

5. **Cancellation has separate signal and UX failures.**
   The process helper propagates abort and the deterministic cancellation test
   persists a `cancelled` task. The live source TUI can cancel active work;
   a live coding cancellation journey remains unverified because no coding-
   eligible model is installed. This remains a **CANCELLATION / UI LIFECYCLE**
   boundary rather than a claim of complete release readiness.

6. **Capability discovery is disconnected from routing.**
   Capability probes are now versioned, persisted, cache-invalidated when the
   probe changes, and consumed by route eligibility. Runtime declarations are
   not enough for coding. This original **ROUTER / CAPABILITY** cause is
   closed in deterministic routing tests; the installed qwen remains below
   coding eligibility on fresh live evidence.

These findings refine, rather than erase, the historical `SKILL.md` report:
the exact old session is still not reproducible from the current source, but
the same class of issue remains demonstrable through a different live model
failure. The correct repair target is the kernel boundary and evidence gate,
not a prompt-only patch.

## Current repair status — 2026-08-24

The identified causes now have host-side controls: turn policy is structural;
invalid tool calls are bounded and typed; context/evidence and completion are
ledger-backed; provider crashes become failed tasks; checkpoint hashes prevent
stale overwrites; textual protocol recovery is normalized; output is bounded;
and model capability probes gate routing. The installed LM Studio qwen is
correctly classified `workspace_reader`: the read path is usable, but editing
and verification still fail. That is current model/runtime evidence, not a
reason to weaken the gate or label the model an autonomous coder.

## Qwen2.5 Coder 7B follow-up — 2026-08-24

The newly loaded 7B model changed the diagnosis quantitatively but not the
release decision:

1. The 7B passes the conversational/no-tool and repository-read protocol path
   and can complete a simple one-file edit/test task. This is an improvement
   over the earlier 1.5B result.
2. LM Studio returns an empty native `tool_calls` array for the observed
   requests and places tool-shaped output in text wrappers (`<response>`,
   fenced XML, `<xml>`) or planning prose. The adapter/parser now recovers the
   bounded forms and suppresses them from the transcript. This closes a
   **TOOL PARSER / RUNTIME FORMAT** defect without turning model text into
   unrestricted executable instructions.
3. The 7B still fails the end-to-end multi-file coding task: it stops while
   describing the next action after a read, with no mutation or verification.
   This is **MODEL CAPABILITY / CHAT TEMPLATE / TASK EXECUTION**, not evidence
   that the completion gate should be loosened.

The correct current classification is `workspace_reader`. A native-tool-use
model/runtime combination or materially stronger measured local route is still
required before LocalCode can claim the functional autonomous-coding MVP.

## Prose-only early stop follow-up — 2026-08-24

The live 7B task also exposed a kernel lifecycle gap: after a coding model
returned a planning paragraph with no tool call, `runAgent` went directly to
completion review. The completion gate blocked the task correctly, but the
loop had not yet attempted a bounded reflective retry. The kernel now records
that no-action observation and asks for one executable evidence-based action,
up to the existing non-progress limit. Deterministic coverage proves that a
model which acts on the retry can continue, while an unresponsive model still
ends `blocked`. This is a closed **AGENT LOOP / RECOVERY** defect; the remaining
7B failure is **MODEL CAPABILITY / RUNTIME TEMPLATE**.

## Partial-success false completion follow-up - 2026-08-24

The first criteria-aware live run exposed a second lifecycle defect: Qwen 7B
fixed `add`, produced a passing test, and stopped before implementing
`multiply`, while the kernel had been auto-marking every criterion satisfied.
The primary cause was **COMPLETION GATE**: mutation plus verification was being
treated as semantic objective satisfaction. Explicit criteria now require a
host-owned read-only verifier, and missing criteria produce `blocked` with
bounded continuation when a verifier is available. The same live task now
ends blocked with `multiply` still missing rather than falsely completed.

## Capability-cache overwrite follow-up - 2026-08-24

The first positive 14B probe was saved without a hardware snapshot. The cache
correctly rejected it, and a 30-second doctor timeout then overwrote it with a
fallback result lacking a version. The symptom was `doctor --agent` reporting
`unknown/chat_only` despite a passing live probe.

Failed local probes now include `AGENT_CAPABILITY_PROBE_VERSION`. The positive
14B evidence is stored with the exact hardware snapshot and survives discovery;
the negative timeout path is also versioned. Primary cause: **CAPABILITY CACHE /
DISCOVERY TIMEOUT**, closed by versioned failure persistence and exact
environment metadata.
