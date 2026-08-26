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

export function terminalPhase(phase: AgentPhase): boolean {
  return terminalPhases.has(phase);
}

/**
 * Reopen a persisted non-complete task for a new user-controlled resume.
 * Completed work is intentionally immutable; blocked/failed/cancelled work
 * resumes through the reflective recovery phase instead of replaying an
 * in-flight mutation.
 */
export function reopenTaskForResume(ledger: AgentTaskLedger): void {
  if (ledger.phase === "complete")
    throw new Error("A completed task cannot be resumed as active work.");
  if (terminalPhases.has(ledger.phase)) ledger.phase = "reflect";
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
  if (
    phase === "complete" &&
    ledger.phase !== "review" &&
    ledger.phase !== "verify"
  )
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
  if (!values.includes(value)) values.push(value);
}
