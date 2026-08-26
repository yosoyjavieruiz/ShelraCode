# ShelraCode Level-10 Agent Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement seven evidence-gated phases that move ShelraCode toward a durable, truthful, Claude/Codex-class coding-agent harness.

**Architecture:** The host remains the authority for task state, permissions, evidence, verification, persistence, and completion. Provider adapters remain isolated, repository intelligence and context are bounded, and child agents (when introduced) communicate through typed contracts. Each phase is an independently testable vertical slice and does not claim capabilities not exercised by current runtime evidence.

**Tech Stack:** Bun 1.3+, strict TypeScript ESM, SolidJS/OpenTUI, `bun:sqlite`, existing provider/filesystem/Git adapters.

**Spec:** `docs/superpowers/specs/2026-08-26-level-10-agent-architecture.md`

## Global Constraints

- Privacy and cost gates precede model quality; `STRICT_ZERO` never intentionally executes a paid route.
- Core business logic must not import TUI code, and provider-specific wire objects must not leak into the kernel.
- Every mutation passes permission and checkpoint boundaries, accepts `AbortSignal`, and preserves user work.
- Tests are written and observed failing before production behavior is added.
- Existing user changes and the checkpoint commit `fb060621a3fd634e78d2689379fb30d7c24b79c2` are preserved.
- No production claim is made without fresh typecheck, focused tests, relevant integration tests, and the real executable/user path where applicable.

---

## File map

Phase 1 adds a focused contract-assessment module and extends the existing
ledger/completion interfaces. Phase 2 adds repository-index modules without
putting parsing logic in `loop.ts`. Phase 3 adds a versioned ledger codec and
storage rehydration services. Phase 4 extends the shared process policy rather
than adding policy branches to individual tools. Phase 5 adds runtime Skill
loading and instruction composition outside the TUI. Phase 6 adds child-agent
contracts and a coordinator behind the existing loop. Phase 7 adds disposable
evaluation fixtures and release evidence scripts.

### Task 1: Establish the objective-proof contract (Phase 1)

**Files:**

- Create: `src/agent/objective-proof.ts`
- Modify: `src/agent/task-contract.ts`
- Modify: `src/agent/task-state.ts`
- Test: `tests/unit/objective-proof.test.ts`
- Test: `tests/unit/task-contract.test.ts`

**Interfaces:**

- `ObjectiveProofStatus = "unproven" | "proven" | "failed" | "not_applicable"`.
- `ObjectiveProof` contains `id`, `requirementId`, `kind`, `source`, `summary`, `observedAt`, `status`, and optional `revision`.
- `assessObjectiveProof(contract, ledger, evidence)` returns required deliverables/criteria with proof status, missing requirements, and bounded recovery actions.
- The assessment is deterministic and may use only host ledger/evidence and explicitly supplied artifact facts; it never treats model prose as proof.

- [x] **Step 1: Write the failing proof-assessment tests.**

Add tests proving that an explicit two-file coding contract fails when only one
file changed, passes only when both files have fresh read/change evidence and
the required verification proof exists, and rejects a model completion claim
without a host proof. Use `createTaskLedger`, `recordTaskAction`, and
`recordVerificationRun`; do not mock the proof evaluator.

- [x] **Step 2: Run the focused test and confirm the expected missing-module or behavior failure.**

Run: `bun test tests/unit/objective-proof.test.ts`

Expected: FAIL because `objective-proof.ts` and its assessment behavior do not
exist yet.

- [x] **Step 3: Implement the minimal typed proof model and assessment.**

Keep the proof evaluator independent of TUI/provider code. Link explicit path
deliverables to normalized `filesRead`/`filesChanged`; link required project
criteria to passed verification runs; link final-review requirements to the
ledger review evidence. Return every missing requirement instead of a single
boolean.

- [x] **Step 4: Run the focused proof and contract tests.**

Run: `bun test tests/unit/objective-proof.test.ts tests/unit/task-contract.test.ts`

Expected: PASS with the new assessment and all existing contract behavior
preserved.

- [x] **Step 5: Commit the phase-1 proof model.**

Run:

