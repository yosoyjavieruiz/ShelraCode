import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CheckpointService } from "../../src/checkpoint/checkpoint.js";
import { LocalCodeDatabase } from "../../src/storage/database.js";
import { ToolError } from "../../src/tools/errors.js";
import { createLogger, type LogRecord } from "../../src/shared/logging.js";

describe("checkpoint rollback", () => {
  test("restores only LocalCode-owned content", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "localcode-checkpoint-"));
    await writeFile(path.join(root, "file.ts"), "before\n", "utf8");
    const db = new LocalCodeDatabase(":memory:");
    const service = new CheckpointService(db, root);
    const id = await service.create("task-1", ["file.ts"]);
    await writeFile(path.join(root, "file.ts"), "local change\n", "utf8");
    await service.recordMutation(id, "file.ts", "local change\n");

    const result = await service.rollback(id);
    expect(result).toEqual({ restored: ["file.ts"], conflicts: [] });
    expect(await readFile(path.join(root, "file.ts"), "utf8")).toBe("before\n");
    db.close();
  });

  test("stops instead of overwriting an external edit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "localcode-checkpoint-"));
    await mkdir(path.join(root, "src"));
    await writeFile(path.join(root, "src", "file.ts"), "before\n", "utf8");
    const db = new LocalCodeDatabase(":memory:");
    const service = new CheckpointService(db, root);
    const id = await service.create("task-2", ["src/file.ts"]);
    await writeFile(
      path.join(root, "src", "file.ts"),
      "local change\n",
      "utf8",
    );
    await service.recordMutation(id, "src/file.ts", "local change\n");
    await writeFile(path.join(root, "src", "file.ts"), "user change\n", "utf8");

    const result = await service.rollback(id);
    expect(result.restored).toHaveLength(0);
    expect(result.conflicts[0]?.reason).toBe("changed-external");
    expect(await readFile(path.join(root, "src", "file.ts"), "utf8")).toBe(
      "user change\n",
    );
    db.close();
  });
});

test("rejects a stale mutation after an external edit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-checkpoint-"));
  await writeFile(path.join(root, "file.ts"), "before\n", "utf8");
  const db = new LocalCodeDatabase(":memory:");
  const service = new CheckpointService(db, root);
  const id = await service.create("task-3", ["file.ts"]);
  await writeFile(path.join(root, "file.ts"), "user edit\n", "utf8");

  await expect(
    service.assertNoExternalChange(id, "file.ts"),
  ).rejects.toBeInstanceOf(ToolError);
  try {
    await service.assertNoExternalChange(id, "file.ts");
  } catch (error) {
    expect((error as ToolError).code).toBe("STALE_EDIT");
  }
  db.close();
});

test("reports whether checkpointed work is still preserved", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-checkpoint-"));
  await writeFile(path.join(root, "file.ts"), "before\n", "utf8");
  const db = new LocalCodeDatabase(":memory:");
  const service = new CheckpointService(db, root);
  const id = await service.create("task-preserved", ["file.ts"]);

  expect(await service.isPreserved(id)).toBe(true);
  await writeFile(path.join(root, "file.ts"), "external\n", "utf8");
  expect(await service.isPreserved(id)).toBe(false);
  db.close();
});

test("logs why checkpoint preservation failed without exposing file content", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-checkpoint-preservation-log-"),
  );
  await writeFile(path.join(root, "file.ts"), "before\n", "utf8");
  const records: LogRecord[] = [];
  const logger = createLogger({
    level: "debug",
    sink: { write: (record) => records.push(record) },
  });
  const db = new LocalCodeDatabase(":memory:", logger);
  const service = new CheckpointService(db, root, logger);
  const id = await service.create("task-preservation-log", ["file.ts"]);

  await writeFile(
    path.join(root, "file.ts"),
    "external-secret-content\n",
    "utf8",
  );
  expect(await service.isPreserved(id)).toBe(false);

  const failure = records.find(
    (record) => record.event === "checkpoint.preservation.failed",
  );
  expect(failure?.data).toMatchObject({
    path: "file.ts",
    reason: "changed-external",
    actualExists: true,
  });
  expect(JSON.stringify(records)).not.toContain("external-secret-content");
  db.close();
});

test("checkpoint logs lifecycle and stale-edit evidence without file content", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-checkpoint-logs-"),
  );
  await writeFile(
    path.join(root, "file.ts"),
    "before-secret-content\n",
    "utf8",
  );
  const records: LogRecord[] = [];
  const logger = createLogger({
    level: "debug",
    sink: { write: (record) => records.push(record) },
  });
  const db = new LocalCodeDatabase(":memory:", logger);
  const service = new CheckpointService(db, root, logger);
  const id = await service.create("task-logs", ["file.ts"]);
  await service.recordMutation(id, "file.ts", "local-secret-content\n");

  const rendered = JSON.stringify(records);
  expect(records.map((record) => record.event)).toContain(
    "checkpoint.create.finished",
  );
  expect(records.map((record) => record.event)).toContain(
    "checkpoint.mutation.recorded",
  );
  expect(rendered).not.toContain("before-secret-content");
  expect(rendered).not.toContain("local-secret-content");
  db.close();
});
