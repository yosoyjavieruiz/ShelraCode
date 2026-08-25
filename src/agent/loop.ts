import type {
  NormalizedMessage,
  ProviderFailure,
  ProviderEvent,
  ToolCall,
} from "../providers/types.js";
import type { FileMutationSnapshot } from "../checkpoint/checkpoint.js";
import { runTestsTool } from "../tools/workspace.js";
import { ToolError, toolErrorDetails } from "../tools/errors.js";
import type { ToolDefinition, ToolResult } from "../tools/types.js";
import { evaluateCompletionGate } from "./completion-gate.js";
import { independentlyVerifyTask } from "./verifier.js";
import { compactTaskContext } from "./compaction.js";
import { recoverTextToolCalls } from "./tool-envelope.js";
import { extractObjectivePaths } from "./objective-review.js";
export { recoverTextToolCalls } from "./tool-envelope.js";
import { normalizeVerificationPlan } from "./verification-plan.js";
import type { TurnMode } from "./turn-policy.js";
import {
  addTaskEvidence,
  addTaskBlocker,
  createTaskLedger,
  recordTaskAction,
  recordVerificationRun,
  setTaskCriterion,
  setTaskPlan,
  setTaskPhase,
  terminalPhase,
  updateTaskPlanStep,
} from "./task-state.js";
import type { AgentPhase, AgentTaskLedger, PlanStep } from "./task-state.js";
import type { LocalCodeLogger } from "../shared/logging.js";
import type {
  AgentEvent,
  AgentLoopOptions,
  AgentRunResult,
  AgentTask,
  SuccessCriteriaVerification,
} from "./types.js";

function summarizeToolInput(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return { inputType: typeof input };
  const value = input as Record<string, unknown>;
  const summary: Record<string, unknown> = {
    keys: Object.keys(value),
  };
  for (const key of ["path", "command", "query", "pattern"]) {
    if (typeof value[key] === "string") summary[key] = value[key];
  }
  for (const key of ["content", "oldText", "newText"]) {
    if (typeof value[key] === "string")
      summary[`${key}Length`] = value[key].length;
  }
  return summary;
}

function summarizeToolResult(result: ToolResult): Record<string, unknown> {
  const output = objectOutput(result.output);
  return {
    ok: result.ok,
    durationMs: result.durationMs,
    ...(result.code ? { code: result.code } : {}),
    ...(result.recoverable === undefined
      ? {}
      : { recoverable: result.recoverable }),
    ...(result.path ? { path: result.path } : {}),
    ...(typeof output?.exitCode === "number"
      ? { exitCode: output.exitCode }
      : {}),
    ...(typeof output?.stdout === "string"
      ? { stdoutLength: output.stdout.length }
      : {}),
    ...(typeof output?.stderr === "string"
      ? { stderrLength: output.stderr.length }
      : {}),
    ...(Array.isArray(output?.matches)
      ? { matchCount: output.matches.length }
      : {}),
    ...(result.error
      ? { errorCode: result.code ?? "UNCLASSIFIED_TOOL_ERROR" }
      : {}),
  };
}

