import { expect, test } from "bun:test";
import { LegacyAgentRunner } from "../../src/core/legacy-agent-runner.js";
import { createTaskLedger } from "../../src/agent/task-state.js";
import { createTaskRuntimeSnapshot } from "../../src/agent/task-runtime-state.js";
import {
  createSweCore,
  SweCoreConcurrencyError,
  SweCoreTaskNotFoundError,
  type SweCore,
} from "../../src/core/swe-core.js";
import {
  InMemoryTaskRuntimeRepository,
  TaskStateService,
} from "../../src/core/task-runtime-repository.js";
import type {
  RunBudget,
  SweDriverRequest,
  SweExecutionOutcome,
  SweStepRequest,
  TaskRuntimeRepository,
  TaskSnapshot,
} from "../../src/core/types.js";

const workspace = { root: process.cwd() };

function outcome(
  status: SweExecutionOutcome["status"],
  overrides: Partial<SweExecutionOutcome> = {},
): SweExecutionOutcome {
  return {
    status,
    progressed: status === "completed",
    verified: status === "completed",
    ...overrides,
  };
}

function budget(maxSteps = 4): RunBudget {
  return { maxSteps, wallClockBudgetMs: 5_000 };
}

class FakeStepExecutor {
  readonly calls: SweStepRequest[] = [];
  readonly order: string[] = [];
  private index = 0;

  constructor(
    private readonly responses: readonly SweExecutionOutcome[],
    private readonly identity = "fake-step-driver",
  ) {}

  async step(request: SweStepRequest): Promise<SweExecutionOutcome> {
    this.order.push(`${this.identity}:step`);
    this.calls.push(request);
    const response =
      this.responses[Math.min(this.index++, this.responses.length - 1)];
    if (!response) throw new Error("fake executor has no response");
    return response;
  }

  async run(request: SweDriverRequest): Promise<SweExecutionOutcome> {
    return this.step({ ...request, actionNumber: 1 });
  }
}

test("start persists before a bounded step and inspect exposes host state", async () => {
  const events: string[] = [];
  const repository = new InMemoryTaskRuntimeRepository({
    onCreate: () => events.push("create"),
    onSave: () => events.push("save"),
  });
  const executor = new FakeStepExecutor([
    outcome("running", { progressed: true, verified: false }),
  ]);
  const core = createSweCore({
    state: new TaskStateService(repository),
    executor,
    idFactory: () => "task-core-1",
  });

  const taskId = await core.startTask(
    { text: "Inspect one bounded task" },
    workspace,
    { maxSteps: 4 },
  );
  expect(taskId).toBe("task-core-1");
  expect((await core.inspect(taskId)).status).toBe("ready");
  const result = await core.step(taskId);

  expect(events[0]).toBe("create");
  expect(executor.order).toEqual(["fake-step-driver:step"]);
  expect(result.supported).toBe(true);
  expect(result.status).toBe("running");
  expect(result.snapshot.stepCount).toBe(1);
  expect(result.snapshot.objective.text).toBe("Inspect one bounded task");
});

test("run advances one semantic decision at a time and requires verified completion", async () => {
  const executor = new FakeStepExecutor([
    outcome("running", { progressed: true, verified: false }),
    outcome("completed", { progressed: true, verified: true }),
  ]);
  const core = createSweCore({
    executor,
    idFactory: () => "task-core-run",
  });
  const taskId = await core.startTask("Make a bounded change", workspace, {
    maxSteps: 4,
  });

  const result = await core.run(taskId, budget());

  expect(result.status).toBe("completed");
  expect(result.reason).toBe("completed");
  expect(result.stepsRun).toBe(2);
  expect(result.snapshot.stepCount).toBe(2);
  expect(executor.calls).toHaveLength(2);
  expect(executor.calls[0]?.task.status).toBe("running");
  expect(executor.calls[1]?.task.status).toBe("running");
});

test("unverified completion is downgraded to a blocked host state", async () => {
  const executor = new FakeStepExecutor([
    outcome("completed", {
      progressed: true,
      verified: false,
      summary: "model said done",
    }),
  ]);
  const core = createSweCore({ executor, idFactory: () => "task-unverified" });

  const taskId = await core.startTask("Finish safely", workspace, {});
  const result = await core.run(taskId, budget());

  expect(result.status).toBe("blocked");
  expect(result.reason).toBe("unverified_completion");
  expect(result.snapshot.status).toBe("blocked");
  expect(result.snapshot.lastError).toContain("verification");
});