```text
git add src/agent/objective-proof.ts src/agent/task-contract.ts src/agent/task-state.ts tests/unit/objective-proof.test.ts tests/unit/task-contract.test.ts
git commit -m "feat: add host-owned objective proof assessment"
```

### Task 2: Make completion consume objective proof (Phase 1)

**Files:**

- Modify: `src/agent/completion-gate.ts`
- Modify: `src/agent/verifier.ts`
- Modify: `src/agent/loop.ts`
- Modify: `src/agent/types.ts`
- Test: `tests/unit/completion-gate.test.ts`
- Test: `tests/unit/verifier.test.ts`
- Test: `tests/integration/agent-loop.test.ts`

**Interfaces:**

- `CompletionGateInput.objectiveProof?: ObjectiveProofAssessment`.
- `CompletionDecision` exposes stable missing-proof reasons.
- `AgentRunResult` and `AgentEvent` retain the structured proof outcome without
  exposing private model reasoning.

- [x] **Step 1: Add failing false-success and false-block tests.**

Prove that a coding task with mutation, green project tests, and non-empty
model text still blocks when a required deliverable lacks proof. Prove that a
task with no applicable project command can complete only when its contract
explicitly marks project checks `not_required` and objective/final-review proof
passes.

- [x] **Step 2: Run the focused tests and observe the old behavior fail.**

Run: `bun test tests/unit/completion-gate.test.ts tests/unit/verifier.test.ts tests/integration/agent-loop.test.ts`

- [x] **Step 3: Integrate the host proof assessment into the terminal path.**

Make `runAgent` evaluate proof before `complete`; a failed assessment creates
bounded recovery work or `blocked`, never `completed`. Preserve legacy callers
by deriving a compatibility assessment only when no contract is supplied.

- [x] **Step 4: Run focused, integration, and type checks.**

Run: `bun test tests/unit/completion-gate.test.ts tests/unit/verifier.test.ts tests/integration/agent-loop.test.ts`; `bun run typecheck`

- [x] **Step 5: Commit the authoritative completion gate.**

Run: `git add src/agent src/agent/types.ts tests/unit tests/integration/agent-loop.test.ts; git commit -m "feat: gate completion on objective proof"`

### Task 3: Build the bounded repository intelligence index (Phase 2)

**Files:**

- Create: `src/context/repository-intelligence.ts`
- Create: `src/context/repository-language.ts`
- Modify: `src/context/repository.ts`
- Modify: `src/context/context-builder.ts`
- Test: `tests/unit/repository-intelligence.test.ts`
- Test: `tests/integration/context-relevance.test.ts`

**Interfaces:**

- `RepositorySymbol`, `RepositoryImport`, `RepositoryReference`, and
  `RepositoryIntelligence` are bounded serializable domain types.
- `buildRepositoryIntelligence(root, snapshot, options)` accepts an
  `AbortSignal` and returns symbols/imports/references/relatedTests with caps.
- `selectRelatedRepositoryEvidence(index, objective, explicitPaths)` ranks
  exact paths, symbols, imports, references, and tests before lexical fallback.

- [x] **Step 1: Write failing heterogeneous fixture tests.**

Create disposable TypeScript, Python, and Go files in the test fixture and
assert that exported symbols, relative imports, references, and test partners
are indexed and ranked ahead of unrelated lexical matches.

- [x] **Step 2: Run the focused test and confirm the index is absent.**

Run: `bun test tests/unit/repository-intelligence.test.ts`

- [x] **Step 3: Implement bounded language-aware extraction.**

Use existing filesystem/process abstractions and deterministic regex/token
parsers for supported languages; preserve unknown-language lexical fallback.
Canonicalize all paths under the workspace, cap files/symbols/references, and
never execute package scripts as part of indexing.

- [x] **Step 4: Integrate ranked intelligence into context construction.**

Add the index as a bounded context section and record its sources as
`ContextEvidence`; do not expose unbounded repository content or private files.

- [x] **Step 5: Run focused context tests, typecheck, and the fixture integration.**

Run: `bun test tests/unit/repository-intelligence.test.ts tests/integration/context-relevance.test.ts`; `bun run typecheck`

- [x] **Step 6: Commit repository intelligence.**

