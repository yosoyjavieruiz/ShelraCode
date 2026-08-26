import { Database } from "bun:sqlite";
import type { QuotaSnapshot } from "../shared/types.js";
import type { ModelCandidate } from "../shared/types.js";
import type { AgentTaskLedger } from "../agent/task-state.js";
import type { LocalCodeLogger } from "../shared/logging.js";
import type { MemoryFact, MemoryKind } from "../shared/memory.js";
import {
  restoreTaskRuntime,
  serializeTaskRuntime,
  type RuntimeRestoreResult,
} from "../agent/task-ledger-codec.js";
import type {
  TaskRuntimeSnapshot,
  TaskRuntimeSnapshotInput,
} from "../agent/task-runtime-state.js";

const CURRENT_SCHEMA_VERSION = 4;
type StoredAgentProbe = NonNullable<ModelCandidate["agentProbe"]>;

interface StoredModelCapability {
  probe: StoredAgentProbe;
  version: number;
}

export interface SessionSummary {
  id: string;
  repository: string;
  objective: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMessage {
  role: string;
  content: string;
  createdAt: string;
}

export class LocalCodeDatabase {
  readonly db: Database;
  private readonly logger?: LocalCodeLogger;

  constructor(filename = ":memory:", logger?: LocalCodeLogger) {
    this.logger = logger?.child({ component: "storage.database" });
    this.db = new Database(filename, { create: true, strict: true });
    this.db.run("PRAGMA foreign_keys = ON");
    this.migrate();
    this.logger?.info("storage.opened", {
      persistent: filename !== ":memory:",
      schemaVersion: this.schemaVersion(),
    });
  }