test("legacy runner exposes a typed unsupported step instead of faking maxTurns=1", async () => {
  let invoked = false;
  const legacy = new LegacyAgentRunner({
    createTask: () => {
      invoked = true;
      throw new Error("legacy run should not be called by step");
    },
    createOptions: () => {
      throw new Error("legacy run should not be called by step");
    },
  });
  const core = createSweCore({
    executor: legacy,
    idFactory: () => "task-legacy-step",
  });

  const taskId = await core.startTask("Use the legacy loop", workspace, {});
  const result = await core.step(taskId);

  expect(invoked).toBe(false);
  expect(result.supported).toBe(false);
  expect(result.reason).toBe("STEP_UNSUPPORTED_BY_RUNNER");
  expect(result.snapshot.status).toBe("ready");
});

test("run and step cannot execute concurrently for one task", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const executor = {
    async run(): Promise<SweExecutionOutcome> {
      await pending;
      return outcome("completed", { progressed: true, verified: true });
    },
  };
  const core = createSweCore({ executor, idFactory: () => "task-lock" });
  const taskId = await core.startTask("Hold one execution", workspace, {});
  const running = core.run(taskId, budget());
  await Promise.resolve();

  await expect(core.run(taskId, budget())).rejects.toBeInstanceOf(
    SweCoreConcurrencyError,
  );
  await expect(core.step(taskId)).rejects.toBeInstanceOf(
    SweCoreConcurrencyError,
  );
  release();
  expect((await running).status).toBe("completed");
});

test("cancel aborts the active executor once and remains idempotent", async () => {
  let abortCount = 0;
  let cancelCount = 0;
  const executor = {
    async run({ signal }: SweDriverRequest): Promise<SweExecutionOutcome> {
      await new Promise<void>((resolve) => {
        if (signal.aborted) {
          resolve();
          return;
        }
        signal.addEventListener("abort", () => resolve(), { once: true });
      });
      abortCount += 1;
      return outcome("cancelled", { progressed: false, verified: false });
    },
    async cancel(): Promise<void> {
      cancelCount += 1;
    },
  };
  const core = createSweCore({ executor, idFactory: () => "task-cancel" });
  const taskId = await core.startTask("Cancel me", workspace, {});
  const running = core.run(taskId, budget());
  await Promise.resolve();

  await core.cancel(taskId);
  await core.cancel(taskId);
  const result = await running;

  expect(result.status).toBe("cancelled");
  expect((await core.inspect(taskId)).status).toBe("cancelled");
  expect(cancelCount).toBe(1);
  expect(abortCount).toBe(1);
});

test("resume keeps task identity and runtime anchors while rerunning the same task", async () => {
  const executor = new FakeStepExecutor([
    outcome("blocked", {
      progressed: false,
      verified: false,
      failureCode: "NEEDS_RETRY",
    }),
    outcome("completed", { progressed: true, verified: true }),
  ]);
  const core = createSweCore({
    executor,
    idFactory: () => "task-resume",
  });
  const taskId = await core.startTask(
    { text: "Resume the exact task" },
    workspace,
    { maxSteps: 2 },
  );
  const first = await core.run(taskId, budget(1));
  const resumed = await core.resume(taskId);

  expect(first.status).toBe("blocked");
  expect(resumed.status).toBe("completed");
  expect(resumed.taskId).toBe(taskId);
  expect(resumed.snapshot.taskId).toBe(taskId);
  expect(resumed.snapshot.objective.text).toBe("Resume the exact task");
  expect(resumed.snapshot.stepCount).toBe(2);
});

test("resume owns the task operation lock through rehydration and execution", async () => {
  let releaseResume!: () => void;
  let signalResumeStarted!: () => void;
  const resumePending = new Promise<void>((resolve) => {
    releaseResume = resolve;
  });
  const resumeStarted = new Promise<void>((resolve) => {
    signalResumeStarted = resolve;
  });
  const executor = {
    async resume(): Promise<void> {
      signalResumeStarted();
      await resumePending;
    },
    async step(_request: SweStepRequest): Promise<SweExecutionOutcome> {
      return outcome("completed", { progressed: true, verified: true });
    },
    async run(request: SweDriverRequest): Promise<SweExecutionOutcome> {
      return this.step({ ...request, actionNumber: 1 });
    },
  };
  const core = createSweCore({
    executor,
    idFactory: () => "task-resume-lock",
  });
  const taskId = await core.startTask("Keep resume exclusive", workspace, {});
  const resuming = core.resume(taskId);
  await resumeStarted;

  await expect(core.run(taskId, budget())).rejects.toBeInstanceOf(
    SweCoreConcurrencyError,
  );
  await expect(core.resume(taskId)).rejects.toBeInstanceOf(
    SweCoreConcurrencyError,
  );

  releaseResume();
  expect((await resuming).status).toBe("completed");
});

