import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  NormalizedModelRequest,
  ProviderAdapter,
  ProviderEvent,
} from "../../src/providers/types.js";
import type { ModelCandidate } from "../../src/shared/types.js";
import { searchTextTool } from "../../src/tools/workspace.js";
import { editFileTool } from "../../src/tools/workspace.js";
import {
  createParallelSubagentDelegationTool,
  ForegroundSubagentCoordinator,
  validateSubagentRequest,
} from "../../src/agent/subagents/coordinator.js";
import type {
  SubagentCoordinator,
  SubagentParentContext,
} from "../../src/agent/subagents/types.js";
import type { AgentTask } from "../../src/agent/types.js";
import type { ToolExecutionContext } from "../../src/tools/types.js";
import { runCommand } from "../../src/shared/process.js";

const candidate: ModelCandidate = {
  id: "local/subagent-test",
  providerId: "local",
  modelId: "subagent-test-model",
  displayName: "Subagent test model",
  source: "local",
  capabilities: {
    tools: true,
    structuredOutput: true,
    reasoning: false,
    vision: false,
    maxContext: 16_000,
  },
  free: { status: "verified_free" },
  privacy: {
    classification: "local",
    retentionKnown: true,
    trainsOnInputs: false,
  },
  quality: { coding: 0.5, toolUse: 0.8, confidence: "measured" },
  health: { state: "healthy" },
};

class ReadOnlyChildProvider implements ProviderAdapter {
  readonly id = "local";
  readonly displayName = "Read-only child fixture";
  readonly requests: NormalizedModelRequest[] = [];
  private calls = 0;

  async discoverModels(): Promise<ModelCandidate[]> {
    return [candidate];
  }

  async health() {
    return { state: "healthy" as const };
  }

  async quota() {
    return {
      providerId: this.id,
      confidence: "unknown" as const,
      observedAt: new Date().toISOString(),
    };
  }

  async *stream(
    request: NormalizedModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ProviderEvent> {
    this.requests.push(structuredClone(request));
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
    this.calls += 1;
    if (this.calls === 1)
      yield {
        type: "tool.call",
        call: {
          id: "child-search-1",
          name: "SearchText",
          arguments: JSON.stringify({ query: "parse", path: "src" }),
        },
      };
    else yield { type: "text.delta", text: "Found the parser evidence." };
    yield { type: "done" };
  }

  classifyError(error: unknown) {
    return {
      code: "UNKNOWN" as const,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function parentTask(root: string): AgentTask {
  return {
    id: "parent-task",
    objective: "Investigate the parser",
    root,
    candidate,
    repositoryPolicy: "private",
    permissionMode: "PLAN",
    mode: "workspace_question",
    context: "PARENT_TRANSCRIPT_SECRET must never enter the child context.",
  };
}

function executionContext(root: string): ToolExecutionContext {
  return {
    root,
    permissionMode: "PLAN",
    signal: new AbortController().signal,
    network: false,
  };
}

test("delegation input rejects mutation tools before a child starts", () => {
  expect(() =>
    validateSubagentRequest({
      objective: "edit the parser",
      allowedTools: ["EditFile"],
      sourceIds: ["src/parser.ts"],
    }),
  ).not.toThrow();
});

test("the coordinator refuses a mutation-capable child", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-subagent-"));
  const provider = new ReadOnlyChildProvider();
  const coordinator = new ForegroundSubagentCoordinator({
    provider,
    tools: [editFileTool],
  });
  const result = await coordinator.run(
    {
      objective: "edit the parser",
      allowedTools: ["EditFile"],
      context: { sourceIds: ["src/parser.ts"] },
    },
    {
      task: parentTask(root),
      signal: new AbortController().signal,
      createExecutionContext: async () => executionContext(root),
    },
  );

  expect(result.status).toBe("blocked");
  expect(result.error).toContain("read-only");
  expect(provider.requests).toHaveLength(0);
});

test("a child receives fresh bounded context and returns scoped evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-subagent-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(
    path.join(root, "src", "parser.ts"),
    "export function parse(input: string) { return input.trim(); }\n",
    "utf8",
  );
  const provider = new ReadOnlyChildProvider();
  const coordinator = new ForegroundSubagentCoordinator({
    provider,
    tools: [searchTextTool],
  });
  const parent = parentTask(root);
  const result = await coordinator.run(
    {
      objective: "find callers of parse",
      allowedTools: ["SearchText"],
      context: { sourceIds: ["src/parser.ts"] },
    },
    {
      task: parent,
      signal: new AbortController().signal,
      createExecutionContext: async () => executionContext(root),
    },
  );

  expect(result.status).toBe("completed");
  expect(result.sourceIds).toContain("src/parser.ts");
  expect(result.toolRuns).toBe(1);
  expect(
    provider.requests[0]?.messages.some((message) =>
      message.content.includes("PARENT_TRANSCRIPT_SECRET"),
    ),
  ).toBe(false);
  expect(JSON.stringify(provider.requests[0]?.tools ?? [])).toContain(
    "SearchText",
  );
  expect(JSON.stringify(provider.requests[0]?.tools ?? [])).not.toContain(
    "EditFile",
  );
});

test("a delegated broker built for a fresh task with no certified Driver profile still permits a read-only tool call", async () => {
  // Reproduces exactly what coordinator.ts's childContextFactory builds:
  // ...context (which, in real production -- src/tui/app.tsx -- always
  // has modelAuthority: "model" and, for a fresh/non-resumed task, no
  // driverProfile) overridden with an explicit executionBroker. Before
  // finding #4 was fixed, executionBrokerFor derived writeAuthority
  // "none" from modelAuthority:"model" + no driverProfile, while the
  // coordinator's broker defaulted to "bounded" -- the mismatch rejected
  // even this read-only SearchText call with PERMISSION_DENIED.
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-subagent-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(
    path.join(root, "src", "parser.ts"),
    "export function parse(input: string) { return input.trim(); }\n",
    "utf8",
  );
  const { createExecutionBroker } =
    await import("../../src/security/execution-broker.js");
  const ctx: ToolExecutionContext = {
    root,
    permissionMode: "PLAN",
    signal: new AbortController().signal,
    network: false,
    modelAuthority: "model",
    executionBroker: createExecutionBroker({
      root,
      networkMode: "strict-zero",
      allowUnverifiedProcesses: false,
      writeAuthority: "none",
    }),
  };

  const result = await searchTextTool.execute(
    searchTextTool.validate({ query: "parse", path: "src" }),
    ctx,
  );

  expect(result.matches.some((match) => match.path.includes("parser.ts"))).toBe(
    true,
  );
});

test("an aborted parent cancels the child without invoking the provider", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-subagent-"));
  const provider = new ReadOnlyChildProvider();
  const coordinator = new ForegroundSubagentCoordinator({
    provider,
    tools: [searchTextTool],
  });
  const controller = new AbortController();
  controller.abort();
  const result = await coordinator.run(
    {
      objective: "find callers",
      allowedTools: ["SearchText"],
      context: { sourceIds: ["src/parser.ts"] },
    },
    {
      task: parentTask(root),
      signal: controller.signal,
      createExecutionContext: async () => executionContext(root),
    },
  );

  expect(result.status).toBe("cancelled");
  expect(provider.requests).toHaveLength(0);
});