  migrate(): void {
    this.db.run(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        repository TEXT NOT NULL,
        objective TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS routes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT,
        candidate_id TEXT NOT NULL,
        decision_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS quota_snapshots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider_id TEXT NOT NULL,
        model_id TEXT,
        snapshot_json TEXT NOT NULL,
        observed_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS provider_health (
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        state TEXT NOT NULL,
        consecutive_failures INTEGER NOT NULL DEFAULT 0,
        opened_at TEXT,
        next_probe_at TEXT,
        last_success_at TEXT,
        PRIMARY KEY (provider_id, model_id)
      );
      CREATE TABLE IF NOT EXISTS checkpoints (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS files_changed (
        checkpoint_id TEXT NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        original_hash TEXT NOT NULL,
        original_content TEXT NOT NULL,
        original_exists INTEGER NOT NULL DEFAULT 1,
        last_hash TEXT NOT NULL,
        last_content TEXT NOT NULL,
        PRIMARY KEY (checkpoint_id, path)
      );
      CREATE TABLE IF NOT EXISTS agent_tasks (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        objective TEXT NOT NULL,
        mode TEXT NOT NULL,
        phase TEXT NOT NULL,
        ledger_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS model_capabilities (
        provider_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        probe_json TEXT NOT NULL,
        observed_at TEXT NOT NULL,
        PRIMARY KEY (provider_id, model_id)
      );
      CREATE TABLE IF NOT EXISTS memory_facts (
        id TEXT PRIMARY KEY,
        repository TEXT NOT NULL,
        kind TEXT NOT NULL,
        fact TEXT NOT NULL,
        evidence_json TEXT NOT NULL,
        provenance TEXT NOT NULL,
        confidence REAL NOT NULL,
        scope_json TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        last_validated_at TEXT NOT NULL,
        expires_at TEXT
      );`,
    );

    const version = this.schemaVersion();
    if (version < CURRENT_SCHEMA_VERSION) {
      this.db
        .query(
          "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
        )
        .run(CURRENT_SCHEMA_VERSION, new Date().toISOString());
    }
  }

  schemaVersion(): number {
    const row = this.db
      .query<{ version: number }, []>(
        "SELECT MAX(version) AS version FROM schema_migrations",
      )
      .get();
    return row?.version ?? 0;
  }

  setSetting(key: string, value: string): void {
    this.db
      .query(
        `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(key, value, new Date().toISOString());
    this.logger?.debug("storage.setting.updated", {
      key,
      valueLength: value.length,
    });
  }

  getSetting(key: string): string | undefined {
    const row = this.db
      .query<{ value: string }, [string]>(
        "SELECT value FROM settings WHERE key = ?",
      )
      .get(key);
    return row?.value;
  }

  createSession(
    id: string,
    repository: string,
    objective: string,
    now = new Date().toISOString(),
  ): void {
    this.db
      .query(
        "INSERT INTO sessions (id, repository, objective, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(id, repository, objective, now, now);
    this.logger?.info("storage.session.created", {
      sessionId: id,
      repository,
      objectiveLength: objective.length,
    });
  }

  sessionExists(id: string): boolean {
    return Boolean(
      this.db
        .query<{ id: string }, [string]>(
          "SELECT id FROM sessions WHERE id = ? LIMIT 1",
        )
        .get(id),
    );
  }

  listSessions(limit = 20): SessionSummary[] {
    return this.db
      .query<
        {
          id: string;
          repository: string;
          objective: string;
          created_at: string;
          updated_at: string;
        },
        [number]
      >(
        `SELECT id, repository, objective, created_at, updated_at
         FROM sessions ORDER BY updated_at DESC LIMIT ?`,
      )
      .all(limit)
      .map((session) => ({
        id: session.id,
        repository: session.repository,
        objective: session.objective,
        createdAt: session.created_at,
        updatedAt: session.updated_at,
      }));
  }

  listMessages(sessionId: string): StoredMessage[] {
    return this.db
      .query<{ role: string; content: string; created_at: string }, [string]>(
        `SELECT role, content, created_at FROM messages
         WHERE session_id = ? ORDER BY id ASC`,
      )
      .all(sessionId)
      .map((message) => ({
        role: message.role,
        content: message.content,
        createdAt: message.created_at,
      }));
  }

  appendMessage(
    sessionId: string,
    role: string,
    content: string,
    now = new Date().toISOString(),
  ): void {
    this.db
      .query(
        "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(sessionId, role, content, now);
    this.db
      .query("UPDATE sessions SET updated_at = ? WHERE id = ?")
      .run(now, sessionId);
    this.logger?.debug("storage.message.appended", {
      sessionId,
      role,
      contentLength: content.length,
    });
  }

  recordRoute(
    sessionId: string | undefined,
    candidateId: string,
    decision: unknown,
    now = new Date().toISOString(),
  ): void {
    this.db
      .query(
        "INSERT INTO routes (session_id, candidate_id, decision_json, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(sessionId ?? null, candidateId, JSON.stringify(decision), now);
    this.logger?.info("storage.route.recorded", {
      sessionId,
      candidateId,
    });
  }

  recordQuota(snapshot: QuotaSnapshot): void {
    this.db
      .query(
        "INSERT INTO quota_snapshots (provider_id, model_id, snapshot_json, observed_at) VALUES (?, ?, ?, ?)",
      )
      .run(
        snapshot.providerId,
        snapshot.modelId ?? null,
        JSON.stringify(snapshot),
        snapshot.observedAt,
      );
  }

  latestQuota(providerId: string): QuotaSnapshot | undefined {
    const row = this.db
      .query<{ snapshot_json: string }, [string]>(
        "SELECT snapshot_json FROM quota_snapshots WHERE provider_id = ? ORDER BY observed_at DESC, id DESC LIMIT 1",
      )
      .get(providerId);
    if (!row) return undefined;
    try {
      return JSON.parse(row.snapshot_json) as QuotaSnapshot;
    } catch {
      return undefined;
    }
  }

  saveAgentTask(ledger: AgentTaskLedger, sessionId?: string): void {
    this.db
      .query(
        `INSERT INTO agent_tasks
          (id, session_id, objective, mode, phase, ledger_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           session_id = excluded.session_id,
           objective = excluded.objective,
           mode = excluded.mode,
           phase = excluded.phase,
           ledger_json = excluded.ledger_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        ledger.id,
        sessionId ?? null,
        ledger.objective,
        ledger.mode,
        ledger.phase,
        JSON.stringify(ledger),
        ledger.startedAt,
        ledger.updatedAt,
      );
    this.logger?.debug("storage.task.persisted", {
      taskId: ledger.id,
      sessionId,
      phase: ledger.phase,
      objectiveLength: ledger.objective.length,
      filesChanged: ledger.filesChanged.length,
      actions: ledger.actions.length,
      verificationRuns: ledger.verificationRuns.length,
    });
  }

  /**
   * Persist the versioned runtime envelope used by durable resume. The
   * historical saveAgentTask method remains available for legacy callers;
   * new task execution should use this method so route/context/in-flight
   * state is not discarded.
   */
  saveAgentRuntime(
    input: TaskRuntimeSnapshot | TaskRuntimeSnapshotInput,
    sessionId?: string,
  ): void {
    const encoded = serializeTaskRuntime(input);
    const restored = restoreTaskRuntime(encoded);
    if (!restored.ok)
      throw new Error(
        `Cannot persist invalid runtime snapshot: ${restored.error.reason}`,
      );
    const snapshot = restored.snapshot;
    const effectiveSessionId = sessionId ?? snapshot.sessionId;
    this.db
      .query(
        `INSERT INTO agent_tasks
          (id, session_id, objective, mode, phase, ledger_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           session_id = excluded.session_id,
           objective = excluded.objective,
           mode = excluded.mode,
           phase = excluded.phase,
           ledger_json = excluded.ledger_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        snapshot.taskId,
        effectiveSessionId ?? null,
        snapshot.ledger.objective,
        snapshot.ledger.mode,
        snapshot.ledger.phase,
        encoded,
        snapshot.ledger.startedAt,
        snapshot.updatedAt,
      );
    if (effectiveSessionId)
      this.db
        .query("UPDATE sessions SET updated_at = ? WHERE id = ?")
        .run(snapshot.updatedAt, effectiveSessionId);
    this.logger?.debug("storage.runtime.persisted", {
      taskId: snapshot.taskId,
      sessionId: effectiveSessionId,
      phase: snapshot.ledger.phase,
      updatedRevision: snapshot.updatedRevision,
      inFlight: snapshot.inFlight?.kind,
    });
  }

  getAgentRuntime(taskId: string): RuntimeRestoreResult | undefined {
    const row = this.db
      .query<{ ledger_json: string }, [string]>(
        "SELECT ledger_json FROM agent_tasks WHERE id = ?",
      )
      .get(taskId);
    if (!row) return undefined;
    const restored = restoreTaskRuntime(row.ledger_json);
    if (restored.ok) return restored;
    const legacy = parseTaskLedger(row.ledger_json);
    return legacy
      ? {
          ok: false,
          error: {
            code: "INVALID_RUNTIME_SNAPSHOT",
            reason:
              "task record is a legacy ledger without a versioned runtime snapshot",
          },
        }
      : restored;
  }

  getLatestAgentRuntime(sessionId: string): RuntimeRestoreResult | undefined {
    const row = this.db
      .query<{ ledger_json: string }, [string]>(
        "SELECT ledger_json FROM agent_tasks WHERE session_id = ? ORDER BY updated_at DESC LIMIT 1",
      )
      .get(sessionId);
    if (!row) return undefined;
    return restoreTaskRuntime(row.ledger_json);
  }

  getAgentTask(taskId: string): AgentTaskLedger | undefined {
    const row = this.db
      .query<{ ledger_json: string }, [string]>(
        "SELECT ledger_json FROM agent_tasks WHERE id = ?",
      )
      .get(taskId);
    if (!row) return undefined;
    const runtime = restoreTaskRuntime(row.ledger_json);
    return runtime.ok
      ? runtime.snapshot.ledger
      : parseTaskLedger(row.ledger_json);
  }

  listAgentTasks(sessionId?: string, limit = 20): AgentTaskLedger[] {
    const rows = sessionId
      ? this.db
          .query<{ ledger_json: string }, [string, number]>(
            "SELECT ledger_json FROM agent_tasks WHERE session_id = ? ORDER BY updated_at DESC LIMIT ?",
          )
          .all(sessionId, limit)
      : this.db
          .query<{ ledger_json: string }, [number]>(
            "SELECT ledger_json FROM agent_tasks ORDER BY updated_at DESC LIMIT ?",
          )
          .all(limit);
    return rows.flatMap((row) => {
      const runtime = restoreTaskRuntime(row.ledger_json);
      const ledger = runtime.ok
        ? runtime.snapshot.ledger
        : parseTaskLedger(row.ledger_json);
      return ledger ? [ledger] : [];
    });
  }

  saveModelCapability(
    providerId: string,
    modelId: string,
    probe: StoredAgentProbe,
    observedAt = new Date().toISOString(),
  ): void {
    this.db
      .query(
        `INSERT INTO model_capabilities (provider_id, model_id, probe_json, observed_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(provider_id, model_id) DO UPDATE SET
           probe_json = excluded.probe_json,
           observed_at = excluded.observed_at`,
      )
      .run(
        providerId,
        modelId,
        JSON.stringify({
          version: probe.probeVersion ?? 1,
          probe,
        }),
        observedAt,
      );
    this.logger?.info("storage.capability.persisted", {
      providerId,
      modelId,
      classification: probe.agentCapabilityClass,
      eligible: probe.agenticCodingEligible,
    });
  }

  getModelCapability(
    providerId: string,
    modelId: string,
  ): (StoredModelCapability & { observedAt: string }) | undefined {
    const row = this.db
      .query<{ probe_json: string; observed_at: string }, [string, string]>(
        "SELECT probe_json, observed_at FROM model_capabilities WHERE provider_id = ? AND model_id = ?",
      )
      .get(providerId, modelId);
    if (!row) return undefined;
    const parsed = parseStoredModelCapability(row.probe_json);
    return parsed ? { ...parsed, observedAt: row.observed_at } : undefined;
  }

  saveMemoryFact(fact: MemoryFact): void {
    this.db
      .query(
        `INSERT INTO memory_facts
          (id, repository, kind, fact, evidence_json, provenance, confidence,
           scope_json, tags_json, created_at, last_validated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           repository = excluded.repository,
           kind = excluded.kind,
           fact = excluded.fact,
           evidence_json = excluded.evidence_json,
           provenance = excluded.provenance,
           confidence = excluded.confidence,
           scope_json = excluded.scope_json,
           tags_json = excluded.tags_json,
           last_validated_at = excluded.last_validated_at,
           expires_at = excluded.expires_at`,
      )
      .run(
        fact.id,
        fact.repository,
        fact.kind,
        fact.fact,
        JSON.stringify(fact.evidence),
        fact.provenance,
        Math.max(0, Math.min(1, fact.confidence)),
        JSON.stringify(fact.scope),
        JSON.stringify(fact.tags),
        fact.createdAt,
        fact.lastValidatedAt,
        fact.expiresAt ?? null,
      );
    this.logger?.debug("storage.memory.saved", {
      memoryId: fact.id,
      kind: fact.kind,
      repository: fact.repository,
    });
  }

  listMemoryFacts(
    repository: string,
    kind?: MemoryKind,
    limit = 100,
  ): MemoryFact[] {
    const rows = kind
      ? this.db
          .query<StoredMemoryRow, [string, string, number]>(
            `SELECT id, repository, kind, fact, evidence_json, provenance,
                    confidence, scope_json, tags_json, created_at,
                    last_validated_at, expires_at
             FROM memory_facts WHERE repository = ? AND kind = ?
             ORDER BY last_validated_at DESC LIMIT ?`,
          )
          .all(repository, kind, limit)
      : this.db
          .query<StoredMemoryRow, [string, number]>(
            `SELECT id, repository, kind, fact, evidence_json, provenance,
                    confidence, scope_json, tags_json, created_at,
                    last_validated_at, expires_at
             FROM memory_facts WHERE repository = ?
             ORDER BY last_validated_at DESC LIMIT ?`,
          )
          .all(repository, limit);
    return rows.flatMap(parseMemoryFact);
  }

  invalidateMemoryFact(id: string): void {
    this.db.query("DELETE FROM memory_facts WHERE id = ?").run(id);
    this.logger?.debug("storage.memory.invalidated", { memoryId: id });
  }

  createCheckpoint(
    id: string,
    taskId: string,
    now = new Date().toISOString(),
  ): void {
    this.db
      .query(
        "INSERT INTO checkpoints (id, task_id, created_at) VALUES (?, ?, ?)",
      )
      .run(id, taskId, now);
    this.logger?.info("storage.checkpoint.created", {
      checkpointId: id,
      taskId,
    });
  }

  addCheckpointFile(
    checkpointId: string,
    path: string,
    originalHash: string,
    originalContent: string,
    originalExists: boolean,
    lastHash = originalHash,
    lastContent = originalContent,
  ): void {
    this.db
      .query(
        `INSERT INTO files_changed (checkpoint_id, path, original_hash, original_content, original_exists, last_hash, last_content)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        checkpointId,
        path,
        originalHash,
        originalContent,
        originalExists ? 1 : 0,
        lastHash,
        lastContent,
      );
    this.logger?.debug("storage.checkpoint.file_added", {
      checkpointId,
      path,
      originalExists,
      contentLength: originalContent.length,
    });
  }

  updateCheckpointFile(
    checkpointId: string,
    path: string,
    lastHash: string,
    lastContent: string,
  ): void {
    this.db
      .query(
        "UPDATE files_changed SET last_hash = ?, last_content = ? WHERE checkpoint_id = ? AND path = ?",
      )
      .run(lastHash, lastContent, checkpointId, path);
    this.logger?.debug("storage.checkpoint.file_updated", {
      checkpointId,
      path,
      contentLength: lastContent.length,
    });
  }

  checkpointFiles(checkpointId: string): Array<{
    path: string;
    originalHash: string;
    originalContent: string;
    originalExists: boolean;
    lastHash: string;
    lastContent: string;
  }> {
    const rows = this.db
      .query<
        {
          path: string;
          original_hash: string;
          original_content: string;
          original_exists: number;
          last_hash: string;
          last_content: string;
        },
        [string]
      >(
        "SELECT path, original_hash, original_content, original_exists, last_hash, last_content FROM files_changed WHERE checkpoint_id = ? ORDER BY path",
      )
      .all(checkpointId);
    return rows.map((row) => ({
      path: row.path,
      originalHash: row.original_hash,
      originalContent: row.original_content,
      originalExists: row.original_exists === 1,
      lastHash: row.last_hash,
      lastContent: row.last_content,
    }));
  }

  close(): void {
    this.logger?.info("storage.closed", {});
    this.db.close();
  }
}

interface StoredMemoryRow {
  id: string;
  repository: string;
  kind: string;
  fact: string;
  evidence_json: string;
  provenance: string;
  confidence: number;
  scope_json: string;
  tags_json: string;
  created_at: string;
  last_validated_at: string;
  expires_at: string | null;
}

function parseMemoryFact(row: StoredMemoryRow): MemoryFact[] {
  if (
    !["semantic", "episodic", "procedural"].includes(row.kind) ||
    !["observed", "user_confirmed", "inferred"].includes(row.provenance)
  )
    return [];
  try {
    const evidence = JSON.parse(row.evidence_json) as unknown;
    const scope = JSON.parse(row.scope_json) as unknown;
    const tags = JSON.parse(row.tags_json) as unknown;
    if (
      !Array.isArray(evidence) ||
      !Array.isArray(scope) ||
      !Array.isArray(tags)
    )
      return [];
    return [
      {
        id: row.id,
        repository: row.repository,
        kind: row.kind as MemoryKind,
        fact: row.fact,
        evidence: evidence as MemoryFact["evidence"],
        provenance: row.provenance as MemoryFact["provenance"],
        confidence: row.confidence,
        scope: scope.filter(
          (value): value is string => typeof value === "string",
        ),
        tags: tags.filter(
          (value): value is string => typeof value === "string",
        ),
        createdAt: row.created_at,
        lastValidatedAt: row.last_validated_at,
        ...(row.expires_at ? { expiresAt: row.expires_at } : {}),
      },
    ];
  } catch {
    return [];
  }
}

function parseTaskLedger(value: string): AgentTaskLedger | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      typeof (parsed as Record<string, unknown>).id !== "string" ||
      typeof (parsed as Record<string, unknown>).phase !== "string"
    )
      return undefined;
    const ledger = parsed as AgentTaskLedger;
    // Older persisted ledgers predate the structured host verification plan.
    // Normalize them on read so compaction and resume never depend on an
    // optional field that the current kernel treats as authoritative state.
    if (!Array.isArray(ledger.verificationPlan)) ledger.verificationPlan = [];
    return ledger;
  } catch {
    return undefined;
  }
}

function parseAgentProbe(value: string): StoredAgentProbe | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      Array.isArray(parsed) ||
      typeof (parsed as Record<string, unknown>).conversation !== "boolean" ||
      typeof (parsed as Record<string, unknown>).readTool !== "boolean" ||
      typeof (parsed as Record<string, unknown>).multiTurnTools !== "boolean" ||
      typeof (parsed as Record<string, unknown>).agenticCodingEligible !==
        "boolean" ||
      typeof (parsed as Record<string, unknown>).agentCapabilityClass !==
        "string" ||
      !Array.isArray((parsed as Record<string, unknown>).notes)
    )
      return undefined;
    return parsed as StoredAgentProbe;
  } catch {
    return undefined;
  }
}

function parseStoredModelCapability(
  value: string,
): StoredModelCapability | undefined {
  try {
    const parsed: unknown = JSON.parse(value);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      typeof (parsed as Record<string, unknown>).version === "number" &&
      typeof (parsed as Record<string, unknown>).probe === "object"
    ) {
      const probe = parseAgentProbe(
        JSON.stringify((parsed as Record<string, unknown>).probe),
      );
      return probe
        ? {
            probe,
            version: (parsed as Record<string, unknown>).version as number,
          }
        : undefined;
    }
    const legacyProbe = parseAgentProbe(value);
    return legacyProbe ? { probe: legacyProbe, version: 1 } : undefined;
  } catch {
    return undefined;
  }
}
