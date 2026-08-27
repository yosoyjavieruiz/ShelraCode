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
import { runAgent } from "../../src/agent/loop.js";
import type { AgentTask } from "../../src/agent/types.js";
import {
  createParallelSubagentDelegationTool,
  ForegroundSubagentCoordinator,
  createSubagentDelegationTool,
} from "../../src/agent/subagents/coordinator.js";
import { searchTextTool } from "../../src/tools/workspace.js";
import type { ToolExecutionContext } from "../../src/tools/types.js";

const candidate: ModelCandidate = {
  id: "local/parent-child-fixture",
  providerId: "local",
  modelId: "parent-child-fixture",
  displayName: "Parent child fixture",
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
  quality: { coding: 0.6, toolUse: 0.8, confidence: "measured" },
  health: { state: "healthy" },
};

class ParentChildProvider implements ProviderAdapter {
  readonly id = "local";
  readonly displayName = "Parent child fixture";
  readonly requests: NormalizedModelRequest[] = [];
  private parentDelegated = false;
  private parallelDelegated = false;
  private childSearched = false;

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
    const names =
      request.tools
        ?.map((tool) => {
          if (typeof tool !== "object" || tool === null) return "";
          const functionValue = (tool as { function?: { name?: unknown } })
            .function;
          return typeof functionValue?.name === "string"
            ? functionValue.name
            : "";
        })
        .filter(Boolean) ?? [];
    if (names.includes("DelegateSubagents") && !this.parallelDelegated) {
      this.parallelDelegated = true;
      yield {
        type: "tool.call",
        call: {
          id: "delegate-parallel-1",
          name: "DelegateSubagents",
          arguments: JSON.stringify({
            requests: [
              {
                objective: "inspect parser implementation",
                allowedTools: ["SearchText"],
                sourceIds: ["src/parser.ts"],
              },
              {
                objective: "inspect parser tests",
                allowedTools: ["SearchText"],
                sourceIds: ["tests/parser.test.ts"],
              },
            ],
          }),
        },
      };
    } else if (names.includes("DelegateSubagents")) {
      yield {
        type: "text.delta",
        text: "Parent incorporated parallel evidence.",
      };
    } else if (names.includes("DelegateSubagent") && !this.parentDelegated) {
      this.parentDelegated = true;
      yield {
        type: "tool.call",
        call: {
          id: "delegate-1",
          name: "DelegateSubagent",
          arguments: JSON.stringify({
            objective: "find callers of parse",
            allowedTools: ["SearchText"],
            sourceIds: ["src/parser.ts"],
          }),
        },
      };
    } else if (names.includes("DelegateSubagent")) {
      yield { type: "text.delta", text: "Parent incorporated child evidence." };
    } else if (names.includes("SearchText") && !this.childSearched) {
      this.childSearched = true;
      yield {
        type: "tool.call",
        call: {
          id: "child-search-1",
          name: "SearchText",
          arguments: JSON.stringify({ query: "parse", path: "src" }),
        },
      };
    } else {
      yield {
        type: "text.delta",
        text: "Found callers and returned evidence.",
      };
    }
    yield { type: "done" };
  }

  classifyError(error: unknown) {
    return {
      code: "UNKNOWN" as const,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

test("parent delegates, child uses fresh context, and parent remains the finisher", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-subagent-parent-"),
  );
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(
    path.join(root, "src", "parser.ts"),
    "export function parse(input: string) { return input.trim(); }\n",
    "utf8",
  );
  const provider = new ParentChildProvider();
  const coordinator = new ForegroundSubagentCoordinator({
    provider,
    tools: [searchTextTool],
  });
  const parentTask: AgentTask = {
    id: "parent",
    objective: "Investigate parser callers",
    root,
    candidate,
    repositoryPolicy: "private",
    permissionMode: "PLAN",
    mode: "workspace_question",
    context: "PARENT_ONLY_SECRET",
    contextEvidenceState: "SUFFICIENT",
    systemPromptProfile: "workspace",
    maxTurns: 4,
  };
  const parentContext = (): ToolExecutionContext => ({
    root,
    permissionMode: "PLAN",
    signal: new AbortController().signal,
    network: false,
  });
  const delegation = createSubagentDelegationTool(coordinator, {
    task: parentTask,
    signal: new AbortController().signal,
    createExecutionContext: async () => parentContext(),
  });
  const result = await runAgent(parentTask, {
    provider,
    tools: [delegation],
    toolChoice: "auto",
    createExecutionContext: async () => parentContext(),
  });

  expect(result.status).toBe("completed");
  expect(result.text).toContain("Parent incorporated child evidence");
  expect(
    result.ledger.actions.some(
      (action) =>
        action.target === "DelegateSubagent" && action.status === "succeeded",
    ),
  ).toBe(true);
  expect(
    result.ledger.evidence.some(
      (evidence) =>
        evidence.source === "src/parser.ts" &&
        evidence.summary.includes("Fresh child evidence"),
    ),
  ).toBe(true);
  expect(provider.requests.length).toBeGreaterThanOrEqual(3);
  const childRequest = provider.requests.find(
    (request) =>
      request.tools?.some((tool) =>
        JSON.stringify(tool).includes("SearchText"),
      ) &&
      !request.tools?.some((tool) =>
        JSON.stringify(tool).includes("DelegateSubagent"),
      ),
  );
  expect(childRequest).toBeDefined();
  expect(JSON.stringify(childRequest?.messages ?? [])).not.toContain(
    "PARENT_ONLY_SECRET",
  );
});

