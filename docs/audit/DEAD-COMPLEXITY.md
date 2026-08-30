# Dead / unproven complexity matrix

> **Provenance:** INLINE fallback slice by the lead auditor (the `complexity-auditor`
> subagent was halted by the account session limit). Classifications below use only
> verified evidence (forensics `01` + a corrected importer census). The fuller
> `09-complexity-debt.md` (fan-in/out graph, per-function indicators, orchestration
> analysis) remains **TODO** for the full agent run. Nothing was deleted (charter §49).
> Snapshot: commit `230b557`, dirty tree.

Classes: `PROVEN_VALUE · LIKELY_VALUE · UNPROVEN · REDUNDANT · DEAD · HARMFUL · ABSENT`.

## Matrix

| System | Class | Evidence | Note |
| --- | --- | --- | --- |
| `core/` (`legacy-agent-runner.ts`, `swe-core.ts` 926 LOC, `task-runtime-repository.ts`) | **DEAD / dormant** | **0** non-core importers (`grep` over `src`, relative+absolute); forensics F-FORENSIC-001; `docs/architecture/swe-core.md:66-73` = never-resumed Phase-5 migration | Only importer is `tests/unit/swe-core.test.ts`. Misleadingly named "legacy" (it is newer, not older). |
| `storage/database.ts::saveAgentTask` (dead path) | **DEAD (hazardous)** | forensics F-FORENSIC-002 (P1); writes an incompatible payload into the live `agent_tasks` table; `getAgentRuntime` fallback (`database.ts:469-481`) already reconciles two encodings | Latent MULTIPLE_SOURCE_OF_TRUTH. Cross-ref `07-verification-recovery`. |
| `src/catalog/`, `src/git/`, `src/models/`, `src/telemetry/` | **ABSENT (scaffolding)** | empty dirs, no files, no git history (F-FORENSIC-003); real function lives in `tools/workspace.ts` (git), `cli/control-plane.ts` / `providers/types.ts` (models/catalog) | Directory scaffolding implies capability that is elsewhere; misleads structural reads. |
| `src/tui/dialogs/`, `src/tui/screens/` | **ABSENT (scaffolding)** | empty dirs | TUI scaffolding; low audit priority. |
| `agent/planner.ts` (1213 LOC), `agent/task-graph.ts`, `agent/task-scheduler.ts` | **UNPROVEN** | **wired** into the live loop (imported by `agent/loop.ts`) — NOT dead — but no real-model evidence they improve task success (see F-AUTO-001: 0/128 real-model tests) | "Wired" ≠ "effective". Effectiveness must be measured with a real 1-14B model before keeping/expanding. VALIDATE FIRST. |
| `agent/progressive-plan.ts` | **UNPROVEN** | 1 importer (`tui/app.tsx`); effectiveness unmeasured | As above. |
| `agent/dynamic-capabilities.ts` | **UNPROVEN** | 2 importers (`context/context-builder.ts`, `context/repository.ts`); effect on outcomes unmeasured | As above. |
| `agent/subagents/coordinator.ts` | **UNPROVEN** | 1 importer; product-level multi-agent is a v0.1 non-goal per `docs/PRODUCT.md` | Verify it is actually exercised, not speculative. |
| `agent/tool-envelope.ts` | **REDUNDANT (benign)** | re-export shim of `providers/tool-envelope.ts` (F-FORENSIC-forensics) | Harmless compat shim; not a duplicate implementation. |

## Responsibility concentration (not size-for-size)

Largest live files (LOC): `agent/loop.ts` **6281**, `tui/app.tsx` **4297**,
`tools/workspace.ts` 1964, `context/context-capsule.ts` 1602. `loop.ts` alone owns
turn loop + provider streaming + tool dispatch + ledger mutation + recovery +
completion gating + persistence callback (forensics). This is orchestration
concentration, not merely a big file — flag for the full `09` analysis of whether
it is a single-responsibility hazard for maintainability and for small-model
reasoning about control flow. **No split recommended on size alone** (charter §36).

## Handoff to full complexity audit (TODO)

Compute fan-in/out and circular deps; measure the UNPROVEN machinery against real
task success (needs `real-autonomy-evaluator` + a loaded model); decide keep/merge
for planner vs. task-graph vs. task-scheduler (three planning abstractions —
possible overlap, unverified here).
