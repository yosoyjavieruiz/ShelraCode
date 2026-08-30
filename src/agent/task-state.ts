import { workspacePathComparisonKey } from "../shared/workspace-paths.js";
import type { TurnMode } from "./turn-policy.js";
import type { VerificationCommand } from "./verification-plan.js";
import type { TaskGraph } from "./task-graph.js";
import type { AdaptiveExecutionProfile } from "./execution-profile.js";
import type { PlanRevision } from "./planner.js";
import type { RecoveryContract } from "./recovery.js";
import type { TaskContract } from "./task-contract.js";

export type AgentPhase =
  | "frame"
  | "discover"
  | "analyze"
  | "plan"
  | "act"
  | "observe"
  | "reflect"
  | "verify"
  | "review"
  | "complete"
  | "blocked"
  | "failed"
  | "cancelled";

export interface SuccessCriterion {
  id: string;
  description: string;
  required: boolean;
  satisfied: boolean;
}

export interface TaskConstraint {
  id: string;
  description: string;
}

export interface ContextEvidence {
  id: string;
  kind:
    | "manifest"
    | "file"
    | "search"
    | "git"
    | "test"
    | "tool-result"
    | "decision";
  source: string;
  summary: string;
  relevance: number;
  freshness: number;
}

export interface Hypothesis {
  id: string;
  statement: string;
  status: "open" | "supported" | "rejected";
}

export interface PlanStep {
  id: string;
  description: string;
  status: "pending" | "active" | "done" | "failed" | "skipped";
  kind?: "workspace" | "semantic" | "clarification";
  source?: "model" | "controller" | "controller-recovery";
  revision?: number;
  dependencies?: string[];
  scope?: string[];
  evidenceRequired?: string[];
  verification?: string[];
}

export interface TaskPlan {
  steps: PlanStep[];
  updatedAt: string;
  source?: "model" | "controller";
  revision?: number;
  revisions?: PlanRevision[];
  objective?: string;
  acceptanceCriteria?: string[];
  evidenceRequirements?: string[];
}

export interface AgentAction {
  id: string;
  kind:
    "read" | "search" | "write" | "execute" | "verify" | "review" | "decide";
  target: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  startedAt?: string;
  completedAt?: string;
  summary?: string;
}

export interface VerificationRun {
  id: string;
  stage?: VerificationCommand["stage"];
  command: string;
  status: "running" | "passed" | "failed" | "cancelled";
  exitCode?: number;
  summary?: string;
  /** Workspace-relative test/spec paths extracted from a failed run. */
  failurePaths?: string[];
  startedAt: string;
  completedAt?: string;
}

export interface TaskBlocker {
  id: string;
  summary: string;
  recoverable: boolean;
  suggestedAction?: string;
}

export interface AgentTaskLedger {
  id: string;
  objective: string;
  mode: TurnMode;
  phase: AgentPhase;
  contract?: TaskContract;
  executionProfile?: AdaptiveExecutionProfile;
  planningMode?: "none" | "model" | "compatibility";
  successCriteria: SuccessCriterion[];
  constraints: TaskConstraint[];
  evidence: ContextEvidence[];
  hypotheses: Hypothesis[];
  plan?: TaskPlan;
  verificationPlan: VerificationCommand[];
  /** Controller-owned long-horizon execution graph; model context is only a view. */
  taskGraph?: TaskGraph;
  planRevisions: PlanRevision[];
  recoveryContracts: RecoveryContract[];
  actions: AgentAction[];
  filesRead: string[];
  filesChanged: string[];
  verificationRuns: VerificationRun[];
  blockers: TaskBlocker[];
  startedAt: string;
  updatedAt: string;
}

const terminalPhases = new Set<AgentPhase>([
  "complete",
  "blocked",
  "failed",
  "cancelled",
]);

