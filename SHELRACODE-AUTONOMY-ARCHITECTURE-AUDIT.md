# SHELRACODE — AUTONOMY ARCHITECTURE AUDIT

## Audit scope and evidence protocol

This document is the requested deep, read-only architecture audit of the current ShelraCode checkout. It is written in English because the requested report structure specified English. The document is stored at the repository root so it can be copied directly.

Audit checkout:

- Repository: D:/PROYECTS/shelra
- Branch: main
- HEAD at audit: 14f79ecf86097a8df60e52497986ebdf84e436d5
- Initial tracked worktree state recorded before audit activity: clean
- No production source, configuration, test, dependency, or UI change is intended by this audit.
- The tracked root fixture file index.html was restored byte-for-byte after a disposable reproduction touched the worktree; the final verification below confirms no net code change.

Evidence labels used throughout:

- VERIFIED_LOCAL — observed in the current checkout, current command output, or current source.
- VERIFIED_EXTERNAL — supported by a current official document, official repository, or primary paper.
- USER-SUPPLIED — supplied in the request, screenshot description, or previous audit artifact.
- HISTORICAL — present in project documentation or prior reports but not re-run as current runtime evidence.
- INFERENCE — architectural interpretation derived from evidence.
- UNPROVEN — not established by the current checkout or a reproducible run.

Priority of truth:

~~~text
current runtime observation
    >
current source and tests
    >
current project documentation
    >
historical audit notes
    >
architectural inference
~~~

This audit does not claim private knowledge of Claude Code, Codex, OpenCode, or any other proprietary implementation. Competitor comparisons cover only publicly documented mechanisms.

## Executive verdict

| Measure | Verdict |
|---|---:|
| Current autonomy | 5.0 / 10 |
| Harness quality | 6.0 / 10 |
| Small-model readiness | 4.5 / 10 |
| Weighted autonomy score | 50.6 / 100 = 5.1 / 10 |
| Claude Code proximity | Substantial gap |
| Current classification | Functional coding agent |
| Trust for unsupervised production-repository modification | NO |

ShelraCode is no longer merely an LLM chat screen. The current checkout contains a real multi-turn agent loop, typed tools, turn policies, capability probing, repository context construction, verification state, task-graph data, checkpoints, cancellation, memory, compaction, privacy/cost routing, and a TUI. These are current source-level capabilities.

It is not yet a complex autonomous coding agent because the critical interfaces between those pieces are not authoritative enough:

1. Natural-language coding intent is not compiled into a rich deliverable and acceptance contract.
2. The task graph is not a fully authoritative scheduler with enforced evidence transitions.
3. Verification is primarily generic project-command/structural verification rather than objective-specific acceptance verification.
4. A failed completion gate can become a terminal blocker without creating a repair node or replan.
5. Semantic repository intelligence and fresh Explore/Build/Verify execution are not proven as a productive runtime path.
6. The low-resource model matrix is not currently proven end to end on the exact shipped artifact and runtime.

The clock-website failure is therefore primarily a harness architecture failure with model and task-classification contributions. A stronger model could infer the missing website requirements and perhaps work around the generic verifier, but it would not fix the completion policy, stale plan projection, absent recovery node, or missing authoritative objective contract. The current source has moved beyond the older 93-call/RunTests-bypass failure state, but the deeper completion architecture remains the bottleneck.

### Direct answers

1. **Why did the simple website task fail?**  
   The request entered a weak task-analysis path, greenfield preparation inferred only index.html, the controller retained generic success criteria, no applicable test command made verification unavailable, unavailable verification counted as unsatisfied, and completion blocked without producing repair work. The current TUI also renders zero test counts when no parseable test count exists.

2. **Primary cause: model or harness?**  
   Harness architecture is primary. The model may have contributed by creating only a partial artifact, but the harness did not encode CSS, JavaScript, current-time behavior, reference integrity, or browser verification as required criteria and could not recover when generic verification was unavailable.

3. **Can the current product reliably perform complex multi-file work from one request?**  
   Not established and not trustworthy for unsupervised production work. Historical 14B fixture evidence exists, but current long-horizon, low-resource, real-artifact, and fresh verifier evidence is incomplete.

4. **Can an excellent harness amplify 1.5B–14B models?**  
   Yes, substantially for bounded and structured task distributions. No credible evidence supports universal frontier parity for a generic 1.5B model.

5. **Realistic tiering?**  
   1.5B: classification, retrieval, small verified transformations and micro-edits. 3B: exploration and bounded small repairs. 7B–9B: scoped coding worker. 14B: stronger local worker for moderate multi-file nodes. All tiers still need controller-owned state and verification.

6. **Single biggest bottleneck?**  
   The absence of an authoritative objective-to-evidence contract connected to a scheduler and recoverable completion gate.

## Current evidence snapshot

### Fresh commands

The following results were obtained in the current checkout:

~~~text
git rev-parse --show-toplevel
D:/PROYECTS/shelra

git branch --show-current
main

git rev-parse HEAD
14f79ecf86097a8df60e52497986ebdf84e436d5

git status --short
clean at initial capture; clean for tracked code after restoration, with only this new audit document expected

bun run typecheck
PASS

bun run test:functional
PASS — 26 passed, 0 failed, 102 expect() calls

bun run smoke
PASS — source and bundle help/version/doctor smoke

bun run test
534 pass, 1 skip, 0 fail
1,693 expect() calls
535 tests across 96 files
~~~ 

The full suite result above is current VERIFIED_LOCAL evidence. Older documentation counts such as 312, 346, 378, 499, or 512 passing tests are HISTORICAL and are not used as the current total.

### Artifact boundary

package.json declares the source executable entry at package.json:7-9:

~~~text
src/index.ts
~~~

The current package scripts run Bun source or bundle checks. No standalone Windows .exe was found in this audit. Therefore:

- source tests are VERIFIED_LOCAL;
- source/bundle smoke is VERIFIED_LOCAL;
- a manually built distributable executable journey is UNPROVEN;
- a claim that a user-run .exe contains a particular fix would be unsupported.

### Current versus historical evidence

The current source contains evidence that earlier defects were addressed:

- provider/tool batches are bounded at eight calls;
- loop-level progress and repeated-action limits exist;
- RunTests currently shares network policy checks with command execution;
- capability admission and progressive discovery route logic exist.

The older report claiming up to 93 tool calls and a RunTests network-policy bypass is retained only as HISTORICAL evidence of the engineering trajectory. The newer current mechanisms must be judged on their present limitations, not on superseded claims.

## What ShelraCode really is today

The most accurate classification is:

> A functional coding agent with a real orchestration skeleton, but without proof-carrying objective completion and without a fully authoritative scheduler/recovery plane.

It is closer to this model:

~~~text
user objective
    ->
turn-mode and task analysis
    ->
repository context
    ->
capability-aware route
    ->
model/provider
    ->
typed tool execution
    ->
multi-turn loop
    ->
generic task state and verification
    ->
completion or blocker
~~~

than to a pure chatbot. It is not yet this stronger model:

~~~text
user objective
    ->
task compiler
    ->
executable acceptance contract
    ->
repository intelligence graph
    ->
bounded task DAG
    ->
micro-context worker decision
    ->
typed observation
    ->
evidence ledger
    ->
objective verifier
    ->
repair/replan
    ->
proof-carrying completion
~~~

The missing distinction is not the existence of classes named task graph, verifier, memory, or capability probe. The distinction is whether each subsystem is authoritative in the active runtime path and whether its output drives the next valid transition.

## Actual runtime architecture

### Production entry and turn path

The current source-level path is:

~~~text
src/index.ts:14 main
    ->
src/tui/launch.tsx:11 launch / OpenTUI
    ->
src/tui/app.tsx:1032 runTask
    ->
src/tui/app.tsx:1119-1125 resolve turn mode
    ->
src/tui/app.tsx:1131-1185 routing context, project commands,
                 verification policy and progressive targets
    ->
src/tui/app.tsx:1217-1227 scope/context gate
    ->
src/tui/app.tsx:1291-1354 route strategy and selection
    ->
src/tui/app.tsx:1400 runSelectedAgent
    ->
src/tui/app.tsx:1440 active context
    ->
src/tui/app.tsx:1491-1515 generic criteria and verification policy
    ->
agent runtime / loop
    ->
provider adapter and stream normalizer
    ->
tool envelope / tool registry
    ->
workspace tools
    ->
task state, plan projection, verification and completion
    ->
TUI presentation adapter
~~~

The source is VERIFIED_LOCAL. The exact UI event ordering of the user screenshot is USER-SUPPLIED/UNPROVEN because the screenshot event trace was not available in the checkout.

### Authority map

| Stage | Current source | Responsibility | Input | Output | Authority | Controller or model |
|---|---|---|---|---|---|---|
| Entry | src/index.ts:14 | Start application | process args | TUI/command runtime | Authoritative | Controller |
| TUI launch | src/tui/launch.tsx:11 | Start terminal UI | runtime options | app instance | Authoritative | Controller |
| Task submission | src/tui/app.tsx:1032 | Start a task run | user text, workspace | run state | Authoritative | Controller |
| Turn classification | src/agent/turn-policy.ts:173-200 | Choose conversation/knowledge/coding mode | user text, analysis | TurnMode | Authoritative for tools | Controller with model-independent heuristics |
| Task analysis | src/router/task-analysis.ts:41-223 | Classify task/complexity | user text | TaskAnalysis | Partially authoritative | Controller |
| Repository context | src/context/repository.ts:35-540 | Discover and rank evidence | workspace, objective | RepositoryContext | Authoritative for supplied context | Controller |
| Route selection | src/router/router.ts:32-474 | Filter/rank eligible providers | task, policy, capability | RouteDecision | Authoritative | Controller |
| Prompt construction | loop/app/context modules | Assemble messages and tool definitions | task/context/provider | request | Partially authoritative | Controller |
| Provider request | src/providers/openai-compatible.ts:245-518 | Stream model events | messages/tools | normalized stream | Adapter authoritative | Provider plus controller |
| Tool normalization | src/providers/stream-normalizer.ts:62-150 | Quarantine/normalize text/tool fragments | provider stream | normalized event | Authoritative adapter | Controller |
| Tool admission | src/providers/tool-envelope.ts:4-21 | Bound calls per response | model tool calls | accepted/rejected envelope | Authoritative | Controller |
| Tool execution | src/tools/workspace.ts and registry | Read/edit/shell/test/Git actions | typed args | ToolResult | Authoritative at executor | Controller |
| Loop | src/agent/loop.ts | Iterate model/action/observation | task, provider, tools | events/state | Authoritative lifecycle | Controller with model decisions |
| Plan projection | src/agent/loop.ts:836-852 | Derive plan activity from paths | changed/active paths | plan status | Partial | Controller |
| Task graph | src/agent/task-graph.ts:80-225 | Build and mutate graph data | task inputs/status | TaskGraph | Partial | Controller data, not full scheduler |
| Verification | src/agent/verifier.ts; objective-review.ts | Check ledger/structure | task state, artifacts | verification result | Partial | Controller |
| Completion | src/agent/loop.ts:1629-1838 | Decide done/blocked | criteria, blockers, verification | complete/blocked | Authoritative but too generic | Controller |
| Presentation | src/tui/presentation/adapter.ts:531-537 | Render test counts/events | normalized events | TUI rows | UI-only projection | Controller-fed |

