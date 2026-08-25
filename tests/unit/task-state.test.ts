import { expect, test } from "bun:test";
import {
  addTaskEvidence,
  createTaskLedger,
  recordTaskAction,
  recordVerificationRun,
  setTaskPhase,
} from "../../src/agent/task-state.js";

test("task ledger starts in frame and records evidence and actions", () => {
  const ledger = createTaskLedger({
    id: "task-1",
    objective: "Fix the session refresh bug",
    mode: "coding",
  });

  expect(ledger.phase).toBe("frame");
  setTaskPhase(ledger, "discover");
  addTaskEvidence(ledger, {
    id: "evidence-1",
    kind: "manifest",
    source: "package.json",
    summary: "Project scripts are declared in package.json.",
    relevance: 1,
    freshness: 1,
  });
  recordTaskAction(ledger, {
    id: "action-1",
    kind: "read",
    target: "package.json",
    status: "succeeded",
  });

  expect(ledger.evidence).toHaveLength(1);
  expect(ledger.actions).toHaveLength(1);
  expect(ledger.filesRead).toContain("package.json");
});

test("task ledger rejects an invalid lifecycle jump", () => {
  const ledger = createTaskLedger({
    id: "task-2",
    objective: "Review the repository",
    mode: "review",
  });

  expect(() => setTaskPhase(ledger, "complete")).toThrow(
    /invalid task phase transition/i,
  );
});

test("task ledger keeps blockers visible instead of silently completing", () => {
  const ledger = createTaskLedger({
    id: "task-3",
    objective: "Run verification",
    mode: "command",
  });

  ledger.blockers.push({
    id: "blocker-1",
    summary: "The configured runtime is unavailable.",
    recoverable: true,
  });
  setTaskPhase(ledger, "blocked");

  expect(ledger.phase).toBe("blocked");
  expect(ledger.blockers[0]?.summary).toContain("runtime");
});

test("task ledger records verification evidence and updates an existing run", () => {
  const ledger = createTaskLedger({
    id: "task-verification",
    objective: "run tests",
    mode: "coding",
  });
  const startedAt = new Date().toISOString();
  recordVerificationRun(ledger, {
    id: "verification-1",
    command: "bun test",
    status: "running",
    startedAt,
  });
  recordVerificationRun(ledger, {
    id: "verification-1",
    command: "bun test",
    status: "passed",
    exitCode: 0,
    summary: "all tests passed",
    startedAt,
    completedAt: new Date().toISOString(),
  });

  expect(ledger.verificationRuns).toHaveLength(1);
  expect(ledger.verificationRuns[0]?.status).toBe("passed");
  expect(ledger.verificationRuns[0]?.exitCode).toBe(0);
});