const phaseTransitions: Readonly<Record<AgentPhase, ReadonlySet<AgentPhase>>> =
  {
    frame: new Set(["discover", "blocked", "failed", "cancelled"]),
    discover: new Set(["analyze", "reflect", "blocked", "failed", "cancelled"]),
    analyze: new Set([
      "plan",
      "act",
      "reflect",
      "verify",
      "review",
      "blocked",
      "failed",
      "cancelled",
    ]),
    plan: new Set([
      "act",
      "reflect",
      "verify",
      "review",
      "blocked",
      "failed",
      "cancelled",
    ]),
    act: new Set([
      "observe",
      "reflect",
      "verify",
      "plan",
      "blocked",
      "failed",
      "cancelled",
    ]),
    observe: new Set([
      "act",
      "reflect",
      "verify",
      "plan",
      "review",
      "blocked",
      "failed",
      "cancelled",
    ]),
    reflect: new Set([
      "discover",
      "plan",
      "act",
      "observe",
      "verify",
      "review",
      "blocked",
      "failed",
      "cancelled",
    ]),
    verify: new Set([
      "reflect",
      "review",
      "plan",
      "act",
      "blocked",
      "failed",
      "cancelled",
    ]),
    review: new Set([
      "complete",
      "blocked",
      "plan",
      "reflect",
      "failed",
      "cancelled",
    ]),
    complete: new Set(),
    blocked: new Set(),
    failed: new Set(),
    cancelled: new Set(),
  };

export function terminalPhase(phase: AgentPhase): boolean {
  return terminalPhases.has(phase);
}

export function canTransitionTaskPhase(
  from: AgentPhase,
  to: AgentPhase,
): boolean {
  return from === to || phaseTransitions[from].has(to);
}

/**
 * The working tree changed in task-owned paths between the crash and this
 * resume (resume-policy.ts's "task_changes_detected"). Nothing in the ledger
 * links a successCriterion or verificationRun to the specific path(s) it
 * depended on, so proof recorded before this point cannot be trusted to
 * still hold for content that changed underneath it: reset it and drop
 * evidence for the changed paths so the next turn re-reads them, instead of
 * resuming on stale completion state.
 */
function invalidateStaleResumeProof(
  ledger: AgentTaskLedger,
  changedPaths: readonly string[],
): void {
  const changedKeys = new Set(changedPaths.map(workspacePathComparisonKey));
  ledger.filesRead = ledger.filesRead.filter(
    (path) => !changedKeys.has(workspacePathComparisonKey(path)),
  );
  ledger.evidence = ledger.evidence.filter(
    (item) => !changedKeys.has(workspacePathComparisonKey(item.source)),
  );
  for (const criterion of ledger.successCriteria) criterion.satisfied = false;
  ledger.verificationRuns = [];
}

/**
 * Reopen a persisted non-complete task for a new user-controlled resume.
 * Completed work is intentionally immutable; blocked/failed/cancelled work
 * resumes through the reflective recovery phase instead of replaying an
 * in-flight mutation. `changedPaths` are task-owned paths the host found
 * changed on disk since the persisted snapshot; any completion proof or
 * evidence recorded before this point is invalidated for them.
 */
export function reopenTaskForResume(
  ledger: AgentTaskLedger,
  changedPaths: readonly string[] = [],
): void {
  if (ledger.phase === "complete")
    throw new Error("A completed task cannot be resumed as active work.");
  if (terminalPhases.has(ledger.phase)) ledger.phase = "reflect";
  if (changedPaths.length > 0) invalidateStaleResumeProof(ledger, changedPaths);
  ledger.updatedAt = now();
}

function now(): string {
  return new Date().toISOString();
}

export function createTaskLedger(input: {
  id: string;
  objective: string;
  mode: TurnMode;
  contract?: TaskContract;
  executionProfile?: AdaptiveExecutionProfile;
  planningMode?: "none" | "model" | "compatibility";
  successCriteria?: SuccessCriterion[];
  constraints?: TaskConstraint[];
  verificationPlan?: VerificationCommand[];
}): AgentTaskLedger {
  const timestamp = now();
  return {
    id: input.id,
    objective: input.objective,
    mode: input.mode,
    phase: "frame",
    ...(input.contract ? { contract: input.contract } : {}),
    ...(input.executionProfile
      ? { executionProfile: input.executionProfile }
      : {}),
    ...(input.planningMode ? { planningMode: input.planningMode } : {}),
    successCriteria: input.successCriteria ?? [],
    constraints: input.constraints ?? [],
    verificationPlan: input.verificationPlan ?? [],
    evidence: [],
    hypotheses: [],
    actions: [],
    filesRead: [],
    filesChanged: [],
    verificationRuns: [],
    blockers: [],
    planRevisions: [],
    recoveryContracts: [],
    startedAt: timestamp,
    updatedAt: timestamp,
  };
}

