import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CheckpointService } from "../../src/checkpoint/checkpoint.js";
import { runAgent } from "../../src/agent/loop.js";
import { workspaceTools } from "../../src/tools/workspace.js";
import { LocalCodeDatabase } from "../../src/storage/database.js";
import {
  createScriptedProvider,
  fakeAgentCandidate,
} from "../support/fake-provider.js";

test("structured execution uses an LLM-defined plan instead of host target prose", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-planner-"));
  await mkdir(path.join(root, "src"));
  await writeFile(
    path.join(root, "src", "session.ts"),
    "export const session = true;\n",
    "utf8",
  );
  const objective =
    "Inspect the session implementation and propose a safe plan.";
  const proposal = {
    schemaVersion: 1,
    proposalId: "llm-plan-1",
    objective,
    summary:
      "Inspect the implementation before deciding whether a change is needed.",
    nodes: [
      {
        id: "inspect-session",
        objective: "Inspect the current session implementation.",
        dependencies: [],
        scope: {
          candidateFiles: ["src/session.ts"],
          allowedTools: ["ReadFile"],
        },
        requiredEvidence: ["current session source"],
        acceptance: ["The current implementation is understood."],
      },
    ],
  };
  const provider = createScriptedProvider(
    [
      [
        {
          type: "tool.call",
          call: {
            id: "plan-1",
            name: "ProposeTaskPlan",
            arguments: JSON.stringify(proposal),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "read-1",
            name: "ReadFile",
            arguments: JSON.stringify({ path: "src/session.ts" }),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "text.delta",
          text: "The session implementation is understood.",
        },
        { type: "done" },
      ],
    ],
    { stopAfter: true },
  );
  const db = new LocalCodeDatabase(":memory:");
  const checkpoint = new CheckpointService(db, root);
  try {
    const result = await runAgent(
      {
        id: "planner-task",
        objective,
        root,
        candidate: fakeAgentCandidate,
        repositoryPolicy: "private",
        permissionMode: "PLAN",
        mode: "plan",
        executionProfile: "structured",
        planningMode: "model",
        context: "The repository contains src/session.ts.",
        maxTurns: 3,
      },
      {
        provider,
        tools: workspaceTools.filter((tool) => tool.risk === "read"),
        toolChoice: "auto",
        createExecutionContext: async () => ({
          root,
          permissionMode: "PLAN",
          signal: new AbortController().signal,
          checkpoint,
        }),
      },
    );

    expect(result.status).toBe("completed");
    expect(result.ledger.taskGraph?.planSource).toBe("model");
    expect(result.ledger.plan?.source).toBe("model");
    expect(result.ledger.plan?.steps.map((step) => step.id)).toEqual([
      "inspect-session",
    ]);
    expect(result.ledger.planRevisions).toHaveLength(1);
    expect(result.ledger.planRevisions[0]?.source).toBe("llm");
    expect(provider.requests[0]?.tools?.[0]).toEqual(
      expect.objectContaining({
        function: expect.objectContaining({ name: "ProposeTaskPlan" }),
      }),
    );
    expect(
      provider.requests[1]?.tools?.some(
        (tool) =>
          (tool as { function?: { name?: string } }).function?.name ===
          "ProposeTaskPlan",
      ),
    ).toBe(false);
  } finally {
    db.close();
  }
});

test("asks the LLM planner to replace an unnecessary clarification before blocking", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-planner-clarification-review-"),
  );
  const objective = "Create a small status artifact for the repository.";
  const initialProposal = {
    schemaVersion: 1,
    proposalId: "llm-plan-clarification-1",
    objective,
    nodes: [
      {
        id: "clarify-status-format",
        objective: "Ask the user which optional status format to use.",
        kind: "clarification",
        dependencies: [],
        scope: { allowedTools: [] },
        acceptance: ["The user selects a status format."],
      },
      {
        id: "write-status",
        objective: "Write status.txt using the selected format.",
        kind: "workspace",
        dependencies: ["clarify-status-format"],
        scope: {
          candidateFiles: ["status.txt"],
          allowedTools: ["WriteFile"],
        },
      },
    ],
  };
  const recoveryProposal = {
    schemaVersion: 1,
    proposalId: "llm-plan-clarification-recovery-1",
    objective,
    supersedes: ["clarify-status-format", "write-status"],
    nodes: [
      {
        id: "choose-status-default",
        objective: "Choose a conventional concise status representation.",
        kind: "semantic",
        dependencies: [],
        scope: { allowedTools: [] },
        acceptance: [
          "A conventional default status representation is selected.",
        ],
      },
      {
        id: "write-status-recovery",
        objective: "Write status.txt using the selected conventional default.",
        kind: "workspace",
        dependencies: ["choose-status-default"],
        scope: {
          candidateFiles: ["status.txt"],
          allowedTools: ["WriteFile"],
        },
        acceptance: ["status.txt contains the selected status representation."],
      },
    ],
  };
  const provider = createScriptedProvider(
    [
      [
        {
          type: "tool.call",
          call: {
            id: "plan-clarification-1",
            name: "ProposeTaskPlan",
            arguments: JSON.stringify(initialProposal),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "plan-clarification-recovery-1",
            name: "ProposeTaskPlan",
            arguments: JSON.stringify(recoveryProposal),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "text.delta",
          text: "Use a concise conventional status representation.",
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "write-status-recovery",
            name: "WriteFile",
            arguments: JSON.stringify({
              path: "status.txt",
              content: "ready\n",
            }),
          },
        },
        { type: "done" },
      ],
    ],
    { stopAfter: true },
  );
  const db = new LocalCodeDatabase(":memory:");
  const checkpoint = new CheckpointService(db, root);
  try {
    const result = await runAgent(
      {
        id: "planner-clarification-review-task",
        objective,
        root,
        candidate: fakeAgentCandidate,
        repositoryPolicy: "private",
        permissionMode: "EDIT",
        mode: "coding",
        executionProfile: "structured",
        planningMode: "model",
        repositoryState: "empty",
        greenfieldIntent: true,
        enforceTaskContract: true,
        verificationPolicy: "not_required",
        maxTurns: 6,
      },
      {
        provider,
        tools: workspaceTools.filter((tool) => tool.name === "WriteFile"),
        toolChoice: "auto",
        createExecutionContext: async () => ({
          root,
          permissionMode: "EDIT",
          signal: new AbortController().signal,
          checkpoint,
        }),
        reviewFinalDiff: () => true,
        verifySuccessCriteria: async (_task, ledger) => {
          const exists = await Bun.file(path.join(root, "status.txt")).exists();
          return {
            pass: exists,
            issues: exists ? [] : ["status.txt is missing."],
            nextActions: exists ? [] : ["Write status.txt."],
            nextPaths: exists ? [] : ["status.txt"],
            satisfiedCriterionIds: exists
              ? ledger.successCriteria.map((criterion) => criterion.id)
              : [],
          };
        },
        independentVerifier: async () => ({
          pass: true,
          confidence: 1,
          issues: [],
        }),
      },
    );

    expect(result.status).toBe("completed");
    expect(result.ledger.planRevisions).toHaveLength(2);
    expect(result.ledger.planRevisions[1]?.supersededNodeIds).toEqual([
      "clarify-status-format",
      "write-status",
    ]);
    expect(
      result.ledger.taskGraph?.nodes.map((node) => [
        node.id,
        node.status,
        node.kind,
      ]),
    ).toEqual([
      ["clarify-status-format", "superseded", "clarification"],
      ["write-status", "superseded", "workspace"],
      ["choose-status-default", "passed", "semantic"],
      ["write-status-recovery", "passed", "workspace"],
    ]);
    expect(provider.requests).toHaveLength(4);
    expect(await Bun.file(path.join(root, "status.txt")).text()).toBe(
      "ready\n",
    );
  } finally {
    db.close();
  }
});

