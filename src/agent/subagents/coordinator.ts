import { runAgent } from "../loop.js";
import type { AgentLoopOptions, AgentTask } from "../types.js";
import { buildSubagentContext } from "./context.js";
import type {
  DelegationToolInput,
  DelegationToolResult,
  SubagentCoordinator,
  SubagentCoordinatorOptions,
  SubagentParentContext,
  SubagentRequest,
  SubagentResult,
} from "./types.js";
import type {
  ToolDefinition,
  ToolExecutionContext,
} from "../../tools/types.js";
import {
  prepareIsolatedSubagentWorkspace,
  type IsolatedSubagentWorkspace,
} from "./worktree.js";

const MAX_ALLOWED_TOOLS = 8;
const MAX_OBJECTIVE_CHARS = 2_000;

function inputRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new Error("DelegateSubagent input must be an object.");
  return input as Record<string, unknown>;
}

function stringValue(value: unknown, field: string, max = 2_000): string {
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${field} must be a non-empty string.`);
  return value.trim().slice(0, max);
}

function stringArray(value: unknown, field: string, max: number): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > max)
    throw new Error(`${field} must contain between 1 and ${max} strings.`);
  return value.map((item) => stringValue(item, field, 300));
}

export function validateSubagentRequest(input: unknown): DelegationToolInput {
  const value = inputRecord(input);
  const allowed = stringArray(
    value.allowedTools,
    "allowedTools",
    MAX_ALLOWED_TOOLS,
  );
  const sourceIds = stringArray(value.sourceIds, "sourceIds", 16);
  if (value.isolated !== undefined && typeof value.isolated !== "boolean")
    throw new Error("isolated must be a boolean when provided.");
  return {
    objective: stringValue(value.objective, "objective", MAX_OBJECTIVE_CHARS),
    allowedTools: allowed,
    sourceIds,
    ...(value.isolated === undefined ? {} : { isolated: value.isolated }),
  };
}

function childId(parent: AgentTask, request: SubagentRequest): string {
  const suffix = request.id?.trim() || `child-${Date.now().toString(36)}`;
  return `${parent.id}:subagent:${suffix.replace(/[^a-z0-9._-]/giu, "-")}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sourceIsInsideParent(root: string, sourceId: string): boolean {
  const normalized = sourceId.replaceAll("\\", "/").replace(/^\.\//u, "");
  return (
    normalized.length > 0 &&
    !normalized.startsWith("/") &&
    !/^[A-Za-z]:\//u.test(normalized) &&
    !normalized.split("/").includes("..") &&
    !normalized.startsWith("skill:") &&
    root.length > 0
  );
}

function sourceIsInsideTaskScope(task: AgentTask, sourceId: string): boolean {
  if (!sourceIsInsideParent(task.root, sourceId)) return false;
  const stagedPaths = (task.stagedPaths ?? [])
    .map((value) => value.replaceAll("\\", "/").replace(/^\.\//u, ""))
    .filter(Boolean);
  if (stagedPaths.length === 0) return true;
  const normalized = sourceId.replaceAll("\\", "/").replace(/^\.\//u, "");
  return stagedPaths.some(
    (scope) => normalized === scope || normalized.startsWith(`${scope}/`),
  );
}

export class ForegroundSubagentCoordinator implements SubagentCoordinator {
  private readonly options: Required<
    Pick<SubagentCoordinatorOptions, "maxTurns" | "maxContextChars">
  > &
    Omit<SubagentCoordinatorOptions, "maxTurns" | "maxContextChars">;

  constructor(options: SubagentCoordinatorOptions) {
    this.options = {
      ...options,
      maxTurns: Math.max(2, Math.min(8, options.maxTurns ?? 4)),
      maxContextChars: Math.max(
        2_048,
        Math.min(24_000, options.maxContextChars ?? 12_000),
      ),
    };
  }

  async run(
    request: SubagentRequest,
    parent: SubagentParentContext,
  ): Promise<SubagentResult> {
    const id = childId(parent.task, request);
    const baseResult = {
      id,
      objective: request.objective,
      text: "",
      evidence: [],
      sourceIds: [],
      toolRuns: 0,
    };
    if (parent.signal.aborted)
      return {
        ...baseResult,
        status: "cancelled",
        error: "Parent task cancelled.",
      };
    const allowed = [...new Set(request.allowedTools)];
    if (allowed.length === 0 || allowed.length > MAX_ALLOWED_TOOLS)
      return {
        ...baseResult,
        status: "blocked",
        error: `A child must receive between 1 and ${MAX_ALLOWED_TOOLS} tools.`,
      };
    const tools = allowed.map((name) =>
      this.options.tools.find((tool) => tool.name === name),
    );
    if (tools.some((tool) => !tool))
      return {
        ...baseResult,
        status: "blocked",
        error: "The requested child tool is not available to the parent host.",
      };
    if (tools.some((tool) => tool!.risk !== "read"))
      return {
        ...baseResult,
        status: "blocked",
        error: "The current child runtime permits read-only tools only.",
      };
    if (
      !request.context.sourceIds.every((source) =>
        sourceIsInsideTaskScope(parent.task, source),
      )
    )
      return {
        ...baseResult,
        status: "blocked",
        error:
          "Child context contains a source outside the parent workspace scope.",
      };
    let isolatedWorkspace: IsolatedSubagentWorkspace | undefined;
    try {
      if (request.isolated) {
        const prepared = await prepareIsolatedSubagentWorkspace(
          parent.task.root,
          parent.signal,
        );
        if (!prepared.ok)
          return { ...baseResult, status: "blocked", error: prepared.reason };
        isolatedWorkspace = prepared.workspace;
      }
      const childRoot = isolatedWorkspace?.root ?? parent.task.root;
      const context = await buildSubagentContext(
        childRoot,
        request.objective,
        { ...request.context, maxChars: this.options.maxContextChars },
        parent.signal,
      );
      const childTask: AgentTask = {
        id,
        objective: request.objective,
        root: childRoot,
        candidate: parent.task.candidate,
        repositoryPolicy: parent.task.repositoryPolicy,
        permissionMode: "PLAN",
        mode: "workspace_question",
        planningMode: "none",
        context: context.text,
        contextEvidenceState:
          context.sourceIds.length > 0 ? "SUFFICIENT" : "INSUFFICIENT",
        repositoryState: parent.task.repositoryState,
        systemPromptProfile: "workspace",
        maxTurns: this.options.maxTurns,
        contextBudgetChars: this.options.maxContextChars,
        ...(parent.task.instructions
          ? { instructions: [...parent.task.instructions] }
          : {}),
      };
      const childContextFactory = async (
        task: AgentTask,
      ): Promise<ToolExecutionContext> => {
        const context = await parent.createExecutionContext(task);
        return {
          ...context,
          root: childRoot,
          permissionMode: "PLAN",
          signal: parent.signal,
          checkpoint: undefined,
          checkpointId: undefined,
          allowExistingFileOverwrite: false,
        };
      };
      const childOptions: AgentLoopOptions = {
        provider: this.options.provider,
        tools: tools as ToolDefinition<unknown, unknown>[],
        toolChoice: tools.length > 0 ? "auto" : "none",
        logger: this.options.logger?.child({
          component: "agent.subagent",
          taskId: id,
        }),
        createExecutionContext: childContextFactory,
      };
      const result = await runAgent(childTask, childOptions, parent.signal);
      const contextEvidence = context.sourceIds.map((sourceId) => ({
        sourceId,
        kind: "context",
        summary:
          "The child host loaded this explicit source into its fresh context.",
      }));
      const ledgerEvidence = result.ledger.evidence
        .filter((item) => sourceIsInsideParent(parent.task.root, item.source))
        .slice(0, 32)
        .map((item) => ({
          sourceId: item.source,
          kind: item.kind,
          summary: item.summary.slice(0, 1_000),
        }));
      const evidence = [...contextEvidence, ...ledgerEvidence]
        .filter(
          (item, index, all) =>
            all.findIndex(
              (candidate) => candidate.sourceId === item.sourceId,
            ) === index,
        )
        .slice(0, 32);
      return {
        ...baseResult,
        status: result.status,
        text: result.text.slice(0, 4_000),
        evidence,
        sourceIds: [
          ...new Set([
            ...context.sourceIds,
            ...evidence.map((item) => item.sourceId),
          ]),
        ],
        toolRuns: result.toolRuns.length,
      };
    } catch (error) {
      return {
        ...baseResult,
        status: parent.signal.aborted ? "cancelled" : "failed",
        error: errorText(error),
      };
    } finally {
      await isolatedWorkspace?.cleanup();
    }
  }
}

export function createSubagentDelegationTool(
  coordinator: SubagentCoordinator,
  parent: SubagentParentContext,
): ToolDefinition<DelegationToolInput, DelegationToolResult> {
  return {
    name: "DelegateSubagent",
    description:
      "Delegate one bounded read-only repository investigation to a fresh-context child and return structured evidence.",
    risk: "read",
    parameters: {
      type: "object",
      properties: {
        objective: {
          type: "string",
          description: "The bounded investigation the child must answer.",
        },
        allowedTools: {
          type: "array",
          description: "Read-only tools the child may use, such as SearchText.",
        },
        sourceIds: {
          type: "array",
          description:
            "Workspace-relative files that may seed the fresh context.",
        },
        isolated: {
          type: "boolean",
          description:
            "Use a clean detached disposable worktree for this read-only child.",
        },
      },
      required: ["objective", "allowedTools", "sourceIds"],
      additionalProperties: false,
    },
    validate: validateSubagentRequest,
    async execute(input, ctx) {
      const result = await coordinator.run(
        {
          id: input.objective.slice(0, 80),
          objective: input.objective,
          allowedTools: input.allowedTools,
          context: { sourceIds: input.sourceIds },
          ...(input.isolated === undefined ? {} : { isolated: input.isolated }),
        },
        { ...parent, signal: ctx.signal },
      );
      return result;
    },
  };
}