export function setTaskPhase(ledger: AgentTaskLedger, phase: AgentPhase): void {
  if (terminalPhases.has(ledger.phase))
    throw new Error(`Cannot transition terminal task phase ${ledger.phase}`);
  if (!canTransitionTaskPhase(ledger.phase, phase))
    throw new Error(
      `Invalid task phase transition ${ledger.phase} -> ${phase}`,
    );
  ledger.phase = phase;
  ledger.updatedAt = now();
}

export function addTaskEvidence(
  ledger: AgentTaskLedger,
  evidence: ContextEvidence,
): void {
  if (!ledger.evidence.some((item) => item.id === evidence.id))
    ledger.evidence.push(evidence);
  ledger.updatedAt = now();
}

export function setTaskPlan(ledger: AgentTaskLedger, plan: TaskPlan): void {
  ledger.plan = plan;
  ledger.updatedAt = now();
}

export function recordPlanRevision(
  ledger: AgentTaskLedger,
  revision: PlanRevision,
): void {
  if (!ledger.planRevisions.some((item) => item.id === revision.id))
    ledger.planRevisions.push(revision);
  ledger.updatedAt = now();
}

export function recordRecoveryContract(
  ledger: AgentTaskLedger,
  recovery: RecoveryContract,
): void {
  if (!ledger.recoveryContracts.some((item) => item.id === recovery.id))
    ledger.recoveryContracts.push(recovery);
  ledger.updatedAt = now();
}

export function updateTaskPlanStep(
  ledger: AgentTaskLedger,
  stepId: string,
  status: PlanStep["status"],
): boolean {
  const step = ledger.plan?.steps.find((candidate) => candidate.id === stepId);
  if (!step || step.status === status) return false;
  step.status = status;
  if (ledger.plan) ledger.plan.updatedAt = now();
  ledger.updatedAt = now();
  return true;
}

export function addTaskBlocker(
  ledger: AgentTaskLedger,
  blocker: TaskBlocker,
): void {
  if (!ledger.blockers.some((item) => item.id === blocker.id))
    ledger.blockers.push(blocker);
  ledger.updatedAt = now();
}

export function satisfyTaskCriterion(
  ledger: AgentTaskLedger,
  criterionId: string,
): void {
  setTaskCriterion(ledger, criterionId, true);
}

export function setTaskCriterion(
  ledger: AgentTaskLedger,
  criterionId: string,
  satisfied: boolean,
): void {
  const criterion = ledger.successCriteria.find(
    (item) => item.id === criterionId,
  );
  if (criterion) criterion.satisfied = satisfied;
  ledger.updatedAt = now();
}

export function recordTaskAction(
  ledger: AgentTaskLedger,
  action: AgentAction,
): void {
  const existing = ledger.actions.find((item) => item.id === action.id);
  if (existing) Object.assign(existing, action);
  else ledger.actions.push(action);
  if (action.status === "succeeded" && action.kind === "read")
    addUnique(ledger.filesRead, action.target);
  if (action.status === "succeeded" && action.kind === "write")
    addUnique(ledger.filesChanged, action.target);
  ledger.updatedAt = now();
}

/**
 * Attribute paths the host observed as newly changed on disk around a
 * successful Shell/RunTests call. Those tools have risk "execute", not
 * "write", so recordTaskAction's target (the tool name, since execute
 * actions have no single file path) never reaches filesChanged; without
 * this, a task's own side-effecting shell command (formatter, lockfile
 * regeneration, install) is invisible to the resume-ownership check and a
 * safe resume is wrongly blocked as "changes outside the task scope".
 */
export function recordTaskMutatedPaths(
  ledger: AgentTaskLedger,
  paths: readonly string[],
): void {
  if (paths.length === 0) return;
  for (const path of paths) addUnique(ledger.filesChanged, path);
  ledger.updatedAt = now();
}

export function recordVerificationRun(
  ledger: AgentTaskLedger,
  run: VerificationRun,
): void {
  const existing = ledger.verificationRuns.find((item) => item.id === run.id);
  if (existing) Object.assign(existing, run);
  else ledger.verificationRuns.push(run);
  ledger.updatedAt = now();
}

function addUnique(values: string[], value: string): void {
  const key = workspacePathComparisonKey(value);
  if (!values.some((existing) => workspacePathComparisonKey(existing) === key))
    values.push(value);
}