### Provider and runtime path

Current runtime discovery is present in src/runtimes/discovery.ts:2-50 for Ollama, generic local OpenAI-compatible endpoints, LM Studio and a llama.cpp server adapter. This is provider/runtime discovery, not a complete ShelraCode-owned native runtime product.

No current source evidence establishes a managed ShelraCode runtime manager that:

- downloads pinned runtime binaries;
- verifies runtime artifacts;
- owns a model catalog;
- downloads/imports GGUF artifacts;
- estimates model plus KV-cache memory;
- launches and restarts a managed loopback sidecar;
- runs a capability probe for every model/runtime/quantization/template combination;
- persists a complete installed-model lifecycle.

The native-local-provider conclusion is therefore:

- external local providers: PRESENT;
- adapter/discovery path: PRESENT/PARTIAL;
- ShelraCode-native inference product: ABSENT/UNPROVEN;
- managed llama-server sidecar: RECOMMENDED future direction, not current capability.

## Clock-website failure

### Requested objective

The relevant objective was approximately:

~~~text
Create a website that shows the current time using HTML, CSS and JavaScript.
~~~

A trustworthy system should compile this into at least:

- a browser entry artifact;
- HTML structure;
- CSS styling, inline or linked;
- JavaScript logic, inline or linked;
- current-time derivation;
- visible rendering;
- ongoing update behavior;
- valid local references;
- syntax/static validation;
- browser smoke verification when browser tooling is available;
- final diff-scope review.

### Current causal chain

The following is VERIFIED_LOCAL mechanism evidence plus a current disposable mechanism reproduction. It is not a claim that the exact live 14B screenshot was re-run.

1. src/router/task-analysis.ts:41 starts task analysis.
2. The default task class is EXPLAIN at :61.
3. Generic Spanish create language is not a broad create/edit trigger in the main mutation branch. The create-related branch at :108-122 is specific to test generation. The generic mutation vocabulary at :123-142 includes edit/change/update and Spanish verbs such as cambia, actualiza, renombra, implementa and modifica, but not generic crea.
4. src/agent/turn-policy.ts:173-200 still identifies mutation intent and can resolve the request to coding mode. Thus weak task analysis does not necessarily prevent write access, but it loses objective richness and complexity signals.
5. src/agent/progressive-plan.ts:85-135 infers targets. For greenfield web creation, :144-155 defaults preparation targets to index.html when no explicit path is present.
6. src/agent/types.ts:27-64 represents an AgentTask with objective, mode, optional string successCriteria, constraints, context, verification and staged paths. It does not represent a rich deliverable/acceptance contract.
7. src/agent/task-graph.ts:6-34 accepts objective, mode, candidate files, verification commands and constraints. It does not require an explicit deliverable list or per-node proof contract.
8. The model can create index.html successfully.
9. CSS, JavaScript, current Date logic, update behavior and browser behavior are not guaranteed by the host contract in this path.
10. src/agent/verification-criteria.ts:18-30 treats unavailable verification as unsatisfied. Its structural criteria at :53-76 and unavailable issue handling at :97-132 are generic rather than web-objective-specific. The recommended next action can be to rerun configured verification even when there is no applicable command.
11. No project test command means the verification policy can become unavailable.
12. src/agent/loop.ts:1629-1688 computes completion conditions; :1753-1838 adds blockers, marks failed/blocked state and emits task.blocked.
13. There is no current CompletionFailure contract that turns the missing criterion into a repair node/replan before stopping.
14. src/tui/presentation/adapter.ts:531-537 defaults displayed test counts to passed 0/failed 0 when no parseable test count exists. Therefore a UI row such as Tests — 0 passed is not evidence that a test suite actually ran.
15. A current disposable scripted-provider reproduction reached a successful CreateFile action in four turns, but ended with verified=false and blocked state because test/verification evidence was unavailable; the plan target remained active and no CSS/JS recovery node was created. This is VERIFIED_LOCAL mechanism reproduction, not live-model evidence.

### Attribution

| Failure symptom | Primary attribution | Contribution | Confidence |
|---|---|---|---|
| Generic request loses richness | Task compiler/harness | Model semantics | HIGH |
| Only index.html treated as preparation scope | Progressive target compiler | User did not specify file names | HIGH |
| CSS/JS/behavior not guaranteed | Task contract absent | Model may under-implement | HIGH |
| 0 tests displayed | UI fallback/verification semantics | No project tests | HIGH |
| Unavailable verification blocks | Completion/verification policy | None or weak model | HIGH |
| Plan remains stale | Plan projection and graph/UI split | Timing/model actions | HIGH |
| No recovery action | Completion controller | Model cannot invent host node | HIGH |
| Exact screenshot ordering | Runtime | Screenshot trace unavailable | LOW/UNPROVEN |

### What a frontier model would and would not fix

A frontier coding model could plausibly infer that HTML, CSS and JavaScript are separate deliverables, create more complete files, and recognize that a static page needs browser or artifact checks. It could not, by model intelligence alone, make:

- unavailable verification count as applicable evidence;
- the completion gate create a repair node;
- a stale plan projection synchronize itself;
- a TUI fallback distinguish no tests from zero passed tests;
- the provider/runtime enforce a capability contract;
- the executor supply OS-level isolation.

With a frontier model and the current harness, the same defects remain latent and will surface on documentation, config, browser, no-test, failed-test, and long-horizon tasks.

## Task compiler

### What exists

Current task analysis provides:

- task class;
- rough complexity;
- read/write/command intent;
- possible route capability requirements;
- progressive target inference;
- generic criteria and verification policy;
- an initial task graph data structure.

This is useful orchestration scaffolding. It is not yet an authoritative TaskContract.

### What is missing

The current production path does not prove a durable structured contract containing all of:

~~~text
objective
mode
deliverables
constraints
acceptance criteria
verification requirements
affected scope
prohibited actions
risk
required evidence
node dependencies
repair policy
~~~

A simple TaskAnalysis enum, UI plan text, or model-generated prose does not satisfy that requirement because it cannot independently decide whether a deliverable was achieved.

### Target contract for the clock task

A suitable compiled contract would be conceptually:

~~~yaml
objective: browser page displaying the current local time
mode: coding_task
deliverables:
  - browser entry document
  - styling inline or in a linked stylesheet
  - JavaScript clock logic inline or in a linked script
acceptance:
  - entry document exists
  - requested HTML/CSS/JavaScript elements are present
  - local references resolve
  - time derives from the browser runtime clock
  - display updates after initial render
  - syntax/static checks pass
  - no unrelated files changed
verification:
  - artifact and reference inspection
  - HTML/JavaScript parse or static checks
  - browser smoke when available
  - final diff review
tests:
  status: not_applicable unless project tests exist
~~~

This is a design recommendation, not current implementation evidence.

## Repository intelligence

### Current implementation

src/context/repository.ts:35-75 uses Git and ripgrep-oriented discovery. :78-123 provides a fallback walk. :327-344 applies fixed priority and objective-term ranking. :376-540 builds context with:

- repository facts;
- candidate files;
- lexical matches;
- file snippets;
- redaction;
- character limits;
- search-backend status;
- evidence state.

The evidence state at :469-481 can become sufficient when relevant matches, direct facts or explicit evidence exist. This is a meaningful context gate, but it is not a complete semantic repository intelligence layer.

### Present/partial/absent matrix

| Capability | Status | Current evidence |
|---|---|---|
| Git snapshot | PRESENT | src/context/repository.ts |
| Manifest detection | PRESENT/PARTIAL | repository facts and project commands |
| Language/framework detection | PRESENT/PARTIAL | lexical/path/project facts |
| File index | PRESENT | discovered candidate files |
| Lexical search | PRESENT | ripgrep/fallback |
| Fixed relevance ranking | PRESENT | src/context/repository.ts:327-344 |
| Search-backend degradation state | PRESENT | context evidence status |
| Token/character budget | PRESENT | context-budget.ts |
| AST symbol index | UNPROVEN | no productive active path established |
| Import graph | UNPROVEN | no productive active path established |
| Reference/call graph | UNPROVEN | no productive active path established |
| LSP definitions/references | UNPROVEN | no productive active path established |
| Test relationship index | PARTIAL | project commands and file heuristics |
| Semantic reranking | UNPROVEN | no current productive evidence |
| Model-guided iterative retrieval | PARTIAL | loop can request more context, but not proven as graph retrieval |
| Task-specific evidence ledger | PARTIAL | context evidence exists, not full task proof |

### Suitability for small models

Raw file search imposes too much uncertainty on a 1.5B model. The controller should expose compact answers such as:

~~~text
FindDefinition(refreshSession)
    exact symbol
    file and range
    callers
    related tests
    confidence
~~~

instead of requiring:

~~~text
SearchText
    many matches
    speculative reads
    wrong path recovery
    model-created dependency graph
~~~

Current ShelraCode has the foundation for bounded lexical retrieval but not verified production equivalents of FindDefinition, FindReferences, ReadSymbol, FindRelatedTests, InspectFailure, ValidateChangedFile and VerifyCriterion.

This is HIGH confidence as a source-level gap and MEDIUM confidence as a predicted performance bottleneck, because no current model comparison isolates semantic-tool impact.

## Context architecture

### Current request composition

The current system can combine:

- system and agent instructions;
- project instructions;
- task objective;
- repository facts;
- ranked files and snippets;
- search matches;
- memory;
- tool schemas;
- prior conversation/tool events;
- verification state.

src/agent/context-budget.ts:13-45 applies model-size-aware character budgets:

- up to approximately 2B: 10,000 characters;
- up to approximately 4B: 14,000;
- up to approximately 8B: 20,000;
- above 8B: 28,000;
- further constrained by provider limits.

This is a positive design decision. It still does not amount to a fully compiled TaskCapsule because the transcript, generic tools and criteria can remain broader than the current decision requires.

### Context should be compiled per decision

The target small-model form is:

~~~text
TaskCapsule
    objective
    current node
    only relevant project rules
    relevant files/ranges
    current evidence
    last failure
    allowed tools
    exact verification target
    next valid state transitions
~~~

The controller should preserve full history for audit/debug but send only state relevant to the next decision.

### Compaction and memory

src/agent/compaction.ts:39-75 creates structured state summaries. :77-136 preserves state/system/anchor/recent material. This is PARTIAL/PRESENT at the mechanism level.

src/shared/memory.ts:11-29 stores facts with provenance/freshness. :58-93 selects relevant memories, with a bounded default. :130-157 compacts task episodes and excludes raw transcript/shell/prose. This is a strong foundation.

What remains UNPROVEN is a live 100-step task that crosses compaction, resumes after restart, preserves task criteria and avoids reintroducing stale/irrelevant memory. Current docs explicitly list long-horizon/resume proof as open.

## Agent loop

### What is present