Run: `git add src/context tests/unit/repository-intelligence.test.ts tests/integration/context-relevance.test.ts; git commit -m "feat: add bounded repository intelligence"`

### Task 4: Compile a fresh context packet per model decision (Phase 2)

**Files:**

- Modify: `src/context/context-compiler.ts`
- Modify: `src/agent/loop.ts`
- Modify: `src/agent/types.ts`
- Modify: `src/agent/compaction.ts`
- Test: `tests/unit/context-compiler.test.ts`
- Test: `tests/unit/compaction.test.ts`
- Test: `tests/integration/agent-loop.test.ts`

**Interfaces:**

- `ContextDecisionInput` identifies turn, node, objective, constraints,
  instructions, memory, repository evidence, observations, and legal actions.
- `compileDecisionContext(input)` returns a bounded packet plus source IDs and
  omitted-section reasons.

- [x] **Step 1: Write the failing decision-context test.**

Add a test equivalent to:

```ts
const packet = compileDecisionContext({
  objective: "Fix the parser",
  subtask: "Inspect the parser and its tests",
  constraints: ["preserve the public API"],
  instructions: [{ source: "AGENTS.md", text: "run the focused tests" }],
  memory: [],
  evidence: [{ source: "src/parser.ts", summary: "parser symbol" }],
  observations: [{ source: "ReadFile", text: "export function parse" }],
  legalActions: ["ReadFile", "SearchText"],
  tokenBudget: 2_000,
});
expect(packet.text).toContain("Fix the parser");
expect(packet.text).toContain("src/parser.ts");
expect(packet.text).not.toContain("unrelated-large-output");
expect(packet.sourceIds).toContain("src/parser.ts");
```

- [x] **Step 2: Run the focused test and observe the missing compiler export.**

Run: `bun test tests/unit/context-compiler.test.ts -t "decision context"`

Expected: FAIL because `compileDecisionContext` and its bounded source contract
do not exist.

- [x] **Step 3: Implement the bounded compiler and replace only the next-decision input path.**

Keep `compileContextPacket` backward-compatible. Add explicit section budgets,
source IDs, and omitted-section reasons; have `runAgent` compile the next
request from the active node/evidence instead of blindly appending every old
tool output. Do not remove the recent-message window until the new packet is
present in an integration assertion.

- [x] **Step 4: Add the compaction retention assertion.**

Extend `tests/unit/compaction.test.ts` with:

```ts
expect(compacted.text).toContain("Fix the parser");
expect(compacted.text).toContain("current node");
expect(compacted.text).toContain("missing proof");
expect(compacted.sourceIds).toContain("src/parser.ts");
```

- [x] **Step 5: Run context/compaction/agent integration tests and typecheck.**

Run: `bun test tests/unit/context-compiler.test.ts tests/unit/compaction.test.ts tests/integration/agent-loop.test.ts`; `bun run typecheck`

- [x] **Step 6: Commit the decision-context path.**

Run: `git add src/context/context-compiler.ts src/agent/loop.ts src/agent/types.ts src/agent/compaction.ts tests/unit/context-compiler.test.ts tests/unit/compaction.test.ts tests/integration/agent-loop.test.ts; git commit -m "feat: compile bounded context per decision"`

### Task 5: Version, persist, and rehydrate the complete task ledger (Phase 3)

**Files:**

- Create: `src/agent/task-ledger-codec.ts`
- Create: `src/agent/task-runtime-state.ts`
- Modify: `src/storage/database.ts`
- Modify: `src/tui/app.tsx`
- Modify: `src/agent/loop.ts`
- Test: `tests/unit/task-ledger-codec.test.ts`
- Test: `tests/unit/storage.test.ts`
- Test: `tests/integration/resume.test.ts`

**Interfaces:**

- `TaskRuntimeSnapshot` contains schema version, ledger, route identity,
  context anchor, active node, in-flight marker, and updated revision.
- `serializeTaskRuntime` validates and redacts before storage.
- `restoreTaskRuntime` rejects incompatible/corrupt snapshots with a typed
  recovery result and never silently starts a fresh task.

- [x] **Step 1: Write the failing round-trip test.**