test("recovers an invalid initial LLM plan through a new planner proposal", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-planner-invalid-initial-"),
  );
  const objective = "Create a verified marker artifact.";
  const invalidProposal = {
    schemaVersion: 1,
    proposalId: "llm-plan-invalid-initial-1",
    objective,
    nodes: [
      {
        id: "invalid-clarification",
        objective: "Clarify the marker contents.",
        kind: "clarification",
        dependencies: [],
        scope: { allowedTools: ["ReadFile"] },
      },
    ],
  };
  const correctedProposal = {
    schemaVersion: 1,
    proposalId: "llm-plan-invalid-initial-recovery-1",
    objective,
    nodes: [
      {
        id: "write-marker",
        objective: "Write marker.txt with a concise verified marker.",
        kind: "workspace",
        dependencies: [],
        scope: {
          candidateFiles: ["marker.txt"],
          allowedTools: ["WriteFile"],
        },
      },
    ],
  };
  const provider = createScriptedProvider(
    [
      [
        {
          type: "tool.call",
          call: {
            id: "plan-invalid-initial-1",
            name: "ProposeTaskPlan",
            arguments: JSON.stringify(invalidProposal),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "plan-invalid-initial-recovery-1",
            name: "ProposeTaskPlan",
            arguments: JSON.stringify(correctedProposal),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "write-marker",
            name: "WriteFile",
            arguments: JSON.stringify({
              path: "marker.txt",
              content: "verified\n",
            }),
          },
        },
        { type: "done" },
      ],
    ],
    { stopAfter: true },
  );
  const db = new LocalCodeDatabase(":memory:");
  const checkpoint = new CheckpointService(db, root);
  try {
    const result = await runAgent(
      {
        id: "planner-invalid-initial-task",
        objective,
        root,
        candidate: fakeAgentCandidate,
        repositoryPolicy: "private",
        permissionMode: "EDIT",
        mode: "coding",
        executionProfile: "structured",
        planningMode: "model",
        repositoryState: "empty",
        greenfieldIntent: true,
        enforceTaskContract: true,
        verificationPolicy: "not_required",
        maxTurns: 4,
      },
      {
        provider,
        tools: workspaceTools.filter((tool) => tool.name === "WriteFile"),
        toolChoice: "auto",
        createExecutionContext: async () => ({
          root,
          permissionMode: "EDIT",
          signal: new AbortController().signal,
          checkpoint,
        }),
        reviewFinalDiff: () => true,
        verifySuccessCriteria: async (_task, ledger) => {
          const exists = await Bun.file(path.join(root, "marker.txt")).exists();
          return {
            pass: exists,
            issues: exists ? [] : ["marker.txt is missing."],
            nextActions: exists ? [] : ["Write marker.txt."],
            nextPaths: exists ? [] : ["marker.txt"],
            satisfiedCriterionIds: exists
              ? ledger.successCriteria.map((criterion) => criterion.id)
              : [],
          };
        },
        independentVerifier: async () => ({
          pass: true,
          confidence: 1,
          issues: [],
        }),
      },
    );

    expect(result.status).toBe("completed");
    expect(result.ledger.recoveryContracts[0]?.cause).toBe(
      "INVALID_INITIAL_PLAN",
    );
    expect(result.ledger.planRevisions).toHaveLength(1);
    expect(result.ledger.taskGraph?.nodes).toEqual([
      expect.objectContaining({
        id: "write-marker",
        status: "passed",
        kind: "workspace",
      }),
    ]);
    expect(provider.requests).toHaveLength(3);
    expect(await Bun.file(path.join(root, "marker.txt")).text()).toBe(
      "verified\n",
    );
  } finally {
    db.close();
  }
});

test("executes dependent LLM plan nodes in order and keeps the plan authoritative", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-planner-order-"),
  );
  await writeFile(path.join(root, "one.ts"), "export const one = 1;\n", "utf8");
  await writeFile(path.join(root, "two.ts"), "export const two = 2;\n", "utf8");
  const objective = "Inspect the two source files in dependency order.";
  const proposal = {
    schemaVersion: 1,
    proposalId: "llm-plan-order-1",
    objective,
    nodes: [
      {
        id: "inspect-one",
        objective: "Inspect one.ts.",
        dependencies: [],
        scope: { candidateFiles: ["one.ts"], allowedTools: ["ReadFile"] },
      },
      {
        id: "inspect-two",
        objective: "Inspect two.ts after one.ts.",
        dependencies: ["inspect-one"],
        scope: { candidateFiles: ["two.ts"], allowedTools: ["ReadFile"] },
      },
    ],
  };
  const provider = createScriptedProvider(
    [
      [
        {
          type: "tool.call",
          call: {
            id: "plan-order-1",
            name: "ProposeTaskPlan",
            arguments: JSON.stringify(proposal),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "read-one",
            name: "ReadFile",
            arguments: JSON.stringify({ path: "one.ts" }),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "read-two",
            name: "ReadFile",
            arguments: JSON.stringify({ path: "two.ts" }),
          },
        },
        { type: "done" },
      ],
      [
        { type: "text.delta", text: "Both files were inspected." },
        { type: "done" },
      ],
    ],
    { stopAfter: true },
  );
  const db = new LocalCodeDatabase(":memory:");
  const checkpoint = new CheckpointService(db, root);
  try {
    const result = await runAgent(
      {
        id: "planner-order-task",
        objective,
        root,
        candidate: fakeAgentCandidate,
        repositoryPolicy: "private",
        permissionMode: "PLAN",
        mode: "plan",
        executionProfile: "structured",
        planningMode: "model",
        context: "The repository contains one.ts and two.ts.",
        maxTurns: 4,
      },
      {
        provider,
        tools: workspaceTools.filter((tool) => tool.risk === "read"),
        toolChoice: "auto",
        createExecutionContext: async () => ({
          root,
          permissionMode: "PLAN",
          signal: new AbortController().signal,
          checkpoint,
        }),
      },
    );

    expect(result.status).toBe("completed");
    expect(
      result.ledger.taskGraph?.nodes.map((node) => [node.id, node.status]),
    ).toEqual([
      ["inspect-one", "passed"],
      ["inspect-two", "passed"],
    ]);
    expect(result.ledger.taskGraph?.currentNodeId).toBe("");
    expect(
      provider.requests[1]?.tools?.map(
        (tool) => (tool as { function?: { name?: string } }).function?.name,
      ),
    ).toEqual(["ReadFile"]);
    expect(
      provider.requests[2]?.tools?.map(
        (tool) => (tool as { function?: { name?: string } }).function?.name,
      ),
    ).toEqual(["ReadFile"]);
  } finally {
    db.close();
  }
});