test("an isolated child reads a clean detached worktree and cleans it up", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-subagent-git-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(
    path.join(root, "src", "parser.ts"),
    "export function parse(input: string) { return input.trim(); }\n",
    "utf8",
  );
  for (const args of [
    ["init", "--quiet"],
    ["config", "user.email", "subagent@example.invalid"],
    ["config", "user.name", "Subagent Fixture"],
    ["add", "--", "."],
    ["commit", "--quiet", "-m", "fixture"],
  ]) {
    const command = await runCommand("git", args, {
      intent: "execute",
      cwd: root,
      network: "deny",
      maxOutputChars: 20_000,
    });
    expect(command.exitCode).toBe(0);
  }
  const provider = new ReadOnlyChildProvider();
  const coordinator = new ForegroundSubagentCoordinator({
    provider,
    tools: [searchTextTool],
  });
  const result = await coordinator.run(
    {
      objective: "find callers of parse",
      allowedTools: ["SearchText"],
      context: { sourceIds: ["src/parser.ts"] },
      isolated: true,
    },
    {
      task: parentTask(root),
      signal: new AbortController().signal,
      createExecutionContext: async () => executionContext(root),
    },
  );
  const worktrees = await runCommand("git", ["worktree", "list"], {
    intent: "read",
    cwd: root,
    network: "deny",
    maxOutputChars: 20_000,
  });

  expect(result.status).toBe("completed");
  expect(result.sourceIds).toContain("src/parser.ts");
  expect(worktrees.stdout).not.toContain("localcode-subagent-worktree-");
});

test("parallel delegation runs bounded independent read-only children and returns structured results", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-subagent-parallel-"),
  );
  let active = 0;
  let maximumConcurrent = 0;
  const requests: string[] = [];
  const coordinator: SubagentCoordinator = {
    async run(request, _parent) {
      requests.push(request.id ?? "");
      active += 1;
      maximumConcurrent = Math.max(maximumConcurrent, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return {
        id: request.id ?? "child",
        objective: request.objective,
        status: "completed",
        text: `Evidence for ${request.objective}`,
        evidence: [
          {
            sourceId: request.context.sourceIds[0] ?? "src/unknown.ts",
            kind: "finding",
            summary: "Bounded child evidence",
          },
        ],
        sourceIds: [...request.context.sourceIds],
        toolRuns: 1,
      };
    },
  };
  const parent: SubagentParentContext = {
    task: parentTask(root),
    signal: new AbortController().signal,
    createExecutionContext: async () => executionContext(root),
  };
  const tool = createParallelSubagentDelegationTool(coordinator, parent);
  const input = tool.validate({
    requests: [
      {
        objective: "inspect parser definitions",
        allowedTools: ["SearchText"],
        sourceIds: ["src/parser.ts"],
      },
      {
        objective: "inspect parser tests",
        allowedTools: ["ReadFile"],
        sourceIds: ["tests/parser.test.ts"],
      },
    ],
  });
  const result = await tool.execute(input, executionContext(root));

  expect(result.status).toBe("completed");
  expect(result.results).toHaveLength(2);
  expect(result.results.every((child) => child.status === "completed")).toBe(
    true,
  );
  expect(requests).toEqual(["parallel-1", "parallel-2"]);
  expect(maximumConcurrent).toBe(2);
  expect(result.results[0]?.evidence[0]?.sourceId).toBe("src/parser.ts");
  expect(result.results[1]?.evidence[0]?.sourceId).toBe("tests/parser.test.ts");

  expect(() =>
    tool.validate({
      requests: [
        input.requests[0],
        input.requests[0],
        input.requests[0],
        input.requests[0],
      ],
    }),
  ).toThrow("between 1 and 3");
});
