import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
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
import { createModelPlanningGraph } from "../../src/agent/task-graph.js";
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

test("objective review defers lexical path matching while an LLM plan covers the mutation", async () => {
  const objective =
    "Añade una función reset que ponga el contador en cero, actualiza las pruebas y mantén la API existente";
  const ledger = createTaskLedger({
    id: "objective-review-model-plan",
    objective,
    mode: "coding",
    planningMode: "model",
  });
  const graph = createModelPlanningGraph({ objective });
  graph.revision = 1;
  graph.currentNodeId = "implement";
  graph.nodes = [
    {
      id: "inspect",
      objective: "Read the current counter implementation and tests.",
      dependencies: [],
      kind: "workspace",
      status: "passed",
      scope: {
        candidateFiles: ["src/counter.ts", "src/counter.test.ts"],
        allowedTools: ["ReadFile"],
      },
      contextRequirements: ["current implementation"],
      acceptance: ["Relevant files were inspected."],
      verification: [],
      attempts: 0,
      source: "model",
      revision: 1,
    },
    {
      id: "implement",
      objective: "Implement reset and update the related tests.",
      dependencies: ["inspect"],
      kind: "workspace",
      status: "verifying",
      scope: {
        candidateFiles: ["src/counter.ts", "src/counter.test.ts"],
        allowedTools: ["EditFile"],
      },
      contextRequirements: ["current implementation"],
      acceptance: ["Reset behavior is implemented and covered."],
      verification: [],
      attempts: 1,
      source: "model",
      revision: 1,
    },
  ];
  ledger.taskGraph = graph;
  recordTaskAction(ledger, {
    id: "read-counter",
    kind: "read",
    target: "src/counter.ts",
    status: "succeeded",
  });
  recordTaskAction(ledger, {
    id: "read-counter-test",
    kind: "read",
    target: "src/counter.test.ts",
    status: "succeeded",
  });
  recordTaskAction(ledger, {
    id: "write-counter",
    kind: "write",
    target: "src/counter.ts",
    status: "succeeded",
  });
  recordTaskAction(ledger, {
    id: "write-counter-test",
    kind: "write",
    target: "src/counter.test.ts",
    status: "succeeded",
  });
  recordVerificationRun(ledger, {
    id: "test-counter",
    stage: "test",
    command: "bun test",
    status: "passed",
    exitCode: 0,
    startedAt: new Date().toISOString(),
  });

  const result = await reviewCodingObjective(
    task(objective),
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

test("objective review rejects unresolved placeholders in a changed artifact", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-objective-review-"),
  );
  try {
    await writeFile(
      path.join(root, "README.md"),
      "# Project\n\nStart with [Required tooling or dependencies].\n",
    );
    const ledger = createTaskLedger({
      id: "objective-review-placeholder",
      objective:
        "Create a README explaining this project's purpose and how to start it.",
      mode: "coding",
    });
    recordTaskAction(ledger, {
      id: "read-readme",
      kind: "read",
      target: "README.md",
      status: "succeeded",
    });
    recordTaskAction(ledger, {
      id: "write-readme",
      kind: "write",
      target: "README.md",
      status: "succeeded",
    });

    const result = await reviewCodingObjective(
      task(
        "Create a README explaining this project's purpose and how to start it.",
      ),
      ledger,
      root,
    );

    expect(result.pass).toBe(false);
    expect(result.issues.join(" ")).toContain("unresolved placeholder");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("objective review rejects unresolved example paths in a changed artifact", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-objective-review-example-"),
  );
  try {
    await writeFile(
      path.join(root, "README.md"),
      "# Project\n\nClone from /path/to/project before running the app.\n",
    );
    const ledger = createTaskLedger({
      id: "objective-review-example-path",
      objective:
        "Create a README explaining this project's purpose and how to start it.",
      mode: "coding",
    });
    recordTaskAction(ledger, {
      id: "read-readme",
      kind: "read",
      target: "README.md",
      status: "succeeded",
    });
    recordTaskAction(ledger, {
      id: "write-readme",
      kind: "write",
      target: "README.md",
      status: "succeeded",
    });

    const result = await reviewCodingObjective(
      task(
        "Create a README explaining this project's purpose and how to start it.",
      ),
      ledger,
      root,
    );

    expect(result.pass).toBe(false);
    expect(result.issues.join(" ")).toContain("unresolved placeholder");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("objective review rejects a generic placeholder document from live work", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-objective-review-template-"),
  );
  try {
    await writeFile(
      path.join(root, "README.md"),
      "# Project\n\nThis is a placeholder README template.\n",
    );
    const ledger = createTaskLedger({
      id: "objective-review-template",
      objective: "Create a README explaining this project's purpose.",
      mode: "coding",
    });
    recordTaskAction(ledger, {
      id: "read-readme",
      kind: "read",
      target: "README.md",
      status: "succeeded",
    });
    recordTaskAction(ledger, {
      id: "write-readme",
      kind: "write",
      target: "README.md",
      status: "succeeded",
    });

    const result = await reviewCodingObjective(
      task("Create a README explaining this project's purpose.", ["README.md"]),
      ledger,
      root,
    );

    expect(result.pass).toBe(false);
    expect(result.issues.join(" ")).toContain("unresolved placeholder");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("objective review rejects unresolved repository and project placeholders", async () => {
  const root = await mkdtemp(
    path.join(
      os.tmpdir(),
      "localcode-objective-review-repository-placeholder-",
    ),
  );
  try {
    await writeFile(
      path.join(root, "README.md"),
      [
        "# Project Name",
        "",
        "Clone <repository-url> and run `cd project-name`.",
        "",
        "The remaining setup is [if applicable].",
      ].join("\n"),
    );
    const ledger = createTaskLedger({
      id: "objective-review-repository-placeholder",
      objective:
        "Create a README explaining this project's purpose and how to start it.",
      mode: "coding",
    });
    recordTaskAction(ledger, {
      id: "read-readme",
      kind: "read",
      target: "README.md",
      status: "succeeded",
    });
    recordTaskAction(ledger, {
      id: "write-readme",
      kind: "write",
      target: "README.md",
      status: "succeeded",
    });

    const result = await reviewCodingObjective(
      task(
        "Create a README explaining this project's purpose and how to start it.",
      ),
      ledger,
      root,
    );

    expect(result.pass).toBe(false);
    expect(result.issues.join(" ")).toContain("unresolved placeholder");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("objective review rejects cross-artifact DOM selectors that cannot resolve", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-objective-review-dom-"),
  );
  try {
    await writeFile(
      path.join(root, "index.html"),
      '<!doctype html><main id="time-container"><script src="app.js"></script></main>\n',
    );
    await writeFile(
      path.join(root, "app.js"),
      'document.getElementById("clock").textContent = "ready";\n',
    );
    const ledger = createTaskLedger({
      id: "objective-review-dom",
      objective: "Create a page using index.html and app.js.",
      mode: "coding",
    });
    for (const [id, kind, target] of [
      ["read-html", "read", "index.html"],
      ["read-js", "read", "app.js"],
      ["write-html", "write", "index.html"],
      ["write-js", "write", "app.js"],
    ] as const)
      recordTaskAction(ledger, { id, kind, target, status: "succeeded" });

    const result = await reviewCodingObjective(
      task("Create a page using index.html and app.js.", [
        "index.html",
        "app.js",
      ]),
      ledger,
      root,
    );

    expect(result.pass).toBe(false);
    expect(result.issues.join(" ")).toContain("does not define that selector");
    expect(result.nextPaths).toEqual(
      expect.arrayContaining(["index.html", "app.js"]),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("objective review accepts a resolvable cross-artifact DOM selector", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-objective-review-dom-pass-"),
  );
  try {
    await writeFile(
      path.join(root, "index.html"),
      '<!doctype html><main id="clock"><script src="app.js"></script></main>\n',
    );
    await writeFile(
      path.join(root, "app.js"),
      'document.getElementById("clock").textContent = "ready";\n',
    );
    const ledger = createTaskLedger({
      id: "objective-review-dom-pass",
      objective: "Create a page using index.html and app.js.",
      mode: "coding",
    });
    for (const [id, kind, target] of [
      ["read-html", "read", "index.html"],
      ["read-js", "read", "app.js"],
      ["write-html", "write", "index.html"],
      ["write-js", "write", "app.js"],
    ] as const)
      recordTaskAction(ledger, { id, kind, target, status: "succeeded" });

    const result = await reviewCodingObjective(
      task("Create a page using index.html and app.js.", [
        "index.html",
        "app.js",
      ]),
      ledger,
      root,
    );

    expect(result.pass).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
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