test("cancel during resume rehydration aborts the resume hook", async () => {
  const backing = new InMemoryTaskRuntimeRepository();
  let saveCount = 0;
  let releaseFirstSave!: () => void;
  let signalFirstSave!: () => void;
  const firstSavePending = new Promise<void>((resolve) => {
    releaseFirstSave = resolve;
  });
  const firstSaveStarted = new Promise<void>((resolve) => {
    signalFirstSave = resolve;
  });
  const repository: TaskRuntimeRepository = {
    create: (snapshot) => backing.create(snapshot),
    load: (taskId) => backing.load(taskId),
    async save(snapshot) {
      saveCount += 1;
      if (saveCount === 1) {
        signalFirstSave();
        await firstSavePending;
      }
      backing.save(snapshot);
    },
  };
  let resumeSignalAborted = false;
  const executor = {
    async resume({ signal }: { signal: AbortSignal }): Promise<void> {
      resumeSignalAborted = signal.aborted;
      if (!signal.aborted) {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(
            () => reject(new Error("resume did not receive abort")),
            100,
          );
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              resolve();
            },
            { once: true },
          );
        });
      }
    },
    async step(_request: SweStepRequest): Promise<SweExecutionOutcome> {
      return outcome("completed", { progressed: true, verified: true });
    },
    async run(request: SweDriverRequest): Promise<SweExecutionOutcome> {
      return this.step({ ...request, actionNumber: 1 });
    },
  };
  const core = createSweCore({
    state: new TaskStateService(repository),
    executor,
    idFactory: () => "task-resume-cancel-race",
  });
  const taskId = await core.startTask(
    "Cancel during rehydration",
    workspace,
    {},
  );
  const resuming = core.resume(taskId);
  await firstSaveStarted;

  const cancelling = core.cancel(taskId);
  await cancelling;
  releaseFirstSave();

  const result = await resuming;
  expect(result.status).toBe("cancelled");
  expect(resumeSignalAborted).toBe(true);
  expect((await core.inspect(taskId)).status).toBe("cancelled");
});

test("step execution is blocked when a semantic decision exceeds the wall-clock budget", async () => {
  const executor = {
    async step(_request: SweStepRequest): Promise<SweExecutionOutcome> {
      await new Promise<void>((resolve) => setTimeout(resolve, 40));
      return outcome("completed", { progressed: true, verified: true });
    },
    async run(request: SweDriverRequest): Promise<SweExecutionOutcome> {
      return this.step({ ...request, actionNumber: 1 });
    },
  };
  const core = createSweCore({
    executor,
    idFactory: () => "task-step-wall-budget",
  });
  const taskId = await core.startTask("Respect the wall clock", workspace, {});

  const result = await core.run(taskId, {
    maxSteps: 1,
    wallClockBudgetMs: 10,
  });

  expect(result.status).toBe("blocked");
  expect(result.reason).toBe("budget_exhausted");
  expect(result.snapshot.lastError).toContain("wall_clock_budget");
});

test("prepared runtime state keeps the same obligations, route, and context anchor", async () => {
  const ledger = createTaskLedger({
    id: "task-prepared-runtime",
    objective: "Resume with the existing runtime",
    mode: "coding",
    verificationPlan: [],
    successCriteria: [
      {
        id: "criterion-1",
        description: "Preserve the task obligation",
        required: true,
        satisfied: false,
      },
    ],
  });
  const runtime = createTaskRuntimeSnapshot({
    ledger,
    repositoryRoot: workspace.root,
    route: {
      candidateId: "local/exact-driver",
      providerId: "local",
      modelId: "wire-model-id",
      runtimeId: "lm-studio",
      capability: "coding_agent",
    },
    contextAnchor: {
      sourceIds: ["src/value.ts"],
      instructionSources: ["CLAUDE.md"],
      memoryIds: ["memory-1"],
      proofGapIds: ["criterion-1"],
    },
  });
  const core = createSweCore({
    executor: new FakeStepExecutor([
      outcome("completed", { progressed: true, verified: true }),
    ]),
  });
  const taskId = await core.startPreparedTask({
    taskId: "task-prepared-runtime",
    objective: runtime.ledger.objective,
    workspace,
    policy: {},
    runtimeSnapshot: runtime,
  });
  const snapshot = await core.inspect(taskId);

  expect(snapshot.runtimeSnapshot?.route?.modelId).toBe("wire-model-id");
  expect(snapshot.runtimeSnapshot?.contextAnchor.sourceIds).toContain(
    "src/value.ts",
  );
  expect(snapshot.runtimeSnapshot?.ledger.successCriteria[0]?.description).toBe(
    "Preserve the task obligation",
  );
});

test("unknown tasks fail closed with a typed error", async () => {
  const core = createSweCore({ executor: new FakeStepExecutor([]) });

  await expect(core.inspect("missing-task")).rejects.toBeInstanceOf(
    SweCoreTaskNotFoundError,
  );
  await expect(core.step("missing-task")).rejects.toBeInstanceOf(
    SweCoreTaskNotFoundError,
  );
});

