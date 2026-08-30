import type { TaskId, TaskRuntimeRepository, TaskSnapshot } from "./types.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class TaskStateNotFoundError extends Error {
  readonly code = "TASK_NOT_FOUND" as const;

  constructor(readonly taskId: TaskId) {
    super(`Task ${taskId} was not found.`);
    this.name = "TaskStateNotFoundError";
  }
}

export class TaskStateConflictError extends Error {
  readonly code = "TASK_STATE_CONFLICT" as const;

  constructor(readonly taskId: TaskId) {
    super(`Task ${taskId} already exists.`);
    this.name = "TaskStateConflictError";
  }
}

export interface InMemoryTaskRuntimeRepositoryOptions {
  onCreate?: (snapshot: TaskSnapshot) => void;
  onSave?: (snapshot: TaskSnapshot) => void;
}

/**
 * Small deterministic repository used by the Core and its host tests. A
 * production adapter can map this port to LocalCodeDatabase without leaking
 * SQL or provider objects into the lifecycle service.
 */
export class InMemoryTaskRuntimeRepository implements TaskRuntimeRepository {
  private readonly snapshots = new Map<TaskId, TaskSnapshot>();
  private readonly options: InMemoryTaskRuntimeRepositoryOptions;

  constructor(options: InMemoryTaskRuntimeRepositoryOptions = {}) {
    this.options = options;
  }

  create(snapshot: TaskSnapshot): void {
    if (this.snapshots.has(snapshot.taskId))
      throw new TaskStateConflictError(snapshot.taskId);
    const saved = clone(snapshot);
    this.snapshots.set(saved.taskId, saved);
    this.options.onCreate?.(clone(saved));
  }

  load(taskId: TaskId): TaskSnapshot | undefined {
    const snapshot = this.snapshots.get(taskId);
    return snapshot ? clone(snapshot) : undefined;
  }

  save(snapshot: TaskSnapshot): void {
    const saved = clone(snapshot);
    this.snapshots.set(saved.taskId, saved);
    this.options.onSave?.(clone(saved));
  }
}

/**
 * Host-owned task state service. It clones at every boundary so callers and
 * adapters cannot mutate authoritative state without a persistence operation.
 */
export class TaskStateService {
  constructor(
    private readonly repository: TaskRuntimeRepository = new InMemoryTaskRuntimeRepository(),
  ) {}

  async create(snapshot: TaskSnapshot): Promise<void> {
    await this.repository.create(clone(snapshot));
  }

  async get(taskId: TaskId): Promise<TaskSnapshot | undefined> {
    const snapshot = await this.repository.load(taskId);
    return snapshot ? clone(snapshot) : undefined;
  }

  async require(taskId: TaskId): Promise<TaskSnapshot> {
    const snapshot = await this.get(taskId);
    if (!snapshot) throw new TaskStateNotFoundError(taskId);
    return snapshot;
  }

  async save(snapshot: TaskSnapshot): Promise<void> {
    await this.repository.save(clone(snapshot));
  }
}