Construct a ledger with a model plan, a failed action, a proof gap, and a
verification run; assert `restoreTaskRuntime(serializeTaskRuntime(input))`
preserves all of them and the route model ID.

- [x] **Step 2: Write the failing corruption test and run both tests.**

Pass `{ schemaVersion: 1, ledger: null }` and an unknown future version to the
codec. Assert a typed `INVALID_RUNTIME_SNAPSHOT` result instead of a new task.

Run: `bun test tests/unit/task-ledger-codec.test.ts tests/unit/storage.test.ts`

Expected: FAIL because the runtime codec/repository is not implemented.

- [x] **Step 3: Implement the versioned codec and DB repository methods.**

Validate every persisted array/object at the boundary, preserve unknown fields
only inside a versioned `extensions` object, and redact model/output text from
the snapshot. Return `Result`/typed errors used by the existing storage layer.

- [x] **Step 4: Make the user resume path restore the ledger before calling the loop.**

Load the latest `agent_tasks` snapshot for the selected session, restore it,
and pass the recovered task/runtime anchor to `runAgent`; refuse to start when
the snapshot is corrupt or belongs to another repository revision.

- [x] **Step 5: Add in-flight recovery rules for model, tool, mutation, and verification boundaries.**

Mark an in-flight action as interrupted on restore and create one bounded
recovery contract with the original action ID; never replay a destructive
mutation automatically.

- [x] **Step 6: Run storage/resume/agent tests and typecheck.**

Run: `bun test tests/unit/task-ledger-codec.test.ts tests/unit/storage.test.ts tests/integration/resume.test.ts tests/integration/agent-loop.test.ts`; `bun run typecheck`

- [x] **Step 7: Commit durable task state.**

Run: `git add src/agent/task-ledger-codec.ts src/agent/task-runtime-state.ts src/storage/database.ts src/tui/app.tsx src/agent/loop.ts tests/unit/task-ledger-codec.test.ts tests/unit/storage.test.ts tests/integration/resume.test.ts; git commit -m "feat: persist and restore task runtime state"`

### Task 6: Make compaction and restart share one rehydration path (Phase 3)

**Files:**

- Modify: `src/agent/compaction.ts`
- Modify: `src/agent/task-runtime-state.ts`
- Modify: `src/agent/loop.ts`
- Test: `tests/unit/compaction.test.ts`
- Test: `tests/integration/resume.test.ts`

- [ ] **Step 1: Add a failing rehydration test with five retained layers.**

Populate instructions, selected memory IDs, the active plan node, route model
ID, and an unsatisfied proof ID; assert all five are present after both
compaction and runtime restore.

- [ ] **Step 2: Run the test and observe the missing rehydration.**

Run: `bun test tests/unit/compaction.test.ts tests/integration/resume.test.ts`

- [ ] **Step 3: Implement one bounded rehydration envelope used by compaction and resume.**

Use `TaskRuntimeSnapshot.contextAnchor` as the single source for those layers;
compaction serializes it and resume restores it without reconstructing from
raw transcript text.

- [ ] **Step 4: Verify no raw secrets/prompts enter the durable summary.**

Assert an API-key fixture and a tool result body are absent while objective,
source IDs, proof gaps, and route metadata remain.

- [ ] **Step 5: Run focused tests and commit.**

Run: `git add src/agent/compaction.ts src/agent/task-runtime-state.ts src/agent/loop.ts tests/unit/compaction.test.ts tests/integration/resume.test.ts; git commit -m "feat: share context rehydration across resume and compaction"`

### Task 7: Centralize child-process/network policy (Phase 4)

**Files:**

- Modify: `src/shared/process-policy.ts`
- Modify: `src/shared/process.ts`
- Modify: `src/tools/workspace.ts`
- Modify: `src/tools/types.ts`
- Create: `src/shared/process-isolation.ts`
- Test: `tests/unit/process.test.ts`
- Test: `tests/unit/permissions.test.ts`
- Test: `tests/integration/privacy-context.test.ts`

- [ ] **Step 1: Write failing process-policy tests.**