test("the same core accepts differently identified drivers without model-brand branching", async () => {
  const outcomes = [outcome("completed", { progressed: true, verified: true })];
  const localDriver = new FakeStepExecutor(outcomes, "local-runtime-q4");
  const alternateDriver = new FakeStepExecutor(
    outcomes,
    "openai-compatible-q6",
  );
  const runWith = async (
    driver: FakeStepExecutor,
    id: string,
  ): Promise<string> => {
    const core: SweCore = createSweCore({
      executor: driver,
      idFactory: () => id,
    });
    const taskId = await core.startTask("Complete one action", workspace, {});
    return (await core.run(taskId, budget())).status;
  };

  expect(await runWith(localDriver, "task-local")).toBe("completed");
  expect(await runWith(alternateDriver, "task-alternate")).toBe("completed");
});

test("driver, execution, and verification stay independent ports of the same core", async () => {
  const seen: string[] = [];
  const core = createSweCore({
    driver: {
      async decide(request) {
        seen.push(`driver:${request.task.objective.text}`);
        return { type: "action", action: { kind: "bounded.edit" } };
      },
    },
    execution: {
      async run(request) {
        seen.push(`execution:${request.decision.action.kind}`);
        return {
          status: "succeeded",
          progressed: true,
          verified: false,
        };
      },
    },
    verification: {
      async verify(request) {
        seen.push(`verification:${request.decision.type}`);
        return {
          status: "passed",
          taskComplete: true,
          evidenceRefs: ["host-proof:1"],
        };
      },
    },
    idFactory: () => "task-boundaries",
  });
  const taskId = await core.startTask("Use the boundary ports", workspace, {});
  const result = await core.run(taskId, budget());

  expect(result.status).toBe("completed");
  expect(result.snapshot.evidenceRefs).toEqual(["host-proof:1"]);
  expect(seen).toEqual([
    "driver:Use the boundary ports",
    "execution:bounded.edit",
    "verification:action",
  ]);
});

test("concurrent steps are rejected instead of sharing a mutable continuation", async () => {
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  const executor = new FakeStepExecutor([
    outcome("running", { progressed: true, verified: false }),
  ]);
  const blockingExecutor = {
    async step(request: SweStepRequest): Promise<SweExecutionOutcome> {
      executor.calls.push(request);
      await pending;
      return outcome("running", { progressed: true, verified: false });
    },
    async run(request: SweDriverRequest): Promise<SweExecutionOutcome> {
      return this.step({ ...request, actionNumber: 1 });
    },
  };
  const core = createSweCore({
    executor: blockingExecutor,
    idFactory: () => "task-step-lock",
  });
  const taskId = await core.startTask("Hold one step", workspace, {});
  const running = core.step(taskId);
  await Promise.resolve();
  await expect(core.step(taskId)).rejects.toBeInstanceOf(
    SweCoreConcurrencyError,
  );
  release();
  expect((await running).status).toBe("running");
});

test("state service surfaces persistence conflicts instead of overwriting them", async () => {
  let stored: TaskSnapshot | undefined;
  let saveAttempts = 0;
  const repository: TaskRuntimeRepository = {
    async load() {
      return stored ? structuredClone(stored) : undefined;
    },
    async create(snapshot) {
      stored = structuredClone(snapshot);
    },
    async save(snapshot) {
      saveAttempts += 1;
      if (saveAttempts === 1) throw new Error("STALE_RUNTIME_SNAPSHOT");
      stored = structuredClone(snapshot);
    },
  };
  const core = createSweCore({
    state: new TaskStateService(repository),
    executor: new FakeStepExecutor([
      outcome("completed", { progressed: true, verified: true }),
    ]),
    idFactory: () => "task-conflict",
  });
  const taskId = await core.startTask("Expose storage conflict", workspace, {});

  await expect(core.run(taskId, budget())).rejects.toThrow(
    "STALE_RUNTIME_SNAPSHOT",
  );
});

test("step requests carry a bounded remaining budget and a fresh abort signal", async () => {
  let request: SweStepRequest | undefined;
  const executor = {
    async step(input: SweStepRequest): Promise<SweExecutionOutcome> {
      request = input;
      return outcome("completed", { progressed: true, verified: true });
    },
    async run(input: SweDriverRequest): Promise<SweExecutionOutcome> {
      return this.step({ ...input, actionNumber: 1 });
    },
  };
  const core = createSweCore({ executor, idFactory: () => "task-request" });
  const taskId = await core.startTask("Inspect request", workspace, {});
  await core.step(taskId);

  expect(request?.remainingSteps).toBeGreaterThan(0);
  expect(request?.signal).toBeInstanceOf(AbortSignal);
  expect(request?.task.workspace.root).toBe(workspace.root);
});