test("advances to the next LLM-authored mutation node after a scoped write", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-planner-mutation-order-"),
  );
  const objective = "Create alpha.txt and beta.txt in dependency order.";
  const proposal = {
    schemaVersion: 1,
    proposalId: "llm-plan-mutation-order-1",
    objective,
    nodes: [
      {
        id: "create-alpha",
        objective: "Create alpha.txt with the first result.",
        dependencies: [],
        scope: {
          candidateFiles: ["alpha.txt"],
          allowedTools: ["WriteFile"],
        },
        acceptance: ["alpha.txt contains the first result."],
      },
      {
        id: "create-beta",
        objective: "Create beta.txt after alpha.txt.",
        dependencies: ["create-alpha"],
        scope: {
          candidateFiles: ["beta.txt"],
          allowedTools: ["WriteFile"],
        },
        acceptance: ["beta.txt contains the second result."],
      },
    ],
  };
  const provider = createScriptedProvider(
    [
      [
        {
          type: "tool.call",
          call: {
            id: "plan-mutation-order-1",
            name: "ProposeTaskPlan",
            arguments: JSON.stringify(proposal),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "write-alpha",
            name: "WriteFile",
            arguments: JSON.stringify({
              path: "alpha.txt",
              content: "first\n",
            }),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "write-beta",
            name: "WriteFile",
            arguments: JSON.stringify({
              path: "beta.txt",
              content: "second\n",
            }),
          },
        },
        { type: "done" },
      ],
    ],
    { stopAfter: true },
  );
  const db = new LocalCodeDatabase(":memory:");
  const checkpoint = new CheckpointService(db, root);
  try {
    const result = await runAgent(
      {
        id: "planner-mutation-order-task",
        objective,
        root,
        candidate: fakeAgentCandidate,
        repositoryPolicy: "private",
        permissionMode: "EDIT",
        mode: "coding",
        executionProfile: "structured",
        planningMode: "model",
        repositoryState: "empty",
        greenfieldIntent: true,
        enforceTaskContract: true,
        verificationPolicy: "not_required",
        maxTurns: 5,
      },
      {
        provider,
        tools: workspaceTools.filter((tool) => tool.name === "WriteFile"),
        toolChoice: "auto",
        createExecutionContext: async () => ({
          root,
          permissionMode: "EDIT",
          signal: new AbortController().signal,
          checkpoint,
        }),
        reviewFinalDiff: () => true,
        verifySuccessCriteria: async (_task, ledger) => {
          const alpha = await Bun.file(path.join(root, "alpha.txt")).exists();
          const beta = await Bun.file(path.join(root, "beta.txt")).exists();
          const pass = alpha && beta;
          return {
            pass,
            issues: pass ? [] : ["Both ordered artifacts are required."],
            nextActions: pass ? [] : ["Create the missing ordered artifact."],
            nextPaths: pass ? [] : ["alpha.txt", "beta.txt"],
            satisfiedCriterionIds: pass
              ? ledger.successCriteria.map((criterion) => criterion.id)
              : [],
          };
        },
        independentVerifier: async () => ({
          pass: true,
          confidence: 1,
          issues: [],
        }),
      },
    );

    expect(result.status).toBe("completed");
    expect(
      result.ledger.taskGraph?.nodes.map((node) => [node.id, node.status]),
    ).toEqual([
      ["create-alpha", "passed"],
      ["create-beta", "passed"],
    ]);
    expect(await Bun.file(path.join(root, "alpha.txt")).text()).toBe("first\n");
    expect(await Bun.file(path.join(root, "beta.txt")).text()).toBe("second\n");
    expect(provider.requests).toHaveLength(3);
  } finally {
    db.close();
  }
});

test("defers later tool calls from one LLM response until the next plan node turn", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-planner-observation-boundary-"),
  );
  await writeFile(path.join(root, "one.ts"), "export const one = 1;\n", "utf8");
  await writeFile(path.join(root, "two.ts"), "export const two = 2;\n", "utf8");
  const objective =
    "Inspect two source files in the order selected by the plan.";
  const proposal = {
    schemaVersion: 1,
    proposalId: "llm-plan-observation-boundary-1",
    objective,
    nodes: [
      {
        id: "inspect-one-boundary",
        objective: "Inspect one.ts first.",
        dependencies: [],
        scope: { candidateFiles: ["one.ts"], allowedTools: ["ReadFile"] },
      },
      {
        id: "inspect-two-boundary",
        objective: "Inspect two.ts after one.ts.",
        dependencies: ["inspect-one-boundary"],
        scope: { candidateFiles: ["two.ts"], allowedTools: ["ReadFile"] },
      },
    ],
  };
  const provider = createScriptedProvider(
    [
      [
        {
          type: "tool.call",
          call: {
            id: "plan-observation-boundary",
            name: "ProposeTaskPlan",
            arguments: JSON.stringify(proposal),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "read-one-boundary",
            name: "ReadFile",
            arguments: JSON.stringify({ path: "one.ts" }),
          },
        },
        {
          type: "tool.call",
          call: {
            id: "stale-read-two-boundary",
            name: "ReadFile",
            arguments: JSON.stringify({ path: "two.ts" }),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "read-two-boundary",
            name: "ReadFile",
            arguments: JSON.stringify({ path: "two.ts" }),
          },
        },
        { type: "done" },
      ],
      [
        { type: "text.delta", text: "Both files were inspected in order." },
        { type: "done" },
      ],
    ],
    { stopAfter: true },
  );
  const db = new LocalCodeDatabase(":memory:");
  const checkpoint = new CheckpointService(db, root);
  try {
    const result = await runAgent(
      {
        id: "planner-observation-boundary-task",
        objective,
        root,
        candidate: fakeAgentCandidate,
        repositoryPolicy: "private",
        permissionMode: "PLAN",
        mode: "plan",
        executionProfile: "structured",
        planningMode: "model",
        context: "The repository contains one.ts and two.ts.",
        maxTurns: 4,
      },
      {
        provider,
        tools: workspaceTools.filter((tool) => tool.risk === "read"),
        toolChoice: "auto",
        createExecutionContext: async () => ({
          root,
          permissionMode: "PLAN",
          signal: new AbortController().signal,
          checkpoint,
        }),
      },
    );

    expect(result.status).toBe("completed");
    expect(
      result.ledger.taskGraph?.nodes.map((node) => [node.id, node.status]),
    ).toEqual([
      ["inspect-one-boundary", "passed"],
      ["inspect-two-boundary", "passed"],
    ]);
    expect(result.toolRuns).toContainEqual(
      expect.objectContaining({
        tool: "ReadFile",
        ok: false,
        code: "CONFLICT",
        error: expect.stringContaining("deferred"),
      }),
    );
    expect(
      provider.requests[2]?.tools?.map(
        (tool) => (tool as { function?: { name?: string } }).function?.name,
      ),
    ).toEqual(["ReadFile"]);
  } finally {
    db.close();
  }
});

