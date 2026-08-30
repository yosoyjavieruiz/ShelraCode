import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  InMemoryTaskRuntimeRepository,
  TaskStateService,
  TaskStateNotFoundError,
} from "./task-runtime-repository.js";
import type {
  CoreBoundaries,
  Objective,
  ObjectiveInput,
  PreparedTask,
  RunBudget,
  RunResult,
  StepResult,
  SweAction,
  SweDecision,
  SweDriverRequest,
  SweExecutionOutcome,
  SweExecutionRequest,
  SweTaskExecutor,
  SweVerificationOutcome,
  SweVerificationRequest,
  SweCore,
  TaskId,
  TaskPolicy,
  TaskRuntimeRepository,
  TaskSnapshot,
  TaskStatus,
  WorkspaceRef,
} from "./types.js";
import type { TaskRuntimeSnapshot } from "../agent/task-runtime-state.js";

const DEFAULT_MAX_STEPS = 8;
const DEFAULT_MAX_WALL_CLOCK_MS = 120_000;
const MAX_SUMMARY_LENGTH = 500;
const MAX_EVIDENCE_REFS = 128;

export class SweCoreTaskNotFoundError extends TaskStateNotFoundError {
  readonly code = "TASK_NOT_FOUND" as const;

  constructor(taskId: TaskId) {
    super(taskId);
    this.name = "SweCoreTaskNotFoundError";
  }
}

export class SweCoreConcurrencyError extends Error {
  readonly code = "TASK_OPERATION_IN_PROGRESS" as const;

  constructor(
    readonly taskId: TaskId,
    readonly operation: "run" | "step",
  ) {
    super(`Task ${taskId} already has an active ${operation} operation.`);
    this.name = "SweCoreConcurrencyError";
  }
}

export class SweCoreConfigurationError extends Error {
  readonly code = "INVALID_CORE_CONFIGURATION" as const;
}

export class SweCoreStateError extends Error {
  readonly code = "INVALID_TASK_STATE" as const;
}

interface SweCoreOptions extends CoreBoundaries {
  state?: TaskStateService;
  repository?: TaskRuntimeRepository;
  idFactory?: () => TaskId;
  clock?: () => string;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function now(): string {
  return new Date().toISOString();
}

function boundedText(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0) return undefined;
  return normalized.length > MAX_SUMMARY_LENGTH
    ? `${normalized.slice(0, MAX_SUMMARY_LENGTH)}…[truncated]`
    : normalized;
}

function failureText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return boundedText(message) ?? "The task executor failed without a message.";
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function isPersistenceConflict(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  return (
    code === "STALE_RUNTIME_SNAPSHOT" ||
    code === "TASK_STATE_CONFLICT" ||
    error.name === "RuntimePersistenceConflictError" ||
    /STALE_RUNTIME_SNAPSHOT|TASK_STATE_CONFLICT/u.test(error.message)
  );
}

function objectiveValue(input: ObjectiveInput): Objective {
  const text = typeof input === "string" ? input : input.text;
  if (typeof text !== "string" || text.trim().length === 0)
    throw new SweCoreConfigurationError("Objective text is required.");
  return { text: text.trim() };
}

function workspaceValue(input: WorkspaceRef): WorkspaceRef {
  if (
    !input ||
    typeof input.root !== "string" ||
    input.root.trim().length === 0
  )
    throw new SweCoreConfigurationError("Workspace root is required.");
  return { root: path.resolve(input.root) };
}

function positiveInteger(value: number | undefined, fallback: number): number {
  const effective = value ?? fallback;
  if (!Number.isInteger(effective) || effective <= 0)
    throw new SweCoreConfigurationError(
      "Task budgets must be positive integers.",
    );
  return effective;
}

function normalizedPolicy(policy: TaskPolicy): TaskPolicy {
  if (!policy || typeof policy !== "object")
    throw new SweCoreConfigurationError("Task policy is required.");
  const maxSteps = positiveInteger(policy.maxSteps, DEFAULT_MAX_STEPS);
  const maxWallClockMs = positiveInteger(
    policy.maxWallClockMs,
    DEFAULT_MAX_WALL_CLOCK_MS,
  );
  return {
    maxSteps,
    maxWallClockMs,
    ...(policy.metadata ? { metadata: clone(policy.metadata) } : {}),
  };
}

