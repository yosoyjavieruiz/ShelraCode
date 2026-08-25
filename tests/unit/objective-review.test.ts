import { expect, test } from "bun:test";
import {
  extractObjectivePaths,
  reviewCodingObjective,
} from "../../src/agent/objective-review.js";
import {
  createTaskLedger,
  recordTaskAction,
  recordVerificationRun,
} from "../../src/agent/task-state.js";
import type { AgentTask } from "../../src/agent/types.js";

function task(objective: string, stagedPaths?: string[]): AgentTask {
  return {
    id: "objective-review-test",
    objective,
    root: process.cwd(),
    candidate: {
      id: "local/test",
      providerId: "test",
      modelId: "test-model",
      displayName: "Test model",
      source: "local",
      capabilities: {
        tools: true,
        structuredOutput: true,
        reasoning: false,
        vision: false,
      },
      free: { status: "unknown" },
      privacy: { classification: "local", retentionKnown: true },
      quality: { confidence: "measured" },
      health: { state: "healthy" },
    },
    repositoryPolicy: "local_only",
    permissionMode: "AUTO",
    mode: "coding",
    ...(stagedPaths ? { stagedPaths } : {}),
  };
}

test("objective review extracts root and nested workspace paths", () => {
  expect(
    extractObjectivePaths(
      "Inspect package.json, src/auth/session.ts and tests/auth.test.ts.",
    ),
  ).toEqual(["package.json", "src/auth/session.ts", "tests/auth.test.ts"]);
});

test("objective review does not turn a dependency name into a phantom file", () => {
  expect(
    extractObjectivePaths(
      "Update the Moment.js dependency and repair the authentication flow.",
    ),
  ).toEqual([]);
});

test("objective review keeps an explicitly named root document", () => {
  expect(extractObjectivePaths("Update the file index.html.")).toEqual([
    "index.html",
  ]);
});

test("objective review blocks a named file that was never inspected", async () => {
  const ledger = createTaskLedger({
    id: "objective-review-missing-read",
    objective: "Fix src/auth/session.ts.",
    mode: "coding",
  });
  recordTaskAction(ledger, {
    id: "write",
    kind: "write",
    target: "src/auth/session.ts",
    status: "succeeded",
  });

  const result = await reviewCodingObjective(
    task("Fix src/auth/session.ts."),
    ledger,
    process.cwd(),
  );

  expect(result.pass).toBe(false);
  expect(result.issues.join(" ")).toContain("not inspected");
  expect(result.nextPaths).toContain("src/auth/session.ts");
});

test("objective review accepts a related bounded change with no test request", async () => {
  const ledger = createTaskLedger({
    id: "objective-review-pass",
    objective: "Fix src/auth/session.ts.",
    mode: "coding",
  });
  recordTaskAction(ledger, {
    id: "read",
    kind: "read",
    target: "src/auth/session.ts",
    status: "succeeded",
  });
  recordTaskAction(ledger, {
    id: "write",
    kind: "write",
    target: "src/auth/session.ts",
    status: "succeeded",
  });

  const result = await reviewCodingObjective(
    task("Fix src/auth/session.ts."),
    ledger,
    process.cwd(),
  );

  expect(result).toEqual({
    pass: true,
    issues: [],
    nextPaths: [],
    nextActions: [],
  });
});

test("objective review requires passing test evidence for an explicit test request", async () => {
  const ledger = createTaskLedger({
    id: "objective-review-test-evidence",
    objective: "Update src/auth.ts and run tests.",
    mode: "coding",
  });
  recordTaskAction(ledger, {
    id: "read",
    kind: "read",
    target: "src/auth.ts",
    status: "succeeded",
  });
  recordTaskAction(ledger, {
    id: "write",
    kind: "write",
    target: "src/auth.ts",
    status: "succeeded",
  });

  const result = await reviewCodingObjective(
    task("Update src/auth.ts and run tests."),
    ledger,
    process.cwd(),
  );

  expect(result.pass).toBe(false);
  expect(result.issues.join(" ")).toContain("passing test evidence");
  recordVerificationRun(ledger, {
    id: "test",
    stage: "test",
    command: "bun test",
    status: "passed",
    exitCode: 0,
    startedAt: new Date().toISOString(),
  });
  const passed = await reviewCodingObjective(
    task("Update src/auth.ts and run tests."),
    ledger,
    process.cwd(),
  );
  expect(passed.pass).toBe(true);
});

test("objective review advances inferred staged targets one at a time", async () => {
  const ledger = createTaskLedger({
    id: "objective-review-staged",
    objective: "Refactor the authentication flow.",
    mode: "coding",
  });
  recordTaskAction(ledger, {
    id: "read-auth",
    kind: "read",
    target: "src/auth.ts",
    status: "succeeded",
  });
  recordTaskAction(ledger, {
    id: "write-auth",
    kind: "write",
    target: "src/auth.ts",
    status: "succeeded",
  });

  const result = await reviewCodingObjective(
    task("Refactor the authentication flow.", [
      "src/auth.ts",
      "src/session.ts",
    ]),
    ledger,
    process.cwd(),
  );

  expect(result.pass).toBe(false);
  expect(result.nextPaths).toEqual(["src/session.ts"]);
});
