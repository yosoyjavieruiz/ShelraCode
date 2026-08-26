import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTaskLedger } from "../../src/agent/task-state.js";
import { reviewWorkspaceChange } from "../../src/agent/workspace-review.js";

test("reviews a non-Git workspace from the host mutation ledger", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-review-"));
  const ledger = createTaskLedger({
    id: "non-git-review",
    objective: "Create an artifact.",
    mode: "coding",
  });
  ledger.filesChanged.push("artifact.txt");

  await expect(reviewWorkspaceChange({ root, ledger })).resolves.toBe(true);
});

test("does not pass a non-Git final review without a recorded mutation", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-review-empty-"));
  const ledger = createTaskLedger({
    id: "non-git-empty-review",
    objective: "Create an artifact.",
    mode: "coding",
  });

  await expect(reviewWorkspaceChange({ root, ledger })).resolves.toBe(false);
});