function normalizedBudget(
  budget: RunBudget,
  policy: TaskPolicy,
): Required<RunBudget> {
  const requestedSteps = positiveInteger(budget.maxSteps, DEFAULT_MAX_STEPS);
  const requestedWallClock = positiveInteger(
    budget.wallClockBudgetMs,
    policy.maxWallClockMs ?? DEFAULT_MAX_WALL_CLOCK_MS,
  );
  return {
    maxSteps: Math.min(requestedSteps, policy.maxSteps ?? DEFAULT_MAX_STEPS),
    wallClockBudgetMs: Math.min(
      requestedWallClock,
      policy.maxWallClockMs ?? DEFAULT_MAX_WALL_CLOCK_MS,
    ),
  };
}

function evidenceRefs(values: readonly string[] | undefined): string[] {
  if (!values) return [];
  return [
    ...new Set(
      values
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ].slice(0, MAX_EVIDENCE_REFS);
}

function isTaskStatusTerminal(status: TaskStatus): boolean {
  return (
    status === "completed" ||
    status === "blocked" ||
    status === "failed" ||
    status === "cancelled"
  );
}

function isSweAction(value: unknown): value is SweAction {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  if (typeof record.kind !== "string" || record.kind.trim().length === 0)
    return false;
  if (record.arguments === undefined) return true;
  return (
    typeof record.arguments === "object" &&
    record.arguments !== null &&
    !Array.isArray(record.arguments)
  );
}

function isSweDecision(value: unknown): value is SweDecision {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  if (record.type === "action") return isSweAction(record.action);
  if (record.type === "complete") return true;
  return (
    record.type === "blocked" &&
    typeof record.reason === "string" &&
    record.reason.trim().length > 0
  );
}

function isExecutionOutcome(value: unknown): value is SweExecutionOutcome {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const record = value as Record<string, unknown>;
  if (
    ![
      "running",
      "succeeded",
      "completed",
      "blocked",
      "failed",
      "cancelled",
    ].includes(String(record.status)) ||
    typeof record.progressed !== "boolean" ||
    typeof record.verified !== "boolean"
  )
    return false;
  if (
    (record.summary !== undefined && typeof record.summary !== "string") ||
    (record.failureCode !== undefined &&
      typeof record.failureCode !== "string") ||
    (record.evidenceRefs !== undefined &&
      (!Array.isArray(record.evidenceRefs) ||
        !record.evidenceRefs.every((value) => typeof value === "string")))
  )
    return false;
  return true;
}

function validateRuntimeSnapshot(
  snapshot: TaskRuntimeSnapshot,
  task: TaskSnapshot,
): void {
  if (
    !snapshot ||
    typeof snapshot !== "object" ||
    typeof snapshot.taskId !== "string" ||
    typeof snapshot.repositoryRoot !== "string" ||
    !snapshot.ledger ||
    snapshot.taskId !== task.taskId ||
    path.resolve(snapshot.repositoryRoot) !== task.workspace.root ||
    snapshot.ledger.id !== task.taskId ||
    snapshot.ledger.objective !== task.objective.text
  ) {
    throw new SweCoreStateError(
      `Runtime snapshot ${
        typeof snapshot?.taskId === "string" ? snapshot.taskId : "unknown"
      } does not match task ${task.taskId}.`,
    );
  }
}

function resultReason(status: TaskStatus): RunResult["reason"] {
  if (status === "completed") return "completed";
  if (status === "cancelled") return "cancelled";
  if (status === "failed") return "failed";
  return "blocked";
}

function composeBoundaries(boundaries: CoreBoundaries): SweTaskExecutor {
  if (boundaries.executor) return boundaries.executor;
  if (!boundaries.driver || !boundaries.execution || !boundaries.verification)
    throw new SweCoreConfigurationError(
      "Provide an executor or all driver, execution, and verification boundaries.",
    );
  const { driver, execution, verification } = boundaries;
  const executeStep = async (
    request: SweDriverRequest & { actionNumber?: number },
  ): Promise<SweExecutionOutcome> => {
    const decision = await driver.decide(request);
    if (!isSweDecision(decision))
      throw new SweCoreStateError(
        "Driver returned an invalid semantic decision.",
      );
    if (decision.type === "blocked")
      return {
        status: "blocked",
        progressed: false,
        verified: false,
        summary: decision.reason,
        evidenceRefs: evidenceRefs(decision.evidenceRefs),
        failureCode: "DRIVER_BLOCKED",
      };
    if (decision.type === "complete") {
      const verificationResult = await verification.verify({
        task: request.task,
        signal: request.signal,
        decision,
      });
      return fromVerification(decision, verificationResult, false);
    }
    const actionId = `${request.task.taskId}:action:${request.task.stepCount + 1}`;
    const executionResult = await execution.run({
      ...request,
      decision,
      actionId,
    });
    if (executionResult.status !== "succeeded")
      return {
        ...executionResult,
        verified: false,
        evidenceRefs: evidenceRefs(executionResult.evidenceRefs),
      };
    const verificationResult = await verification.verify({
      task: request.task,
      signal: request.signal,
      decision,
      execution: executionResult,
    });
    return fromVerification(
      decision,
      verificationResult,
      executionResult.progressed,
    );
  };
  return {
    async step(request) {
      return executeStep(request);
    },
    async run(request) {
      return executeStep(request);
    },
    ...(driver.cancel || execution.cancel
      ? {
          cancel: async ({
            task,
            signal,
          }: {
            task: TaskSnapshot;
            signal: AbortSignal;
          }) => {
            if (driver.cancel) await driver.cancel({ task, signal });
            if (execution.cancel) await execution.cancel({ task, signal });
          },
        }
      : {}),
    ...(driver.resume
      ? {
          resume: async ({
            task,
            signal,
          }: {
            task: TaskSnapshot;
            signal: AbortSignal;
          }) => {
            await driver.resume?.({ task, signal });
          },
        }
      : {}),
  };
}

function fromVerification(
  decision: SweDecision,
  verification: SweVerificationOutcome,
  progressed: boolean,
): SweExecutionOutcome {
  const refs = evidenceRefs([
    ...(decision.type === "action" ? [] : (decision.evidenceRefs ?? [])),
    ...(verification.evidenceRefs ?? []),
  ]);
  if (verification.status === "passed" && verification.taskComplete)
    return {
      status: "completed",
      progressed,
      verified: true,
      summary: verification.summary,
      evidenceRefs: refs,
    };
  if (verification.status === "passed")
    return {
      status: "running",
      progressed,
      verified: false,
      summary: verification.summary,
      evidenceRefs: refs,
    };
  return {
    status: "blocked",
    progressed,
    verified: false,
    summary: verification.summary,
    failureCode:
      verification.failureCode ??
      (verification.status === "unavailable"
        ? "VERIFICATION_UNAVAILABLE"
        : "VERIFICATION_FAILED"),
    evidenceRefs: refs,
  };
}

export class DefaultSweCore implements SweCore {
  private readonly executor: SweTaskExecutor;
  private readonly state: TaskStateService;
  private readonly idFactory: () => TaskId;
  private readonly clock: () => string;
  private readonly activeRuns = new Map<TaskId, Promise<RunResult>>();
  private readonly activeSteps = new Map<TaskId, Promise<StepResult>>();
  private readonly activeResumes = new Map<TaskId, Promise<RunResult>>();
  private readonly controllers = new Map<TaskId, AbortController>();
  private readonly cancelled = new Set<TaskId>();

  constructor(options: SweCoreOptions) {
    this.executor = composeBoundaries(options);
    this.state =
      options.state ??
      new TaskStateService(
        options.repository ?? new InMemoryTaskRuntimeRepository(),
      );
    this.idFactory = options.idFactory ?? randomUUID;
    this.clock = options.clock ?? now;
  }

  async startTask(
    objective: ObjectiveInput,
    workspace: WorkspaceRef,
    policy: TaskPolicy,
  ): Promise<TaskId> {
    return this.startPreparedTask({ objective, workspace, policy });
  }

  async startPreparedTask(input: PreparedTask): Promise<TaskId> {
    const taskId = input.taskId?.trim() || this.idFactory();
    if (!taskId.trim())
      throw new SweCoreConfigurationError("Task id is required.");
    const snapshot: TaskSnapshot = {
      taskId,
      objective: objectiveValue(input.objective),
      workspace: workspaceValue(input.workspace),
      policy: normalizedPolicy(input.policy),
      status: "ready",
      stepCount: 0,
      progressRevision: 0,
      createdAt: this.clock(),
      updatedAt: this.clock(),
      evidenceRefs: [],
      ...(input.runtimeSnapshot
        ? { runtimeSnapshot: clone(input.runtimeSnapshot) }
        : {}),
    };
    if (snapshot.runtimeSnapshot)
      validateRuntimeSnapshot(snapshot.runtimeSnapshot, snapshot);
    await this.state.create(snapshot);
    return taskId;
  }

  async inspect(taskId: TaskId): Promise<TaskSnapshot> {
    try {
      return await this.state.require(taskId);
    } catch (error) {
      if (error instanceof TaskStateNotFoundError)
        throw new SweCoreTaskNotFoundError(taskId);
      throw error;
    }
  }

  async step(taskId: TaskId): Promise<StepResult> {
    if (this.activeRuns.has(taskId))
      throw new SweCoreConcurrencyError(taskId, "run");
    if (this.activeResumes.has(taskId))
      throw new SweCoreConcurrencyError(taskId, "run");
    const active = this.activeSteps.get(taskId);
    if (active) throw new SweCoreConcurrencyError(taskId, "step");
    const promise = this.stepInternal(taskId, 1, 1).finally(() => {
      if (this.activeSteps.get(taskId) === promise)
        this.activeSteps.delete(taskId);
    });
    this.activeSteps.set(taskId, promise);
    return promise;
  }

  async run(taskId: TaskId, budget: RunBudget): Promise<RunResult> {
    if (this.activeRuns.has(taskId))
      throw new SweCoreConcurrencyError(taskId, "run");
    if (this.activeSteps.has(taskId))
      throw new SweCoreConcurrencyError(taskId, "step");
    if (this.activeResumes.has(taskId))
      throw new SweCoreConcurrencyError(taskId, "run");
    const promise = this.runInternal(taskId, budget).finally(() => {
      if (this.activeRuns.get(taskId) === promise)
        this.activeRuns.delete(taskId);
    });
    this.activeRuns.set(taskId, promise);
    return promise;
  }

  async cancel(taskId: TaskId): Promise<void> {
    const snapshot = await this.inspect(taskId);
    if (isTaskStatusTerminal(snapshot.status)) return;
    if (this.cancelled.has(taskId)) return;
    this.cancelled.add(taskId);
    const controller = this.controllers.get(taskId);
    controller?.abort();
    let cancelError: unknown;
    if (this.executor.cancel) {
      try {
        await this.executor.cancel({
          task: snapshot,
          signal: controller?.signal ?? new AbortController().signal,
        });
      } catch (error) {
        cancelError = error;
      }
    }
    const current = await this.state.require(taskId);
    if (!isTaskStatusTerminal(current.status) || current.status === "running") {
      current.status = "cancelled";
      current.lastError = "Task cancelled by the host.";
      current.updatedAt = this.clock();
      await this.state.save(current);
    }
    if (cancelError !== undefined) throw cancelError;
  }

  async resume(taskId: TaskId): Promise<RunResult> {
    if (this.activeRuns.has(taskId) || this.activeSteps.has(taskId))
      throw new SweCoreConcurrencyError(taskId, "run");
    if (this.activeResumes.has(taskId))
      throw new SweCoreConcurrencyError(taskId, "run");
    // Install the controller before resumeInternal's first await. Cancellation
    // can therefore abort rehydration itself, not only the later run.
    const controller = new AbortController();
    this.controllers.set(taskId, controller);
    // A prior terminal cancellation may be explicitly resumed. Any new
    // cancellation after this point remains visible to resumeInternal.
    this.cancelled.delete(taskId);
    const promise = this.resumeInternal(taskId, controller).finally(() => {
      if (this.activeResumes.get(taskId) === promise)
        this.activeResumes.delete(taskId);
      if (this.controllers.get(taskId) === controller)
        this.controllers.delete(taskId);
    });
    this.activeResumes.set(taskId, promise);
    return promise;
  }

  private async resumeInternal(
    taskId: TaskId,
    controller: AbortController,
  ): Promise<RunResult> {
    const snapshot = await this.inspect(taskId);
    if (snapshot.status === "completed")
      throw new SweCoreStateError("A completed task cannot be resumed.");
    snapshot.status = "ready";
    snapshot.lastError = undefined;
    snapshot.updatedAt = this.clock();
    await this.state.save(snapshot);
    try {
      if (this.executor.resume)
        await this.executor.resume({
          task: snapshot,
          signal: controller.signal,
        });
    } catch (error) {
      if (
        this.cancelled.has(taskId) ||
        controller.signal.aborted ||
        isAbortError(error)
      ) {
        const cancelled = await this.persistCancelled(taskId);
        return this.runResult(cancelled, 0, "cancelled");
      }
      snapshot.status = "failed";
      snapshot.lastError = failureText(error);
      snapshot.updatedAt = this.clock();
      await this.state.save(snapshot);
      throw error;
    }
    const afterResume = await this.inspect(taskId);
    if (
      this.cancelled.has(taskId) ||
      controller.signal.aborted ||
      afterResume.status === "cancelled"
    ) {
      const cancelled =
        afterResume.status === "cancelled"
          ? afterResume
          : await this.persistCancelled(taskId, afterResume);
      return this.runResult(cancelled, 0, "cancelled");
    }
    return this.runInternal(taskId, {
      maxSteps: snapshot.policy.maxSteps ?? DEFAULT_MAX_STEPS,
      wallClockBudgetMs:
        snapshot.policy.maxWallClockMs ?? DEFAULT_MAX_WALL_CLOCK_MS,
    });
  }

  private async persistCancelled(
    taskId: TaskId,
    existing?: TaskSnapshot,
  ): Promise<TaskSnapshot> {
    const snapshot = existing ?? (await this.inspect(taskId));
    if (snapshot.status !== "cancelled") {
      snapshot.status = "cancelled";
      snapshot.lastError = "Task cancelled by the host.";
      snapshot.updatedAt = this.clock();
      await this.state.save(snapshot);
    }
    return snapshot;
  }

  private async runInternal(
    taskId: TaskId,
    requestedBudget: RunBudget,
  ): Promise<RunResult> {
    const initial = await this.inspect(taskId);
    if (isTaskStatusTerminal(initial.status))
      return this.runResult(initial, 0, resultReason(initial.status));
    const budget = normalizedBudget(requestedBudget, initial.policy);
    const deadline = Date.now() + budget.wallClockBudgetMs;
    const controller = new AbortController();
    this.controllers.set(taskId, controller);
    this.cancelled.delete(taskId);
    if (this.executor.step) {
      let stepsRun = 0;
      let budgetExpired = false;
      const timeout = setTimeout(() => {
        budgetExpired = true;
        controller.abort();
      }, budget.wallClockBudgetMs);
      try {
        while (stepsRun < budget.maxSteps) {
          const current = await this.inspect(taskId);
          if (isTaskStatusTerminal(current.status))
            return this.runResult(
              current,
              stepsRun,
              resultReason(current.status),
            );
          if (Date.now() >= deadline)
            return this.blockForBudget(taskId, stepsRun, "wall_clock_budget");
          const last = await this.stepInternal(
            taskId,
            budget.maxSteps - stepsRun,
            stepsRun + 1,
            controller,
          );
          stepsRun += 1;
          if (budgetExpired && !this.cancelled.has(taskId))
            return this.blockForBudget(taskId, stepsRun, "wall_clock_budget");
          if (!last.supported)
            return this.runResult(last.snapshot, stepsRun, "step_unsupported");
          if (Date.now() >= deadline && !last.terminal)
            return this.blockForBudget(taskId, stepsRun, "wall_clock_budget");
          if (last.terminal)
            return this.runResult(
              last.snapshot,
              stepsRun,
              last.reason === "unverified_completion"
                ? "unverified_completion"
                : resultReason(last.status),
            );
        }
        return this.blockForBudget(taskId, stepsRun, "step_budget");
      } catch (error) {
        if (isPersistenceConflict(error)) throw error;
        const failed = await this.failOrCancel(taskId, error);
        return this.runResult(failed.snapshot, stepsRun, failed.reason);
      } finally {
        clearTimeout(timeout);
        if (this.controllers.get(taskId) === controller)
          this.controllers.delete(taskId);
      }
    }

    let stepsRun = 0;
    let budgetExpired = false;
    const timeout = setTimeout(() => {
      budgetExpired = true;
      controller.abort();
    }, budget.wallClockBudgetMs);
    try {
      const running = await this.markRunning(initial);
      const outcome = await this.executor.run({
        task: running,
        signal: controller.signal,
        remainingSteps: budget.maxSteps,
      });
      stepsRun = 1;
      if (budgetExpired)
        return this.blockForBudget(taskId, stepsRun, "wall_clock_budget");
      const result = await this.applyOutcome(
        taskId,
        outcome,
        stepsRun,
        controller,
      );
      return this.runResult(
        result.snapshot,
        stepsRun,
        result.reason ?? resultReason(result.snapshot.status),
      );
    } catch (error) {
      if (isPersistenceConflict(error)) throw error;
      if (budgetExpired)
        return this.blockForBudget(taskId, stepsRun, "wall_clock_budget");
      const failed = await this.failOrCancel(taskId, error);
      return this.runResult(failed.snapshot, stepsRun, failed.reason);
    } finally {
      clearTimeout(timeout);
      if (this.controllers.get(taskId) === controller)
        this.controllers.delete(taskId);
    }
  }

  private async stepInternal(
    taskId: TaskId,
    remainingSteps: number,
    actionNumber: number,
    suppliedController?: AbortController,
  ): Promise<StepResult> {
    const current = await this.inspect(taskId);
    if (isTaskStatusTerminal(current.status))
      return this.stepResult(current, false, true, current.lastError);
    const controller = suppliedController ?? new AbortController();
    if (!suppliedController) this.controllers.set(taskId, controller);
    try {
      if (!this.executor.step) return this.stepUnsupported(current);
      const running = await this.markRunning(current);
      const outcome = await this.executor.step({
        task: running,
        signal: controller.signal,
        remainingSteps,
        actionNumber,
      });
      const applied = await this.applyOutcome(
        taskId,
        outcome,
        actionNumber,
        controller,
      );
      return this.stepResult(
        applied.snapshot,
        applied.progressed,
        isTaskStatusTerminal(applied.snapshot.status),
        applied.reason,
      );
    } catch (error) {
      if (isPersistenceConflict(error)) throw error;
      const failed = await this.failOrCancel(taskId, error);
      return this.stepResult(failed.snapshot, false, true, failed.reason);
    } finally {
      if (!suppliedController && this.controllers.get(taskId) === controller)
        this.controllers.delete(taskId);
    }
  }

  private async markRunning(snapshot: TaskSnapshot): Promise<TaskSnapshot> {
    if (snapshot.status !== "running") {
      snapshot.status = "running";
      snapshot.updatedAt = this.clock();
      await this.state.save(snapshot);
    }
    return snapshot;
  }

  private stepUnsupported(snapshot: TaskSnapshot): StepResult {
    return {
      taskId: snapshot.taskId,
      supported: false,
      status: snapshot.status,
      terminal: false,
      progressed: false,
      stepCount: snapshot.stepCount,
      snapshot: clone(snapshot),
      reason: "STEP_UNSUPPORTED_BY_RUNNER",
    };
  }

  private async applyOutcome(
    taskId: TaskId,
    outcome: SweExecutionOutcome,
    attemptedStep: number,
    _controller: AbortController,
  ): Promise<{
    snapshot: TaskSnapshot;
    progressed: boolean;
    reason?: RunResult["reason"];
  }> {
    if (this.cancelled.has(taskId)) {
      const cancelled = await this.inspect(taskId);
      if (cancelled.status !== "cancelled") {
        cancelled.status = "cancelled";
        cancelled.lastError = "Task cancelled by the host.";
        cancelled.updatedAt = this.clock();
        await this.state.save(cancelled);
      }
      return { snapshot: cancelled, progressed: false, reason: "cancelled" };
    }
    const snapshot = await this.inspect(taskId);
    if (!isExecutionOutcome(outcome))
      throw new SweCoreStateError("Executor returned an invalid outcome.");
    if (outcome.runtimeSnapshot) {
      if (
        typeof outcome.runtimeSnapshot !== "object" ||
        outcome.runtimeSnapshot === null
      )
        throw new SweCoreStateError(
          "Executor returned an invalid runtime snapshot.",
        );
      validateRuntimeSnapshot(outcome.runtimeSnapshot, snapshot);
      snapshot.runtimeSnapshot = clone(outcome.runtimeSnapshot);
    }
    snapshot.stepCount += 1;
    if (outcome.progressed) snapshot.progressRevision += 1;
    snapshot.evidenceRefs = evidenceRefs([
      ...snapshot.evidenceRefs,
      ...(outcome.evidenceRefs ?? []),
    ]);
    snapshot.lastSummary = boundedText(outcome.summary);
    snapshot.lastError = boundedText(outcome.failureCode);
    let status: TaskStatus =
      outcome.status === "succeeded" ? "running" : outcome.status;
    let reason: RunResult["reason"] | undefined;
    if (outcome.status === "completed" && !outcome.verified) {
      status = "blocked";
      reason = "unverified_completion";
      snapshot.lastError =
        "The executor reported completion without host verification.";
    }
    snapshot.status = status;
    snapshot.updatedAt = this.clock();
    await this.state.save(snapshot);
    return {
      snapshot,
      progressed: outcome.progressed,
      ...(reason ? { reason } : {}),
    };
  }

  private async failOrCancel(
    taskId: TaskId,
    error: unknown,
  ): Promise<{ snapshot: TaskSnapshot; reason: RunResult["reason"] }> {
    const snapshot = await this.inspect(taskId);
    if (this.cancelled.has(taskId) || isAbortError(error)) {
      snapshot.status = "cancelled";
      snapshot.lastError = "Task cancelled by the host.";
      snapshot.updatedAt = this.clock();
      await this.state.save(snapshot);
      return { snapshot, reason: "cancelled" };
    }
    snapshot.status = "failed";
    snapshot.lastError = failureText(error);
    snapshot.updatedAt = this.clock();
    await this.state.save(snapshot);
    return { snapshot, reason: "failed" };
  }

  private async blockForBudget(
    taskId: TaskId,
    stepsRun: number,
    budgetKind: string,
  ): Promise<RunResult> {
    const snapshot = await this.inspect(taskId);
    snapshot.status = "blocked";
    snapshot.lastError = `Run budget exhausted (${budgetKind}).`;
    snapshot.updatedAt = this.clock();
    await this.state.save(snapshot);
    return this.runResult(snapshot, stepsRun, "budget_exhausted");
  }

  private stepResult(
    snapshot: TaskSnapshot,
    progressed: boolean,
    terminal: boolean,
    reason?: string,
  ): StepResult {
    return {
      taskId: snapshot.taskId,
      supported: true,
      status: snapshot.status,
      terminal,
      progressed,
      stepCount: snapshot.stepCount,
      snapshot: clone(snapshot),
      ...(reason ? { reason } : {}),
    };
  }

  private runResult(
    snapshot: TaskSnapshot,
    stepsRun: number,
    reason: RunResult["reason"],
  ): RunResult {
    return {
      taskId: snapshot.taskId,
      supported: true,
      status: snapshot.status,
      terminal: isTaskStatusTerminal(snapshot.status),
      progressed: snapshot.progressRevision > 0,
      stepCount: snapshot.stepCount,
      snapshot: clone(snapshot),
      stepsRun,
      reason,
    };
  }
}

export function createSweCore(options: SweCoreOptions): DefaultSweCore {
  return new DefaultSweCore(options);
}

export type { SweCore } from "./types.js";
export type { SweCoreOptions };