Cover `powershell -Command curl ...`, a child process inheriting a denied
network policy, output above the cap, and an environment containing
`OPENAI_API_KEY`/`DATABASE_URL`. Assert network denial, bounded output, and
credential absence.

- [ ] **Step 2: Run the tests and record current policy bypasses.**

Run: `bun test tests/unit/process.test.ts tests/unit/permissions.test.ts`

Expected: at least the shell-indirection and child-inheritance assertions
fail against the current regex-only boundary.

- [ ] **Step 3: Implement centralized command intents and bounded process execution.**

Require every process request to declare `read`, `test`, `build`, `package`,
`network`, or `destructive` intent; apply one policy before spawn, cap both
streams in the process layer, and propagate `AbortSignal` to children.

- [ ] **Step 4: Add the strongest available Windows isolation adapter and report `application_policy` separately from `os_enforced`.**

Detect whether the host can create a restricted process/token/job boundary;
when it cannot, return `os_enforced: false` explicitly and keep the command
blocked unless the selected permission policy permits the weaker mode.

- [ ] **Step 5: Verify all existing tools route through the same boundary.**

Instrument the test process factory and assert Shell, RunTests, verification,
and health probes use the same policy entry point.

- [ ] **Step 6: Run security/privacy/type checks and commit.**

Run: `bun test tests/unit/process.test.ts tests/unit/permissions.test.ts tests/integration/privacy-context.test.ts`; `bun run typecheck`; `git add src/shared/process-policy.ts src/shared/process.ts src/shared/process-isolation.ts src/tools/workspace.ts src/tools/types.ts tests/unit/process.test.ts tests/unit/permissions.test.ts tests/integration/privacy-context.test.ts; git commit -m "feat: centralize process and network enforcement"`

### Task 8: Implement scoped Skills and instruction precedence (Phase 5)

**Files:**

- Create: `src/instructions/instruction-loader.ts`
- Create: `src/instructions/skill-loader.ts`
- Create: `src/instructions/trust-policy.ts`
- Modify: `src/context/instructions.ts`
- Modify: `src/context/context-compiler.ts`
- Test: `tests/unit/scoped-instructions.test.ts`
- Test: `tests/unit/skills.test.ts`
- Test: `tests/integration/privacy-context.test.ts`

- [ ] **Step 1: Write the failing loader and precedence tests.**

Create a fixture with root/nested `AGENTS.md`, a Skill metadata file, a full
Skill body, a README instruction, and tool output that says to ignore policy.
Assert discovery returns metadata only, body loading occurs only after a
matching task, nested trusted instructions override parent instructions, and
README/tool output never enters the trusted instruction list.

- [ ] **Step 2: Run the tests and confirm there is no runtime Skill loader.**

Run: `bun test tests/unit/scoped-instructions.test.ts tests/unit/skills.test.ts`

- [ ] **Step 3: Implement bounded loader, trust labels, and deterministic precedence.**

Use `system > project root > nested scope > user task > memory > repository
data` for policy composition, while preserving user intent as the task
payload; a lower-trust source may add evidence but cannot change permissions.

- [ ] **Step 4: Integrate only trusted instruction content into the decision packet and record provenance.**

Include Skill metadata globally, include at most the selected Skill bodies under
their token budget, and add source IDs/trust labels to `ContextEvidence`.

- [ ] **Step 5: Run instruction/privacy/type checks and commit.**

Run: `bun test tests/unit/scoped-instructions.test.ts tests/unit/skills.test.ts tests/integration/privacy-context.test.ts`; `bun run typecheck`; `git add src/instructions src/context/instructions.ts src/context/context-compiler.ts tests/unit/scoped-instructions.test.ts tests/unit/skills.test.ts tests/integration/privacy-context.test.ts; git commit -m "feat: load scoped skills with trusted instruction precedence"`

### Task 9: Add bounded child-agent delegation (Phase 6)

**Files:**

- Create: `src/agent/subagents/types.ts`
- Create: `src/agent/subagents/coordinator.ts`
- Create: `src/agent/subagents/context.ts`
- Modify: `src/agent/types.ts`
- Modify: `src/agent/loop.ts`
- Test: `tests/unit/subagents.test.ts`
- Test: `tests/integration/subagents.test.ts`