test("does not mark a mutation node complete from a context read", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-planner-read-before-write-"),
  );
  const objective = "Create output.txt with the requested result.";
  const proposal = {
    schemaVersion: 1,
    proposalId: "llm-plan-read-before-write-1",
    objective,
    nodes: [
      {
        id: "create-output",
        objective: "Create output.txt with the requested result.",
        dependencies: [],
        scope: {
          candidateFiles: ["output.txt"],
          allowedTools: ["WriteFile"],
        },
        acceptance: ["output.txt contains the requested result."],
        verification: ["Inspect the resulting output artifact."],
      },
    ],
  };
  const provider = createScriptedProvider(
    [
      [
        {
          type: "tool.call",
          call: {
            id: "plan-read-before-write-1",
            name: "ProposeTaskPlan",
            arguments: JSON.stringify(proposal),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "context-read-before-write",
            name: "ListFiles",
            arguments: JSON.stringify({ path: "." }),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "write-after-context-read",
            name: "WriteFile",
            arguments: JSON.stringify({
              path: "output.txt",
              content: "requested result\n",
            }),
          },
        },
        { type: "done" },
      ],
    ],
    { stopAfter: true },
  );
  const db = new LocalCodeDatabase(":memory:");
  const checkpoint = new CheckpointService(db, root);
  try {
    const result = await runAgent(
      {
        id: "planner-read-before-write-task",
        objective,
        root,
        candidate: fakeAgentCandidate,
        repositoryPolicy: "private",
        permissionMode: "EDIT",
        mode: "coding",
        executionProfile: "structured",
        planningMode: "model",
        repositoryState: "empty",
        greenfieldIntent: true,
        enforceTaskContract: true,
        verificationPolicy: "not_required",
        maxTurns: 4,
      },
      {
        provider,
        tools: workspaceTools.filter((tool) =>
          ["ListFiles", "WriteFile"].includes(tool.name),
        ),
        toolChoice: "auto",
        createExecutionContext: async () => ({
          root,
          permissionMode: "EDIT",
          signal: new AbortController().signal,
          checkpoint,
        }),
        reviewFinalDiff: () => true,
        verifySuccessCriteria: async (_task, ledger) => ({
          pass: true,
          issues: [],
          nextActions: [],
          nextPaths: [],
          satisfiedCriterionIds: ledger.successCriteria.map(
            (criterion) => criterion.id,
          ),
        }),
        independentVerifier: async () => ({
          pass: true,
          confidence: 1,
          issues: [],
        }),
      },
    );

    expect(result.status).toBe("completed");
    expect(result.ledger.taskGraph?.nodes).toEqual([
      expect.objectContaining({ id: "create-output", status: "passed" }),
    ]);
    expect(await Bun.file(path.join(root, "output.txt")).text()).toBe(
      "requested result\n",
    );
    expect(provider.requests).toHaveLength(3);
  } finally {
    db.close();
  }
});

test("turns a plan-scope conflict into an LLM-authored monotonic repair node", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-planner-recovery-"),
  );
  const objective =
    "Create a small stylesheet for the requested interface and verify the change.";
  const initialProposal = {
    schemaVersion: 1,
    proposalId: "llm-plan-recovery-1",
    objective,
    nodes: [
      {
        id: "style-interface",
        objective: "Create the stylesheet for the requested interface.",
        dependencies: [],
        scope: {
          candidateFiles: ["styles.css"],
          allowedTools: ["WriteFile"],
        },
        acceptance: ["The stylesheet exists in the planned scope."],
        verification: ["Inspect the created stylesheet."],
      },
    ],
  };
  const recoveryProposal = {
    schemaVersion: 1,
    proposalId: "llm-plan-recovery-2",
    objective,
    summary:
      "Replace the failed node with the correctly scoped stylesheet repair.",
    nodes: [
      {
        id: "style-interface-repair",
        objective: "Create the stylesheet for the requested interface.",
        dependencies: [],
        scope: {
          candidateFiles: ["styles.css"],
          allowedTools: ["WriteFile"],
        },
        acceptance: ["The stylesheet exists in the planned scope."],
        verification: ["Inspect the created stylesheet."],
      },
    ],
  };
  const provider = createScriptedProvider(
    [
      [
        {
          type: "tool.call",
          call: {
            id: "plan-recovery-1",
            name: "ProposeTaskPlan",
            arguments: JSON.stringify(initialProposal),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "wrong-write",
            name: "WriteFile",
            arguments: JSON.stringify({
              path: "index.html",
              content: "<main>wrong scope</main>\n",
            }),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "plan-recovery-2",
            name: "ProposeTaskPlan",
            arguments: JSON.stringify(recoveryProposal),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "correct-write",
            name: "WriteFile",
            arguments: JSON.stringify({
              path: "styles.css",
              content: "body { color: navy; }\n",
            }),
          },
        },
        { type: "done" },
      ],
      [
        { type: "text.delta", text: "The stylesheet is complete." },
        { type: "done" },
      ],
    ],
    { stopAfter: true },
  );
  const db = new LocalCodeDatabase(":memory:");
  const checkpoint = new CheckpointService(db, root);
  try {
    const result = await runAgent(
      {
        id: "planner-recovery-task",
        objective,
        root,
        candidate: fakeAgentCandidate,
        repositoryPolicy: "private",
        permissionMode: "EDIT",
        mode: "coding",
        executionProfile: "structured",
        planningMode: "model",
        repositoryState: "empty",
        greenfieldIntent: true,
        enforceTaskContract: true,
        context:
          "The workspace is empty and the stylesheet is a requested deliverable.",
        maxTurns: 5,
      },
      {
        provider,
        tools: workspaceTools.filter((tool) => tool.name === "WriteFile"),
        toolChoice: "auto",
        createExecutionContext: async () => ({
          root,
          permissionMode: "EDIT",
          signal: new AbortController().signal,
          checkpoint,
        }),
        reviewFinalDiff: () => true,
        verifySuccessCriteria: async (_task, ledger) => ({
          pass: true,
          issues: [],
          nextActions: [],
          nextPaths: [],
          satisfiedCriterionIds: ledger.successCriteria.map(
            (criterion) => criterion.id,
          ),
        }),
        independentVerifier: async () => ({
          pass: true,
          confidence: 1,
          issues: [],
        }),
      },
    );

    expect(result.status).toBe("completed");
    expect(result.ledger.taskGraph?.revision).toBe(2);
    expect(
      result.ledger.taskGraph?.nodes.map((node) => [node.id, node.status]),
    ).toEqual([
      ["style-interface", "superseded"],
      ["style-interface-repair", "passed"],
    ]);
    expect(
      result.ledger.planRevisions.map((revision) => revision.revision),
    ).toEqual([1, 2]);
    expect(result.ledger.planRevisions[1]?.supersededNodeIds).toEqual([
      "style-interface",
    ]);
    expect(
      result.ledger.recoveryContracts.some(
        (recovery) => recovery.supersedeNodeId === "style-interface",
      ),
    ).toBe(true);
    expect(await Bun.file(path.join(root, "styles.css")).text()).toContain(
      "color: navy",
    );
    expect(await Bun.file(path.join(root, "index.html")).exists()).toBe(false);
    expect(
      provider.requests.filter((request) =>
        request.tools?.some(
          (tool) =>
            (tool as { function?: { name?: string } }).function?.name ===
            "ProposeTaskPlan",
        ),
      ),
    ).toHaveLength(2);
  } finally {
    db.close();
  }
});

