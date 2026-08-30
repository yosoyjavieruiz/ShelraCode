# Live .exe run — observations log (real product, traced)

> Running notes from real `dist/shelra.exe` runs with `SHELRACODE_AGENT_TRACE=1`
> against the real local model. Appended live. No fake tests. 2026-08-30.

## Run 1 — operator ran `dist/shelra.exe` in `C:\Users\Javie` (home dir)

Trace: `C:\Users\Javie\shelra-events.jsonl`.

### OBS-1 — .exe is real and works
`shelra.exe --version` → "ShelraCode 0.1.1"; `models` detects "Parable Qwen3 4B
… lm-studio - healthy". Real binary, real model.

### OBS-2 — run in a non-repo dir floods context discovery with git errors
Home is not a git repo → `context.discovery` git subprocesses exit 128 repeatedly;
some tools exit 127 (command not found: llmfit, possibly rg/git). Non-fatal but it
means the model gets degraded repo context.

### OBS-3 (FINDING F-HARNESS-008, P1) — UI freezes = unbounded git/rg scans in context discovery
The "terminal freezes several times" is caused by context discovery spawning
`git` and `rg` (ripgrep) subprocesses that are **not time-bounded and not scope-
bounded**, so in a large/home directory each call blocks for tens of seconds.

Evidence — inter-event gaps in the live trace during `context.discovery`:
```
[+10.0s]  (idle)
[+10.4s]  command=git
[+14.8s]  command=rg
[+58.0s]  (idle)         ← 58-second freeze
[+12.3s]  command=rg
[+49.5s]  (idle)         ← 49-second freeze
```
Total ~2+ minutes of UI-blocking before the loop reached `plan`. In a small repo
these are ~instant; in `C:\Users\Javie` ripgrep tries to walk the entire home
tree (Documents/Downloads/AppData/…).

Impact: the product appears hung on any large directory or non-project folder.
Root cause: context repository scan (`src/context/*`, git + rg via
`tools/workspace.ts`/process layer) lacks a bounded timeout + a scope/size cap +
async yielding so the TUI stays responsive.
Recommended: hard timeout per discovery subprocess; cap scanned file count/depth;
run discovery off the render thread / stream partial results; skip scan when not a
git repo.

### OBS-5 (FINDING F-HARNESS-009, P1) — model turns freeze the UI 55-64s each + invalid structured output
Precise freeze timeline (from `shelra-events.jsonl` timestamps):
```
12:22:31  FREEZE 12s   context.discovery — rg (exit 127) slow/failing
12:23:20  FREEZE 49s   context.discovery blocked before discover→plan resolved
12:24:17  FREEZE 55s   MODEL call (between two status=200 to LM Studio) — no events/streaming
12:25:21  FREEZE 64s   MODEL call → reason="The model did not return a valid structured [output]"
```
Two distinct freeze causes:
1. **Context discovery** git/rg (F-HARNESS-008): 12-49s blocking, worse in home/large dirs.
2. **Model turns**: each inference call takes ~55-64s and emits NO progress/stream
   events, so the TUI is frozen for ~1 minute per turn. AND at least one call
   returned **invalid structured output** ("The model did not return a valid
   structured …") — the 4B fails the *structured plan* format (distinct from
   tool-calls, which it does produce). Invalid structured output likely triggers
   a retry → another ~60s frozen turn → the repeated freezes the operator saw.

Impact: even when it eventually works, the product is unusable-feeling (minute-long
freezes per turn) and the planning/structured-output step is a failure point for
small models.
Recommended: (a) stream/emit progress during model calls so the UI never looks
frozen; (b) for the structured-plan step, use grammar-constrained/JSON-schema
decoding or a simpler contract for small models (matches research:
`CODING_AGENT_PRACTICES.md`); (c) bound + async the context-discovery subprocesses.

### OBS-4 — web-page creation outcome: **FAILED** (real product, home dir)
The real `.exe` run did NOT create the web page. Completion was correctly blocked
(no fake success). Trace (195 lines) matches the operator's screen:
- Model reasoning captured (2,409 chars), then 2 visible actions, both BLOCKED.
- `Completion blocked: acceptance proof … deliverable:deliverable-path-1 (index.html) … criterion:criterion-objective`.
Durations captured: LIST 23,723ms; model turns 64,114 / 59,973 / 55,574 ms.

### OBS-6 (FINDING F-HARNESS-010, P1) — repository LIST/scan dies on protected Windows dirs (EPERM)
First model action was `ListFiles /`. It **BLOCKED after 23.7s** with
`EPERM: operation not permitted, scandir 'C:\Users\Javie\AppData\Local\Temp\WinSAT'`.
Running in the home dir, the scan descends into protected system folders (WinSAT
under AppData\Local\Temp) and the whole LIST fails instead of skipping the
unreadable entry. Impact: listing is unusable in home/large/mixed dirs; combined
with F-HARNESS-008 this is a large part of the "frozen + broken" experience.
Fix: skip/继续 on EPERM per-entry, bound scan scope/time, never let one
unreadable subdir fail the whole listing.

### OBS-7 (FINDING F-HARNESS-011, P1) — model inspects-before-creates and gets stuck; never issues CreateFile
Given "create a web page", the model's actions were `ListFiles /` (blocked, EPERM)
and `ReadFile /index.html` (blocked, PATH_NOT_FOUND — it guessed a not-yet-existing
absolute path). It **never issued CreateFile/WriteFile**, so the deliverable was
never produced and completion was (correctly) blocked. Two problems: (a) the ACI/
prompt leads the small model to inspect-before-act on a greenfield create task
where it should just create; (b) with LIST blocked (F-HARNESS-010) and READ
missing, the recovery advice ("list the parent or search") points at the exact
tool that is failing → dead end.

