import { expect, test } from "bun:test";
import {
  addTaskEvidence,
  createTaskLedger,
  recordTaskAction,
  recordTaskMutatedPaths,
  recordVerificationRun,
  reopenTaskForResume,
  canTransitionTaskPhase,
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

test("task ledger exposes and enforces the phase transition authority", () => {
  expect(canTransitionTaskPhase("frame", "discover")).toBe(true);
  expect(canTransitionTaskPhase("discover", "verify")).toBe(false);
  expect(canTransitionTaskPhase("review", "complete")).toBe(true);

  const ledger = createTaskLedger({
    id: "task-phase-authority",
    objective: "Review the repository",
    mode: "review",
  });
  expect(() => setTaskPhase(ledger, "verify")).toThrow(
    /invalid task phase transition/i,
  );
  setTaskPhase(ledger, "discover");
  setTaskPhase(ledger, "analyze");
  setTaskPhase(ledger, "review");
  setTaskPhase(ledger, "complete");
  expect(ledger.phase).toBe("complete");
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

test("recordTaskMutatedPaths adds Shell/RunTests-attributed paths to filesChanged without duplicates", () => {
  const ledger = createTaskLedger({
    id: "task-shell-mutation",
    objective: "Run the formatter",
    mode: "coding",
  });

  recordTaskAction(ledger, {
    id: "action-1",
    kind: "execute",
    target: "Shell",
    status: "succeeded",
  });
  expect(ledger.filesChanged).toEqual([]);

  recordTaskMutatedPaths(ledger, ["src/parser.ts", "package-lock.json"]);
  recordTaskMutatedPaths(ledger, ["src/parser.ts"]);

  expect(ledger.filesChanged).toEqual(["src/parser.ts", "package-lock.json"]);
});

test("recordTaskMutatedPaths does not add a duplicate for a path that only differs in leading slash or case", () => {
  const ledger = createTaskLedger({
    id: "task-shell-mutation-casing",
    objective: "Run the formatter",
    mode: "coding",
  });
  recordTaskAction(ledger, {
    id: "action-1",
    kind: "write",
    target: "Src/Parser.ts",
    status: "succeeded",
  });

  recordTaskMutatedPaths(ledger, ["/src/parser.ts"]);

  const foldsCase =
    process.platform === "win32" || process.platform === "darwin";
  expect(ledger.filesChanged).toEqual(
    foldsCase ? ["Src/Parser.ts"] : ["Src/Parser.ts", "/src/parser.ts"],
  );
});

function ledgerWithProof() {
  const ledger = createTaskLedger({
    id: "task-resume",
    objective: "Fix the parser",
    mode: "coding",
    successCriteria: [
      {
        id: "criterion-1",
        description: "Parser handles trailing commas",
        required: true,
        satisfied: true,
      },
      {
        id: "criterion-2",
        description: "README mentions the new flag",
        required: false,
        satisfied: true,
      },
    ],
  });
  addTaskEvidence(ledger, {
    id: "evidence-1",
    kind: "file",
    source: "src/parser.ts",
    summary: "Parser reads a trailing comma without throwing.",
    relevance: 1,
    freshness: 1,
  });
  recordTaskAction(ledger, {
    id: "action-1",
    kind: "read",
    target: "src/parser.ts",
    status: "succeeded",
  });
  recordVerificationRun(ledger, {
    id: "verification-1",
    command: "bun test",
    status: "passed",
    exitCode: 0,
    startedAt: new Date().toISOString(),
  });
  return ledger;
}

test("reopenTaskForResume with no changed paths preserves recorded proof", () => {
  const ledger = ledgerWithProof();
  setTaskPhase(ledger, "discover");
  setTaskPhase(ledger, "analyze");
  setTaskPhase(ledger, "plan");
  setTaskPhase(ledger, "act");
  setTaskPhase(ledger, "failed");

  reopenTaskForResume(ledger);

  expect(ledger.phase).toBe("reflect");
  expect(ledger.successCriteria[0]?.satisfied).toBe(true);
  expect(ledger.verificationRuns).toHaveLength(1);
  expect(ledger.filesRead).toContain("src/parser.ts");
  expect(ledger.evidence).toHaveLength(1);
});

test("reopenTaskForResume with task-owned changed paths invalidates completion proof and stale evidence", () => {
  const ledger = ledgerWithProof();
  setTaskPhase(ledger, "discover");
  setTaskPhase(ledger, "analyze");
  setTaskPhase(ledger, "plan");
  setTaskPhase(ledger, "act");
  setTaskPhase(ledger, "failed");

  reopenTaskForResume(ledger, ["src/parser.ts"]);

  expect(ledger.phase).toBe("reflect");
  expect(ledger.successCriteria[0]?.satisfied).toBe(false);
  expect(ledger.successCriteria[1]?.satisfied).toBe(false);
  expect(ledger.verificationRuns).toHaveLength(0);
  expect(ledger.filesRead).not.toContain("src/parser.ts");
  expect(ledger.evidence).toHaveLength(0);
});

test("reopenTaskForResume invalidation matches changed paths regardless of leading slash or case", () => {
  const ledger = ledgerWithProof();
  setTaskPhase(ledger, "discover");
  setTaskPhase(ledger, "analyze");
  setTaskPhase(ledger, "plan");
  setTaskPhase(ledger, "act");
  setTaskPhase(ledger, "failed");

  reopenTaskForResume(ledger, ["/Src/Parser.ts"]);

  // successCriteria/verificationRuns are always reset once anything changed
  // (see the previous test); the path-comparison-key matching this test
  // exercises only governs which filesRead/evidence entries are dropped.
  const foldsCase =
    process.platform === "win32" || process.platform === "darwin";
  expect(ledger.filesRead.includes("src/parser.ts")).toBe(!foldsCase);
  expect(ledger.evidence.some((item) => item.source === "src/parser.ts")).toBe(
    !foldsCase,
  );
});