test("records a successful LLM mutation as completion evidence without requiring a redundant read", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-planner-mutation-evidence-"),
  );
  const objective =
    "Create a README file explaining the project's purpose and how to start it.";
  const proposal = {
    schemaVersion: 1,
    proposalId: "llm-plan-mutation-evidence-1",
    objective,
    nodes: [
      {
        id: "create-readme",
        objective:
          "Create the README with project purpose and startup guidance.",
        dependencies: [],
        scope: {
          candidateFiles: ["README.md"],
          allowedTools: ["WriteFile"],
        },
        acceptance: ["README.md contains the requested project guidance."],
        verification: ["Inspect the resulting README artifact."],
      },
    ],
  };
  const provider = createScriptedProvider(
    [
      [
        {
          type: "tool.call",
          call: {
            id: "plan-mutation-evidence-1",
            name: "ProposeTaskPlan",
            arguments: JSON.stringify(proposal),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "write-readme-evidence",
            name: "WriteFile",
            arguments: JSON.stringify({
              path: "README.md",
              content: "# Project\n\nThis project is ready for development.\n",
            }),
          },
        },
        { type: "done" },
      ],
    ],
    { stopAfter: true },
  );
  const db = new LocalCodeDatabase(":memory:");
  const checkpoint = new CheckpointService(db, root);
  try {
    const result = await runAgent(
      {
        id: "planner-mutation-evidence-task",
        objective,
        root,
        candidate: fakeAgentCandidate,
        repositoryPolicy: "private",
        permissionMode: "EDIT",
        mode: "coding",
        executionProfile: "direct",
        planningMode: "model",
        repositoryState: "empty",
        greenfieldIntent: true,
        enforceTaskContract: true,
        verificationPolicy: "not_required",
        maxTurns: 3,
      },
      {
        provider,
        tools: workspaceTools.filter((tool) => tool.name === "WriteFile"),
        toolChoice: "auto",
        createExecutionContext: async () => ({
          root,
          permissionMode: "EDIT",
          signal: new AbortController().signal,
          checkpoint,
        }),
        reviewFinalDiff: () => true,
        verifySuccessCriteria: async (_task, ledger) => ({
          pass: true,
          issues: [],
          nextActions: [],
          nextPaths: [],
          satisfiedCriterionIds: ledger.successCriteria.map(
            (criterion) => criterion.id,
          ),
        }),
      },
    );

    expect(result.status).toBe("completed");
    expect(result.ledger.evidence).toContainEqual(
      expect.objectContaining({
        kind: "file",
        source: "WriteFile",
        relevance: 0.85,
      }),
    );
    expect(result.ledger.filesChanged).toEqual(["README.md"]);
    expect(await Bun.file(path.join(root, "README.md")).exists()).toBe(true);
    expect(provider.requests).toHaveLength(2);
  } finally {
    db.close();
  }
});

test("turns an out-of-scope planned read into an LLM-authored recovery", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-planner-read-scope-recovery-"),
  );
  await mkdir(path.join(root, "src"));
  await writeFile(
    path.join(root, "src", "index.ts"),
    "export const project = true;\n",
    "utf8",
  );
  const objective = "Create README.md documenting the current project.";
  const initialProposal = {
    schemaVersion: 1,
    proposalId: "llm-plan-read-scope-1",
    objective,
    nodes: [
      {
        id: "write-readme",
        objective: "Create README.md from the available project evidence.",
        kind: "workspace",
        dependencies: [],
        scope: {
          candidateFiles: ["README.md"],
          allowedTools: ["WriteFile"],
        },
        acceptance: ["README.md documents the current project."],
        verification: ["Inspect the resulting README artifact."],
      },
    ],
  };
  const recoveryProposal = {
    schemaVersion: 1,
    proposalId: "llm-plan-read-scope-2",
    objective,
    supersedes: ["write-readme"],
    nodes: [
      {
        id: "write-readme-recovery",
        objective: "Create README.md from the available project evidence.",
        kind: "workspace",
        dependencies: [],
        scope: {
          candidateFiles: ["README.md"],
          allowedTools: ["WriteFile"],
        },
        acceptance: ["README.md documents the current project."],
        verification: ["Inspect the resulting README artifact."],
      },
    ],
  };
  const provider = createScriptedProvider(
    [
      [
        {
          type: "tool.call",
          call: {
            id: "plan-read-scope-1",
            name: "ProposeTaskPlan",
            arguments: JSON.stringify(initialProposal),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "read-outside-plan-scope",
            name: "ReadFile",
            arguments: JSON.stringify({ path: "src/index.ts" }),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "plan-read-scope-2",
            name: "ProposeTaskPlan",
            arguments: JSON.stringify(recoveryProposal),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "write-readme-after-scope-recovery",
            name: "WriteFile",
            arguments: JSON.stringify({
              path: "README.md",
              content:
                "# Project\n\nThe current project is ready for development.\n",
            }),
          },
        },
        { type: "done" },
      ],
    ],
    { stopAfter: true },
  );
  const db = new LocalCodeDatabase(":memory:");
  const checkpoint = new CheckpointService(db, root);
  try {
    const result = await runAgent(
      {
        id: "planner-read-scope-recovery-task",
        objective,
        root,
        candidate: fakeAgentCandidate,
        repositoryPolicy: "private",
        permissionMode: "EDIT",
        mode: "coding",
        executionProfile: "structured",
        planningMode: "model",
        repositoryState: "non_empty",
        contextEvidenceState: "SUFFICIENT",
        context: "The project source is available at src/index.ts.",
        enforceTaskContract: true,
        verificationPolicy: "not_required",
        maxTurns: 6,
      },
      {
        provider,
        tools: workspaceTools.filter((tool) =>
          ["ReadFile", "WriteFile"].includes(tool.name),
        ),
        toolChoice: "auto",
        createExecutionContext: async () => ({
          root,
          permissionMode: "EDIT" as const,
          signal: new AbortController().signal,
          checkpoint,
        }),
        reviewFinalDiff: () => true,
        verifySuccessCriteria: async (_task, ledger) => {
          const exists = await Bun.file(path.join(root, "README.md")).exists();
          return {
            pass: exists,
            issues: exists ? [] : ["README.md is missing."],
            nextActions: exists ? [] : ["Create README.md."],
            nextPaths: exists ? [] : ["README.md"],
            satisfiedCriterionIds: exists
              ? ledger.successCriteria.map((criterion) => criterion.id)
              : [],
          };
        },
      },
    );

    expect(result.status).toBe("completed");
    expect(result.toolRuns.map((run) => run.tool)).toEqual([
      "ReadFile",
      "WriteFile",
    ]);
    expect(result.toolRuns[0]).toMatchObject({
      ok: false,
      code: "CONFLICT",
      path: "src/index.ts",
    });
    expect(result.toolRuns[0]?.error).toContain(
      "outside the bounded scope of LLM-authored plan node",
    );
    expect(result.ledger.planRevisions).toHaveLength(2);
    expect(result.ledger.planRevisions[1]?.supersededNodeIds).toEqual([
      "write-readme",
    ]);
    expect(
      result.ledger.taskGraph?.nodes.map((node) => [node.id, node.status]),
    ).toEqual([
      ["write-readme", "superseded"],
      ["write-readme-recovery", "passed"],
    ]);
    expect(await Bun.file(path.join(root, "README.md")).exists()).toBe(true);
  } finally {
    db.close();
  }
});