src/agent/loop.ts contains a genuine iterative runtime rather than a single model call. The loop:

1. builds a request;
2. receives normalized text/tool events;
3. validates tool calls;
4. executes tools;
5. records tool results;
6. applies progress and failure accounting;
7. requests another model turn;
8. performs verification/completion logic.

The source also contains explicit recovery instructions at :648-675. Coding-mode instructions tell the model to use one tool per turn or choose the next action after observing the result. This is an important correction from the older uncontrolled-batch behavior.

src/agent/loop.ts:1046-1070 tracks maximum turns/output and no-progress limits. :1120-1155 can force recovery. :2038-2085 rejects a response with more than eight tool calls before execution and allows one bounded recovery attempt.

### Action boundaries

src/providers/tool-envelope.ts:4-21 defines MAX_TOOL_CALLS_PER_RESPONSE = 8 and returns a typed TOOL_BATCH_TOO_LARGE result. This proves that the current runtime no longer permits an unlimited 93-call response in the active envelope path.

The remaining design gap is semantic, not just numeric:

- a batch of eight independent reads may be acceptable;
- a batch containing dependent reads, mutations, tests, and speculative paths is not;
- the source should distinguish read-only independent batches from mutation batches;
- a mutation should be serialized and observed before a dependent next decision;
- the watchdog should prevent a large harmful batch before execution, not only recover afterward.

The current code provides meaningful protection, but a formal action-cycle policy is only PARTIAL.

### Current loop versus target loop

~~~text
CURRENT
model response
    ->
tool envelope validation
    ->
bounded tool execution
    ->
tool results
    ->
loop/progress/recovery
    ->
next model turn
    ->
generic verification/completion

TARGET
task node
    ->
TaskCapsule
    ->
one bounded semantic decision
    ->
policy/schema gate
    ->
one logical mutation or small independent read batch
    ->
typed observation
    ->
evidence ledger
    ->
node verifier
    ->
pass / repair / replan / escalate
~~~

The current loop is real. The target loop moves node truth and evidence authority outside model prose.

### Loop limitations

Current source does not prove all of the following:

- a formal per-node action budget;
- mutation batch size exactly one at every executor boundary;
- all dependent actions wait for semantic observation;
- a repair node is created for every verification failure;
- a graph scheduler always selects the next ready node;
- a fresh verifier runs before completion;
- a long task survives compaction and restart without losing the contract.

These are P1/P0 boundary gaps, not evidence that no loop exists.

## Tool ACI

### Active production tools

The active workspace tool family includes:

| Tool | Purpose | Current status |
|---|---|---|
| ReadFile | Read bounded file content | PRESENT |
| WriteFile | Write an existing file | PRESENT |
| CreateFile | Create a new file | PRESENT |
| EditFile / patch path | Apply an edit | PRESENT |
| DeleteFile | Delete a file subject to policy | PRESENT |
| GlobFiles | Find paths by pattern | PRESENT |
| ListFiles | List directory entries | PRESENT |
| SearchText | Lexical repository search | PRESENT |
| Shell | Run command subject to policy | PRESENT |
| RunTests | Run project tests subject to policy | PRESENT |
| GitStatus | Read Git status | PRESENT |
| GitDiff | Read diff | PRESENT |

src/tools/types.ts:7-83 provides risk classification, typed result shape, recoverability and hints. src/tools/errors.ts:2-22 provides normalized error codes. src/tools/workspace.ts contains command/file/test implementations. src/tools/permissions.ts:8-98 provides path and operation policy.

### Strengths

- file and directory mismatches are represented distinctly;
- output can be truncated with an explicit result;
- commands are subject to network/destructive checks;
- workspace boundaries are checked;
- tool errors are normalized before returning to the model;
- commands and tests use a common process policy;
- command output has a 50K bound;
- cancellation is represented.

### Weak-model usability gaps

Generic primitives still make the model reconstruct semantic operations manually. Current productive evidence does not establish first-class tools equivalent to:

~~~text
InspectProject
FindDefinition
FindReferences
FindImplementations
ReadSymbol
ReadRelevantRange
FindRelatedTests
InspectFailure
ValidateChangedFile
RunRelevantTests
VerifyCriterion
ReviewDiff
~~~

This matters because a small model must otherwise decide:

- which of many lexical matches matters;
- whether a path is a file or directory;
- which callers need updating;
- which test is related;
- whether an edit is syntactically safe;
- whether an artifact satisfies a user-level deliverable.

The controller should add semantic tools only where evals demonstrate value. The architectural requirement is that the interface be easier than raw shell composition.

### Tool contract verdict

| Dimension | Verdict |
|---|---|
| Typed inputs | PRESENT |
| Safe path validation | PRESENT |
| Workspace boundary | PRESENT |
| Output bounds | PRESENT |
| Cancellation | PRESENT/PARTIAL |
| Shared command policy | PRESENT |
| Explicit network error code | PARTIAL |
| Recovery hint | PRESENT/PARTIAL |
| Semantic repository primitives | UNPROVEN/ABSENT |
| Per-model tool subsets | PARTIAL |
| Executor-level mutation serialization | PARTIAL |
| Provider-neutral normalized events | PRESENT |

## Error taxonomy and recovery

### Current normalized errors

src/tools/errors.ts currently includes:

~~~text
INVALID_ARGUMENT
NOT_FOUND
PATH_NOT_FOUND
PATH_EXISTS
PATH_IS_FILE
PATH_IS_DIRECTORY
OUTSIDE_WORKSPACE
PERMISSION_DENIED
BINARY_FILE
OUTPUT_TRUNCATED
COMMAND_FAILED
COMMAND_TIMEOUT
TEST_FAILED
STALE_EDIT
CONFLICT
RUNTIME_UNAVAILABLE
MODEL_ERROR
TOOL_BATCH_TOO_LARGE
INSUFFICIENT_CONTEXT
CANCELLED
~~~

This is a solid base. It does not map one-for-one to the desired taxonomy:

| Desired condition | Current mapping | Assessment |
|---|---|---|
| INVALID_ARGUMENT | INVALID_ARGUMENT | PRESENT |
| PATH_NOT_FOUND | PATH_NOT_FOUND | PRESENT |
| PATH_IS_FILE | PATH_IS_FILE | PRESENT |
| PATH_IS_DIRECTORY | PATH_IS_DIRECTORY | PRESENT |
| OUTSIDE_WORKSPACE | OUTSIDE_WORKSPACE | PRESENT |
| PERMISSION_DENIED | PERMISSION_DENIED | PRESENT |
| NETWORK_DENIED | NETWORK_DISABLED / process-policy error | PARTIAL |
| COMMAND_FAILED | COMMAND_FAILED | PRESENT |
| COMMAND_TIMEOUT | COMMAND_TIMEOUT | PRESENT |
| TEST_FAILED | TEST_FAILED | PRESENT |
| OUTPUT_TRUNCATED | OUTPUT_TRUNCATED | PRESENT |
| PATCH_CONFLICT | STALE_EDIT / CONFLICT | PARTIAL |
| MODEL_PROTOCOL_ERROR | MODEL_ERROR | PARTIAL |
| CONTEXT_OVERFLOW | no distinct current code proven | ABSENT/UNPROVEN |
| CANCELLED | CANCELLED | PRESENT |

### Recovery behavior

src/agent/loop.ts:648-675 supplies an error recovery instruction. The loop tracks identical actions and no-progress states. It can force a recovery turn and stop repeated behavior.

src/agent/loop.ts:1046-1070 and :1120-1155 provide bounded loop recovery. src/agent/loop.ts:2038-2085 rejects overlarge tool batches. src/router/route-fallback.ts:12-65 keeps tool/harness failures current rather than blindly treating them as provider failures; eligible provider failures may retry.

This means recovery is not absent. It is PARTIAL because recovery is still primarily another model turn over an error result, rather than a typed controller-owned recovery matrix that creates an explicit task action.

### Required recovery matrix

The desired behavior is:

~~~text
ACT
  ->
OBSERVE
  ->
CLASSIFY
  ->
RECOVER / REPLAN / ESCALATE / STOP
~~~

Current status by condition:

| Condition | Current behavior | Verdict |
|---|---|---|
| Invalid argument | Normalized error and recovery instruction | Partially self-correcting |
| File/directory mismatch | Typed result | Self-correcting if model follows hint |
| Missing path | Typed error/search may be attempted | Partial; repeated-guess prevention exists |
| Search backend unavailable | Context carries degraded/search status | Partial; sufficient-context semantics need more proof |
| Shell command failure | stderr/command result returned | Partial |
| Test failure | TEST_FAILED result and loop can continue | Present at loop level |
| Malformed tool call | Provider normalizer/envelope recovery | Present/partial |
| Provider disconnect | Provider error/fallback path | Partial |
| Context overflow | No distinct current taxonomy proven | Weak |
| Verification failure | Blocker/failed state | Terminal too often |
| Repeated identical error | Loop limits/stopping | Present, but replan contract missing |

The critical problem is not raw error handling. It is that a failed completion state does not reliably become new executable work.

## Planning and scheduler

### Current task graph

src/agent/task-graph.ts:6-34 defines TaskNode, TaskGraph and TaskGraphInput. The input includes objective, mode, candidate files, verification commands and constraints.

src/agent/task-graph.ts:80-211 compiles graphs with discover/analyze/mutate/verify/review/answer-style nodes. This is useful structured state.

src/agent/task-graph.ts:214-225 exposes setTaskNodeStatus. The implementation finds a node, mutates status/current node and returns the graph. It does not establish a complete scheduler with:

- enforced dependency validation;
- legal transition table;
- per-node evidence requirements;
- retry budgets;
- repair-node creation;
- blocker propagation;
- verified-node immutability;
- automatic next-ready selection;
- independent verifier ownership.

### UI plan projection

src/agent/loop.ts:836-852 syncs target-plan status from changed/active paths. src/agent/types.ts:104-108 comments that plan statuses are currently represented as an initial snapshot in the event model rather than a guaranteed transition stream.

This explains how the graph/action state can advance while the visible plan remains stale, or how the visible plan can show a step as active despite a tool having created a relevant artifact. The exact screenshot sequence is UNPROVEN, but the source-level authority split is VERIFIED_LOCAL.

### Plan verdict

Current plan is:

- structured data: PRESENT;
- UI projection: PRESENT;
- executable dependency graph: PARTIAL;
- evidence-driven node completion: PARTIAL;
- autonomous repair scheduler: ABSENT/UNPROVEN;
- fresh worker orchestration: ABSENT/UNPROVEN.

It is not merely decorative, but it is not yet a complete scheduler.

## Verification

### Current verification layers

src/agent/verifier.ts:36-146 provides deterministic verification over task ledger/state. src/agent/objective-review.ts:183-337 provides structural semantic adjacency review. src/agent/verification-criteria.ts provides criteria evaluation and verification-policy handling.

Current project-oriented verification can involve:

- configured tests;
- typecheck;
- lint/build/project commands;
- changed-file checks;
- Git/diff state;
- task ledger criteria.

These mechanisms are useful for repository code. They do not prove that every natural-language deliverable has an applicable validator.

