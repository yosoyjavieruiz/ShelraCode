import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import path from "node:path";
import { assertWorkspacePath, resolveWorkspacePath } from "../shared/paths.js";
import { LocalCodeDatabase } from "../storage/database.js";
import { ToolError } from "../tools/errors.js";
import type { LocalCodeLogger } from "../shared/logging.js";

export interface CheckpointConflict {
  path: string;
  expectedHash: string;
  actualHash?: string;
  reason: "changed-external" | "symlink-escape" | "missing";
}

export interface RollbackResult {
  restored: string[];
  conflicts: CheckpointConflict[];
}

export interface FileMutationSnapshot {
  path: string;
  exists: boolean;
  content: string;
  contentHash: string;
}

function hash(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function safePath(root: string, relativePath: string): string {
  return resolveWorkspacePath(root, relativePath);
}

async function readWorkspaceFile(
  root: string,
  relativePath: string,
): Promise<{ exists: boolean; content: string }> {
  const absolute = await assertWorkspacePath(root, relativePath);
  try {
    return { exists: true, content: await readFile(absolute, "utf8") };
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return { exists: false, content: "" };
    }
    throw error;
  }
}

export class CheckpointService {
  constructor(
    private readonly db: LocalCodeDatabase,
    private readonly root: string,
    logger?: LocalCodeLogger,
  ) {
    this.logger = logger?.child({ component: "checkpoint" });
  }

  private readonly logger?: LocalCodeLogger;

  async create(taskId: string, paths: string[]): Promise<string> {
    const id = randomUUID();
    this.logger?.info("checkpoint.create.started", {
      checkpointId: id,
      taskId,
      pathCount: new Set(paths).size,
    });
    this.db.createCheckpoint(id, taskId);
    await this.capture(id, paths);
    this.logger?.info("checkpoint.create.finished", {
      checkpointId: id,
      taskId,
      capturedFileCount: this.db.checkpointFiles(id).length,
    });
    return id;
  }

  async capture(checkpointId: string, paths: string[]): Promise<void> {
    const captured = new Set(
      this.db.checkpointFiles(checkpointId).map((file) => file.path),
    );
    let capturedCount = 0;
    for (const relativePath of [...new Set(paths)]) {
      if (captured.has(relativePath)) continue;
      const file = await readWorkspaceFile(this.root, relativePath);
      const contentHash = hash(file.content);
      this.db.addCheckpointFile(
        checkpointId,
        relativePath,
        contentHash,
        file.content,
        file.exists,
      );
      capturedCount += 1;
    }
    this.logger?.debug("checkpoint.capture.finished", {
      checkpointId,
      requestedPathCount: new Set(paths).size,
      capturedCount,
    });
  }

  async recordMutation(
    checkpointId: string,
    relativePath: string,
    content: string,
  ): Promise<void> {
    safePath(this.root, relativePath);
    this.db.updateCheckpointFile(
      checkpointId,
      relativePath,
      hash(content),
      content,
    );
    this.logger?.info("checkpoint.mutation.recorded", {
      checkpointId,
      path: relativePath,
      contentLength: content.length,
    });
  }

  async snapshot(relativePath: string): Promise<FileMutationSnapshot> {
    const file = await readWorkspaceFile(this.root, relativePath);
    return {
      path: relativePath,
      exists: file.exists,
      content: file.content,
      contentHash: hash(file.content),
    };
  }

  async restoreMutation(
    checkpointId: string,
    before: FileMutationSnapshot,
    expectedCurrentHash: string,
  ): Promise<boolean> {
    const current = await this.snapshot(before.path);
    if (current.contentHash !== expectedCurrentHash) {
      this.logger?.warn("checkpoint.mutation_restore.conflict", {
        checkpointId,
        path: before.path,
        reason: "changed-external",
      });
      return false;
    }
    const absolute = safePath(this.root, before.path);
    if (before.exists) {
      await mkdir(path.dirname(absolute), { recursive: true });
      await writeFile(absolute, before.content, "utf8");
    } else if (current.exists) {
      await unlink(absolute);
    }
    this.db.updateCheckpointFile(
      checkpointId,
      before.path,
      before.contentHash,
      before.content,
    );
    this.logger?.info("checkpoint.mutation_restore.finished", {
      checkpointId,
      path: before.path,
    });
    return true;
  }