test("executes an LLM-authored semantic node before its dependent workspace node", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-planner-semantic-node-"),
  );
  const objective = "Create output.txt from a bounded content decision.";
  const proposal = {
    schemaVersion: 1,
    proposalId: "llm-plan-semantic-node-1",
    objective,
    nodes: [
      {
        id: "decide-content",
        objective:
          "Choose a concise content statement for the output artifact.",
        kind: "semantic",
        dependencies: [],
        scope: { allowedTools: [] },
        acceptance: ["A bounded content decision is recorded."],
      },
      {
        id: "write-output",
        objective: "Write output.txt using the content decision.",
        kind: "workspace",
        dependencies: ["decide-content"],
        scope: {
          candidateFiles: ["output.txt"],
          allowedTools: ["WriteFile"],
        },
        acceptance: ["output.txt contains the selected content."],
      },
    ],
  };
  const provider = createScriptedProvider(
    [
      [
        {
          type: "tool.call",
          call: {
            id: "plan-semantic-node-1",
            name: "ProposeTaskPlan",
            arguments: JSON.stringify(proposal),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "text.delta",
          text: "Use a short, concrete statement that the artifact is ready.",
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "write-after-semantic-node",
            name: "WriteFile",
            arguments: JSON.stringify({
              path: "output.txt",
              content: "The artifact is ready.\n",
            }),
          },
        },
        { type: "done" },
      ],
    ],
    { stopAfter: true },
  );
  const db = new LocalCodeDatabase(":memory:");
  const checkpoint = new CheckpointService(db, root);
  try {
    const result = await runAgent(
      {
        id: "planner-semantic-node-task",
        objective,
        root,
        candidate: fakeAgentCandidate,
        repositoryPolicy: "private",
        permissionMode: "EDIT",
        mode: "coding",
        executionProfile: "structured",
        planningMode: "model",
        repositoryState: "empty",
        greenfieldIntent: true,
        enforceTaskContract: true,
        verificationPolicy: "not_required",
        maxTurns: 5,
      },
      {
        provider,
        tools: workspaceTools.filter((tool) => tool.name === "WriteFile"),
        toolChoice: "auto",
        createExecutionContext: async () => ({
          root,
          permissionMode: "EDIT",
          signal: new AbortController().signal,
          checkpoint,
        }),
        reviewFinalDiff: () => true,
        verifySuccessCriteria: async (_task, ledger) => {
          const exists = await Bun.file(path.join(root, "output.txt")).exists();
          return {
            pass: exists,
            issues: exists ? [] : ["output.txt is missing."],
            nextActions: exists ? [] : ["Write output.txt."],
            nextPaths: exists ? [] : ["output.txt"],
            satisfiedCriterionIds: exists
              ? ledger.successCriteria.map((criterion) => criterion.id)
              : [],
          };
        },
        independentVerifier: async () => ({
          pass: true,
          confidence: 1,
          issues: [],
        }),
      },
    );

    expect(result.status).toBe("completed");
    expect(
      result.ledger.taskGraph?.nodes.map((node) => [
        node.id,
        node.kind,
        node.status,
      ]),
    ).toEqual([
      ["decide-content", "semantic", "passed"],
      ["write-output", "workspace", "passed"],
    ]);
    expect(result.ledger.evidence).toContainEqual(
      expect.objectContaining({
        kind: "decision",
        source: "LLM semantic worker",
      }),
    );
    expect(provider.requests[1]?.tools).toBeUndefined();
    expect(await Bun.file(path.join(root, "output.txt")).text()).toBe(
      "The artifact is ready.\n",
    );
  } finally {
    db.close();
  }
});

test("does not count tool-shaped prose as a completed semantic node", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-planner-semantic-protocol-"),
  );
  const objective = "Create output.txt from a bounded content decision.";
  const proposal = {
    schemaVersion: 1,
    proposalId: "llm-plan-semantic-protocol-1",
    objective,
    nodes: [
      {
        id: "decide-content-protocol",
        objective: "Choose the bounded content for the output artifact.",
        kind: "semantic",
        dependencies: [],
        scope: { allowedTools: [] },
        acceptance: ["A bounded content decision is recorded."],
      },
      {
        id: "write-output-protocol",
        objective: "Write output.txt using the content decision.",
        kind: "workspace",
        dependencies: ["decide-content-protocol"],
        scope: {
          candidateFiles: ["output.txt"],
          allowedTools: ["WriteFile"],
        },
        acceptance: ["output.txt contains the selected content."],
      },
    ],
  };
  const provider = createScriptedProvider(
    [
      [
        {
          type: "tool.call",
          call: {
            id: "plan-semantic-protocol-1",
            name: "ProposeTaskPlan",
            arguments: JSON.stringify(proposal),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "text.delta",
          text: "<tool_call> ListFiles </tool_call>",
        },
        { type: "done" },
      ],
      [
        {
          type: "text.delta",
          text: "The selected content is a concise readiness statement.",
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "write-after-semantic-protocol",
            name: "WriteFile",
            arguments: JSON.stringify({
              path: "output.txt",
              content: "The artifact is ready.\n",
            }),
          },
        },
        { type: "done" },
      ],
    ],
    { stopAfter: true },
  );
  const db = new LocalCodeDatabase(":memory:");
  const checkpoint = new CheckpointService(db, root);
  try {
    const result = await runAgent(
      {
        id: "planner-semantic-protocol-task",
        objective,
        root,
        candidate: fakeAgentCandidate,
        repositoryPolicy: "private",
        permissionMode: "EDIT",
        mode: "coding",
        executionProfile: "structured",
        planningMode: "model",
        repositoryState: "empty",
        greenfieldIntent: true,
        enforceTaskContract: true,
        verificationPolicy: "not_required",
        maxTurns: 6,
      },
      {
        provider,
        tools: workspaceTools.filter((tool) => tool.name === "WriteFile"),
        toolChoice: "auto",
        createExecutionContext: async () => ({
          root,
          permissionMode: "EDIT",
          signal: new AbortController().signal,
          checkpoint,
        }),
        reviewFinalDiff: () => true,
        verifySuccessCriteria: async (_task, ledger) => {
          const exists = await Bun.file(path.join(root, "output.txt")).exists();
          return {
            pass: exists,
            issues: exists ? [] : ["output.txt is missing."],
            nextActions: exists ? [] : ["Write output.txt."],
            nextPaths: exists ? [] : ["output.txt"],
            satisfiedCriterionIds: exists
              ? ledger.successCriteria.map((criterion) => criterion.id)
              : [],
          };
        },
        independentVerifier: async () => ({
          pass: true,
          confidence: 1,
          issues: [],
        }),
      },
    );

    expect(result.status).toBe("completed");
    expect(
      result.ledger.actions.filter((action) => action.kind === "decide"),
    ).toHaveLength(1);
    expect(result.ledger.actions).toContainEqual(
      expect.objectContaining({
        kind: "review",
        status: "failed",
        target: "model-turn",
      }),
    );
    expect(
      result.ledger.taskGraph?.nodes.find(
        (node) => node.id === "decide-content-protocol",
      ),
    ).toEqual(expect.objectContaining({ status: "passed" }));
    expect(await Bun.file(path.join(root, "output.txt")).exists()).toBe(true);
  } finally {
    db.close();
  }
});