### Project verification versus objective verification

| Verification type | Current status |
|---|---|
| Test command execution | PRESENT when configured |
| Typecheck/lint/build selection | PRESENT/PARTIAL |
| Diff review | PRESENT/PARTIAL |
| Changed-file structural review | PRESENT |
| Generic criteria ledger | PRESENT |
| Objective-specific artifact checks | PARTIAL |
| Browser behavior verification | UNPROVEN |
| Per-criterion proof object | PARTIAL |
| No-tests applicability semantics | DEFECTIVE in clock path |
| Fresh independent semantic verifier | UNPROVEN |

A task with no tests must not be forced through a test-only gate. “No tests present” and “tests executed with zero passes” are different states.

### Clock verification that should have been selected

For the clock objective, a valid verifier should check:

1. entry HTML exists;
2. HTML is parseable;
3. CSS is inline or a resolvable local stylesheet;
4. JavaScript is inline or a resolvable local script;
5. the page has visible time output;
6. JavaScript obtains time from Date or an equivalent browser time source;
7. update behavior is observable through a timer or browser interaction;
8. syntax/static checks pass;
9. browser smoke passes when browser tooling is available;
10. the final diff is within user scope.

Current source does not prove these checks are generated from the objective. This is the central missing contract.

### Verification verdict

ShelraCode has a verification subsystem. It does not yet have a general objective verifier that can decide what “done” means for a no-test greenfield artifact.

## Completion and repair

### Current completion path

src/agent/loop.ts:1629-1688 computes completion state. src/agent/loop.ts:1753-1838 finalizes runs, adds blockers, marks verification/review failure where required, transitions the ledger and emits task.blocked.

src/agent/verification-criteria.ts:18-30 treats unavailable verification as unsatisfied. :97-132 records unavailable verification as an issue and recommends configured verification rather than constructing an objective-specific alternative.

This creates a false-failure mode:

~~~text
valid artifact mutation
    ->
no applicable project test command
    ->
verification unavailable
    ->
criterion false
    ->
completion blocked
    ->
no recovery contract
    ->
task stops
~~~

The current system is more resistant to false success than its historical predecessor, but it is still vulnerable to false failure and dead-end blocking.

### Completion truth requirements

A trustworthy completion gate should require proof objects for:

~~~text
objectiveSatisfied
deliverablesSatisfied
requiredVerificationPerformed
verificationPassed
unresolvedBlockers == 0
userChangesPreserved
~~~

The current source has pieces of these checks but not one complete objective-specific proof contract.

### Required repair semantics

The target behavior is:

~~~text
verification fails
    ->
classify missing evidence
    ->
create RecoveryContract
    ->
add repair or evidence-acquisition node
    ->
scheduler selects node
    ->
worker receives a fresh TaskCapsule
    ->
verify again
~~~

Current behavior can stop at “Completion blocked”. That is a P0 autonomy defect because a controller that detects incomplete work but cannot drive the next valid action is a guardrail, not a self-correcting coding agent.

## Model capability system

### Current capability probe

src/agent/capability-probe.ts:51 identifies probe version 14. The probe exercises some combination of:

- no-tool conversational response;
- read tools;
- continuation after tool output;
- edit/test behavior;
- recovery;
- structured tool behavior.

src/agent/capability-probe.ts:814-865 classifies results. :911-916 records exact identity. :999-1015 represents failed probes.

src/agent/capability-cache.ts:7-86 keys capability by exact model/runtime/hardware identity. This is stronger than trusting a model-card label or parameter count.

### Capability dimension gaps

The current source does not prove a complete matrix for every model/runtime/quantization/chat-template/context combination covering:

- valid tool arguments;
- multi-turn dependent actions;
- path-error recovery;
- test-failure repair;
- multi-file edits;
- long-horizon loop resistance;
- compaction recovery;
- objective-specific verification;
- truthful completion discipline.

The probe system is PRESENT/PARTIAL; the full agent capability contract is UNPROVEN.

### Ineligible model admission

src/router/router.ts:32-81 implements capability admission and :237-474 performs privacy/cost/capability/tool/context/health/quota scoring. The intended design is hard eligibility before preference scoring.

src/tui/app.tsx:1226-1227 consults coding capability and the discovery/progressive flow can allow read-only work when a model is chat-only and scope is non-empty. This is a good boundary.

The unresolved question is whether every write-capable route, including all fallback and progressive paths, is hard-blocked by the exact empirical capability profile. The source indicates strong gating; an exhaustive live matrix is UNPROVEN.

## Routing

### Current routing strengths

- privacy policy precedes quality scoring;
- strict-zero/cost policy exists;
- provider capabilities are considered;
- local/cloud route distinctions exist;
- route explanations and fallback reasons are represented;
- chat-only discovery can be limited to read-only scope;
- provider/harness failures are not automatically misclassified as provider failures.

### Current routing limitations

Routing cannot compensate for missing task semantics. A model may be eligible for coding while receiving:

- incomplete deliverables;
- generic verification;
- oversized or low-density context;
- raw tool primitives;
- stale plan state.

A hard model gate is necessary but not sufficient.

The correct ordering is:

~~~text
privacy and cost policy
    ->
task capability requirement
    ->
empirical model/runtime/template eligibility
    ->
tool subset and context profile
    ->
latency/cost/local preference score
~~~

The source largely follows this principle, but current live evidence does not establish all fallback and progressive routes under every policy.

## Small-model viability

### Core principle

The model should be treated as a probabilistic worker inside a deterministic software-engineering control plane.

The controller should own:

~~~text
task lifecycle
objective and acceptance state
repository indexing
context budget
tool validation
permissions
error typing
retry limits
progress tracking
verification selection
completion truth
memory persistence
escalation policy
~~~

The model should primarily own:

~~~text
semantic interpretation
local hypothesis generation
bounded action selection
small patch generation
failure interpretation
explanation of findings
~~~

This separation is supported by current agent-harness documentation and by primary research on agent-computer interfaces, retrieval and constrained software repair. It is an INFERENCE about ShelraCode design, not a claim that a generic small model can solve arbitrary software engineering.

### Tier analysis

| Model tier | Realistic role with current harness | Realistic role with excellent harness | Important limits |
|---|---|---|---|
| 1.5B–2B | General chat, limited read routing, tiny transformations; coding autonomy not proven | Intent classification, retrieval queries, structured tool arguments, one-file micro-edits, deterministic verification assistance | Weak ambiguity handling, multi-file planning, long horizon and semantic debugging |
| 3B–4B | Bounded reads and small edits depending on exact runtime | Explore worker, constrained one- or two-file repair, simple test iteration | Variable tool adherence and broad architecture reasoning |
| 7B–9B | Scoped coding worker; historical 7B evidence safely blocks complex tasks | Main worker for bounded multi-file nodes, test-fix-test loops, local debugging | Still needs strong context, verification and recovery |
| 12B–14B | Stronger local worker; historical 14B fixture success exists | Moderate multi-file implementation, debugging, semantic review with controller limits | Not a guarantee of frontier performance; long tasks still controller-owned |
| Frontier/cloud optional | Better semantic planning and ambiguity handling | Larger nodes and harder diagnosis | Must respect privacy, cost and strict-local policy; never an implicit paid fallback |

These are engineering roles, not universal parameter thresholds. Capability probes must outrank model names and parameter count.

### What deterministic infrastructure can amplify

High-value work to move out of a small model:

- discover manifests, language and framework;
- index paths, symbols, imports and tests;
- identify related files;
- compile deliverables and acceptance criteria;
- select a ready task node;
- constrain tools and arguments;
- reject invalid paths and unsafe commands;
- run focused checks;
- classify errors;
- count progress and repeated failures;
- verify artifacts;
- preserve user changes;
- decide whether a completion proof is sufficient.

The strongest amplification comes from reducing each model decision to a small, observable contract. It does not create missing semantic knowledge; it prevents the model from spending capacity on deterministic logistics.

### Training direction

Research supports training for structured agent action rather than generic verbose reasoning:

- APIGen demonstrates executable verification for function-call data.
- Salesforce xLAM publishes small action-oriented models.
- ActionStudio standardizes heterogeneous agent trajectories.
- agent-distillation work reports gains from retrieval/code-tool trajectories at small scales.
- SWE-Protégé reports a post-trained 7B agent using sparse expert consultation and anti-loop behavior.
- SWE-Dev and related work show the value of software-engineering trajectories and realistic tasks.

These papers support capability amplification. They do not establish universal 1.5B SWE-bench parity.

## Memory and compaction

### Required separation

| State | Content | Lifetime | Default model exposure |
|---|---|---|---|
| Working context | Current files, tool result and decision | One decision | Yes |
| Task state | Contract, nodes, criteria, blockers | Task | Compact |
| Evidence ledger | Verifier outputs, hashes, commands and timestamps | Task/audit | Relevant proof only |
| Project memory | Stable conventions and commands | Persistent | Selected |
| Episodic memory | Reusable solution/failure patterns | Persistent/selective | Selected |
| Repository index | Symbols, paths, relationships | Persistent/rebuilt | Query results |
| Raw transcript | Debug/replay record | Persistent/optional | No by default |

### Current implementation

src/shared/memory.ts:11-29 contains provenance/freshness-aware facts. :58-93 selects relevant memories with a bounded default. :130-157 compacts task episodes without retaining all raw shell output and assistant prose.

src/agent/compaction.ts:39-75 and :77-136 provide structured state compaction that preserves current state, system material, anchors and recent events.

This is a meaningful foundation. The gap is proof over a real long-running task: the checkout documentation says long-horizon, resume and model-size matrices remain open. No current live 100-step compaction/resume result was produced in this audit.

### Required compaction schema

A robust digest should retain:

~~~yaml
objective:
acceptance_criteria:
constraints:
completed_nodes:
active_node:
failed_attempts:
do_not_repeat:
important_files:
changed_files:
project_facts:
diagnostics:
test_results:
verification_evidence:
current_hypothesis:
open_blockers:
next_required_action:
~~~

It should discard or summarize:

- duplicate searches;
- obsolete shell output;
- completed child transcripts;
- stale hypotheses;
- irrelevant skill bodies;
- raw model prose.

Persistent memory needs scope, provenance, freshness, confidence and invalidation. Incorrect durable memory is worse than forgetting.

## Skills

Skills are present as a project mechanism, but their existence is not evidence of agent autonomy. Skills should provide specialized procedures on demand, not replace:

- task compilation;
- repository indexing;
- task state;
- verification;
- completion;
- core loop behavior.

Current source and project status support a lazy/selective-memory direction, but a productive skill activation path for the clock or complex coding task is not demonstrated.

Current public Claude Code and OpenCode documentation treats skills as specialized, loadable context rather than a reason to inject every procedure into every prompt. Recent SWE-Skills-Bench work reports that many generic skills do not improve pass rates and may conflict with repository/version context. This is PAPER/EXTERNAL evidence and should be replicated before making skills a major optimization target.

Verdict:

- skill discovery/configuration: PRESENT;
- relevant skill loading: PARTIAL;
- skill version/compatibility proof: UNPROVEN;
- skills as repository intelligence: NO;
- skills as completion/recovery: NO.

