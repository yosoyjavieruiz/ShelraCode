# ADR-000: Adopt a self-calibrating local SWE runtime

- **Status:** Accepted
- **Date:** 2026-08-27
- **Decision owners:** ShelraCode maintainers
- **Scope:** architecture direction and phase gates; no Phase 0 production-code
  migration

## Context

ShelraCode is a local-first coding product whose security, privacy, and
strict-zero invariants already matter in production-shaped paths. It also has a
substantial deterministic agent harness, typed tools/errors, routing policy,
checkpoints, persistence, context/planning services, and a canonical OpenTUI
path.

The current repository audit also found:

- large lifecycle-authority concentrations in `src/agent/loop.ts` and
  `src/tui/app.tsx`;
- scripted/fake-provider tests that are useful host evidence but not
  real-model autonomy evidence;
- one successful real-model micro-edit smoke beside a failed recovery probe and
  17 unproven local journeys;
- incomplete exact model/runtime/artifact/configuration identity;
- no protected held-out certification boundary;
- persistence and security assets that do not yet form authoritative durable
  task state or one enforceable ExecutionBroker;
- an existing Level 10 architecture specification whose controller-owned
  contracts, evidence, recovery, security, and measured delegation principles
  remain useful, but whose implementation ordering must now begin with
  evaluation and exact driver truth.

The product must not infer authority from model name, parameter count, model
card, parseable tool output, or a single demonstration. Small local models are
especially sensitive to action representation, tool surface, edit format,
context budget, templates, quantization, and runtime configuration.

## Research basis

Primary-source refresh on 2026-08-27 supports these design principles:

- OpenAI describes the Codex harness as the layer that manages context, tools,
  sandboxing, and approvals around model inference; the harness is part of the
  effective system capability.
  <https://developers.openai.com/blog/codex-as-a-platform>
- OpenAI's current model guidance recommends task-relevant tools, lean prompts,
  validation on representative tasks, and explicit approval boundaries rather
  than assuming benchmark or model capability transfers automatically.
  <https://developers.openai.com/api/docs/guides/latest-model>
- Claude Code documents separate mechanisms for project instructions, Skills,
  code intelligence, MCP, subagents, hooks, permissions, sandboxing, and
  worktrees. It also distinguishes deterministic hooks from contextual
  guidance and documents the context cost of always-on material.
  <https://code.claude.com/docs/en/features-overview>
- Aider supports model-dependent edit representations rather than treating one
  edit codec as universal.
  <https://aider.chat/docs/more/edit-formats.html>
- Continue documents both native tool use and system-message tool interfaces
  for models/providers with different capabilities.
  <https://docs.continue.dev/ide-extensions/agent/model-setup>

These sources support separation, calibration, bounded authority, and empirical
comparison. They do **not** establish that one architecture, context size,
protocol, or small model is universally optimal. ShelraCode must produce its
own paired and protected evidence.

## Decision

ShelraCode will evolve through a phase-gated strangler migration into a
**self-calibrating local software-engineering runtime**.

The governing rule is:

> Measure how an exact model/runtime/configuration can be driven reliably,
> select the smallest successful SWE loop, externalize mechanical cognition
> into deterministic host capabilities, and grant only the authority supported
> by objective evidence.

### 1. Exact configuration is the unit of capability

Capability profiles will be keyed to the model artifact, hash, quantization,
runtime/version, tokenizer, chat/tool template, structured-output and reasoning
modes, context/KV and sampling configuration, OS, and relevant hardware/backend
identity.

Material identity changes invalidate or degrade certification. Uncalibrated or
stale profiles receive no autonomous write/network authority.

### 2. Evaluation and evidence precede architectural migration

Shelra Lab foundations and durable run evidence are implemented before protocol
optimization or core extraction. Scripted providers remain host tests. Real
model runs, protected tasks, and release certification remain separately
labeled.

### 3. The core remains intentionally small

The target `SweCore` owns task lifecycle boundaries (`start`, `step`, `run`,
`cancel`, `inspect`, `resume`) while delegating:

- exact model driving;
- context compilation;
- repository intelligence;
- execution and policy;
- evidence and verification;
- recovery;
- persistence;
- optional capability activation;
- evaluation.

No replacement mega-manager is accepted. Existing runtime behavior is migrated
behind compatibility boundaries and removed only after paired parity or
improvement evidence.

### 4. The controller owns truth

Authoritative task state, acceptance obligations, legal actions, evidence,
repository baseline, profile, checkpoints, and recovery history are host-owned.
The model receives a compiled context capsule for one bounded semantic decision
by default. Model-generated summaries or `done` declarations never become
authoritative state by themselves.

### 5. Optional intelligence is measured and removable

Skills, retrieval, experts, subagents, semantic indexing, batching, and larger
tool surfaces remain optional capabilities. Automatic activation requires
profile compatibility, policy permission, and paired evidence without
unacceptable false-success, security, latency, or context cost.

Concurrent writable agents require isolated worktrees/equivalent checkouts.
Parallel mutation of the same checkout is forbidden.

### 6. Side effects and security remain host-enforced

All consequential side effects will converge on an `ExecutionBroker` with path,
symlink, stale-state, command, network, secret, budget, evidence, and rollback
controls. Strict-zero egress claims require enforceable host/OS evidence where
the platform permits it; prompt text and route metadata alone are insufficient.

### 7. Completion and release are proof obligations

Every task has stable acceptance obligations. The host accepts completion only
from concrete evidence. Public benchmarks are research references. Capability
levels C0–C6 require protected, repeated, exact-profile evidence, and marketing
cannot exceed the highest fully certified level.