- [ ] **Step 1: Write the failing child contract test.**

Submit `{ objective: "find callers", allowedTools: ["SearchText"], context:
{ sourceIds: ["src/parser.ts"] } }` and assert the child receives no parent
transcript, cannot call `EditFile`, returns evidence source IDs, and stops when
the parent signal aborts.

- [ ] **Step 2: Run the test and confirm delegation is missing.**

Run: `bun test tests/unit/subagents.test.ts tests/integration/subagents.test.ts`

- [ ] **Step 3: Implement a single-child foreground coordinator with no parallel mutation.**

Use a fresh provider request and a child `AgentTask` with an allowlisted tool
set. The child result must be `completed`, `blocked`, or `failed` with
structured evidence; no child may directly mark the parent complete.

- [ ] **Step 4: Integrate parent incorporation only after child evidence validates against the parent task scope.**

Reject evidence outside the parent root or scope, record the child result as a
ledger action, and require the parent to make the next decision.

- [ ] **Step 5: Add disposable worktree support and conflict refusal before any parallel path.**

Create a worktree only for a child explicitly marked isolated; refuse merge
when the parent or user changed the same path and surface a recovery contract.

- [ ] **Step 6: Run focused integration/security/type checks and commit.**

Run: `bun test tests/unit/subagents.test.ts tests/integration/subagents.test.ts`; `bun run typecheck`; `git add src/agent/subagents src/agent/types.ts src/agent/loop.ts tests/unit/subagents.test.ts tests/integration/subagents.test.ts; git commit -m "feat: add bounded fresh-context child agents"`

### Task 10: Add heterogeneous agent evaluations and release proof (Phase 7)

**Files:**

- Create: `tests/evals/agent-journeys.ts`
- Create: `tests/evals/fixtures/`
- Create: `scripts/evaluate-agent.ts`
- Modify: `scripts/smoke.ts`
- Modify: `docs/STATUS.md`
- Modify: `docs/agent-kernel/STATUS.md`
- Test: `tests/integration/agent-evaluations.test.ts`

- [ ] **Step 1: Add failing evaluation assertions for the required journeys.**

Define a table of fixture IDs and expected terminal states; include one
false-success fixture where the model claims completion without creating the
artifact, one failing-test repair, one restart/resume, one dirty-worktree
conflict, one compaction pressure run, and one strict-zero route rejection.

- [ ] **Step 2: Run the evaluator against fake providers and record the baseline.**

Run: `bun test tests/integration/agent-evaluations.test.ts`; expected output
must include per-journey status, verification status, recovery count, and no
aggregate success claim when a journey is unproven.

- [ ] **Step 3: Run the same matrix against available local models without downloading models or using paid inference.**

Use only models already discovered by the local runtime and record a skipped
reason for unloaded/ineligible models; never add a cloud request as fallback.

- [ ] **Step 4: Add artifact provenance and reproducible result output.**

Record source HEAD, executable hash, model/runtime/template/quant/context,
generation settings, OS/hardware, fixture revision, and test command.

- [ ] **Step 5: Run the release gate.**

Run: `bun run format:check`; `bun run typecheck`; `bun run test`; `bun run build`; `bun run smoke`; `bun test tests/integration/functional-acceptance.test.ts`; then exercise the rebuilt TUI at 80, 100, 120, and 160 columns with submit, cancellation, and exit.

- [ ] **Step 6: Re-score autonomy from fresh evidence and document remaining `UNPROVEN` capabilities.**

Update only claims supported by the evaluator output; do not raise a score for
unit tests that did not exercise a real model/artifact path.

- [ ] **Step 7: Commit the evaluation/release gate.**

Run: `git add tests/evals scripts/evaluate-agent.ts scripts/smoke.ts tests/integration/agent-evaluations.test.ts docs/STATUS.md docs/agent-kernel/STATUS.md; git commit -m "test: add autonomous coding evaluation gate"`

## Phase completion gate

A phase is complete only when its tests passed from the current source,
relevant integration behavior is exercised in a disposable fixture, no
security/cost/privacy invariant regressed, and the phase's capability is
observable through the active product path. A green unit suite alone does not
advance the phase.