test("parent incorporates evidence from bounded parallel child investigations", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-subagent-parallel-parent-"),
  );
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "tests"), { recursive: true });
  await writeFile(
    path.join(root, "src", "parser.ts"),
    "export function parse(input: string) { return input.trim(); }\n",
    "utf8",
  );
  await writeFile(
    path.join(root, "tests", "parser.test.ts"),
    "test('parser', () => expect(true).toBe(true));\n",
    "utf8",
  );
  const provider = new ParentChildProvider();
  const coordinator = new ForegroundSubagentCoordinator({
    provider,
    tools: [searchTextTool],
  });
  const parentTask: AgentTask = {
    id: "parallel-parent",
    objective: "Investigate parser implementation and tests",
    root,
    candidate,
    repositoryPolicy: "private",
    permissionMode: "PLAN",
    mode: "workspace_question",
    context: "PARENT_ONLY_SECRET",
    contextEvidenceState: "SUFFICIENT",
    systemPromptProfile: "workspace",
    maxTurns: 4,
  };
  const parentContext = (): ToolExecutionContext => ({
    root,
    permissionMode: "PLAN",
    signal: new AbortController().signal,
    network: false,
  });
  const delegation = createParallelSubagentDelegationTool(coordinator, {
    task: parentTask,
    signal: new AbortController().signal,
    createExecutionContext: async () => parentContext(),
  });
  const result = await runAgent(parentTask, {
    provider,
    tools: [delegation],
    toolChoice: "auto",
    createExecutionContext: async () => parentContext(),
  });

  expect(result.status).toBe("completed");
  expect(result.text).toContain("Parent incorporated parallel evidence");
  expect(
    result.ledger.actions.some(
      (action) =>
        action.target === "DelegateSubagents" && action.status === "succeeded",
    ),
  ).toBe(true);
  expect(
    result.ledger.evidence.some(
      (evidence) => evidence.source === "src/parser.ts",
    ),
  ).toBe(true);
  expect(
    result.ledger.evidence.some(
      (evidence) => evidence.source === "tests/parser.test.ts",
    ),
  ).toBe(true);
  expect(provider.requests.length).toBeGreaterThanOrEqual(4);
  expect(
    provider.requests.some((request) =>
      request.tools?.some((tool) =>
        JSON.stringify(tool).includes("DelegateSubagents"),
      ),
    ),
  ).toBe(true);
  const childRequests = provider.requests.filter(
    (request) =>
      !request.tools?.some((tool) =>
        JSON.stringify(tool).includes("DelegateSubagents"),
      ),
  );
  expect(childRequests.length).toBeGreaterThanOrEqual(2);
  expect(
    childRequests.every(
      (request) =>
        !JSON.stringify(request.messages).includes("PARENT_ONLY_SECRET"),
    ),
  ).toBe(true);
});