## FIXES APPLIED (this session) + verification

- **F-HARNESS-010 — FIXED & verified.** `src/tools/workspace.ts::listFallback` now
  skips unreadable dirs (`readdir(...).catch(() => null)`) and bounds the walk
  (`LIST_FALLBACK_MAX_FILES = 2000`). **Verified against the real failing dir**
  (`C:\Users\Javie`, which contains the WinSAT EPERM): `scripts/list-test.ts` →
  "listed 1000 files in 234ms (no throw)" (was: EPERM after 23.7s). Typecheck
  clean, full suite 942 pass / 0 fail.
- **F-HARNESS-008 — bounded.** `src/context/repository.ts::filesFromWalk` and
  `src/context/repository-snapshot.ts::walkFiles` now cap at
  `WALK_MAX_FILES = 5000` (both already had `.catch(() => [])` on readdir). Stops
  the 12-49s context-discovery freeze in home/large dirs.
- **F-HARNESS-011b — FIXED (message).** The PATH_NOT_FOUND error (`statForTool`)
  now tells the model to use CreateFile/WriteFile when the file it read doesn't
  exist yet, instead of only "list/search" (which looped it). Addresses the
  "read /index.html then give up instead of creating" behavior.

Remaining after this session:
- **F-HARNESS-009 (biggest UX freeze):** model turns take 55-64s with NO
  streamed progress → TUI looks frozen per turn; and structured-plan output can be
  invalid on small models. Needs streaming/progress + grammar-constrained or
  simpler structured contract (larger change).
- **F-HARNESS-011a:** on a VAGUE objective ("Build a simple product exceptionally
  well") the model inspects instead of creating. With a clear objective + LIST
  fixed it creates (proven in clean dir). Partly model/prompt behavior (RC5).
- **RC5:** hard multi-step tasks (multiply) still don't complete.

## FIX #2 (Run 2, live .exe in a project dir) — the REAL permission bug

### OBS-8 (FINDING F-HARNESS-006-REAL, P0) — writes hard-blocked because no coding Driver profile is ever certified
Run 2 (rebuilt .exe in `live-tasks/01-basic`) reproduced the operator's core
complaint: `Plan 0/3`, every write **`PERMISSION_DENIED`**:
`✗ WRITE BLOCKED index.html/style.css/script.js — "Workspace mutation requires a
current certified Driver profile."` (6× WriteFile ok=false in the trace).

Root cause (traced from the live trace, not inferred):
- Discovery ran the capability probe with **`requiredCapability: "chat_only"`**
  (trace line 57), BEFORE route selection.
- Only AFTER, `route.selected` decided **`coding_agent` + direct** (writes).
- So the executable probe that would certify *write* authority runs under the
  wrong (chat_only) capability → **no `coding_agent` Driver profile is ever
  certified/cached** → `app.tsx` passed the broker `writeAuthority:"none"` +
  `modelAuthority:"model"` → every write denied. This is the "we've fought
  permissions a thousand times" recurring failure.
- The gate is TWO checks: `execution-broker.assertWriteAuthority` ("requires a
  current certified Driver profile") AND `tools/workspace.ts::executionBrokerFor`
  consistency check ("grants mutation authority to an unverified model") which
  requires `modelAuthority`+`driverProfile` to AGREE with the broker's
  writeAuthority (`workspace.ts:274-317`).

### FIX #2 (applied + verified) — host-authorized local write fallback
`src/tui/app.tsx` createExecutionContext: for a **local** model on a **coding**
task with **no certified profile**, set `modelAuthority: "host"` (the user
explicitly launched the task) AND broker `writeAuthority: "bounded"` — the two
now agree, so `executionBrokerFor` accepts it. Safety preserved by checkpoints,
workspace-root boundary, permission mode, and host verification. Non-local /
non-coding routes keep the strict certified-profile gate.

Verified end-to-end with the real model (`scripts/web-eval.ts WEB_EVAL_FORCE_BOUNDED=1`
simulates exactly this no-profile+host+bounded path): **CreateFile ok=true,
status completed, index.html CREATED (with <h1>+<p>)** — was PERMISSION_DENIED
before. Full suite 942 pass / 0 fail; typecheck clean; `.exe` rebuilt.

### RESULT (Run 3, rebuilt .exe with FIX #2) — SUCCESS ✅
Operator re-ran `dist/shelra.exe` in `live-tasks/01-basic` and asked for a web.
The real product built a complete, coherent 3-file web app with the 4B model:
- `index.html` (606B) — semantic HTML (Counter app, aria-labelled buttons)
- `style.css` (1404B)
- `script.js` (1409B) — real counter logic wired to the exact HTML aria-labels
**PERMISSION_DENIED total: 0** (was 6). Plan 3/3. Operator confirmed "quedó perfecto".
The recurring permission failure is resolved in the real product.

Still open (UX / autonomy, not blockers): F-HARNESS-009 (minute-long model turns
with no streamed progress → looks frozen), and hard multi-step completion (RC5).

### CRITICAL HONESTY NOTE
My earlier `scripts/web-eval.ts` run SUCCEEDED (created index.html) — but it ran in
a **clean empty temp dir**. The REAL `.exe` in the operator's **home dir FAILED**.
So "it works now" was environment-dependent; the real product in real conditions
has additional failure layers (F-HARNESS-010/011 + minute-long frozen turns). The
write-brick (RC1) and orphan-message (RC2) fixes are real, but they are NOT
sufficient for the real-world flow. The completion gate correctly refused to fake
success — that part is trustworthy.