## Reconciliation with the current repository

### Preserve and extend

The migration will preserve and test current useful assets:

- privacy and strict-zero routing invariants;
- typed errors and validated tool boundaries;
- task contracts, ledgers, transitions, plans, and execution profiles;
- context compilation and repository-intelligence foundations;
- stale-edit and checkpoint protections;
- cancellation and normalized failures;
- persistence/snapshot/resume foundations;
- deterministic host tests and functional acceptance journeys;
- the canonical SolidJS/OpenTUI interface and current stack.

### Strangle behind new boundaries

- `src/agent/loop.ts`: progressively move model driving, task state, evidence,
  execution, verification, recovery, and persistence authority behind explicit
  services.
- `src/tui/app.tsx`: make the TUI observe/control runtime services rather than
  own the task lifecycle and objective-verification composition.
- current capability caches/classifiers: migrate from provider/model-name keys
  and heuristics to exact versioned driver profiles and invalidation.
- evaluator stdout summaries: migrate to schemas, manifests, raw artifacts, and
  protected result boundaries.

### Defer until measured

- semantic/vector repository retrieval;
- runtime multi-agent teams;
- automatically active Skills;
- writable delegation without worktree isolation;
- a managed llama.cpp path unless product/runtime evidence justifies it;
- training/fine-tuning before verified trajectory governance exists;
- any assertion of 1.5B–14B parity with frontier systems.

### Reject

- big-bang replacement of the working runtime;
- model-card or model-name capability promotion;
- parse-only calibration presented as semantic success;
- fake-provider pass counts presented as autonomy;
- benchmark/task-ID special-casing;
- hidden-answer exposure to implementation or training;
- retrying identical failed actions as the default recovery policy;
- prompt-only security for enforceable boundaries;
- feature completion used as release certification.

## Roadmap precedence and crosswalk

The 17-phase self-calibrating-runtime roadmap is the implementation sequence for
this decision. Existing architecture work remains source material as follows:

| Existing concern                                          | New roadmap home                               |
| --------------------------------------------------------- | ---------------------------------------------- |
| objective compiler, task contract, controller-owned state | Phases 5, 6, and 8                             |
| durable persistence and resume                            | Phase 11                                       |
| planning/context/execution profiles                       | Phases 5 and 6                                 |
| evidence, verification, failure recovery                  | Phases 8 and 9                                 |
| Skills and delegation                                     | Phases 10 and 13, only after paired evaluation |
| security hardening                                        | Phase 12, behind one execution boundary        |
| evaluation and release acceptance                         | Phases 1–4 and 16                              |

When the roadmap, older architecture document, and current code disagree:

1. product privacy/security/cost invariants remain mandatory;
2. fresh executable/source evidence outranks historical descriptions;
3. this ADR governs migration direction;
4. a phase cannot proceed past a failed gate without correction or an explicit
   superseding ADR.

## Consequences

### Positive

- capability and authority become truthful for the exact local configuration;
- weak models can still deliver useful certified lower-tier behavior;
- deterministic host services remove mechanical work from scarce model context;
- failures become regression inputs rather than hidden retry loops;
- existing working assets can migrate incrementally;
- fake, real-model, source, and artifact evidence become auditable.

### Costs and trade-offs

- early phases emphasize schemas, evidence, and reproducibility over visible
  product features;
- exact identity and repeated trials increase storage and evaluation time;
- some runtimes may remain C0/C1 when they cannot expose or demonstrate enough
  identity/behavior;
- strict phase gates may stop the roadmap while a failure is investigated;
- optional features can remain disabled even when architecturally attractive.

### Risks to manage

- creating nominally separate services that merely move the mega-loop;
- leaking protected acceptance data into prompts or trajectory exports;
- conflating a catalog context limit with the loaded runtime configuration;
- allowing dirty-source provenance to collapse to `HEAD`;
- accepting tool syntax while scoring the wrong semantic action as success;
- presenting the existing executable as current-source evidence without a build
  manifest and real interactive acceptance.

## Alternatives considered

### Keep the current agent and improve prompts

Rejected as the governing strategy. It cannot establish exact model identity,
host-owned completion, protected evidence, enforceable side-effect policy, or
durable recovery.

### Big-bang rewrite around the target diagram

Rejected. It would discard useful safety/test assets and make behavioral parity
hard to prove in a dirty, actively developed repository.

### Start with multi-agent orchestration

Rejected. Single-agent capability, persistence, verification, recovery, and
security are prerequisite evidence. Delegation is added only where it beats a
paired single-agent baseline.

### Use a large context and broad tool surface for every model

Rejected. Context and tool interfaces consume model capacity and must be
calibrated. The default is the smallest useful capsule and one semantic action
per decision.

### Use public benchmarks as release authority

Rejected. They do not prove ShelraCode's exact runtime, security, durability,
false-success behavior, or protected generalization.

## Phase gate

Phase 0 accepts documentation-only changes when:

- current architecture, commands, tests, lifecycle authority, artifacts, and
  evidence boundaries are recorded;
- the current suite passes or every known failure is reproducibly recorded;
- at least one available real local configuration is attempted without
  fabricated results;
- fake/scripted and real-model evidence are explicitly separated;
- no architecture rewrite occurs.

The gate outcome is recorded in `docs/phases/phase-00-report.md`. Passing Phase 0
authorizes only the start of Phase 1; it does not certify product autonomy or
authorize later phases.