const TOOL_TEXT_SHAPE =
  /^\s*(?:[\[{<`]|```)[\s\S]*(?:"tool_calls"\s*:|"(?:name|tool)"\s*:\s*"(?:ListFiles|GlobFiles|SearchText|ReadFile|EditFile|WriteFile|CreateFile|DeleteFile|Shell|RunTests|GitStatus|GitDiff)"[\s\S]*(?:"arguments"\s*:|"output"\s*:))/u;

export function sanitizeAssistantTextForCompletion(
  text: string,
  fallback: string,
): string {
  const trimmed = text.trim();
  if (!trimmed) return fallback;
  if (recoverTextToolCalls(trimmed, 0)?.length) return fallback;
  return TOOL_TEXT_SHAPE.test(trimmed) ? fallback : trimmed;
}

function summarizeFailure(message: string): string {
  const normalized = message.replace(/\s+/gu, " ").trim();
  return normalized.length <= 500
    ? normalized
    : `${normalized.slice(0, 500)}â€¦[truncated]`;
}

function emit(options: AgentLoopOptions, event: AgentEvent): void {
  options.onEvent?.(event);
  options.events?.emit(event);
  const logger = options.logger;
  if (!logger) return;
  switch (event.type) {
    case "tool.started":
      logger.debug("agent.tool.started", {
        callId: event.callId,
        tool: event.tool,
        risk: event.risk,
        ...summarizeToolInput(event.input),
      });
      break;
    case "tool.finished":
      logger.debug("agent.tool.finished", {
        callId: event.callId,
        tool: event.tool,
        ...summarizeToolResult(event.result),
      });
      break;
    case "verification.started":
      logger.info("agent.verification.started", {
        verificationId: event.id,
        ...(event.stage ? { stage: event.stage } : {}),
        command: event.command,
      });
      break;
    case "verification.finished":
      logger.info("agent.verification.finished", {
        ...(event.stage ? { stage: event.stage } : {}),
        ...(event.command ? { command: event.command } : {}),
        exitCode: event.exitCode,
        outputLength: event.output.length,
      });
      break;
    case "phase.changed":
      logger.debug("agent.phase.changed", { phase: event.phase });
      break;
    case "checkpoint.created":
      logger.info("agent.checkpoint.created", { checkpointId: event.id });
      break;
    case "task.completed":
      logger.info("agent.task.completed", {
        status: event.result.status,
        verified: event.result.verified,
        turns: event.result.turns,
        evidenceCount: event.result.evidenceCount,
        toolRuns: event.result.toolRuns.length,
      });
      break;
    case "task.failed":
      logger.warn("agent.task.failed", {
        errorType: "task_failure",
        reason: summarizeFailure(event.error),
      });
      break;
    case "task.blocked":
      logger.warn("agent.task.blocked", {
        reason: summarizeFailure(event.error),
      });
      break;
    case "task.cancelled":
      logger.info("agent.task.cancelled", {
        reason: summarizeFailure(event.error),
      });
      break;
    case "tool.output":
    case "assistant.delta":
    case "model.progress":
      break;
  }
}

// Surfaces the ledger's already-existing internal phase state machine
// (frame/discover/analyze/plan/act/observe/reflect/verify/review/...) to
// hosts as a structured event. Before this, `AgentTaskLedger.phase`
// transitioned silently — real state the UI has no way to render without
// guessing from prose. This is the smallest possible change to expose it:
// setTaskPhase's own invariants (no transition out of a terminal phase,
// no skipping to "complete") are untouched, this only adds a notification.
function transitionPhase(
  ledger: AgentTaskLedger,
  phase: AgentPhase,
  options: AgentLoopOptions,
): void {
  const previous = ledger.phase;
  setTaskPhase(ledger, phase);
  emit(options, { type: "phase.changed", phase });
  options.logger?.debug("agent.phase.transition", {
    from: previous,
    to: phase,
  });
}

function toolSchema(tool: ToolDefinition<unknown, unknown>): unknown {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

function providerModelId(task: AgentTask): string {
  return (
    task.candidate.modelId ||
    task.candidate.displayName ||
    task.candidate.id.split("/").slice(1).join("/") ||
    task.candidate.id
  );
}

function parseToolInput(call: ToolCall): unknown {
  try {
    return JSON.parse(call.arguments || "{}") as unknown;
  } catch {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `Tool ${call.name} returned malformed JSON arguments. Retry with valid JSON matching the tool schema.`,
      {
        recoverable: true,
        suggestedAction: "Regenerate the tool arguments as a JSON object.",
      },
    );
  }
}

function objectOutput(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const MODEL_TOOL_TEXT_LIMIT = 8_000;
const MODEL_EXECUTION_TEXT_LIMIT = 4_000;

function compactToolOutput(
  tool: string,
  output: unknown,
): Record<string, unknown> | undefined {
  const fields = objectOutput(output);
  if (!fields) return undefined;
  const limit =
    tool === "Shell" || tool === "RunTests"
      ? MODEL_EXECUTION_TEXT_LIMIT
      : MODEL_TOOL_TEXT_LIMIT;
  const compacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (typeof value === "string") {
      compacted[key] =
        value.length > limit
          ? `${value.slice(0, limit)}\n[host output truncated for model context]`
          : value;
    } else if (Array.isArray(value)) {
      compacted[key] = value.slice(0, 40);
      if (value.length > 40) compacted[`${key}Truncated`] = true;
    } else compacted[key] = value;
  }
  return compacted;
}

function toolMessageContent(result: ToolResult): string {
  const compactedOutput = compactToolOutput(result.tool, result.output);
  return JSON.stringify({
    ...result,
    ...(compactedOutput === undefined ? {} : { output: compactedOutput }),
  });
}

function executionFailure(
  toolName: string,
  input: unknown,
  output: unknown,
): Pick<
  ToolResult,
  "ok" | "error" | "code" | "recoverable" | "suggestedAction"
> {
  const fields = objectOutput(output);
  const exitCode = fields?.exitCode;
  if (
    (toolName !== "Shell" && toolName !== "RunTests") ||
    typeof exitCode !== "number" ||
    exitCode === 0
  )
    return { ok: true };

  const inputFields = objectOutput(input);
  const command =
    (typeof fields?.command === "string" && fields.command) ||
    (typeof inputFields?.command === "string" && inputFields.command) ||
    toolName;
  const failures = Array.isArray(fields?.failures)
    ? fields.failures
        .map((failure) => objectOutput(failure)?.summary)
        .filter((summary): summary is string => typeof summary === "string")
        .slice(0, 3)
        .join(" | ")
    : "";
  const detail = failures ? ` ${failures}` : "";
  return {
    ok: false,
    error:
      `${toolName} command failed with exit code ${exitCode}: ${command}.${detail}`.slice(
        0,
        1_200,
      ),
    code: toolName === "RunTests" ? "TEST_FAILED" : "COMMAND_FAILED",
    recoverable: true,
    suggestedAction:
      toolName === "RunTests"
        ? "Inspect the concise failure evidence, change the implementation if needed, and run the focused test again."
        : "Inspect stderr and retry with a corrected command or narrower step.",
  };
}

function validateToolInput(
  tool: ToolDefinition<unknown, unknown>,
  input: unknown,
): unknown {
  if (
    tool.parameters.additionalProperties === false &&
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input)
  ) {
    const allowed = new Set(Object.keys(tool.parameters.properties));
    const unknown = Object.keys(input).filter((key) => !allowed.has(key));
    if (unknown.length > 0)
      throw new ToolError(
        "INVALID_ARGUMENT",
        `Unknown argument(s) for ${tool.name}: ${unknown.join(", ")}. Remove them and retry with the declared schema.`,
        {
          recoverable: true,
          field: unknown[0],
          suggestedAction: "Use only the fields declared by the tool schema.",
        },
      );
  }
  return tool.validate(input);
}

function toolErrorFields(
  error: unknown,
): Pick<
  ToolResult,
  "code" | "recoverable" | "field" | "path" | "suggestedAction" | "details"
> {
  const details = toolErrorDetails(error);
  return details
    ? {
        code: details.code,
        recoverable: details.recoverable,
        ...(details.field === undefined ? {} : { field: details.field }),
        ...(details.path === undefined ? {} : { path: details.path }),
        ...(details.suggestedAction === undefined
          ? {}
          : { suggestedAction: details.suggestedAction }),
        ...(details.details === undefined ? {} : { details: details.details }),
      }
    : {};
}

const TEXT_TOOL_PREFIX_TAIL = 18;

function isTextToolBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  return new Set([" ", "\t", "\r", "\n"]).has(text[index - 1] ?? "");
}

function findTextToolCandidate(text: string): number {
  for (let index = 0; index < text.length; index += 1) {
    if (!isTextToolBoundary(text, index)) continue;
    const character = text[index];
    if (character === "{" || character === "[") return index;
    if (text.startsWith("<response>", index)) return index;
    if (text.startsWith("<xml>", index)) return index;
    if (text.startsWith("<tools>", index)) return index;
    if (text.startsWith("<tool_call>", index)) return index;
    if (text.startsWith("<tool_response>", index)) return index;
    if (text.startsWith("```", index)) return index;
  }
  return -1;
}

function normalizeWorkspacePath(value: string): string {
  const parts: string[] = [];
  const raw = value.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      const previous = parts.at(-1);
      if (previous && previous !== "..") parts.pop();
      else parts.push(part);
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

function extractWorkspacePathHints(values: readonly string[]): string[] {
  const pathPattern =
    /(?:^|[\s("'\/])((?:\.\/)?(?:[\w.-]+[\\/])+[\w.-]+\.[A-Za-z0-9]{1,12})(?=$|[\s)"',.;:])/g;
  const hints = new Set<string>();
  for (const value of values) {
    pathPattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pathPattern.exec(value)) !== null) {
      const normalized = normalizeWorkspacePath(match[1]!);
      if (normalized) hints.add(normalized);
    }
  }
  return [...hints].slice(0, 6);
}

function extractVerificationFailurePaths(value: string): string[] {
  return extractWorkspacePathHints([value])
    .map(normalizeWorkspacePath)
    .map((candidate) => {
      const marker = candidate.search(
        /(?:^|\/)(?:test|tests|__tests__|spec|specs)(?:\/|$)/iu,
      );
      return marker > 0 ? candidate.slice(marker + 1) : candidate;
    })
    .filter(
      (candidate) =>
        /(?:^|\/)(?:test|tests|__tests__|spec|specs)(?:\/|$)/iu.test(
          candidate,
        ) || /\.(?:test|spec)\.[^/]+$/iu.test(candidate),
    )
    .slice(0, 6);
}

function failureMessage(
  event: Extract<ProviderEvent, { type: "error" }>,
): string {
  return `${event.error.code}: ${event.error.message}`;
}

function providerFailureMessage(failure: ProviderFailure): string {
  return `${failure.code}: ${failure.message}`;
}

function frameConstraints(
  task: AgentTask,
  mode: TurnMode,
  verificationPlan: readonly { command: string }[],
): string[] {
  const constraints = [...(task.constraints ?? [])];
  const add = (value: string): void => {
    if (!constraints.includes(value)) constraints.push(value);
  };
  if (mode === "conversation" || mode === "knowledge")
    add("Do not perform repository operations for this turn.");
  if (mode === "plan" || mode === "review")
    add("This turn is read-only; do not modify the workspace.");
  if (mode === "coding") {
    add("Preserve pre-existing user work.");
    if (verificationPlan.length > 0)
      add("Do not declare completion until host-owned verification passes.");
  }
  if (task.containsHighConfidenceSecret)
    add("Do not send high-confidence secrets to a remote provider.");
  return constraints;
}

function classifyProviderFailure(
  provider: AgentLoopOptions["provider"],
  error: unknown,
): ProviderFailure {
  try {
    return provider.classifyError(error);
  } catch {
    return {
      code: "UNKNOWN",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

// Kept to one sentence deliberately: tool descriptions and typed error
// codes (see tools/errors.ts) carry the specifics. This line only has to
// establish the behavior — "a tool error is evidence, not a stop sign" —
// not restate every recovery case.
const TOOL_ERROR_RECOVERY_INSTRUCTION =
  "If a tool call fails, its error explains what to change (wrong path, " +
  "wrong tool for a file vs. directory, invalid argument) — correct that " +
  "and try again instead of giving up or repeating the same call.";

const SYSTEM_PROMPT_BY_PROFILE: Record<
  NonNullable<AgentTask["systemPromptProfile"]>,
  string
> = {
  minimal:
    "You are LocalCode, a local-first coding assistant. Respond naturally and " +
    "helpfully to the user's message. This turn has no workspace tools available " +
    "and does not need any — never claim to be inspecting files or the repository.",
  workspace:
    "You are LocalCode, a local-first coding assistant. Use the available " +
    "read-only workspace tools only as needed to answer the user's question " +
    "about this repository, then answer directly. No write, shell or test " +
    "tools are available this turn — do not attempt to modify anything. " +
    TOOL_ERROR_RECOVERY_INSTRUCTION,
  coding:
    "You are LocalCode. Respect privacy, strict-zero routing, workspace " +
    "boundaries, permissions, and verify mutations with deterministic tools. " +
    "When a workspace action is needed, use exactly one available tool per " +
    "turn; do not describe a planned tool call as prose, JSON, XML, or a " +
    "code block, and do not assume file contents before reading them. After " +
    "each tool result, choose the next action from the new evidence. " +
    TOOL_ERROR_RECOVERY_INSTRUCTION,
};

export async function runAgent(
  task: AgentTask,
  options: AgentLoopOptions,
  signal = new AbortController().signal,
): Promise<AgentRunResult> {
  const toolMap = new Map(options.tools.map((tool) => [tool.name, tool]));
  const profile = task.systemPromptProfile ?? "coding";
  const mode: TurnMode =
    task.mode ??
    (profile === "minimal"
      ? "knowledge"
      : task.verificationCommand || task.verificationCommands?.length
        ? "coding"
        : "workspace_question");
  const verificationPlan = normalizeVerificationPlan(
    task.verificationCommands,
    task.verificationCommand,
  );
  const constraints = frameConstraints(task, mode, verificationPlan);
  const successCriteria =
    task.successCriteria && task.successCriteria.length > 0
      ? task.successCriteria
      : ["Address the user's objective with an evidence-backed response."];
  const explicitSuccessCriteria = (task.successCriteria?.length ?? 0) > 0;
  const ledger = createTaskLedger({
    id: task.id,
    objective: task.objective,
    mode,
    verificationPlan,
    successCriteria: successCriteria.map((description, index) => ({
      id: `criterion-${index + 1}`,
      description,
      required: true,
      satisfied: false,
    })),
    constraints: constraints.map((description, index) => ({
      id: `constraint-${index + 1}`,
      description,
    })),
  });
  const logger = options.logger?.child({
    component: "agent.loop",
    taskId: task.id,
    providerId: task.candidate.providerId,
    modelId: providerModelId(task),
  });
  const loopOptions = logger ? { ...options, logger } : options;
  logger?.info("agent.task.started", {
    mode,
    toolCount: options.tools.length,
    toolChoice: options.toolChoice ?? "auto",
    objectiveLength: task.objective.length,
    contextLength: task.context?.length ?? 0,
  });
  options.trace?.record({
    taskId: task.id,
    type: "task.started",
    phase: ledger.phase,
    data: {
      mode,
      model: providerModelId(task),
      toolCount: options.tools.length,
      toolChoice: options.toolChoice ?? "auto",
    },
  });
  transitionPhase(ledger, "discover", loopOptions);
  options.persistTask?.(ledger);
  const persistLedger = (): void => options.persistTask?.(ledger);
  const emitPlan = (): void => {
    if (!ledger.plan) return;
    persistLedger();
    emit(loopOptions, {
      type: "plan.changed",
      steps: ledger.plan.steps.map((step) => ({
        id: step.id,
        description: step.description,
        status: step.status,
      })),
    });
  };
  const objectivePaths = [
    ...new Set(
      [...extractObjectivePaths(task.objective), ...(task.stagedPaths ?? [])]
        .map(normalizeWorkspacePath)
        .filter((value) => value.length > 0),
    ),
  ];
  const syncTargetPlan = (activePaths: readonly string[] = []): void => {
    if (!ledger.plan || objectivePaths.length === 0) return;
    const changed = new Set(ledger.filesChanged.map(normalizeWorkspacePath));
    const active = new Set(activePaths.map(normalizeWorkspacePath));
    let changedPlan = false;
    objectivePaths.slice(0, 8).forEach((target, index) => {
      const stepId = `step-target-${index + 1}`;
      const normalized = normalizeWorkspacePath(target);
      const status = active.has(normalized)
        ? "active"
        : changed.has(normalized)
          ? "done"
          : "pending";
      changedPlan = updateTaskPlanStep(ledger, stepId, status) || changedPlan;
    });
    if (changedPlan) emitPlan();
  };
  let criteriaWritePaths =
    objectivePaths.length > 0
      ? [objectivePaths[0]!]
      : extractWorkspacePathHints([task.objective]).map(normalizeWorkspacePath);
  const contextFallback =
    profile === "minimal"
      ? ""
      : "\n\nNo repository context was provided. Inspect the workspace before editing.";
  const stagedExecutionInstruction =
    mode === "coding" && objectivePaths.length > 1
      ? `\n\nHost execution plan: this is a staged multi-file task. Work on one target at a time. The current mutation target is ${criteriaWritePaths[0] ?? objectivePaths[0]}. Read the target, make only the requested change for that stage, and wait for host verification before editing another target.`
      : "";
  const messages: NormalizedMessage[] = [
    {
      role: "system",
      content: SYSTEM_PROMPT_BY_PROFILE[profile],
    },
    {
      role: "user",
      content: task.context
        ? `${task.objective}\n\n${task.context}${stagedExecutionInstruction}`
        : `${task.objective}${contextFallback}${stagedExecutionInstruction}`,
    },
  ];
  const toolRuns: ToolResult[] = [];
  let finalText = "";
  let verificationRan = false;
  let verified = false;
  let mutationRevision = 0;
  let verifiedMutationRevision = -1;
  let mutated = false;
  let checkpointId: string | undefined;
  // Multi-file coding starts as a staged transaction. A small model sees the
  // full objective, but the host permits mutation in one explicitly named
  // file at a time; after verification, the criteria verifier advances the
  // next target. Before host feedback reads remain open for discovery; after
  // feedback, reads are focused on the current staged target.
  let criteriaFeedbackActive = false;
  const pendingMutations: Array<{
    before: FileMutationSnapshot;
    after: FileMutationSnapshot;
    protectedCriterionIds: string[];
  }> = [];
  const protectedCriterionIds = new Set<string>();
  const readRevisions = new Map<string, number>();
  const rejectedEditPaths = new Set<string>();
  let unresolvedBlockers = 0;
  let finalReviewState: boolean | undefined;
  let checkpointPreservationCheck:
    ((checkpoint: string | undefined) => Promise<boolean>) | undefined;
  const initialEvidence = task.context?.trim() ? 1 : 0;
  logger?.info("agent.context.built", {
    providedByHost: initialEvidence > 0,
    contextLength: task.context?.length ?? 0,
    initialEvidence,
    contextBudgetChars: task.contextBudgetChars ?? 50_000,
  });
  if (task.context?.trim())
    addTaskEvidence(ledger, {
      id: `${task.id}:initial-context`,
      kind: "tool-result",
      source: "host-context",
      summary: "The host supplied repository context before model execution.",
      relevance: 0.8,
      freshness: 1,
    });
  transitionPhase(ledger, "analyze", loopOptions);
  persistLedger();
  if (mode === "plan" || (task.successCriteria?.length ?? 0) > 1) {
    transitionPhase(ledger, "plan", loopOptions);
    const targetSteps: PlanStep[] = objectivePaths
      .slice(0, 8)
      .map((target, index) => ({
        id: `step-target-${index + 1}`,
        description: `Implement the requested change in ${target}.`,
        status: index === 0 ? "active" : "pending",
        evidenceRequired: [`ReadFile ${target}`],
      }));
    setTaskPlan(ledger, {
      steps: [
        {
          id: "step-discover",
          description:
            "Collect the repository evidence required by the objective.",
          status: "done",
          evidenceRequired: ["relevant repository evidence"],
        },
        ...(targetSteps.length > 0
          ? targetSteps
          : [
              {
                id: "step-analyze",
                description:
                  "Analyze the evidence and identify the smallest safe next action.",
                status: "active" as const,
              },
            ]),
        ...(mode === "coding"
          ? [
              {
                id: "step-verify",
                description:
                  "Run the relevant verification and review the final diff.",
                status: "pending" as const,
                verification:
                  verificationPlan.length > 0
                    ? verificationPlan.map((item) => item.command)
                    : undefined,
              },
            ]
          : []),
      ],
      updatedAt: new Date().toISOString(),
    });
    emitPlan();
  }
  const maxTurns = task.maxTurns ?? 8;
  const maxOutputTokens =
    task.maxOutputTokens ??
    (mode === "coding" || mode === "command" ? 2_048 : 512);
  const temperature =
    task.temperature ??
    (mode === "conversation" || mode === "knowledge" ? 0.7 : 0.2);
  // Non-progress watchdog: local inference has no request quota, so
  // maxTurns alone is too coarse a safety net for a model stuck repeating
  // the same tool call. Three identical calls in a row stop the run early
  // with an actionable error instead of quietly burning the full budget.
  const NON_PROGRESS_LIMIT = 3;
  let lastCallSignature: string | undefined;
  let repeatedCallCount = 0;
  let lastTextualCallSignature: string | undefined;
  let forceNoToolsOnNextTurn = false;
  let lastErrorCode: string | undefined;
  let repeatedErrorCount = 0;
  let noActionCount = 0;

  const observeTool = (
    call: ToolCall,
    tool: ToolDefinition<unknown, unknown> | undefined,
    result: ToolResult,
    input?: unknown,
  ): void => {
    const kind =
      tool?.risk === "read"
        ? "read"
        : tool?.risk === "write" || tool?.risk === "destructive"
          ? "write"
          : tool?.risk === "execute"
            ? "execute"
            : "execute";
    const output = objectOutput(result.output);
    const executionFailed =
      (call.name === "Shell" || call.name === "RunTests") &&
      typeof output?.exitCode === "number" &&
      output.exitCode !== 0;
    recordTaskAction(ledger, {
      id: `${task.id}:tool:${call.id}`,
      kind,
      target:
        typeof input === "object" &&
        input !== null &&
        "path" in input &&
        typeof input.path === "string"
          ? input.path
          : call.name,
      status: result.ok && !executionFailed ? "succeeded" : "failed",
      completedAt: new Date().toISOString(),
      summary: result.ok ? "Tool result succeeded." : result.error,
    });
    transitionPhase(ledger, "observe", loopOptions);
    if (result.ok && tool?.risk === "read")
      addTaskEvidence(ledger, {
        id: `${task.id}:evidence:${call.id}`,
        kind: "tool-result",
        source: call.name,
        summary: `Successful ${call.name} result used as repository evidence.`,
        relevance: 0.9,
        freshness: 1,
      });
    if (
      result.ok &&
      tool?.name === "ReadFile" &&
      typeof input === "object" &&
      input !== null &&
      "path" in input &&
      typeof input.path === "string"
    ) {
      const normalizedPath = normalizeWorkspacePath(input.path);
      readRevisions.set(normalizedPath, mutationRevision);
      rejectedEditPaths.delete(normalizedPath);
    }
    if (
      call.name === "EditFile" &&
      !result.ok &&
      typeof input === "object" &&
      input !== null &&
      "path" in input &&
      typeof input.path === "string" &&
      ["INVALID_ARGUMENT", "NOT_FOUND", "CONFLICT", "STALE_EDIT"].includes(
        result.code ?? "",
      )
    )
      rejectedEditPaths.add(normalizeWorkspacePath(input.path));
    if (call.name === "RunTests" && output) {
      addTaskEvidence(ledger, {
        id: `${task.id}:test-evidence:${call.id}`,
        kind: "test",
        source: call.name,
        summary: executionFailed
          ? "A project test command failed and produced structured failure evidence."
          : "A project test command produced structured verification evidence.",
        relevance: 0.9,
        freshness: 1,
      });
      const command =
        typeof output?.command === "string" ? output.command : "RunTests";
      const exitCode =
        typeof output?.exitCode === "number" ? output.exitCode : undefined;
      recordVerificationRun(ledger, {
        id: `${task.id}:tool-verification:${call.id}`,
        ...(verificationPlan.find((item) => item.command === command)
          ? {
              stage: verificationPlan.find((item) => item.command === command)!
                .stage,
            }
          : {}),
        command,
        status:
          exitCode === undefined
            ? "failed"
            : exitCode === 0
              ? "passed"
              : "failed",
        ...(exitCode === undefined ? {} : { exitCode }),
        summary:
          typeof output?.output === "string"
            ? output.output.slice(0, MODEL_EXECUTION_TEXT_LIMIT)
            : result.error,
        ...(executionFailed && typeof output?.output === "string"
          ? { failurePaths: extractVerificationFailurePaths(output.output) }
          : {}),
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
    }
    if (!result.ok && result.code) {
      if (result.code === lastErrorCode) repeatedErrorCount += 1;
      else {
        lastErrorCode = result.code;
        repeatedErrorCount = 1;
      }
    } else if (result.ok) {
      lastErrorCode = undefined;
      repeatedErrorCount = 0;
    }
    persistLedger();
    options.trace?.record({
      taskId: task.id,
      type: "tool.observed",
      phase: ledger.phase,
      data: {
        tool: call.name,
        ok: result.ok,
        code: result.code,
        recoverable: result.recoverable,
        durationMs: result.durationMs,
      },
    });
    logger?.debug("agent.tool.observed", {
      callId: call.id,
      tool: call.name,
      ...summarizeToolResult(result),
      repeatedErrorCount,
    });
  };

  const reviewFinalDiff = async (): Promise<boolean> => {
    if (finalReviewState !== undefined) return finalReviewState;
    finalReviewState =
      mode !== "coding" ||
      !mutated ||
      (options.reviewFinalDiff
        ? await options.reviewFinalDiff(task, ledger)
        : verificationRan);
    if (finalReviewState && mode === "coding" && mutated) {
      recordTaskAction(ledger, {
        id: `${task.id}:final-review`,
        kind: "review",
        target: "GitDiff",
        status: "succeeded",
        completedAt: new Date().toISOString(),
        summary: "The host performed the final read-only diff review.",
      });
      addTaskEvidence(ledger, {
        id: `${task.id}:final-review-evidence`,
        kind: "git",
        source: "GitDiff",
        summary: "The final workspace diff was inspected before completion.",
        relevance: 1,
        freshness: 1,
      });
      persistLedger();
    }
    return finalReviewState;
  };

  const verifySuccessCriteria = async (): Promise<{
    ready: boolean;
    issues: string[];
    nextPaths: string[];
    nextActions: string[];
    satisfiedCriterionIds: string[];
  }> => {
    if (!explicitSuccessCriteria)
      return {
        ready: true,
        issues: [],
        nextPaths: [],
        nextActions: [],
        satisfiedCriterionIds: [],
      };
    if (!options.verifySuccessCriteria)
      return {
        ready: false,
        issues: [
          "No host-owned success-criteria verifier is configured for this coding task.",
        ],
        nextPaths: [],
        nextActions: [],
        satisfiedCriterionIds: [],
      };

    let verification: SuccessCriteriaVerification;
    try {
      verification = await options.verifySuccessCriteria(task, ledger);
    } catch (error) {
      return {
        ready: false,
        issues: [
          `Success-criteria verification failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ],
        nextPaths: [],
        nextActions: [],
        satisfiedCriterionIds: [],
      };
    }
    const satisfiedCriterionIds = new Set(
      verification.satisfiedCriterionIds ??
        (verification.pass
          ? ledger.successCriteria.map((criterion) => criterion.id)
          : []),
    );
    for (const criterion of ledger.successCriteria)
      setTaskCriterion(
        ledger,
        criterion.id,
        satisfiedCriterionIds.has(criterion.id),
      );
    const missing = ledger.successCriteria
      .filter((criterion) => criterion.required && !criterion.satisfied)
      .map((criterion) => criterion.description);
    const issues = [
      ...(verification.issues ?? []),
      ...missing.map((criterion) => `Unsatisfied criterion: ${criterion}`),
    ];
    const inferredPaths = extractWorkspacePathHints([
      ...issues,
      ...missing,
      task.objective,
    ]);
    const nextPaths = (verification.nextPaths ?? inferredPaths)
      .map(normalizeWorkspacePath)
      .filter((value) => value.length > 0);
    const nextActions = (verification.nextActions ?? []).filter(
      (action) => action.trim().length > 0,
    );
    logger?.info("agent.criteria.evaluated", {
      pass: verification.pass,
      satisfiedCount: verification.satisfiedCriterionIds?.length ?? 0,
      missingCount: missing.length,
      issueCount: issues.length,
    });
    persistLedger();
    return {
      ready: verification.pass && missing.length === 0,
      issues:
        issues.length > 0 ? issues : ["Success criteria are not satisfied."],
      nextPaths: [...new Set(nextPaths)].slice(0, 6),
      nextActions: [...new Set(nextActions)].slice(0, 6),
      satisfiedCriterionIds: verification.satisfiedCriterionIds ?? [],
    };
  };

  const restoreRegressedMutations = async (criteria: {
    satisfiedCriterionIds: string[];
  }): Promise<{
    regressed: boolean;
    restored: boolean;
    notice?: string;
  }> => {
    const regressed = [...protectedCriterionIds].filter(
      (criterionId) => !criteria.satisfiedCriterionIds.includes(criterionId),
    );
    if (regressed.length === 0) return { regressed: false, restored: false };
    if (!checkpointId || pendingMutations.length === 0)
      return {
        regressed: true,
        restored: false,
        notice:
          "A previously satisfied criterion regressed, but the active mutation checkpoint is unavailable.",
      };

    const context = await options.createExecutionContext(task);
    if (!context.checkpoint)
      return {
        regressed: true,
        restored: false,
        notice:
          "A previously satisfied criterion regressed, but the active checkpoint service is unavailable.",
      };
    if (logger) context.logger = logger;
    const mutationsToRestore = [...pendingMutations]
      .reverse()
      .filter((mutation) =>
        mutation.protectedCriterionIds.some((criterionId) =>
          regressed.includes(criterionId),
        ),
      );
    if (mutationsToRestore.length === 0)
      return {
        regressed: true,
        restored: false,
        notice:
          "A previously satisfied criterion regressed, but no post-satisfaction mutation can be restored safely.",
      };
    for (const mutation of mutationsToRestore) {
      const restored = await context.checkpoint.restoreMutation(
        checkpointId,
        mutation.before,
        mutation.after.contentHash,
      );
      if (!restored)
        return {
          regressed: true,
          restored: false,
          notice:
            "A previously satisfied criterion regressed, and the latest file changed externally; no automatic rollback was attempted.",
        };
    }
    for (const mutation of mutationsToRestore) {
      const index = pendingMutations.indexOf(mutation);
      if (index >= 0) pendingMutations.splice(index, 1);
    }
    protectedCriterionIds.clear();
    return {
      regressed: true,
      restored: true,
      notice:
        "Host regression guard restored the last mutation because it invalidated a previously satisfied criterion.",
    };
  };

  const requiredFreshReadPath = (
    paths: readonly string[],
  ): string | undefined =>
    paths.find(
      (candidatePath) =>
        readRevisions.get(normalizeWorkspacePath(candidatePath)) !==
        mutationRevision,
    );

  const userWorkPreserved = async (): Promise<boolean> => {
    const check = options.checkUserWorkPreserved ?? checkpointPreservationCheck;
    return (await check?.(checkpointId)) ?? true;
  };

  const completionFor = async (turns: number): Promise<AgentRunResult> => {
    finalText = sanitizeAssistantTextForCompletion(
      finalText,
      "Changes were applied and verified by the host.",
    );
    const evidenceCount =
      initialEvidence +
      toolRuns.filter((run) => run.ok && toolMap.get(run.tool)?.risk === "read")
        .length;
    const verificationRequired =
      verificationPlan.length > 0 && mode === "coding";
    const verificationPerformed =
      verificationRequired &&
      verificationRan &&
      verifiedMutationRevision === mutationRevision &&
      verified;
    const successCriteriaSatisfied =
      !explicitSuccessCriteria ||
      ledger.successCriteria
        .filter((criterion) => criterion.required)
        .every((criterion) => criterion.satisfied);
    const finalReviewPerformed = await reviewFinalDiff();
    const preserved = await userWorkPreserved();
    const completion = evaluateCompletionGate({
      mode,
      objectiveSatisfied:
        finalText.trim().length > 0 && (mode !== "coding" || mutated),
      successCriteriaSatisfied,
      evidenceCount,
      evidence: ledger.evidence,
      mutationOccurred: mutated,
      verificationRequired,
      verificationPerformed,
      verificationPassed: verificationPerformed,
      finalReviewPerformed,
      unresolvedBlockers,
      userWorkPreserved: preserved,
    });
    logger?.info("agent.completion.evaluated", {
      canComplete: completion.canComplete,
      verified: completion.canComplete,
      turns,
      evidenceCount,
      filesRead: ledger.filesRead.length,
      filesChanged: ledger.filesChanged.length,
      verificationRuns: ledger.verificationRuns.length,
      reasonCount: completion.reasons.length,
    });
    return {
      text: finalText,
      verified: completion.canComplete,
      status: completion.canComplete ? "completed" : "blocked",
      completion,
      evidenceCount,
      ledger,
      turns,
      toolRuns,
      messages,
    };
  };

  const cancellationResult = async (turns: number): Promise<AgentRunResult> => {
    const partial = await completionFor(turns);
    const completion = {
      ...partial.completion,
      reasons: [...partial.completion.reasons, "Task was cancelled."],
    };
    transitionPhase(ledger, "cancelled", loopOptions);
    persistLedger();
    options.trace?.record({
      taskId: task.id,
      type: "task.cancelled",
      phase: ledger.phase,
    });
    const result: AgentRunResult = {
      ...partial,
      status: "cancelled",
      verified: false,
      completion,
    };
    emit(loopOptions, { type: "task.cancelled", error: "Task cancelled." });
    return result;
  };

  const failureResult = async (
    turns: number,
    message: string,
    failure?: ProviderFailure,
  ): Promise<AgentRunResult> => {
    unresolvedBlockers = Math.max(1, unresolvedBlockers);
    addTaskBlocker(ledger, {
      id: `${task.id}:failure:${turns}`,
      summary: message,
      recoverable: false,
    });
    finalText = finalText || message;
    const partial = await completionFor(turns);
    const completion = {
      ...partial.completion,
      reasons: [...partial.completion.reasons, message],
    };
    if (!terminalPhase(ledger.phase)) {
      transitionPhase(ledger, "failed", loopOptions);
      persistLedger();
    }
    options.trace?.record({
      taskId: task.id,
      type: "task.failed",
      phase: ledger.phase,
      data: { message },
    });
    const result: AgentRunResult = {
      ...partial,
      status: "failed",
      verified: false,
      ...(failure ? { failure } : {}),
      completion,
    };
    emit(loopOptions, { type: "task.failed", error: message });
    return result;
  };

  const finish = async (turns: number): Promise<AgentRunResult> => {
    if (ledger.phase !== "review") {
      transitionPhase(ledger, "review", loopOptions);
      persistLedger();
    }
    const preserved = await userWorkPreserved();
    const finalReviewPerformed = await reviewFinalDiff();
    const criteria = await verifySuccessCriteria();
    if (!criteria.ready) {
      unresolvedBlockers = Math.max(1, unresolvedBlockers);
      addTaskBlocker(ledger, {
        id: `${task.id}:success-criteria`,
        summary: criteria.issues.join(" "),
        recoverable: false,
      });
      persistLedger();
    }
    const independent = options.independentVerifier
      ? await options.independentVerifier(task, ledger)
      : independentlyVerifyTask({
          objective: task.objective,
          mode,
          ledger,
          verificationRequired: Boolean(
            verificationPlan.length > 0 && mode === "coding",
          ),
          verificationCommands: verificationPlan,
          finalReviewPerformed,
          userWorkPreserved: preserved,
        });
    if (!independent.pass) {
      unresolvedBlockers = Math.max(1, unresolvedBlockers);
      for (const issue of independent.issues)
        addTaskBlocker(ledger, {
          id: `${task.id}:verification:${issue.code}`,
          summary: issue.message,
          recoverable: false,
        });
      persistLedger();
    }
    const result = await completionFor(turns);
    if (result.status === "completed") {
      syncTargetPlan([]);
      if (updateTaskPlanStep(ledger, "step-verify", "done")) emitPlan();
      transitionPhase(ledger, "complete", loopOptions);
      persistLedger();
      emit(loopOptions, { type: "task.completed", result });
      options.trace?.record({
        taskId: task.id,
        type: "task.completed",
        phase: ledger.phase,
        data: {
          turns,
          evidenceCount: result.evidenceCount,
          toolRuns: result.toolRuns.length,
        },
      });
    } else {
      if (updateTaskPlanStep(ledger, "step-verify", "failed")) emitPlan();
      transitionPhase(ledger, "blocked", loopOptions);
      persistLedger();
      emit(loopOptions, {
        type: "task.blocked",
        error: `Completion blocked: ${result.completion.reasons.join("; ")}`,
      });
      options.trace?.record({
        taskId: task.id,
        type: "task.blocked",
        phase: ledger.phase,
        data: { reasons: result.completion.reasons },
      });
    }
    return result;
  };

  for (let turn = 1; turn <= maxTurns; turn += 1) {
    if (signal.aborted) return await cancellationResult(turn - 1);
    const turnToolChoice = forceNoToolsOnNextTurn
      ? "none"
      : (options.toolChoice ?? "auto");
    forceNoToolsOnNextTurn = false;
    const contextBudgetChars = task.contextBudgetChars ?? 50_000;
    if (
      messages.reduce(
        (total, message) => total + message.content.length + 80,
        0,
      ) > contextBudgetChars
    ) {
      const compacted = compactTaskContext(
        ledger,
        messages,
        contextBudgetChars,
      );
      messages.splice(0, messages.length, ...compacted.messages);
    }
    const assistantTextParts: string[] = [];
    options.trace?.record({
      taskId: task.id,
      type: "turn.started",
      phase: ledger.phase,
      data: {
        turn,
        messageCount: messages.length,
        toolChoice: turnToolChoice,
      },
    });
    logger?.info("agent.turn.started", {
      turn,
      messageCount: messages.length,
      toolChoice: turnToolChoice,
      contextChars: messages.reduce(
        (total, message) => total + message.content.length,
        0,
      ),
    });
    const toolCalls: ToolCall[] = [];
    let streamBuffer = "";
    let sawText = false;
    let reasoningChars = 0;
    let lastReasoningNotice = 0;
    let done = false;
    const presentAssistantText = (text: string): void => {
      if (!text) return;
      assistantTextParts.push(text);
      emit(loopOptions, { type: "assistant.delta", text });
    };
    try {
      for await (const event of options.provider.stream(
        {
          modelId: providerModelId(task),
          messages,
          temperature,
          maxOutputTokens,
          ...(options.tools.length > 0
            ? {
                tools: options.tools.map(toolSchema),
                toolChoice: turnToolChoice,
              }
            : {}),
          stream: true,
        },
        signal,
      )) {
        if (event.type === "text.delta") {
          sawText = true;
          streamBuffer += event.text;
          const candidateStart = findTextToolCandidate(streamBuffer);
          if (candidateStart >= 0) {
            presentAssistantText(streamBuffer.slice(0, candidateStart));
            streamBuffer = streamBuffer.slice(candidateStart);
          } else {
            const safeLength = Math.max(
              0,
              streamBuffer.length - TEXT_TOOL_PREFIX_TAIL,
            );
            if (safeLength > 0) {
              presentAssistantText(streamBuffer.slice(0, safeLength));
              streamBuffer = streamBuffer.slice(safeLength);
            }
          }
        } else if (event.type === "reasoning.delta") {
          // Some local runtimes expose a reasoning channel. Keep its content
          // private, but expose bounded progress metadata so the UI can say
          // exactly why it is waiting instead of pretending the model is idle.
          reasoningChars += event.text.length;
          if (reasoningChars - lastReasoningNotice >= 160) {
            lastReasoningNotice = reasoningChars;
            emit(loopOptions, {
              type: "model.progress",
              phase: "reasoning",
              chars: reasoningChars,
              streaming: true,
            });
          }
        } else if (event.type === "tool.call") {
          toolCalls.push(event.call);
        } else if (event.type === "error") {
          const message = failureMessage(event);
          if (signal.aborted || event.error.code === "CANCELLED")
            return await cancellationResult(turn);
          return await failureResult(turn, message, event.error);
        } else if (event.type === "done") {
          done = true;
        }
      }
      if (reasoningChars > lastReasoningNotice) {
        emit(loopOptions, {
          type: "model.progress",
          phase: "reasoning",
          chars: reasoningChars,
          streaming: false,
        });
      }
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      )
        return await cancellationResult(turn);
      const failure = classifyProviderFailure(options.provider, error);
      return await failureResult(
        turn,
        providerFailureMessage(failure),
        failure,
      );
    }
    if (!done && !sawText && toolCalls.length === 0)
      return await failureResult(turn, "Provider ended without a response.");
    const recoveredCalls = recoverTextToolCalls(streamBuffer, turn);
    const recoveredTextCall = Boolean(recoveredCalls?.length);
    if (recoveredCalls) {
      logger?.info("agent.tool.envelope_recovered", {
        turn,
        callCount: recoveredCalls.length,
      });
      for (const call of recoveredCalls) {
        if (!toolCalls.some((existing) => existing.id === call.id)) {
          toolCalls.push(call);
        }
      }
    } else {
      if (TOOL_TEXT_SHAPE.test(streamBuffer)) {
        logger?.warn("agent.tool_text.suppressed", {
          turn,
          reason: "unrecognized_or_unsafe_tool_shaped_text",
        });
      } else presentAssistantText(streamBuffer);
    }
    const presentedAssistantText = assistantTextParts.join("");
    finalText = presentedAssistantText || finalText;
    logger?.debug("agent.model.response", {
      turn,
      done,
      textLength: presentedAssistantText.length,
      toolCallCount: toolCalls.length,
      recoveredTextCall,
    });

    if (toolCalls.length > 0) {
      const signature = [...toolCalls]
        .map((call) => `${call.name}:${call.arguments}`)
        .sort()
        .join("|");
      if (signature === lastCallSignature) {
        repeatedCallCount += 1;
      } else {
        lastCallSignature = signature;
        repeatedCallCount = 1;
      }
      if (repeatedCallCount >= NON_PROGRESS_LIMIT) {
        logger?.warn("agent.non_progress.detected", {
          reason: "repeated_tool_call",
          repeatedCount: repeatedCallCount,
          tools: toolCalls.map((call) => call.name),
        });
        const message = `Agent loop made no progress: the same tool call (${toolCalls
          .map((call) => call.name)
          .join(", ")}) repeated ${repeatedCallCount} times in a row.`;
        unresolvedBlockers = 1;
        finalText = message;
        return await finish(turn);
      }
    }

    const signature =
      toolCalls.length > 0
        ? [...toolCalls]
            .map((call) => `${call.name}:${call.arguments}`)
            .sort()
            .join("|")
        : undefined;
    const repeatedTextualCall =
      recoveredTextCall &&
      signature !== undefined &&
      signature === lastTextualCallSignature;
    lastTextualCallSignature = recoveredTextCall ? signature : undefined;

    // Defense in depth: this turn does not permit tool use (TurnPolicy
    // resolved toolChoice "none"). Refuse any attempted tool call outright
    // rather than executing it, even if the model ignored tool_choice.
    // Tools follow user intent; a misbehaving model does not get to
    // override that by emitting a tool call anyway.
    if (toolCalls.length > 0 && turnToolChoice === "none") {
      messages.push({ role: "assistant", content: presentedAssistantText });
      finalText =
        presentedAssistantText ||
        "This turn does not use workspace tools, so I skipped the requested action.";
      return await finish(turn);
    }

    if (repeatedTextualCall && toolCalls.length > 0) {
      messages.push({
        role: "assistant",
        content: presentedAssistantText,
        toolCalls: [...toolCalls],
      });
      for (const call of toolCalls) {
        const tool = toolMap.get(call.name);
        let input: unknown = {};
        try {
          input = parseToolInput(call);
        } catch {
          input = {};
        }
        const result: ToolResult = {
          tool: call.name,
          ok: false,
          error:
            "The model repeated a textual tool call that already produced an observation; the duplicate was not executed.",
          code: "CONFLICT",
          recoverable: true,
          suggestedAction:
            "Use the previous tool result and answer without another tool call.",
          durationMs: 0,
        };
        emit(loopOptions, {
          type: "tool.started",
          callId: call.id,
          tool: call.name,
          input,
          ...(tool?.risk ? { risk: tool.risk } : {}),
        });
        toolRuns.push(result);
        observeTool(call, tool, result, input);
        messages.push({
          role: "tool",
          toolCallId: call.id,
          content: toolMessageContent(result),
        });
        emit(loopOptions, {
          type: "tool.finished",
          callId: call.id,
          tool: call.name,
          result,
        });
      }
      forceNoToolsOnNextTurn = true;
      transitionPhase(ledger, "reflect", loopOptions);
      persistLedger();
      continue;
    }

    messages.push({
      role: "assistant",
      content: presentedAssistantText,
      ...(toolCalls.length > 0 ? { toolCalls: [...toolCalls] } : {}),
    });

    if (toolCalls.length > 0) {
      noActionCount = 0;
      for (const call of toolCalls) {
        transitionPhase(ledger, "act", loopOptions);
        const tool = toolMap.get(call.name);
        if (!tool) {
          let input: unknown = {};
          try {
            input = parseToolInput(call);
          } catch {
            input = {};
          }
          const result: ToolResult = {
            tool: call.name,
            ok: false,
            error: "Unknown tool",
            code: "PERMISSION_DENIED",
            recoverable: false,
            suggestedAction:
              "Use only tools exposed for the current turn policy.",
            durationMs: 0,
          };
          emit(loopOptions, {
            type: "tool.started",
            callId: call.id,
            tool: call.name,
            input,
          });
          toolRuns.push(result);
          observeTool(call, tool, result, input);
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: toolMessageContent(result),
          });
          emit(loopOptions, {
            type: "tool.finished",
            callId: call.id,
            tool: call.name,
            result,
          });
          continue;
        }
        let input: unknown = {};
        try {
          input = parseToolInput(call);
        } catch (error) {
          if (
            signal.aborted ||
            (error instanceof DOMException && error.name === "AbortError")
          )
            return await cancellationResult(turn);
          const result: ToolResult = {
            tool: call.name,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            ...toolErrorFields(error),
            durationMs: 0,
          };
          toolRuns.push(result);
          observeTool(call, tool, result, input);
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: toolMessageContent(result),
          });
          emit(loopOptions, {
            type: "tool.started",
            callId: call.id,
            tool: call.name,
            input,
            risk: tool.risk,
          });
          emit(loopOptions, {
            type: "tool.finished",
            callId: call.id,
            tool: call.name,
            result,
          });
          continue;
        }
        emit(loopOptions, {
          type: "tool.started",
          callId: call.id,
          tool: call.name,
          input,
          risk: tool.risk,
        });
        try {
          input = validateToolInput(tool, input);
        } catch (error) {
          const result: ToolResult = {
            tool: call.name,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            ...toolErrorFields(error),
            durationMs: 0,
          };
          toolRuns.push(result);
          observeTool(call, tool, result, input);
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: toolMessageContent(result),
          });
          emit(loopOptions, {
            type: "tool.finished",
            callId: call.id,
            tool: call.name,
            result,
          });
          continue;
        }
        const started = performance.now();
        let mutationBefore: FileMutationSnapshot | undefined;
        let mutationProtectedCriterionIds: string[] = [];
        try {
          const requestedPath =
            typeof input === "object" &&
            input !== null &&
            "path" in input &&
            typeof input.path === "string"
              ? normalizeWorkspacePath(input.path)
              : undefined;
          if (
            (tool.risk === "write" ||
              tool.risk === "destructive" ||
              (tool.name === "ReadFile" && criteriaFeedbackActive)) &&
            criteriaWritePaths.length > 0 &&
            requestedPath &&
            !criteriaWritePaths.includes(requestedPath)
          )
            throw new ToolError(
              "CONFLICT",
              "The write targets " +
                requestedPath +
                ", but the current host criteria target " +
                criteriaWritePaths.join(", ") +
                ".",
              {
                path: requestedPath,
                recoverable: true,
                suggestedAction:
                  "Read or edit one of the current host criteria target files: " +
                  criteriaWritePaths.join(", ") +
                  ".",
              },
            );
          if (
            tool.name === "EditFile" &&
            criteriaFeedbackActive &&
            requestedPath &&
            readRevisions.get(requestedPath) !== mutationRevision
          )
            throw new ToolError(
              "CONFLICT",
              "EditFile requires a fresh ReadFile observation after the latest host feedback or mutation.",
              {
                path: requestedPath,
                recoverable: true,
                suggestedAction:
                  "Read the current file with ReadFile, then recompute the exact edit and retry.",
              },
            );
          if (
            tool.name === "EditFile" &&
            requestedPath &&
            rejectedEditPaths.has(requestedPath)
          )
            throw new ToolError(
              "CONFLICT",
              "EditFile was rejected for this path; a fresh ReadFile observation is required before retrying.",
              {
                path: requestedPath,
                recoverable: true,
                suggestedAction:
                  "Read the current file again, then construct a new exact edit from that observation.",
              },
            );
          const context = await options.createExecutionContext(task);
          if (logger) context.logger = logger;
          if (context.checkpoint)
            checkpointPreservationCheck = async (activeCheckpoint) =>
              activeCheckpoint
                ? context.checkpoint!.isPreserved(activeCheckpoint)
                : true;
          if (checkpointId) context.checkpointId = checkpointId;
          if (
            (tool.risk === "write" || tool.risk === "destructive") &&
            !checkpointId
          ) {
            if (!context.checkpoint)
              throw new Error("Mutation tool requires checkpoint service");
            const candidatePath =
              typeof input === "object" &&
              input !== null &&
              "path" in input &&
              typeof input.path === "string"
                ? input.path
                : undefined;
            if (!candidatePath)
              throw new Error(
                "Mutation tool requires a path for checkpointing",
              );
            checkpointId = await context.checkpoint.create(task.id, [
              candidatePath,
            ]);
            emit(loopOptions, { type: "checkpoint.created", id: checkpointId });
            context.checkpointId = checkpointId;
          } else if (
            (tool.risk === "write" || tool.risk === "destructive") &&
            checkpointId &&
            context.checkpoint
          ) {
            const candidatePath =
              typeof input === "object" &&
              input !== null &&
              "path" in input &&
              typeof input.path === "string"
                ? input.path
                : undefined;
            if (candidatePath)
              await context.checkpoint.capture(checkpointId, [candidatePath]);
          }
          // Live shell/test tail (docs/ui-chat-v2 §36): only Shell/RunTests
          // read this, everything else silently ignores it, unchanged.
          if (
            (tool.risk === "write" || tool.risk === "destructive") &&
            context.checkpoint &&
            checkpointId
          ) {
            const candidatePath =
              typeof input === "object" &&
              input !== null &&
              "path" in input &&
              typeof input.path === "string"
                ? input.path
                : undefined;
            if (candidatePath) {
              mutationBefore = await context.checkpoint.snapshot(candidatePath);
              mutationProtectedCriterionIds = ledger.successCriteria
                .filter(
                  (criterion) => criterion.required && criterion.satisfied,
                )
                .map((criterion) => criterion.id);
              for (const criterionId of mutationProtectedCriterionIds)
                protectedCriterionIds.add(criterionId);
            }
          }
          context.onOutput = (chunk) =>
            emit(loopOptions, {
              type: "tool.output",
              callId: call.id,
              tool: call.name,
              ...chunk,
            });
          const output = await tool.execute(input, context);
          const execution = executionFailure(call.name, input, output);
          const result: ToolResult = {
            tool: call.name,
            ...execution,
            output,
            durationMs: Math.round(performance.now() - started),
          };
          if (
            (tool.risk === "write" || tool.risk === "destructive") &&
            result.ok
          ) {
            mutated = true;
            mutationRevision += 1;
            if (mutationBefore && context.checkpoint) {
              const mutationAfter = await context.checkpoint.snapshot(
                mutationBefore.path,
              );
              pendingMutations.push({
                before: mutationBefore,
                after: mutationAfter,
                protectedCriterionIds: mutationProtectedCriterionIds,
              });
            }
          }
          toolRuns.push(result);
          observeTool(call, tool, result, input);
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: toolMessageContent(result),
          });
          emit(loopOptions, {
            type: "tool.finished",
            callId: call.id,
            tool: call.name,
            result,
          });
        } catch (error) {
          const result: ToolResult = {
            tool: call.name,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            ...toolErrorFields(error),
            durationMs: Math.round(performance.now() - started),
          };
          toolRuns.push(result);
          observeTool(call, tool, result, input);
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: toolMessageContent(result),
          });
          emit(loopOptions, {
            type: "tool.finished",
            callId: call.id,
            tool: call.name,
            result,
          });
        }
      }
      transitionPhase(ledger, "reflect", loopOptions);
      persistLedger();
      if (repeatedErrorCount >= NON_PROGRESS_LIMIT) {
        logger?.warn("agent.non_progress.detected", {
          reason: "repeated_tool_error",
          repeatedCount: repeatedErrorCount,
          code: lastErrorCode,
        });
        unresolvedBlockers = 1;
        finalText = `Agent made no progress after ${repeatedErrorCount} ${lastErrorCode ?? "recoverable"} errors.`;
        return await finish(turn);
      }
      if (
        !mutated ||
        verificationPlan.length === 0 ||
        mutationRevision === verifiedMutationRevision
      )
        continue;
    }

    const verificationNeeded =
      mutated &&
      verificationPlan.length > 0 &&
      mutationRevision !== verifiedMutationRevision;
    if (verificationNeeded) {
      if (updateTaskPlanStep(ledger, "step-verify", "active")) emitPlan();
      transitionPhase(ledger, "verify", loopOptions);
      persistLedger();
      verificationRan = true;
      verified = true;
      verifiedMutationRevision = mutationRevision;
      const context = await options.createExecutionContext(task);
      if (logger) context.logger = logger;
      for (const planned of verificationPlan) {
        const verificationId = `${task.id}:verification:${ledger.verificationRuns.length + 1}`;
        const verificationStartedAt = new Date().toISOString();
        recordVerificationRun(ledger, {
          id: verificationId,
          stage: planned.stage,
          command: planned.command,
          status: "running",
          startedAt: verificationStartedAt,
        });
        persistLedger();
        emit(loopOptions, {
          type: "verification.started",
          id: verificationId,
          ...(planned.stage ? { stage: planned.stage } : {}),
          command: planned.command,
        });
        context.onOutput = (chunk) =>
          emit(loopOptions, {
            type: "tool.output",
            callId: verificationId,
            tool: "RunTests",
            ...chunk,
          });

        let exitCode = 1;
        let output = "";
        let passed = false;
        try {
          const verification = await runTestsTool.execute(
            runTestsTool.validate({ command: planned.command }),
            context,
          );
          exitCode = verification.exitCode;
          output = verification.output;
          passed = exitCode === 0;
        } catch (error) {
          if (
            signal.aborted ||
            (error instanceof DOMException && error.name === "AbortError")
          )
            return await cancellationResult(turn);
          output = error instanceof Error ? error.message : String(error);
        }
        verified = verified && passed;
        recordVerificationRun(ledger, {
          id: verificationId,
          stage: planned.stage,
          command: planned.command,
          status: passed ? "passed" : "failed",
          exitCode,
          summary: output,
          ...(passed
            ? {}
            : { failurePaths: extractVerificationFailurePaths(output) }),
          startedAt: verificationStartedAt,
          completedAt: new Date().toISOString(),
        });
        persistLedger();
        emit(loopOptions, {
          type: "verification.finished",
          stage: planned.stage,
          command: planned.command,
          exitCode,
          output,
        });
        messages.push({
          role: "tool",
          toolCallId: `localcode-verification-${planned.stage}`,
          content: JSON.stringify({
            tool: "RunTests",
            stage: planned.stage,
            command: planned.command,
            ok: passed,
            exitCode,
            output:
              output.length > MODEL_EXECUTION_TEXT_LIMIT
                ? `${output.slice(0, MODEL_EXECUTION_TEXT_LIMIT)}\n[host output truncated for model context]`
                : output,
          }),
        });
        if (!passed) break;
      }
      transitionPhase(ledger, "reflect", loopOptions);
      persistLedger();
      if (explicitSuccessCriteria) {
        const criteria = await verifySuccessCriteria();
        const regression = await restoreRegressedMutations(criteria);
        if (regression.regressed && !regression.restored) {
          unresolvedBlockers = 1;
          finalText =
            regression.notice ??
            "A criteria regression could not be restored safely.";
          return await finish(turn);
        }
        if (!regression.regressed) {
          pendingMutations.length = 0;
          protectedCriterionIds.clear();
        } else {
          verified = false;
          verifiedMutationRevision = -1;
        }
        if (verified && criteria.ready && !regression.regressed) {
          syncTargetPlan([]);
          if (updateTaskPlanStep(ledger, "step-verify", "done")) emitPlan();
          criteriaWritePaths = [];
          criteriaFeedbackActive = false;
          finalText =
            finalText.trim() ||
            "Changes were applied and verified by host verification.";
          logger?.info("agent.host_completion.short_circuit", {
            turn,
            reason: "verification_and_success_criteria_passed",
          });
          return await finish(turn);
        }
        criteriaFeedbackActive = true;
        criteriaWritePaths = criteria.nextPaths;
        syncTargetPlan(criteria.nextPaths);
        const pendingCriteria = ledger.successCriteria
          .filter((criterion) => criterion.required && !criterion.satisfied)
          .map((criterion) => criterion.description);
        const protectedCriteria = ledger.successCriteria
          .filter((criterion) => criterion.required && criterion.satisfied)
          .map((criterion) => criterion.description);
        const relevantPaths = extractWorkspacePathHints([
          ...criteria.issues,
          ...pendingCriteria,
        ]);
        const nextActions = criteria.nextActions;
        const freshReadPath = requiredFreshReadPath(criteria.nextPaths);
        messages.push({
          role: "user",
          content:
            (regression.notice ? regression.notice + " " : "") +
            (verified
              ? "Host verification passed, but the coding objective is not complete."
              : "Host verification did not pass, and the coding objective is not complete.") +
            " Host criteria still missing: " +
            criteria.issues.slice(0, 6).join(" ") +
            (protectedCriteria.length > 0
              ? " Already satisfied criteria are protected; do not undo them: " +
                protectedCriteria.slice(0, 6).join(" ") +
                "."
              : "") +
            (nextActions.length > 0
              ? " Host next actions: " + nextActions.join(" ") + "."
              : "") +
            (freshReadPath
              ? ` Your next tool MUST be ReadFile on ${freshReadPath} before any EditFile or WriteFile.`
              : "") +
            (relevantPaths.length > 0
              ? " Next relevant files to inspect before editing: " +
                relevantPaths.join(", ") +
                "."
              : "") +
            " Execute exactly one next workspace tool that addresses those criteria; do not narrate.",
        });
      }
      continue;
    }

    const criteria =
      mode === "coding" && explicitSuccessCriteria
        ? await verifySuccessCriteria()
        : undefined;
    const codingRequiresAction =
      mode === "coding" &&
      (!mutated ||
        (verificationPlan.length > 0 &&
          mutationRevision !== verifiedMutationRevision) ||
        (verificationRan && !verified) ||
        criteria?.ready === false);
    if (codingRequiresAction) {
      noActionCount += 1;
      if (noActionCount < NON_PROGRESS_LIMIT) {
        // A prose-only assistant turn is a host observation, not a valid
        // provider continuation. Keeping it in the next prompt makes some
        // local templates imitate the prose instead of emitting the next
        // tool request. The text was already emitted to the UI; remove only
        // this non-action message from the model context before retrying.
        const lastMessage = messages[messages.length - 1];
        if (
          lastMessage?.role === "assistant" &&
          lastMessage.content === presentedAssistantText &&
          !lastMessage.toolCalls
        )
          messages.pop();
        transitionPhase(ledger, "reflect", loopOptions);
        const timestamp = new Date().toISOString();
        recordTaskAction(ledger, {
          id: `${task.id}:no-action:${noActionCount}`,
          kind: "review",
          target: "model-turn",
          status: "failed",
          startedAt: timestamp,
          completedAt: timestamp,
          summary:
            "The model produced prose without executing a workspace tool for a coding task.",
        });
        persistLedger();
        const hasReadEvidence = ledger.filesRead.length > 0;
        const criteriaFeedback = criteria?.issues.length
          ? ` Host verification: ${criteria.issues.slice(0, 4).join(" ")}`
          : "";
        const criteriaActions = criteria?.nextActions.length
          ? ` Host next actions: ${criteria.nextActions.slice(0, 4).join(" ")}`
          : "";
        const freshReadPath = criteria
          ? requiredFreshReadPath(criteria.nextPaths)
          : undefined;
        const freshReadFeedback = freshReadPath
          ? ` Your next tool MUST be ReadFile on ${freshReadPath} before any EditFile or WriteFile.`
          : "";
        const protectedCriteria = ledger.successCriteria
          .filter((criterion) => criterion.required && criterion.satisfied)
          .map((criterion) => criterion.description);
        const protectedFeedback =
          protectedCriteria.length > 0
            ? ` Already satisfied criteria are protected; do not undo them: ${protectedCriteria
                .slice(0, 4)
                .join(" ")}.`
            : "";
        messages.push({
          role: "user",
          content: hasReadEvidence
            ? "Host observation: relevant repository evidence is already available." +
              criteriaFeedback +
              criteriaActions +
              freshReadFeedback +
              protectedFeedback +
              " " +
              "Stop narrating and execute exactly one implementation workspace tool " +
              "now; use EditFile or WriteFile with valid arguments for the next " +
              "required change. Do not emit prose or tool-shaped JSON."
            : "Host observation: the previous assistant turn produced no workspace tool action." +
              criteriaFeedback +
              criteriaActions +
              freshReadFeedback +
              protectedFeedback +
              " " +
              "This coding task is not complete. Execute exactly one available workspace tool " +
              "now with valid arguments. Do not explain a future action or emit tool-shaped " +
              "JSON in prose. Continue only from repository evidence.",
        });
        continue;
      }
      unresolvedBlockers = 1;
      finalText =
        "The model produced no executable workspace action after bounded recovery attempts.";
      return await finish(turn);
    }
    noActionCount = 0;

    return await finish(turn);
  }

  unresolvedBlockers = 1;
  finalText =
    finalText ||
    `Agent stopped after reaching the maximum turn budget (${maxTurns}).`;
  return await finish(maxTurns);
}