test("passes the failed LLM node into objective recovery and accepts a monotonic repair", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-planner-objective-recovery-"),
  );
  const objective = "Create the requested output artifact.";
  const initialProposal = {
    schemaVersion: 1,
    proposalId: "llm-plan-objective-recovery-1",
    objective,
    nodes: [
      {
        id: "produce-output",
        objective,
        dependencies: [],
        scope: {
          candidateFiles: ["output.txt"],
          allowedTools: ["WriteFile"],
        },
        acceptance: ["The requested output artifact is complete."],
      },
    ],
  };
  const recoveryProposal = {
    schemaVersion: 1,
    proposalId: "llm-plan-objective-recovery-2",
    objective,
    nodes: [
      // A weak planner may echo the valid part of its previous plan. The
      // controller may preserve that history, but must only execute the new
      // replacement node.
      {
        id: "produce-output",
        objective,
        dependencies: [],
        scope: {
          candidateFiles: ["output.txt"],
          allowedTools: ["WriteFile"],
        },
        acceptance: ["The requested output artifact is complete."],
      },
      {
        id: "produce-output-repair",
        objective: "Create the output artifact with the missing final content.",
        dependencies: [],
        scope: {
          candidateFiles: ["output.txt"],
          allowedTools: ["WriteFile"],
        },
        acceptance: ["output.txt contains the complete final content."],
      },
    ],
  };
  const provider = createScriptedProvider(
    [
      [
        {
          type: "tool.call",
          call: {
            id: "plan-objective-recovery-1",
            name: "ProposeTaskPlan",
            arguments: JSON.stringify(initialProposal),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "write-incomplete-output",
            name: "WriteFile",
            arguments: JSON.stringify({
              path: "output.txt",
              content: "incomplete\n",
            }),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "plan-objective-recovery-2",
            name: "ProposeTaskPlan",
            arguments: JSON.stringify(recoveryProposal),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "write-complete-output",
            name: "WriteFile",
            arguments: JSON.stringify({
              path: "output.txt",
              content: "complete final content\n",
            }),
          },
        },
        { type: "done" },
      ],
    ],
    { stopAfter: true },
  );
  const db = new LocalCodeDatabase(":memory:");
  const checkpoint = new CheckpointService(db, root);
  try {
    const result = await runAgent(
      {
        id: "planner-objective-recovery-task",
        objective,
        root,
        candidate: fakeAgentCandidate,
        repositoryPolicy: "private",
        permissionMode: "EDIT",
        mode: "coding",
        executionProfile: "structured",
        planningMode: "model",
        repositoryState: "empty",
        greenfieldIntent: true,
        enforceTaskContract: true,
        verificationPolicy: "not_required",
        verificationCommand: "cmd /c exit 0",
        maxTurns: 8,
      },
      {
        provider,
        tools: workspaceTools.filter((tool) => tool.name === "WriteFile"),
        toolChoice: "auto",
        reviewFinalDiff: () => true,
        verifySuccessCriteria: async (_task, ledger) => {
          const content = await Bun.file(path.join(root, "output.txt")).text();
          const complete = content.includes("complete final content");
          return {
            pass: complete,
            satisfiedCriterionIds: complete
              ? ledger.successCriteria.map((criterion) => criterion.id)
              : [],
            issues: complete ? [] : ["The output is still incomplete."],
            nextActions: complete ? [] : ["Create the complete final output."],
            nextPaths: complete ? [] : ["output.txt"],
          };
        },
        independentVerifier: async () => ({
          pass: true,
          confidence: 1,
          issues: [],
        }),
        createExecutionContext: async () => ({
          root,
          permissionMode: "EDIT" as const,
          signal: new AbortController().signal,
          checkpoint,
        }),
      },
    );

    expect(result.status).toBe("completed");
    expect(result.verified).toBe(true);
    expect(result.ledger.taskGraph?.revision).toBe(2);
    expect(
      result.ledger.taskGraph?.nodes.map((node) => [node.id, node.status]),
    ).toEqual([
      ["produce-output", "superseded"],
      ["produce-output-repair", "passed"],
    ]);
    expect(result.ledger.recoveryContracts).toContainEqual(
      expect.objectContaining({
        cause: "OBJECTIVE_VERIFICATION_FAILED",
        supersedeNodeId: "produce-output",
      }),
    );
    expect(await Bun.file(path.join(root, "output.txt")).text()).toBe(
      "complete final content\n",
    );
    expect(
      provider.requests.filter((request) =>
        request.tools?.some(
          (tool) =>
            (tool as { function?: { name?: string } }).function?.name ===
            "ProposeTaskPlan",
        ),
      ),
    ).toHaveLength(2);
  } finally {
    db.close();
  }
});

