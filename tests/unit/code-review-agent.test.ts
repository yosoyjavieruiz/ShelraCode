import { expect, test } from "bun:test";
import { runCodeReview } from "../../src/agent/code-review-agent.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  addTaskEvidence,
  createTaskLedger,
  recordTaskAction,
  recordVerificationRun,
} from "../../src/agent/task-state.js";

test("read-only code review passes an evidence-backed verified task", async () => {
  const ledger = createTaskLedger({
    id: "review-pass",
    objective: "Fix src/value.ts",
    mode: "coding",
    verificationPlan: [{ stage: "test", command: "bun test" }],
  });
  addTaskEvidence(ledger, {
    id: "value-read",
    kind: "file",
    source: "src/value.ts",
    summary: "The requested implementation was read before editing.",
    relevance: 1,
    freshness: 1,
  });
  recordTaskAction(ledger, {
    id: "edit",
    kind: "write",
    target: "src/value.ts",
    status: "succeeded",
  });
  ledger.filesChanged.push("src/value.ts");
  recordVerificationRun(ledger, {
    id: "test",
    stage: "test",
    command: "bun test",
    status: "passed",
    exitCode: 0,
    startedAt: new Date().toISOString(),
  });

  const isolatedRoot = await mkdtemp(
    path.join(os.tmpdir(), "localcode-code-review-pass-"),
  );
  const report = await runCodeReview({
    root: isolatedRoot,
    objective: ledger.objective,
    mode: "coding",
    ledger,
    verificationRequired: true,
    verificationCommands: [{ stage: "test", command: "bun test" }],
    verificationState: "available",
    finalReviewPerformed: true,
    userWorkPreserved: true,
  }).finally(() => rm(isolatedRoot, { recursive: true, force: true }));

  expect(report.role).toBe("code-review");
  expect(report.verdict).toBe("PASS");
  expect(report.verification.pass).toBe(true);
  expect(report.reference).toContain("Claude Code public agent-loop baseline");
});

test("read-only code review blocks a task with unavailable verification", async () => {
  const ledger = createTaskLedger({
    id: "review-blocked",
    objective: "Fix src/value.ts",
    mode: "coding",
  });
  addTaskEvidence(ledger, {
    id: "value-read",
    kind: "file",
    source: "src/value.ts",
    summary: "The target was inspected.",
    relevance: 1,
    freshness: 1,
  });
  recordTaskAction(ledger, {
    id: "edit",
    kind: "write",
    target: "src/value.ts",
    status: "succeeded",
  });

  const report = await runCodeReview({
    root: process.cwd(),
    objective: ledger.objective,
    mode: "coding",
    ledger,
    verificationRequired: true,
    verificationState: "unavailable",
    finalReviewPerformed: true,
    userWorkPreserved: true,
  });

  expect(report.verdict).toBe("BLOCKED");
  expect(report.issues.map((issue) => issue.code)).toContain(
    "VERIFICATION_UNAVAILABLE",
  );
});

test("does not treat a non-Git workspace as a failed diff check", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-code-review-"));
  const ledger = createTaskLedger({
    id: "review-non-git",
    objective: "Create an artifact.",
    mode: "coding",
  });
  addTaskEvidence(ledger, {
    id: "artifact-context",
    kind: "file",
    source: "workspace",
    summary: "The disposable workspace was inspected.",
    relevance: 1,
    freshness: 1,
  });
  recordTaskAction(ledger, {
    id: "artifact-write",
    kind: "write",
    target: "artifact.txt",
    status: "succeeded",
  });
  ledger.filesChanged.push("artifact.txt");

  const report = await runCodeReview({
    root,
    objective: ledger.objective,
    mode: "coding",
    ledger,
    verificationRequired: false,
    verificationState: "not_required",
    finalReviewPerformed: true,
    userWorkPreserved: true,
  });

  expect(report.diffCheck).toBe("unavailable");
  expect(report.verdict).toBe("PASS");
  expect(report.verification.pass).toBe(true);
});