## Subagents

### Current state

Current project status identifies Explore/Build/Verify subagents and worktree isolation as not yet proven as a productive production path. Configuration or names alone are not runtime evidence.

A production subagent must prove:

- parent invocation;
- fresh child context;
- restricted tool subset;
- model policy;
- permissions;
- task ownership;
- cancellation;
- structured result contract;
- return to parent scheduler;
- isolated writes/worktree where required.

No complete current Explore → Build → Verify trace with fresh context and structured result was established.

### Recommended use

Start with functional isolation:

~~~text
Explore
  read-only, returns EvidenceBundle

Build
  scoped mutation, returns ChangeBundle

Diagnose
  evidence/failure analysis, no silent edits

Verify
  read/execute only, returns VerificationBundle

Review
  diff/constraint review, no edits
~~~

Do not create a multi-agent society before the single-worker kernel has proof-carrying completion. Coordination overhead can exceed the capability gain for small models.

## Git, permissions, sandbox and privacy

### Git/user changes

The product has Git status/diff/checkpoint mechanisms and the audit preserved the user worktree. The tracked index.html was restored exactly after a disposable reproduction side effect, leaving no net code change. The final status check is required below.

A checkpoint is not the same as a complete sandbox. It can help undo file edits; it cannot reverse external network, package registry, process or database side effects.

### Permissions

src/agent/turn-policy.ts:202-273 assigns tools by mode. Plan/read-only policies and coding policies are represented. src/tools/permissions.ts:8-98 checks path, destructive and write conditions. src/shared/process-policy.ts:1-22 checks command/network patterns.

Current RunTests at src/tools/workspace.ts:1527-1602 and Shell at :1327-1405 both pass through command/network policy. The prior RunTests bypass finding is HISTORICAL and was not reproduced in the current source.

The remaining architectural requirement is central enforcement at the lowest executor boundary for every future command wrapper, package manager, build, subagent and test tool. A wrapper-specific check can drift.

### Policy versus OS-level sandbox

Current ShelraCode has policy-level restrictions:

- command classification;
- network command filtering;
- destructive/path checks;
- workspace boundary checks;
- permission modes;
- process cancellation.

This is not proven OS-level isolation. A regex/process policy can reject known command strings but does not provide the same boundary as a restricted OS process, container, or sandbox profile. Project status explicitly records no proven complete OS sandbox.

The distinction is important:

~~~text
policy check:
    application inspects requested command/path and rejects patterns

OS sandbox:
    operating system constrains what the child process can access/do
    even if the command is unexpected
~~~

### Privacy and cost

The router includes privacy/cost/strict-zero concepts. The audit found no evidence that an external paid fallback is implicitly allowed in strict local mode. This remains a product invariant that needs full policy E2E coverage whenever providers change.

## Native local-provider readiness

### Current state

Current runtime discovery at src/runtimes/discovery.ts:2-50 supports discovery/adapters for Ollama, generic local OpenAI-compatible endpoints, LM Studio and a llama.cpp server. This is not the same as a ShelraCode-owned native provider.

The following separation is recommended:

~~~text
Provider
    user-facing route and policy

RuntimeBackend
    inference process/API implementation

ModelArtifact
    catalog/downloadable file and metadata

InstalledModel
    local artifact state and integrity

CapabilityProfile
    empirical model + runtime + quantization + template result
~~~

Current evidence:

| Capability | Status |
|---|---|
| LM Studio adapter | PRESENT |
| Ollama adapter/discovery | PRESENT/PARTIAL |
| OpenAI-compatible local adapter | PRESENT |
| llama.cpp server adapter | PRESENT/PARTIAL |
| ShelraCode provider as default new-user product | ABSENT/UNPROVEN |
| Managed runtime lifecycle | ABSENT/UNPROVEN |
| Curated signed model catalog | ABSENT/UNPROVEN |
| GGUF import/download/integrity lifecycle | ABSENT/UNPROVEN |
| Hardware-aware total-memory estimator | ABSENT/UNPROVEN |
| Runtime/model capability probe connection | PARTIAL |
| Strict-local no-network-after-install E2E | UNPROVEN |

### Runtime comparison

| Runtime | Strength | Cost/risk | Audit conclusion |
|---|---|---|---|
| llama.cpp / llama-server sidecar | Broad CPU/Metal/CUDA/HIP/Vulkan ecosystem, OpenAI-compatible serving, streaming/tool support | Child-process lifecycle, artifact pinning and port management | Strongest cross-platform future default |
| Direct llama.cpp bindings | Lower IPC overhead, deep control | Native ABI/FFI crash and packaging complexity | Future optimization |
| MLX-LM | Strong Apple Silicon path | Apple-specific ecosystem | Optional Apple backend |
| MLC LLM | Broad deployment/compiler ambition | Higher integration complexity | Research later |
| ONNX Runtime GenAI | Enterprise runtime ecosystem | GenAI layer documented as preview | Experimental |
| vLLM | High-throughput server/batching | Heavy for low-resource consumer devices | Optional high-end backend |
| Ollama external | Convenient local API/model management | External dependency | Optional adapter |
| LM Studio external | Mature local UX | External installation and dependency | Preserve as optional adapter |

External support:

- llama.cpp official repository and server README document broad backends, prebuilt/runtime serving, streaming and tool/JSON-related server features.
- MLX-LM official repository documents Apple-focused generation/quantization.
- GGUF official Hugging Face documentation documents model metadata/quantization ecosystem.
- Ollama, LM Studio, vLLM, MLC and ONNX Runtime GenAI document their respective serving/runtime paths.

The sidecar recommendation is an INFERENCE: it lets ShelraCode own lifecycle and UX while containing native-runtime crashes behind a stable provider boundary. It is not current implementation.

### Future native-provider acceptance

A future provider should prove in a clean environment with no LM Studio or Ollama:

~~~text
install/start ShelraCode
    ->
hardware profile
    ->
recommended artifact
    ->
download/import GGUF
    ->
checksum/integrity
    ->
managed runtime start
    ->
load model
    ->
stream
    ->
cancel
    ->
unload/reload
    ->
restart and repeat
~~~

A model recommendation must account for weights, KV cache at selected context, runtime overhead, offload and safety margin. File-size fit alone is not agent capability.

## Agent evaluations

### Current evidence

Current tests prove substantial harness invariants:

- 534 pass, 1 skip, 0 fail in the current full suite;
- functional path 26 pass;
- typecheck, smoke and bundle help/version/doctor pass;
- current source includes typed tools, batching limits, recovery limits, routing and verifier tests.

These are important but are not equivalent to end-to-end autonomous coding success.

Historical project evidence includes:

- Qwen 1.5B local workspace-reader route, not coding-worker eligibility;
- Qwen 7B simple edit/test success and complex multi-file safe block;
- Qwen 14B historical disposable simple/complex fixture success, with verification evidence;
- prior test count snapshots now superseded by the fresh 534/1/0 run.

### Required agent-level matrix

| Class | Current status |
|---|---|
| Greeting/no tools | PRESENT |
| Repository language | PRESENT/PARTIAL |
| Symbol lookup | PARTIAL; semantic index not proven |
| Architecture question | PRESENT/PARTIAL |
| Plan-only | PRESENT/PARTIAL |
| Review-only | PRESENT/PARTIAL |
| One-file edit | PRESENT |
| Multi-file edit | HISTORICAL for 14B; current matrix incomplete |
| Test-fix-test | PRESENT/PARTIAL; current live matrix incomplete |
| Invalid argument recovery | PRESENT in unit/integration coverage |
| File/directory recovery | PRESENT/PARTIAL |
| Missing path recovery | PRESENT/PARTIAL |
| Search backend failure | PRESENT/PARTIAL |
| Dirty worktree preservation | PRESENT/PARTIAL |
| Cancellation | PRESENT |
| Weak model blocked | PRESENT/PARTIAL |
| Clock website end to end | Current mechanism reproduction fails/block; deterministic acceptance fixture absent |
| Failed-verification recovery | Critical gap |
| Compaction/resume | UNPROVEN live |
| 50+ action task | UNPROVEN |
| 100+ action task | UNPROVEN |
| Real .exe user journey | UNPROVEN |

### Required metrics

Primary:

~~~text
task_success_rate
~~~

Secondary:

~~~text
false_completion_rate
false_block_rate
invalid_tool_rate
unnecessary_tool_rate
error_recovery_rate
repeated_action_rate
context_tokens_per_success
model_calls_per_success
verification_accuracy
wall_time
~~~

The flagship experiment should hold model, quantization, runtime, temperature, context limit, hardware and task set constant:

~~~text
A: generic/minimal loop
B: Shelra deterministic SWE control plane
~~~

Run it at 1.5B, 3B, 7B/9B and 14B. This isolates harness amplification from model improvement.

## External research findings

### Claude Code

Current official documentation describes an iterative gather-context → take-action → verify-results cycle. Tool results inform subsequent decisions. Public documentation also covers Plan/read-only behavior, permissions, checkpoints, memory/context compaction, on-demand skills and isolated subagents.

Sources:

- [How Claude Code works](https://code.claude.com/docs/en/how-claude-code-works)
- [Context window and compaction](https://code.claude.com/docs/en/context-window)
- [Subagents](https://code.claude.com/docs/en/sub-agents)
- [Permissions](https://code.claude.com/docs/en/permissions)
- [Features overview](https://code.claude.com/docs/en/features-overview)

Implication: the model is one part of a harness that owns tools, context and execution boundaries. This is VERIFIED_EXTERNAL.

### OpenAI/Codex guidance

Current OpenAI model guidance recommends lean prompts, task-relevant tools, precise tool descriptions, explicit concurrency/retry/stop conditions and direct tool calls when the next decision depends on the previous result. It also documents compaction and agentic coding model behavior. Public product internals are not treated as fully known.

Sources:

- [Latest-model guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [GPT-5.3-Codex model guidance](https://developers.openai.com/api/docs/models/gpt-5.3-codex)

Implication: tool quantity is not a substitute for orchestration; dependent actions should observe prior results. VERIFIED_EXTERNAL.

### OpenCode

OpenCode publicly documents Build/Plan modes, Explore/General agents, compaction agents, fine-grained permissions and on-demand skills.

Sources:

- [Agents](https://opencode.ai/v2/docs/agents)
- [Compaction](https://opencode.ai/v2/docs/compaction)
- [Permissions](https://opencode.ai/v2/docs/permissions)
- [Skills](https://opencode.ai/docs/skills)

Implication: responsibility, context and authority are separated into primary/subagent roles. VERIFIED_EXTERNAL.

### SWE-agent and ACI

SWE-agent's ACI research shows that interface design affects model performance. Its file viewing, concise search output and edit-adjacent linting reduce cognitive load.

Sources:

- [SWE-agent ACI documentation](https://github.com/SWE-agent/SWE-agent/blob/main/docs/background/aci.md)
- [SWE-agent paper](https://arxiv.org/abs/2405.15793)

Implication: semantic/bounded tools can matter more than adding prompt prose. VERIFIED_EXTERNAL.

### Repository retrieval and constrained repair

- [RepoCoder](https://arxiv.org/abs/2303.12570) supports iterative retrieval and generation.
- [Repoformer](https://arxiv.org/abs/2403.10059) supports selective retrieval because irrelevant context can hurt.
- [Agentless](https://arxiv.org/abs/2407.01489) supports constrained localization → repair → validation pipelines.
- [Aider repository map](https://aider.chat/docs/repomap.html) documents structural definitions/references and token-budgeted repository context.

Implication: high-signal structural context is preferable to repository dumps. VERIFIED_EXTERNAL/PAPER.

### Small action models and trajectories

- [APIGen](https://arxiv.org/abs/2406.18518) uses executable function-call verification.
- [Salesforce xLAM](https://github.com/SalesforceAIResearch/xLAM/) publishes small action-oriented models.
- [ActionStudio](https://aclanthology.org/2025.emnlp-main.1090/) studies heterogeneous agent trajectories.
- [Agent Distillation](https://arxiv.org/abs/2505.17612) reports small-model gains from agent/tool trajectories.
- [SWE-Dev](https://arxiv.org/abs/2506.07636) targets software-engineering data/trajectories.
- [SWE-Protégé](https://arxiv.org/abs/2602.22124) reports a post-trained 7B with sparse expert consultation and anti-loop behavior.
- [FrogMini-14B](https://huggingface.co/microsoft/FrogMini-14B-2510/blob/main/README.md) is a recent 14B SWE-agent result.
- [Compiler feedback experiment](https://arxiv.org/abs/2601.12146) reports tool/compiler feedback effects across model scales.

These sources support system-level amplification and specialized agent behavior. They do not prove generic 1.5B frontier parity. VERIFIED_EXTERNAL/PAPER with medium confidence for newer/unreviewed results.
+
## ShelraCode versus Claude Code

This table compares only public mechanisms, not private prompts or unpublished internals.

| Dimension | ShelraCode current evidence | Claude Code public evidence | Gap |
|---|---|---|---|
| Agent loop | Real multi-turn loop in src/agent/loop.ts; bounded batch and progress controls | Gather context -> act -> verify -> repeat | Shelra loop is real but completion/recovery semantics are weaker |
| Task compilation | TaskAnalysis, generic criteria and target inference | Public workflow leaves more semantic work to a frontier model | Shelra needs an authoritative contract for small models |
| Context | Git/manifest/path/lexical context with budgets | Context/tools/environment managed as a harness | Shelra semantic repository intelligence is less proven |
| Context density | Character budgets exist | Public context/compaction tools and workflow | Shelra lacks a proven TaskCapsule and live long-horizon result |
| Verification | Generic/project checks plus structural review | Verification is a documented loop phase | Objective-specific no-test verification gap |
| Completion | Controller gate can block | Loop continues/course-corrects | Shelra blocker is often terminal |
| Plan mode | Turn policies and graph data | Explicit read-only Plan mode | Shelra graph is not fully executable |
| Permissions | Application policy/path/command checks | Permission rules and hooks | Shelra lacks proven equivalent OS sandbox |
| Checkpoints | Checkpoint mechanisms exist | Snapshots before direct edits | Comparable foundation; external side effects still differ |
| Memory | Provenance/freshness facts and task episodes | Project memory plus auto-memory/context management | Live selective resume not proven |
| Skills | Configuration/mechanism present | On-demand skill loading | Shelra skill productivity/version fit unproven |
| Subagents | Productive isolated path not proven | Fresh contexts with separate tools/model/permissions | Significant gap |
| Code intelligence | Lexical/ranked repository evidence | Public docs support code intelligence integrations | Symbol/reference graph not proven in Shelra |
| Low-resource support | Size-aware budgets and capability probes | Primarily frontier-agent product behavior | Shelra opportunity is not yet validated by a current matrix |
| Native local inference | External/adaptor discovery | Not primary product objective | Shelra native route absent |

Sources: [Claude Code works](https://code.claude.com/docs/en/how-claude-code-works), [context window](https://code.claude.com/docs/en/context-window), [subagents](https://code.claude.com/docs/en/sub-agents), [permissions](https://code.claude.com/docs/en/permissions), [features](https://code.claude.com/docs/en/features-overview).

## ShelraCode versus Codex

OpenAI publicly documents Codex as an agentic coding product and publishes model/tool guidance. Public product documentation does not expose every internal runtime detail, so claims below stay at the documented boundary.

| Dimension | ShelraCode current evidence | Codex public evidence | Gap |
|---|---|---|---|
| Instructions | Project AGENTS.md is present and governs this audit | AGENTS.md/project instruction hierarchy is documented in the ecosystem | Comparable at instruction layer |
| Execution boundary | Policy-level workspace/process checks | Sandbox and approval boundaries are product concepts | Shelra OS-level isolation not proven |
| Approvals | Turn policy and permission classes | Approval/sandbox separation | Shelra semantic approval UX/evidence less proven |
| Worktrees | Git/checkpoints; worktree path not productive-proof | Worktree/isolation workflows documented | Shelra isolated parallel work unproven |
| Subagents | Not a proven production path | Parallel/subagent workflows documented | Gap |
| Long horizon | Compaction/memory mechanisms present | Long-running agent workflows supported | Shelra resume/compaction E2E unproven |
| Tool guidance | Typed tools and eight-call bound | Task-relevant tools, explicit stopping/retry guidance | Shelra semantic tools and formal action cycles weaker |
| Verification | Generic/objective split incomplete | Coding workflow expects validation | Shelra proof-carrying completion gap |
| Local inference | External runtime adapters | Codex is not a local-runtime replacement | Different product objective |
| Cost/privacy | Strict-zero and local-first invariants | User/account/policy controlled | Shelra must preserve explicit no-paid-fallback semantics |

Sources: [OpenAI latest-model guidance](https://developers.openai.com/api/docs/guides/latest-model), [GPT-5.3-Codex](https://developers.openai.com/api/docs/models/gpt-5.3-codex). The comparison does not assert unpublished Codex internals.

## ShelraCode versus OpenCode

| Dimension | ShelraCode current evidence | OpenCode public evidence | Gap |
|---|---|---|---|
| Primary modes | Turn policies and coding/read modes | Build and Plan agents | Shelra mode exists but task scheduler is less explicit |
| Explore | Repository context/search path | Explore/General subagents | Shelra productive fresh Explore path unproven |
| Permissions | Path/command/turn policy | Fine-grained read/edit/bash/LSP/skill permissions | Similar intent; Shelra executor boundary needs proof |
| Skills | Project skills/config | Discover/load on demand | Comparable concept; productivity unproven |
| Compaction | Structured state compaction | Compaction agents/checkpoints | Shelra live resume evidence missing |
| LSP/semantic navigation | No productive symbol graph proven | LSP permissioned and exposed | Gap for small models |
| Doom loops | Repeated action/no-progress limits | Documented permission/doom-loop behavior | Shelra recovery should create graph work |
| Verification | Generic/project plus structural | Agent-dependent | Shelra objective-specific verifier missing |
| Native local runtime | Runtime discovery/adapters | Provider-oriented | Separate implementation objectives |

Sources: [OpenCode agents](https://opencode.ai/v2/docs/agents), [permissions](https://opencode.ai/v2/docs/permissions), [compaction](https://opencode.ai/v2/docs/compaction), [skills](https://opencode.ai/docs/skills).

## Model versus harness diagnosis matrix

Legend: PRIMARY means the strongest current attribution; CONTRIBUTING means it can worsen the failure; UNLIKELY means evidence points elsewhere; UNKNOWN means not established.

| Failure | Model | Runtime/template | Task compiler | Context | Tool ACI | Scheduler | Verifier | Completion | Router |
|---|---|---|---|---|---|---|---|---|---|
| Weak clock intent | CONTRIBUTING | UNKNOWN | PRIMARY | CONTRIBUTING | UNLIKELY | UNLIKELY | UNLIKELY | UNLIKELY | CONTRIBUTING |
| Only index.html | CONTRIBUTING | UNKNOWN | PRIMARY | CONTRIBUTING | CONTRIBUTING | CONTRIBUTING | PRIMARY | UNLIKELY | UNLIKELY |
| CSS/JS omitted | CONTRIBUTING | UNKNOWN | PRIMARY | CONTRIBUTING | CONTRIBUTING | CONTRIBUTING | PRIMARY | UNLIKELY | UNLIKELY |
| Invalid tool arguments | PRIMARY | CONTRIBUTING | UNLIKELY | CONTRIBUTING | PRIMARY | CONTRIBUTING | UNLIKELY | UNLIKELY | UNLIKELY |
| Wrong path/tool | PRIMARY | UNLIKELY | CONTRIBUTING | PRIMARY | PRIMARY | CONTRIBUTING | UNLIKELY | UNLIKELY | UNLIKELY |
| Repeated action | CONTRIBUTING | UNLIKELY | UNLIKELY | CONTRIBUTING | CONTRIBUTING | PRIMARY | UNLIKELY | CONTRIBUTING | UNLIKELY |
| Incomplete multi-file task | CONTRIBUTING | UNKNOWN | PRIMARY | PRIMARY | CONTRIBUTING | PRIMARY | PRIMARY | CONTRIBUTING | UNLIKELY |
| Stale plan | UNLIKELY | UNLIKELY | CONTRIBUTING | UNLIKELY | CONTRIBUTING | PRIMARY | CONTRIBUTING | CONTRIBUTING | UNLIKELY |
| Test failure iteration | PRIMARY/CONTRIBUTING | CONTRIBUTING | UNLIKELY | CONTRIBUTING | CONTRIBUTING | CONTRIBUTING | CONTRIBUTING | UNLIKELY | UNLIKELY |
| No-test false block | UNLIKELY | UNLIKELY | PRIMARY | UNLIKELY | CONTRIBUTING | CONTRIBUTING | PRIMARY | PRIMARY | UNLIKELY |
| Completion blocked without repair | UNLIKELY | UNLIKELY | CONTRIBUTING | UNLIKELY | UNLIKELY | PRIMARY | PRIMARY | PRIMARY | UNLIKELY |
| False success risk | CONTRIBUTING | UNLIKELY | PRIMARY | CONTRIBUTING | CONTRIBUTING | PRIMARY | PRIMARY | PRIMARY | UNLIKELY |
| Long-horizon collapse | CONTRIBUTING | CONTRIBUTING | PRIMARY | PRIMARY | CONTRIBUTING | PRIMARY | PRIMARY | PRIMARY | CONTRIBUTING |

The clock case is not evidence that the model made no error. It is evidence that the controller had no contract capable of translating a partial artifact into the next repair action.

## Root-cause tree

~~~text
Simple objective does not reach truthful completion
|
+-- Objective is not compiled into deliverables
|   +-- generic create language weak in task analysis
|   +-- progressive greenfield scope defaults to index.html
|   +-- no explicit CSS/JS/behavior contract
|
+-- Work state is not fully authoritative
|   +-- TaskGraph stores nodes but does not enforce scheduler transitions
|   +-- plan projection derives from path activity
|   +-- UI status can remain stale
|
+-- Verification is generic rather than objective-specific
|   +-- no applicable test command becomes unavailable
|   +-- unavailable is evaluated as unsatisfied
|   +-- no artifact/browser clock verifier is selected
|   +-- zero displayed tests can mean no parseable test evidence
|
+-- Completion does not produce work
|   +-- blockers are emitted
|   +-- missing evidence is not a RecoveryContract
|   +-- no repair node/replan is scheduled
|
+-- Small-model burden remains high
|   +-- lexical/file primitives instead of semantic repository answers
|   +-- TaskCapsule not proven
|   +-- fresh verifier/subagent path not proven
|
+-- Evidence boundary is incomplete
    +-- current unit suite is strong
    +-- live low-resource matrix is incomplete
    +-- real executable acceptance is unproven
    +-- long-horizon/resume is unproven
~~~

This is a small number of systemic causes rather than a list of unrelated symptoms.

## P0 blockers

P0 means the issue prevents trustworthy autonomous coding, not merely that the product could be more convenient.

| ID | Severity | Subsystem | Evidence / file-symbol | Consequence | Why it blocks autonomy | Confidence |
|---|---|---|---|---|---|---|
| SH-AUT-001 | P0 | Task compilation | src/router/task-analysis.ts:41-223; src/agent/types.ts:27-64 | A request for a clock website can become a generic coding task with index.html as the primary inferred target | The controller cannot know what must be proven | HIGH |
| SH-AUT-002 | P0 | Verification | src/agent/verification-criteria.ts:18-30, :53-76, :97-132; objective-review.ts:183-337 | No-test greenfield work can be blocked as verification unavailable | Done depends on a generic test policy rather than user objective evidence | HIGH |
| SH-AUT-003 | P0 | Completion/recovery | src/agent/loop.ts:1753-1838 | Completion blocked without a repair/replan action | The controller detects incompleteness but cannot continue autonomously | HIGH |
| SH-AUT-004 | P0 | Plan authority | src/agent/task-graph.ts:214-225; loop.ts:836-852; types.ts:104-108 | Graph, plan and UI can diverge after a successful mutation | The user and scheduler cannot rely on step state | HIGH |
| SH-AUT-005 | P0 | Low-resource proof | docs/agent-kernel/STATUS.md:589-606; current live matrix absent | 1.5B-14B claims cannot be generalized to the shipped path | Product direction depends on evidence that is not current/complete | HIGH |
| SH-AUT-006 | P0 | Agent E2E evaluation | Clock reproduction and absent deterministic acceptance fixture | The exact basic user journey is not a permanent regression test | Improvements can regress without detecting task-level failure | HIGH |

### P0 attribution

- SH-AUT-001/002/003/004/006 are overwhelmingly harness defects.
- SH-AUT-005 is an evidence/product validation gap, not a model defect.
- Model limitations are real, but they are not the primary explanation for the dead-end clock run.

## P1 blockers

P1 means the core loop can work in bounded cases, but reliability, scalability or small-model usefulness remains materially limited.

| ID | Area | Current evidence | Risk |
|---|---|---|---|
| SH-AUT-101 | Semantic repository graph | File/lexical ranking exists; active symbol/import/reference/LSP graph not proven | Small models waste turns localizing code |
| SH-AUT-102 | Executable scheduler | TaskGraph data exists, but dependency/legal-transition/retry/repair enforcement is incomplete | Long tasks depend on model memory |
| SH-AUT-103 | TaskCapsule | Context budgets exist, explicit decision capsule not proven | History/tool schemas dilute small-model context |
| SH-AUT-104 | Fresh verifier | verifier/objective review exist; fresh independent runtime path not proven | False success and confirmation bias |
| SH-AUT-105 | Subagent isolation | Productive Explore/Build/Verify path absent/unproven | No clean context partition for specialized work |
| SH-AUT-106 | OS isolation | Policy/process filtering, no proven complete OS sandbox | Unexpected shell behavior may escape intended policy |
| SH-AUT-107 | Long horizon | Structured compaction/memory present; 100-step resume unproven | State loss or stale context at scale |
| SH-AUT-108 | Native local provider | External/adaptor discovery only | Local-first product still depends on external runtime setup |
| SH-AUT-109 | Error taxonomy | Many typed errors; network/protocol/context distinctions incomplete | Recovery policy cannot be fully deterministic |
| SH-AUT-110 | Executable acceptance | Source/bundle smoke passes; standalone .exe journey unproven | Release claims may not match user artifact |
| SH-AUT-111 | Observability | Events/logging exist, but complete replay/proof chain not proven | Failed-run diagnosis remains expensive |

## P2 maturity gaps

P2 improvements should follow after P0 acceptance works:

- richer semantic ranking and AST/LSP integrations;
- adaptive candidate patch generation and deterministic selection;
- model-specific tool subset optimization;
- selective episodic-memory retrieval and invalidation;
- more polished TUI rendering of evidence/proof objects;
- runtime artifact pinning and managed native provider;
- worktree orchestration for parallel tasks;
- skill compatibility metadata and conflict detection;
- log rotation/replay UX;
- capability calibration across more quantizations/templates;
- model post-training on ShelraCode trajectories;
- browser-based artifact verification for web tasks.

## Full autonomy scorecard

Scores are current audit judgments, not benchmark scores.

| Dimension | Score / 10 | Evidence summary |
|---|---:|---|
| Intent understanding | 5 | Turn policy recognizes mutation; task analysis loses generic create semantics |
| Task compilation | 3 | No rich authoritative deliverable contract |
| Repository intelligence | 5 | Git/path/lexical context; semantic graph unproven |
| Context relevance | 6 | Ranking and budgets present |
| Context sufficiency | 6 | Evidence state/gate present; objective-specific sufficiency incomplete |
| Agent loop | 7 | Real multi-turn loop, limits and recovery |
| Scheduler | 4 | TaskGraph exists; authoritative scheduling/replan incomplete |
| Planning | 5 | Structured plan data and projection; stale-state risk |
| Tool protocol | 7 | Typed schemas, envelope, bounded calls |
| Tool reliability | 7 | Workspace/policy/output/cancellation foundations |
| Semantic tool quality | 3 | Generic primitives dominate |
| Error recovery | 6 | Typed errors and loop controls; controller matrix incomplete |
| Multi-step execution | 6 | Proven in bounded paths; broad live evidence incomplete |
| Code editing | 6 | Current tests and historical fixture evidence |
| Shell execution | 7 | Common process policy and limits |
| Test/debug iteration | 6 | Present, not fully live-matrix proven |
| Objective verification | 2 | Clock/no-test objective verifier missing |
| Completion truthfulness | 5 | Better than false-success path; partial proof semantics |
| Completion recovery | 2 | Blocker often terminal |
| Git safety | 8 | Status/diff/checkpoint/protection foundations |
| Permissions | 7 | Turn/path/command policy present |
| Sandbox | 4 | Policy checks, not proven OS isolation |
| Capability detection | 7 | Empirical probe/cache foundations |
| Routing | 7 | Capability/privacy/cost-aware source path |
| Long-context handling | 5 | Budgets and compaction; live proof missing |
| Compaction | 6 | Structured state compaction present |
| Persistent memory | 6 | Provenance/freshness/selective facts present |
| Skills | 4 | Mechanism present; productive relevance unproven |
| Subagents | 2 | Productive fresh-context path not proven |
| Observability | 6 | Events/logging/diagnostics; full replay proof incomplete |
| Agent evaluations | 5 | Strong harness tests; task matrix incomplete |
| Native-local readiness | 2 | External adapters/discovery; native product absent |
| Release readiness | 3 | Source/bundle smoke passes; real executable journey unproven |

## Weighted autonomy score

The weighted core deliberately gives verification/completion and task state more importance than raw tool count.

| Category | Weight | Score | Contribution |
|---|---:|---:|---:|
| Task compilation | 10 | 3.0 | 3.0 |
| Context engineering | 10 | 5.5 | 5.5 |
| Agent loop | 8 | 7.0 | 5.6 |
| Scheduler/task state | 10 | 4.0 | 4.0 |
| Tool/ACI quality | 10 | 6.5 | 6.5 |
| Error recovery | 8 | 6.0 | 4.8 |
| Verification/completion | 15 | 3.5 | 5.25 |
| Small-model capability system | 10 | 6.5 | 6.5 |
| Safety | 6 | 6.5 | 3.9 |
| Long-horizon context | 5 | 3.5 | 1.75 |
| Subagents | 3 | 3.0 | 0.9 |
| Evals/observability | 5 | 5.8 | 2.9 |
| **Total** | **100** |  | **50.6** |

Weighted autonomy: **50.6 / 100 = 5.1 / 10**.

## Stronger-model thought experiment

### Frontier model with today's harness

Likely improvements:

- better task interpretation;
- more complete initial web artifacts;
- fewer malformed calls;
- better path selection;
- stronger test-failure diagnosis;
- more successful workarounds.

Failures that remain:

- no rich objective contract;
- generic no-test verification can block;
- completion blocker may not create repair work;
- plan/UI authority can diverge;
- TUI zero-count fallback remains ambiguous;
- semantic repository graph remains absent;
- OS-level sandbox remains unproven;
- executable/runtime and long-horizon evidence remain incomplete.

Conclusion: a frontier model would raise task success, but would not turn the current harness into a trustworthy proof-based autonomous system.

## Excellent-harness thought experiment

### 1.5B

Plausible:

- intent labels;
- structured deliverable extraction with constrained schemas;
- repository query generation;
- path/symbol selection from compact candidates;
- one-file or micro-file edits;
- deterministic syntax/reference checks;
- error correction for one-step failures.

Unrealistic without escalation:

- ambiguous architecture;
- broad multi-file refactor;
- sustained debugging;
- long-horizon planning;
- independent final completion authority.

### 3B

Plausible:

- Explore tasks;
- small feature nodes;
- simple two-file edits;
- bounded test repair;
- structured tool continuation with strong schemas.

Still weak:

- broad architecture;
- ambiguous multi-module changes;
- repeated semantic failures.

### 7B

Plausible:

- primary local worker for bounded multi-file nodes;
- test-fix-test loops;
- focused debugging;
- moderate feature implementation with semantic repository tools;
- verifier-assisted repair.

Needs:

- strong TaskCapsule;
- graph/scheduler;
- objective verifier;
- loop detection;
- capability-specific training/probing.

### 9B

Plausible:

- broader multi-file changes;
- more capable diagnosis and local planning;
- stronger review;
- selected long-horizon work with compaction.

Still not a substitute for controller-owned state or safety.

### 14B

Plausible:

- moderate multi-file implementation;
- debugging across related modules;
- semantic review;
- more autonomous bounded DAG nodes;
- selective candidate generation/replanning.

Not guaranteed:

- universal frontier performance;
- architecture-level ambiguity without repository intelligence;
- reliable 100+ action work without external state;
- truthful completion without a verifier.

## Minimum small-model autonomous kernel

| Mechanism | Status | Current evidence |
|---|---|---|
| TaskContract | PARTIAL | AgentTask fields, no rich deliverable contract |
| TaskCompiler | PARTIAL | TaskAnalysis/targets, not objective-to-proof compiler |
| RepositoryIndex | PRESENT/PARTIAL | File/Git/lexical facts |
| SymbolGraph | ABSENT/UNPROVEN | No productive active proof |
| TaskCapsule | PARTIAL | Context budgets, no complete decision capsule |
| TaskGraph | PARTIAL | Structured graph, weak transition authority |
| Scheduler | PARTIAL/ABSENT | No proven repair-aware ready-node scheduler |
| TypedToolACI | PRESENT | Tool schemas/results/errors/envelope |
| EvidenceLedger | PARTIAL/PRESENT | Task ledger and verification evidence |
| ObjectiveVerifier | ABSENT/PARTIAL | Structural review, no general objective compiler |
| RecoveryController | PARTIAL | Loop recovery and limits, no repair contract |
| ProofBasedCompletion | PARTIAL | Gate/evidence pieces, no complete per-criterion proof |
| Compaction | PRESENT/PARTIAL | Structured summaries; live resume unproven |
| ProjectMemory | PRESENT | Provenance/freshness/selective facts |
| CapabilityRouter | PRESENT/PARTIAL | Empirical probes and hard-admission path |
| Checkpointing | PRESENT | Checkpoint mechanisms |
| SubagentIsolation | ABSENT/UNPROVEN | No productive fresh-context path |
| AgentEvals | PARTIAL | Strong harness tests, missing task ladder |

## Five deepest gaps to Claude Code

Exactly five systemic gaps matter most:

1. **Objective compilation and proof-based completion** — Claude Code can rely on a frontier model for more semantic work; ShelraCode needs an explicit contract for smaller workers.
2. **Verification-driven recovery** — a failed verification must create new work, not only emit a blocker.
3. **Semantic context and tool interface** — lexical files and generic shell primitives leave too much repository reasoning to the model.
4. **Authoritative task scheduling and isolated contexts** — graph state, plan projection, worker context and verifier ownership need one lifecycle authority.
5. **End-to-end evidence and isolation** — low-resource model matrices, real executable acceptance, long-horizon resume and OS-level containment remain unproven.

## Final classification

**FUNCTIONAL CODING AGENT**

This is above a tool-using chatbot because current source proves an agent loop, typed tools, routing, policies, verification state and task persistence. It is below a strong/complex autonomous coding agent because objective-specific proof, scheduler authority, recovery semantics and broad E2E evidence are incomplete.

## Final verdict

ShelraCode failed the simple website task because the controller did not compile the user request into a complete artifact/behavior contract. It inferred a narrow preparation target, accepted a partial mutation, applied generic project verification, interpreted unavailable verification as failure, left plan state stale and stopped at a blocker without creating repair work.

The primary cause is harness architecture, not the raw intelligence of the 14B model. The model may have contributed an incomplete implementation, but the harness lacked the information and recovery machinery required to recognize, repair and verify the gap.

The current product cannot be trusted to reliably perform complex multi-file engineering tasks from one user request. It has meaningful bounded coding capability and historical 14B fixture evidence, but current live low-resource, long-horizon, fresh-verifier, native-runtime and real-executable evidence is incomplete.

A redesigned harness can substantially amplify 1.5B-14B models by moving deterministic work into task compilation, repository intelligence, semantic tools, scheduling, typed recovery, verification, memory and capability routing. The effect will be largest on constrained task distributions. It will not make a generic 1.5B model universally equivalent to a frontier model.

The single biggest bottleneck is the missing authoritative chain:

~~~text
user objective
    ->
deliverable/acceptance contract
    ->
evidence-bearing task graph
    ->
objective verifier
    ->
repair/replan
    ->
proof-carrying completion
~~~

Until that chain is authoritative, more prompts, skills, context or model size will mostly mask rather than solve the core defect.

## Appendix A — Audit commands and integrity checks

Commands run or inspected during this audit included:

~~~text
git rev-parse --show-toplevel
git branch --show-current
git rev-parse HEAD
git status --short
bun run typecheck
bun run test:functional
bun run smoke
bun run test
rg --files
rg -n "symbol|function|pattern"
git diff
git diff --check
~~~

Source-only audit rule:

- no production implementation was added;
- no configuration/dependency/test changes were added;
- no broad Git rollback was used;
- no user changes were staged or discarded;
- the root tracked index.html was restored to the exact HEAD blob after the disposable reproduction side effect.

Expected final worktree delta:

~~~text
only SHELRACODE-AUTONOMY-ARCHITECTURE-AUDIT.md is new
~~~

This final expectation must be verified after the document is written.

## Appendix B — Clock website acceptance fixture

A deterministic regression fixture should treat the task as successful only when the current system autonomously:

1. compiles the objective into HTML/CSS/JavaScript deliverables;
2. discovers the disposable fixture;
3. creates or updates the required artifacts;
4. advances the authoritative task node;
5. selects non-test-only verification;
6. validates local references;
7. validates HTML and JavaScript syntax;
8. verifies current-time derivation and update behavior where browser tooling is available;
9. reviews the final diff;
10. reaches truthful completion.

It should fail if:

- only index.html is created when CSS/JavaScript are required;
- “0 tests” blocks a task with no applicable project tests;
- plan state remains stale;
- completion is blocked without a recovery action;
- raw malformed tool output reaches the user;
- a model must manually orchestrate the next step.

## Appendix C — Source register

### Current ShelraCode source

- src/index.ts:14 — application entry.
- src/tui/launch.tsx:11 — TUI launch.
- src/tui/app.tsx:1032, 1119-1515, 1774-1925 — task execution, mode/routing/context/criteria and progressive flow.
- src/router/task-analysis.ts:41-223 — task analysis.
- src/router/router.ts:32-81, 237-474 — capability admission and route selection.
- src/agent/turn-policy.ts:173-318 — turn mode and tool policy.
- src/agent/progressive-plan.ts:85-214 — target inference.
- src/agent/types.ts:27-64, 104-108 — task/event state.
- src/agent/task-graph.ts:6-34, 80-225 — task graph.
- src/agent/task-state.ts:5-247 — phases, criteria, ledger, actions and verification.
- src/agent/loop.ts:648-675, 836-852, 1046-1155, 1629-1838, 2038-2085 — loop, plan sync, limits, completion and batch recovery.
- src/agent/verification-criteria.ts:18-132 — generic criteria and unavailable verification.
- src/agent/verifier.ts:36-146 — ledger verifier.
- src/agent/objective-review.ts:183-337 — structural objective review.
- src/agent/context-budget.ts:13-45 — model-size-aware context budget.
- src/agent/compaction.ts:39-136 — structured compaction.
- src/agent/capability-probe.ts:51, 814-865, 911-916, 999-1015 — probes/classification/cache identity/failure.
- src/providers/tool-envelope.ts:4-21 — eight-call response bound.
- src/providers/openai-compatible.ts:245-518 — streaming/provider normalization.
- src/providers/stream-normalizer.ts:62-150 — stream/tool normalization.
- src/tools/types.ts:7-83 — tool contracts/results.
- src/tools/errors.ts:2-22 — normalized error codes.
- src/tools/workspace.ts:1327-1405, 1527-1602 — Shell and RunTests.
- src/tools/permissions.ts:8-98 — command/path permissions.
- src/shared/process-policy.ts:1-22 — process/network policy.
- src/shared/memory.ts:11-29, 58-93, 130-157 — memory facts/selection/episode compaction.
- src/runtimes/discovery.ts:2-50 — runtime discovery/adapters.
- src/tui/presentation/adapter.ts:531-537 — test-count presentation fallback.

### Current project documentation

- docs/agent-kernel/STATUS.md:589-606 — open autonomy, sandbox, subagent, long-horizon and model-matrix gaps.
- docs/agent-kernel/STATUS.md:608-654 — routing/progressive/discovery status.
- docs/agent-kernel/ROOT-CAUSES.md:139-249 — root-cause and model-limit documentation.
- docs/agent-kernel/EVALS.md:158-278, 324-354 — historical model/eval evidence; current full-suite total supersedes older counts.
- docs/agent-kernel/FINAL-AUDIT.md:575+ — historical score/report, not current final score.
- package.json:7-9, 19-26 — source entry and scripts.

### Current external sources

- [Claude Code: How it works](https://code.claude.com/docs/en/how-claude-code-works)
- [Claude Code: Context window](https://code.claude.com/docs/en/context-window)
- [Claude Code: Subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code: Permissions](https://code.claude.com/docs/en/permissions)
- [Claude Code: Features overview](https://code.claude.com/docs/en/features-overview)
- [OpenAI: Latest-model guidance](https://developers.openai.com/api/docs/guides/latest-model)
- [OpenAI: GPT-5.3-Codex](https://developers.openai.com/api/docs/models/gpt-5.3-codex)
- [OpenCode: Agents](https://opencode.ai/v2/docs/agents)
- [OpenCode: Compaction](https://opencode.ai/v2/docs/compaction)
- [OpenCode: Permissions](https://opencode.ai/v2/docs/permissions)
- [OpenCode: Skills](https://opencode.ai/docs/skills)
- [SWE-agent ACI](https://github.com/SWE-agent/SWE-agent/blob/main/docs/background/aci.md)
- [SWE-agent paper](https://arxiv.org/abs/2405.15793)
- [Agentless](https://arxiv.org/abs/2407.01489)
- [Aider repository map](https://aider.chat/docs/repomap.html)
- [RepoCoder](https://arxiv.org/abs/2303.12570)
- [Repoformer](https://arxiv.org/abs/2403.10059)
- [APIGen](https://arxiv.org/abs/2406.18518)
- [Salesforce xLAM](https://github.com/SalesforceAIResearch/xLAM/)
- [ActionStudio](https://aclanthology.org/2025.emnlp-main.1090/)
- [Agent Distillation](https://arxiv.org/abs/2505.17612)
- [SWE-Dev](https://arxiv.org/abs/2506.07636)
- [SWE-Protege](https://arxiv.org/abs/2602.22124)
- [FrogMini-14B](https://huggingface.co/microsoft/FrogMini-14B-2510/blob/main/README.md)
- [Compiler feedback experiment](https://arxiv.org/abs/2601.12146)
- [llama.cpp](https://github.com/ggml-org/llama.cpp)
- [llama.cpp server](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md)
- [MLX-LM](https://github.com/ml-explore/mlx-lm)
- [MLC LLM](https://llm.mlc.ai/)
- [MLC REST deployment](https://llm.mlc.ai/docs/deploy/rest.html)
- [ONNX Runtime GenAI](https://onnxruntime.ai/docs/genai/)
- [vLLM](https://docs.vllm.ai/en/latest/)
- [Ollama tool calling](https://docs.ollama.com/capabilities/tool-calling)
- [LM Studio REST quickstart](https://lmstudio.ai/docs/developer/rest/quickstart)
- [LM Studio model load](https://lmstudio.ai/docs/developer/rest/load)
- [Hugging Face GGUF](https://huggingface.co/docs/hub/en/gguf)