test("asks the LLM planner for a monotonic repair after mutation churn", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-planner-mutation-churn-"),
  );
  const objective = "Create the requested output artifact.";
  const initialProposal = {
    schemaVersion: 1,
    proposalId: "llm-plan-churn-1",
    objective,
    nodes: [
      {
        id: "produce-output",
        objective: "Create the requested output artifact.",
        dependencies: [],
        scope: {
          candidateFiles: ["a.txt", "b.txt", "c.txt", "d.txt"],
          allowedTools: ["WriteFile"],
        },
        acceptance: ["The requested output artifact is produced."],
      },
    ],
  };
  const recoveryProposal = {
    schemaVersion: 1,
    proposalId: "llm-plan-churn-2",
    objective,
    summary:
      "Review the prior mutations and produce the missing final artifact.",
    nodes: [
      {
        id: "produce-output-repair",
        objective:
          "Create the requested output artifact after reviewing prior mutations.",
        dependencies: [],
        scope: {
          candidateFiles: ["final.txt"],
          allowedTools: ["WriteFile"],
        },
        acceptance: ["final.txt is the requested output artifact."],
      },
    ],
  };
  const writes = ["a.txt", "b.txt", "c.txt", "d.txt"].map((file, index) => [
    {
      type: "tool.call" as const,
      call: {
        id: `churn-write-${index + 1}`,
        name: "WriteFile",
        arguments: JSON.stringify({
          path: file,
          content: `intermediate ${index + 1}\n`,
        }),
      },
    },
    { type: "done" as const },
  ]);
  const provider = createScriptedProvider(
    [
      [
        {
          type: "tool.call",
          call: {
            id: "plan-churn-1",
            name: "ProposeTaskPlan",
            arguments: JSON.stringify(initialProposal),
          },
        },
        { type: "done" },
      ],
      ...writes,
      [
        {
          type: "tool.call",
          call: {
            id: "plan-churn-2",
            name: "ProposeTaskPlan",
            arguments: JSON.stringify(recoveryProposal),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "repair-write",
            name: "WriteFile",
            arguments: JSON.stringify({
              path: "final.txt",
              content: "final result\n",
            }),
          },
        },
        { type: "done" },
      ],
    ],
    { stopAfter: true },
  );
  const db = new LocalCodeDatabase(":memory:");
  const checkpoint = new CheckpointService(db, root);
  try {
    const result = await runAgent(
      {
        id: "planner-mutation-churn-task",
        objective,
        root,
        candidate: fakeAgentCandidate,
        repositoryPolicy: "private",
        permissionMode: "EDIT",
        mode: "coding",
        executionProfile: "structured",
        planningMode: "model",
        repositoryState: "empty",
        greenfieldIntent: true,
        enforceTaskContract: true,
        verificationPolicy: "not_required",
        maxTurns: 8,
      },
      {
        provider,
        tools: workspaceTools.filter((tool) => tool.name === "WriteFile"),
        toolChoice: "auto",
        createExecutionContext: async () => ({
          root,
          permissionMode: "EDIT",
          signal: new AbortController().signal,
          checkpoint,
        }),
        reviewFinalDiff: () => true,
        verifySuccessCriteria: async (_task, ledger) => {
          const finalExists = await Bun.file(
            path.join(root, "final.txt"),
          ).exists();
          return {
            pass: finalExists,
            issues: finalExists
              ? []
              : ["The final output artifact is missing."],
            nextActions: finalExists
              ? []
              : ["Produce the final output artifact."],
            nextPaths: finalExists ? [] : ["final.txt"],
            satisfiedCriterionIds: finalExists
              ? ledger.successCriteria.map((criterion) => criterion.id)
              : [],
          };
        },
        independentVerifier: async () => ({
          pass: true,
          confidence: 1,
          issues: [],
        }),
      },
    );

    expect(result.status).toBe("completed");
    expect(result.ledger.taskGraph?.revision).toBe(2);
    expect(
      result.ledger.taskGraph?.nodes.map((node) => [node.id, node.status]),
    ).toEqual([
      ["produce-output", "superseded"],
      ["produce-output-repair", "passed"],
    ]);
    expect(result.ledger.recoveryContracts).toContainEqual(
      expect.objectContaining({
        cause: "NO_OBJECTIVE_PROGRESS",
        supersedeNodeId: "produce-output",
        proposedRecovery: "replan",
      }),
    );
    expect(await Bun.file(path.join(root, "final.txt")).text()).toBe(
      "final result\n",
    );
    expect(
      provider.requests.filter((request) =>
        request.tools?.some(
          (tool) =>
            (tool as { function?: { name?: string } }).function?.name ===
            "ProposeTaskPlan",
        ),
      ),
    ).toHaveLength(2);
  } finally {
    db.close();
  }
});

test("does not block a non-Git workspace when the LLM inspects Git metadata", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-planner-no-git-workspace-"),
  );
  const objective =
    "Create a README file explaining the project's purpose and how to start it.";
  const proposal = {
    schemaVersion: 1,
    proposalId: "llm-plan-no-git-1",
    objective,
    nodes: [
      {
        id: "create-readme-no-git",
        objective:
          "Create the README with project purpose and startup guidance.",
        dependencies: [],
        scope: {
          candidateFiles: ["README.md"],
          allowedTools: ["WriteFile"],
        },
        acceptance: ["README.md contains the requested project guidance."],
        verification: ["Inspect the resulting README artifact."],
      },
    ],
  };
  const provider = createScriptedProvider(
    [
      [
        {
          type: "tool.call",
          call: {
            id: "plan-no-git-1",
            name: "ProposeTaskPlan",
            arguments: JSON.stringify(proposal),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "inspect-no-git-status",
            name: "GitStatus",
            arguments: JSON.stringify({}),
          },
        },
        { type: "done" },
      ],
      [
        {
          type: "tool.call",
          call: {
            id: "write-no-git-readme",
            name: "WriteFile",
            arguments: JSON.stringify({
              path: "README.md",
              content: "# Project\n\nThis project is ready for development.\n",
            }),
          },
        },
        { type: "done" },
      ],
      [
        { type: "text.delta", text: "The README is complete." },
        { type: "done" },
      ],
    ],
    { stopAfter: true },
  );
  const db = new LocalCodeDatabase(":memory:");
  const checkpoint = new CheckpointService(db, root);
  try {
    const result = await runAgent(
      {
        id: "planner-no-git-task",
        objective,
        root,
        candidate: fakeAgentCandidate,
        repositoryPolicy: "private",
        permissionMode: "EDIT",
        mode: "coding",
        executionProfile: "structured",
        planningMode: "model",
        repositoryState: "empty",
        greenfieldIntent: true,
        enforceTaskContract: true,
        verificationPolicy: "not_required",
        maxTurns: 4,
      },
      {
        provider,
        tools: workspaceTools.filter((tool) =>
          ["WriteFile", "GitStatus"].includes(tool.name),
        ),
        toolChoice: "auto",
        createExecutionContext: async () => ({
          root,
          permissionMode: "EDIT",
          signal: new AbortController().signal,
          checkpoint,
        }),
        reviewFinalDiff: () => true,
        verifySuccessCriteria: async (_task, ledger) => ({
          pass: true,
          issues: [],
          nextActions: [],
          nextPaths: [],
          satisfiedCriterionIds: ledger.successCriteria.map(
            (criterion) => criterion.id,
          ),
        }),
        independentVerifier: async () => ({
          pass: true,
          confidence: 1,
          issues: [],
        }),
      },
    );

    expect(result.status).toBe("completed");
    expect(result.ledger.taskGraph?.nodes[0]).toEqual(
      expect.objectContaining({ status: "passed" }),
    );
    expect(result.toolRuns.find((run) => run.tool === "GitStatus")).toEqual(
      expect.objectContaining({
        ok: false,
        code: "COMMAND_FAILED",
      }),
    );
    expect(result.ledger.evidence).toContainEqual(
      expect.objectContaining({
        kind: "git",
        source: "GitStatus",
        summary: expect.stringContaining("not applicable"),
      }),
    );
    expect(result.ledger.blockers).toEqual([]);
    expect(await Bun.file(path.join(root, "README.md")).exists()).toBe(true);
  } finally {
    db.close();
  }
});
