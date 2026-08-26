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
  ForegroundSubagentCoordinator,
  validateSubagentRequest,
} from "../../src/agent/subagents/coordinator.js";
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
