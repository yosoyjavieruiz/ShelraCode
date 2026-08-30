import type { TaskRuntimeSnapshot } from "../agent/task-runtime-state.js";

export type TaskId = string;

export interface Objective {
  text: string;
}

export type ObjectiveInput = Objective | string;

export interface WorkspaceRef {
  root: string;
}

/**
 * Policy is intentionally host-owned and provider-neutral. Provider/runtime
 * settings remain behind the injected driver boundary rather than becoming
 * part of the Core lifecycle contract.
 */
export interface TaskPolicy {
  maxSteps?: number;
  maxWallClockMs?: number;
  metadata?: Readonly<Record<string, string | number | boolean>>;
}

export type TaskStatus =
  "ready" | "running" | "completed" | "blocked" | "failed" | "cancelled";

export interface TaskSnapshot {
  taskId: TaskId;
  objective: Objective;
  workspace: WorkspaceRef;
  policy: TaskPolicy;
  status: TaskStatus;
  stepCount: number;
  progressRevision: number;
  createdAt: string;
  updatedAt: string;
  /** Host-created runtime state, never model-generated state. */
  runtimeSnapshot?: TaskRuntimeSnapshot;
  lastError?: string;
  lastSummary?: string;
  evidenceRefs: string[];
}

export interface PreparedTask {
  taskId?: TaskId;
  objective: ObjectiveInput;
  workspace: WorkspaceRef;
  policy: TaskPolicy;
  runtimeSnapshot?: TaskRuntimeSnapshot;
}

export interface RunBudget {
  maxSteps: number;
  wallClockBudgetMs?: number;
}

export interface SweAction {
  kind: string;
  arguments?: Readonly<Record<string, unknown>>;
}

export type SweDecision =
  | {
      type: "action";
      action: SweAction;
    }
  | {
      type: "complete";
      summary?: string;
      evidenceRefs?: readonly string[];
    }
  | {
      type: "blocked";
      reason: string;
      evidenceRefs?: readonly string[];
    };

export interface SweDriverRequest {
  task: TaskSnapshot;
  signal: AbortSignal;
  remainingSteps: number;
}

export interface SweStepRequest extends SweDriverRequest {
  actionNumber: number;
}

export interface SweExecutionRequest extends SweDriverRequest {
  decision: Extract<SweDecision, { type: "action" }>;
  actionId: string;
}

export interface SweVerificationRequest {
  task: TaskSnapshot;
  signal: AbortSignal;
  decision: SweDecision;
  execution?: SweExecutionOutcome;
}

export type SweExecutionStatus =
  "running" | "succeeded" | "completed" | "blocked" | "failed" | "cancelled";

export interface SweExecutionOutcome {
  status: SweExecutionStatus;
  progressed: boolean;
  verified: boolean;
  summary?: string;
  failureCode?: string;
  evidenceRefs?: readonly string[];
  runtimeSnapshot?: TaskRuntimeSnapshot;
}

export interface SweVerificationOutcome {
  status: "passed" | "failed" | "unavailable";
  /** True only when the complete task, not merely one action, is proven. */
  taskComplete: boolean;
  summary?: string;
  failureCode?: string;
  evidenceRefs?: readonly string[];
}

/** Model adaptation boundary. It never exposes provider-specific objects. */
export interface SweDriverBoundary {
  decide(request: SweDriverRequest): Promise<SweDecision>;
  cancel?(request: { task: TaskSnapshot; signal: AbortSignal }): Promise<void>;
  resume?(request: { task: TaskSnapshot; signal: AbortSignal }): Promise<void>;
}

/** Side effects and policy checks live outside the Core lifecycle. */
export interface SweExecutionBoundary {
  run(request: SweExecutionRequest): Promise<SweExecutionOutcome>;
  cancel?(request: { task: TaskSnapshot; signal: AbortSignal }): Promise<void>;
}

/** Objective verification is host-owned and independent of model claims. */
export interface SweVerificationBoundary {
  verify(request: SweVerificationRequest): Promise<SweVerificationOutcome>;
}

export interface SweTaskExecutor {
  /** Whole-run compatibility path, used by the legacy agent runner. */
  run(request: SweDriverRequest): Promise<SweExecutionOutcome>;
  /** Genuine one-decision continuation boundary, when a driver supports it. */
  step?(request: SweStepRequest): Promise<SweExecutionOutcome>;
  cancel?(request: { task: TaskSnapshot; signal: AbortSignal }): Promise<void>;
  resume?(request: { task: TaskSnapshot; signal: AbortSignal }): Promise<void>;
}

export interface CoreBoundaries {
  /** The driver/execution/verification ports are optional when a composite executor is supplied. */
  driver?: SweDriverBoundary;
  execution?: SweExecutionBoundary;
  verification?: SweVerificationBoundary;
  executor?: SweTaskExecutor;
}

export interface TaskRuntimeRepository {
  create(snapshot: TaskSnapshot): Promise<void> | void;
  load(
    taskId: TaskId,
  ): Promise<TaskSnapshot | undefined> | TaskSnapshot | undefined;
  save(snapshot: TaskSnapshot): Promise<void> | void;
}

export interface StepResult {
  taskId: TaskId;
  supported: boolean;
  status: TaskStatus;
  terminal: boolean;
  progressed: boolean;
  stepCount: number;
  snapshot: TaskSnapshot;
  reason?: string;
}

export interface RunResult extends StepResult {
  stepsRun: number;
  reason:
    | "completed"
    | "blocked"
    | "failed"
    | "cancelled"
    | "budget_exhausted"
    | "step_unsupported"
    | "unverified_completion";
}

export interface SweCore {
  startTask(
    objective: ObjectiveInput,
    workspace: WorkspaceRef,
    policy: TaskPolicy,
  ): Promise<TaskId>;
  step(taskId: TaskId): Promise<StepResult>;
  run(taskId: TaskId, budget: RunBudget): Promise<RunResult>;
  cancel(taskId: TaskId): Promise<void>;
  inspect(taskId: TaskId): Promise<TaskSnapshot>;
  resume(taskId: TaskId): Promise<RunResult>;
}