  async assertNoExternalChange(
    checkpointId: string,
    relativePath: string,
  ): Promise<void> {
    const expected = this.db
      .checkpointFiles(checkpointId)
      .find((file) => file.path === relativePath);
    if (!expected) {
      this.logger?.warn("checkpoint.baseline.missing", {
        checkpointId,
        path: relativePath,
      });
      throw new ToolError(
        "CONFLICT",
        `No checkpoint baseline exists for ${relativePath}.`,
        {
          recoverable: true,
          path: relativePath,
          suggestedAction:
            "Capture the file in the active checkpoint before editing it.",
        },
      );
    }
    const current = await readWorkspaceFile(this.root, relativePath);
    const currentHash = hash(current.content);
    if (currentHash !== expected.lastHash) {
      this.logger?.warn("checkpoint.stale_edit.detected", {
        checkpointId,
        path: relativePath,
      });
      throw new ToolError(
        "STALE_EDIT",
        `${relativePath} changed after LocalCode captured its checkpoint. Read it again before editing.`,
        {
          recoverable: true,
          path: relativePath,
          suggestedAction:
            "Read the current file and recompute the edit against the latest content.",
        },
      );
    }
    this.logger?.debug("checkpoint.baseline.confirmed", {
      checkpointId,
      path: relativePath,
    });
  }

  /**
   * Check that every file captured by the active task still contains the
   * latest content LocalCode wrote. A mismatch means an external edit landed
   * after the checkpoint's last mutation and completion must not claim that
   * user work was preserved.
   */
  async isPreserved(checkpointId: string): Promise<boolean> {
    for (const file of this.db.checkpointFiles(checkpointId)) {
      const current = await readWorkspaceFile(this.root, file.path);
      if (hash(current.content) !== file.lastHash) {
        this.logger?.warn("checkpoint.preservation.failed", {
          checkpointId,
          path: file.path,
          reason: current.exists ? "changed-external" : "missing",
          actualExists: current.exists,
          actualContentLength: current.content.length,
        });
        return false;
      }
    }
    this.logger?.debug("checkpoint.preservation.confirmed", {
      checkpointId,
      fileCount: this.db.checkpointFiles(checkpointId).length,
    });
    return true;
  }

  async rollback(checkpointId: string): Promise<RollbackResult> {
    const restored: string[] = [];
    const conflicts: CheckpointConflict[] = [];
    this.logger?.info("checkpoint.rollback.started", { checkpointId });
    for (const file of this.db.checkpointFiles(checkpointId)) {
      const current = await readWorkspaceFile(this.root, file.path);
      if (!current.exists && file.lastHash !== hash("")) {
        conflicts.push({
          path: file.path,
          expectedHash: file.lastHash,
          reason: "missing",
        });
        continue;
      }
      const currentHash = hash(current.content);
      if (currentHash !== file.lastHash) {
        conflicts.push({
          path: file.path,
          expectedHash: file.lastHash,
          actualHash: currentHash,
          reason: "changed-external",
        });
        continue;
      }
      const absolute = safePath(this.root, file.path);
      if (file.originalExists) {
        await mkdir(path.dirname(absolute), { recursive: true });
        await writeFile(absolute, file.originalContent, "utf8");
      } else if (current.exists) {
        await unlink(absolute);
      }
      restored.push(file.path);
    }
    this.logger?.info(
      conflicts.length > 0
        ? "checkpoint.rollback.finished_with_conflicts"
        : "checkpoint.rollback.finished",
      {
        checkpointId,
        restoredCount: restored.length,
        conflictCount: conflicts.length,
        conflictPaths: conflicts.map((conflict) => conflict.path),
      },
    );
    return { restored, conflicts };
  }
}
