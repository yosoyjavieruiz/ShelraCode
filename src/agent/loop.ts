import path from "node:path";
import type {
  NormalizedMessage,
  ProviderFailure,
  ProviderEvent,
  ToolCall,
} from "../providers/types.js";
import type { FileMutationSnapshot } from "../checkpoint/checkpoint.js";
import { runTestsTool } from "../tools/workspace.js";
import { ToolError, toolErrorDetails } from "../tools/errors.js";
import type { ToolDefinition, ToolResult, ToolRisk } from "../tools/types.js";
import { evaluateCompletionGate } from "./completion-gate.js";
import { independentlyVerifyTask } from "./verifier.js";
import { assessObjectiveProof } from "./objective-proof.js";
import { compactTaskContext } from "./compaction.js";
import {
  MAX_TOOL_CALLS_PER_RESPONSE,
  recoverTextToolCalls,
} from "./tool-envelope.js";
import { normalizeProviderEvents } from "../providers/stream-normalizer.js";
import {
  compileContextPacket,
  compileDecisionContext,
  renderContextPacket,
} from "../context/context-compiler.js";
import { extractObjectivePaths } from "./objective-review.js";
import { evaluateMutationEvidenceGate } from "./context-gate.js";
import {
  appendModelPlanToGraph,
  compileTaskGraph,
  createModelPlanningGraph,
  type TaskNode,
  setTaskNodeStatus,
} from "./task-graph.js";
export { recoverTextToolCalls } from "./tool-envelope.js";
import { normalizeVerificationPlan } from "./verification-plan.js";
import { isNeverRemotePath, scanSecrets } from "../privacy/policy.js";
import type { TurnMode } from "./turn-policy.js";
import {
  requiresModelPlan,
  selectExecutionProfile,
} from "./execution-profile.js";
import { cloneTaskContract, compileTaskContract } from "./task-contract.js";
import {
  requestModelPlan,
  normalizeAppendOnlyRecoveryPlanProposal,
  normalizeRecoveryPlanProposal,
  type PlanNodeStatus,
  type PlanModelResult,
  type PlanProposal,
} from "./planner.js";
import { createRecoveryContract, type RecoveryContract } from "./recovery.js";
import {
  addTaskEvidence,
  addTaskBlocker,
  createTaskLedger,
  recordPlanRevision,
  recordRecoveryContract,
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
  try {
    if (recoverTextToolCalls(trimmed, 0)?.length) return fallback;
  } catch (error) {
    if (error instanceof ToolError && error.code === "TOOL_BATCH_TOO_LARGE")
      return fallback;
    throw error;
  }
  return TOOL_TEXT_SHAPE.test(trimmed) ? fallback : trimmed;
}

function summarizeFailure(message: string): string {
  const normalized = message.replace(/\s+/gu, " ").trim();
  return normalized.length <= 500
    ? normalized
    : `${normalized.slice(0, 500)}â€¦[truncated]`;
}

function isToolShapedAssistantText(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  try {
    if (recoverTextToolCalls(trimmed, 0)?.length) return true;
  } catch (error) {
    // A malformed tool envelope is still not a semantic decision. Let the
    // bounded no-action recovery explain the protocol boundary to the model.
    if (error instanceof ToolError) return true;
    throw error;
  }
  return TOOL_TEXT_SHAPE.test(trimmed);
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

/**
 * A provider can emit a tool call whose argument stream is malformed. The
 * original call remains available to the ledger/error renderer, but it must
 * never be serialized back into the next provider request as invalid JSON.
 * Some OpenAI-compatible local servers reject that assistant message with a
 * generic 500, hiding the real recoverable tool-protocol error.
 */
function normalizeToolCallsForContinuation(
  calls: readonly ToolCall[],
): ToolCall[] {
  return calls.map((call) => {
    try {
      JSON.parse(call.arguments || "{}");
      return { ...call };
    } catch {
      return { ...call, arguments: "{}" };
    }
  });
}

function objectOutput(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

const MODEL_TOOL_TEXT_LIMIT = 8_000;
const MODEL_EXECUTION_TEXT_LIMIT = 4_000;

// Local OpenAI-compatible runtimes sometimes serialize a tool call as prose
// after receiving a tool error. The provider boundary quarantines that prose
// and reports MODEL_PROTOCOL_ERROR; allow a small, consecutive recovery
// window before treating a persistently incompatible model/runtime as fatal.
const MAX_MODEL_PROTOCOL_RECOVERIES = 2;

// After a staged target has been observed, keep the small model on one
// bounded mutation/verification decision instead of reopening discovery on
// every turn. A failed mutation explicitly reopens discovery for recovery.
const STAGED_MUTATION_TOOL_NAMES = new Set([
  "EditFile",
  "WriteFile",
  "DeleteFile",
]);

// Once the host has observed an existing target, a full-file WriteFile is not
// a valid next decision. Keeping it out of the schema is stronger than
// exposing it and hoping a small model remembers the PATH_EXISTS recovery
// message. DeleteFile is added only when the objective explicitly authorizes
// deletion; the permission boundary still applies as a second defense.
const STAGED_EXISTING_MUTATION_TOOL_NAMES = new Set(["EditFile"]);
const STAGED_EXISTING_DESTRUCTIVE_TOOL_NAMES = new Set([
  "EditFile",
  "DeleteFile",
]);

const STAGED_EDIT_RECOVERY_TOOL_NAMES = new Set(["ReadFile", "EditFile"]);

const STAGED_DISCOVERY_TOOL_NAMES = new Set([
  "ReadFile",
  "SearchText",
  "ListFiles",
  "GlobFiles",
]);

// A local model that sends an entire large file as oldText/newText is usually
// attempting a speculative rewrite, not a bounded edit. Reject it before the
// tool reaches the checkpoint so malformed wholesale rewrites cannot corrupt
// a source file. Smaller exact replacements remain unaffected.
const MAX_STAGED_FULL_REWRITE_CHARS = 12_000;

// A generic coding budget is too large for the first decision of a small
// reasoning model: it can spend the whole turn planning instead of taking the
// host-approved next action. Staged work gets an action-sized budget by phase;
// explicit task.maxOutputTokens remains authoritative for callers that need a
// different limit.
const STAGED_DISCOVERY_OUTPUT_TOKENS = 768;
const STAGED_MUTATION_OUTPUT_TOKENS = 1_536;

const MODEL_PLAN_READ_ONLY_TOOLS = new Set([
  "ListFiles",
  "GlobFiles",
  "SearchText",
  "ReadFile",
  "GitStatus",
  "GitDiff",
]);

// A plan node's allowed tools describe the semantic operation it intends to
// perform. Safe repository reads are enabling context for that operation,
// not a mutation outside the plan. Keep this set explicit so a node that
// allows WriteFile can still inspect the existing target without gaining
// Shell, tests, or another mutation primitive by implication.
const MODEL_PLAN_CONTEXT_TOOLS = new Set([
  "ListFiles",
  "GlobFiles",
  "SearchText",
  "ReadFile",
  "GitStatus",
  "GitDiff",
]);
const MODEL_PLAN_FILE_MUTATION_TOOLS = new Set([
  "EditFile",
  "WriteFile",
  "CreateFile",
  "DeleteFile",
  "ApplyPatch",
]);

function objectiveAuthorizesDeletion(objective: string): boolean {
  const normalized = objective.toLowerCase();
  if (
    /\b(?:do not|don't|never|avoid|without)\s+(?:delete|deleting|remove|removing|erase|erasing|borrar|eliminar)/u.test(
      normalized,
    )
  )
    return false;
  return /\b(?:delete|deleting|remove|removing|erase|erasing|borrar|eliminar)\b/u.test(
    normalized,
  );
}

function requiresSupportingStagedEvidence(
  objective: string,
  targetCount: number,
): boolean {
  if (targetCount < 2) return false;
  const normalized = objective.toLowerCase();
  return (
    objective.length > 120 ||
    /\b(?:refactor|restructure|migrate|debug|regression|architecture|review|refactoriza|migra|depura|arquitectura|revisa)\b/u.test(
      normalized,
    )
  );
}

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
      if (value.length > limit) {
        compacted[key] =
          `${value.slice(0, limit)}\n[host output truncated for model context]`;
        compacted[`${key}Truncated`] = true;
      } else compacted[key] = value;
    } else if (Array.isArray(value)) {
      compacted[key] = value.slice(0, 40);
      if (value.length > 40) compacted[`${key}Truncated`] = true;
    } else compacted[key] = value;
  }
  if (
    tool === "ReadFile" &&
    typeof fields.content === "string" &&
    fields.content.length > limit
  ) {
    // The tool result may be complete on disk while the model-facing message
    // is not. Treat the visible observation as truncated so the controller
    // does not expose EditFile against source text the model never received.
    compacted.truncated = true;
    compacted.continuationHint =
      "Use ReadFile with startLine/endLine for the missing range before editing.";
  }
  return compacted;
}

function modelVisibleReadWasTruncated(output: unknown): boolean {
  const fields = objectOutput(output);
  return (
    fields?.truncated === true ||
    (typeof fields?.content === "string" &&
      fields.content.length > MODEL_TOOL_TEXT_LIMIT)
  );
}

function redactSensitiveValue(value: unknown): unknown {
  if (typeof value === "string")
    return scanSecrets(value).length > 0
      ? "[REDACTED SENSITIVE TOOL OUTPUT]"
      : value;
  if (Array.isArray(value)) return value.map(redactSensitiveValue);
  if (typeof value === "object" && value !== null)
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        redactSensitiveValue(entry),
      ]),
    );
  return value;
}

function toolMessageContent(result: ToolResult, task?: AgentTask): string {
  const remote = task !== undefined && task.candidate.source !== "local";
  const outputFields = objectOutput(result.output);
  const outputPath =
    result.path ??
    (typeof outputFields?.path === "string" ? outputFields.path : undefined);
  const protectedPath =
    remote && outputPath !== undefined && isNeverRemotePath(outputPath);
  const safeResult = protectedPath
    ? {
        ...result,
        output: {
          path: outputPath,
          redacted: true,
          reason: "path is excluded from remote context by privacy policy",
        },
      }
    : remote && result.output !== undefined
      ? { ...result, output: redactSensitiveValue(result.output) }
      : result;
  const compactedOutput = compactToolOutput(safeResult.tool, safeResult.output);
  return JSON.stringify({
    ...safeResult,
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
  const windowsTextCommandHint =
    process.platform === "win32" &&
    /\b(?:head|tail|grep|sed|awk)\b/iu.test(command)
      ? " On Windows, use ReadFile/SearchText or a PowerShell equivalent instead of Unix-only text commands."
      : "";
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
        : `Inspect stderr and retry with a corrected command or narrower step.${windowsTextCommandHint}`,
  };
}

function isNonGitRepositoryFailure(
  toolName: string,
  result: ToolResult,
): boolean {
  return (
    (toolName === "GitStatus" || toolName === "GitDiff") &&
    result.ok === false &&
    result.code === "COMMAND_FAILED" &&
    /(?:not a git repository|no es un repositorio(?: de)? git)/iu.test(
      result.error ?? "",
    )
  );
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

function latestToolContinuation(
  messages: readonly NormalizedMessage[],
): NormalizedMessage[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const assistant = messages[index];
    if (assistant?.role !== "assistant" || !assistant.toolCalls?.length)
      continue;
    const continuation: NormalizedMessage[] = [assistant];
    for (let next = index + 1; next < messages.length; next += 1) {
      const message = messages[next];
      if (message?.role !== "tool") break;
      continuation.push(message);
    }
    return continuation.length > 1 ? continuation : [];
  }
  return [];
}

function mutationFailureKey(
  call: ToolCall,
  tool: ToolDefinition<unknown, unknown>,
  result: ToolResult,
  input: unknown,
): string {
  const pathValue =
    typeof input === "object" &&
    input !== null &&
    "path" in input &&
    typeof input.path === "string"
      ? normalizeWorkspacePath(input.path)
      : "";
  return `${tool.name}:${call.name}:${result.code ?? "UNKNOWN"}:${pathValue}`;
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

const PLATFORM_EXECUTION_INSTRUCTION =
  process.platform === "win32"
    ? "The execution host is Windows. Prefer ReadFile/SearchText for repository content and PowerShell-compatible commands; do not assume Unix-only commands such as head, tail, grep or sed are installed."
    : "Prefer the repository tools for file content and keep shell commands narrow and portable.";

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
    PLATFORM_EXECUTION_INSTRUCTION +
    " " +
    TOOL_ERROR_RECOVERY_INSTRUCTION,
};

function stagedWorkUnitInstruction(
  target: string | undefined,
  totalTargets: number,
  targetExists = false,
  needsSupportingEvidence = false,
): string {
  if (!target || totalTargets < 2) return "";
  return (
    "\n\nHOST-CONTROLLED WORK UNIT (authoritative): " +
    `this complex task is staged across ${totalTargets} targets. ` +
    `The current work unit is ${target}. ` +
    "Work only on this target until the host verifies it; do not edit another " +
    "path in the parent objective during this unit. After a successful " +
    "ReadFile of the current target, use that observation to make the smallest " +
    "necessary EditFile or WriteFile. Do not repeat ReadFile on the same path " +
    "unless a specific missing range or symbol requires it. " +
    (needsSupportingEvidence
      ? "Because this is a cross-file or high-complexity objective, inspect at least one supporting file, test, or relevant SearchText match before editing; the host will keep mutation tools unavailable until that evidence exists. "
      : "") +
    (targetExists
      ? "This target already exists and CreateFile is not an available operation for it. "
      : "") +
    "The host, not the " +
    "model, advances the next target."
  );
}

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
  const verificationPolicy =
    task.verificationPolicy ??
    (mode === "coding"
      ? verificationPlan.length > 0
        ? "required"
        : "not_required"
      : "not_required");
  const objectivePaths = [
    ...new Set(
      [...extractObjectivePaths(task.objective), ...(task.stagedPaths ?? [])]
        .map(normalizeWorkspacePath)
        .filter((value) => value.length > 0),
    ),
  ];
  const derivedComplexity = Math.min(
    1,
    0.15 +
      (objectivePaths.length >= 2 ? 0.25 : 0) +
      (objectivePaths.length >= 6 ? 0.25 : 0) +
      (task.objective.length > 160 ? 0.15 : 0) +
      (verificationPlan.length > 0 ? 0.1 : 0),
  );
  const executionProfile =
    task.executionProfile ??
    selectExecutionProfile({
      mode,
      complexity: derivedComplexity,
      explicitPathCount: objectivePaths.length,
      deliverableCount: Math.max(1, objectivePaths.length),
      risk: mode === "coding" ? 0.3 : 0.1,
      uncertaintyCount:
        mode === "coding" && objectivePaths.length === 0 ? 1 : 0,
    });
  const planningMode = task.planningMode ?? "compatibility";
  const taskContract = task.taskContract
    ? cloneTaskContract(task.taskContract)
    : compileTaskContract({
        id: task.id,
        originalRequest: task.objective,
        mode,
        executionProfile,
        explicitPaths: objectivePaths,
        verificationCommands: verificationPlan,
        constraints: task.constraints,
      });
  const constraints = [
    ...new Set([
      ...taskContract.constraints.map((constraint) => constraint.description),
      ...frameConstraints(task, mode, verificationPlan),
    ]),
  ];
  for (const constraint of constraints)
    if (
      !taskContract.constraints.some(
        (existing) => existing.description === constraint,
      )
    )
      taskContract.constraints.push({
        id: `constraint-controller-${taskContract.constraints.length + 1}`,
        description: constraint,
        source: "controller",
      });
  const compiledTaskContext = task.context?.trim()
    ? renderContextPacket(
        compileContextPacket({
          objective: task.objective,
          constraints,
          evidence: [
            {
              source: "host-context",
              kind: "repository",
              summary: task.context,
              relevance: 1,
            },
          ],
          legalActions: options.tools.map((tool) => tool.name),
          expectedOutput: "Choose one bounded, legal next action.",
          tokenBudget: Math.min(
            16_384,
            Math.max(1_024, Math.ceil((task.contextBudgetChars ?? 50_000) / 4)),
          ),
        }),
      )
    : "";
  const contractCriteriaEnabled =
    task.enforceTaskContract === true ||
    task.taskContract !== undefined ||
    (planningMode === "model" && mode === "coding");
  const successCriteria =
    task.successCriteria && task.successCriteria.length > 0
      ? task.successCriteria
      : contractCriteriaEnabled
        ? taskContract.acceptanceCriteria.map(
            (criterion) => criterion.description,
          )
        : ["Address the user's objective with an evidence-backed response."];
  const explicitSuccessCriteria =
    (task.successCriteria?.length ?? 0) > 0 || contractCriteriaEnabled;
  const ledger = createTaskLedger({
    id: task.id,
    objective: task.objective,
    mode,
    contract: taskContract,
    executionProfile,
    planningMode,
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
  const defaultTestCommand = verificationPlan.find(
    (item) => item.stage === "test",
  )?.command;
  const createExecutionContext = async () => {
    const context = await options.createExecutionContext(task);
    if (logger) context.logger = logger;
    if (!context.defaultTestCommand && defaultTestCommand)
      context.defaultTestCommand = defaultTestCommand;
    return context;
  };
  logger?.info("agent.task.started", {
    mode,
    toolCount: options.tools.length,
    toolChoice: options.toolChoice ?? "auto",
    objectiveLength: task.objective.length,
    contextLength: compiledTaskContext.length,
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
      executionProfile,
      planningMode,
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
  const projectModelPlan = (): void => {
    const graph = ledger.taskGraph;
    if (!graph || graph.planSource !== "model") return;
    const status = (value: PlanNodeStatus): PlanStep["status"] => {
      if (value === "verified") return "done";
      if (value === "superseded") return "skipped";
      if (value === "running" || value === "verifying") return "active";
      if (value === "failed" || value === "blocked") return "failed";
      return "pending";
    };
    setTaskPlan(ledger, {
      source: "model",
      revision: graph.revision,
      revisions: graph.revisions,
      objective: graph.rootObjective,
      acceptanceCriteria: [...(graph.acceptanceCriteria ?? [])],
      evidenceRequirements: [...(graph.evidenceRequirements ?? [])],
      steps: graph.nodes.map((node) => ({
        id: node.id,
        description: node.objective,
        status: status(node.status === "passed" ? "verified" : node.status),
        kind: node.kind,
        source: node.source ?? "model",
        revision: node.revision,
        dependencies: [...node.dependencies],
        scope: [...node.scope.candidateFiles],
        evidenceRequired: [...node.contextRequirements],
        verification:
          node.verification && node.verification.length > 0
            ? [...node.verification]
            : node.acceptance.length > 0
              ? [...node.acceptance]
              : undefined,
      })),
      updatedAt: new Date().toISOString(),
    });
  };
  ledger.taskGraph = compileTaskGraph({
    objective: task.objective,
    mode,
    candidateFiles: objectivePaths,
    verificationCommands: verificationPlan.map((item) => item.command),
    constraints,
  });
  if (planningMode === "model")
    ledger.taskGraph = createModelPlanningGraph({
      objective: task.objective,
      constraints,
    });
  persistLedger();
  const currentModelNode = (): TaskNode | undefined => {
    if (planningMode !== "model" || !ledger.taskGraph?.currentNodeId)
      return undefined;
    return ledger.taskGraph.nodes.find(
      (node) => node.id === ledger.taskGraph?.currentNodeId,
    );
  };
  const modelPlanHasUnfinishedNodes = (): boolean =>
    planningMode === "model" &&
    Boolean(
      ledger.taskGraph?.nodes.some(
        (node) => node.status !== "passed" && node.status !== "superseded",
      ),
    );
  const modelPlanHasRunnableContinuation = (): boolean =>
    planningMode === "model" &&
    Boolean(
      ledger.taskGraph?.nodes.some(
        (node) =>
          node.status === "ready" ||
          node.status === "running" ||
          node.status === "verifying",
      ),
    );
  const modelPlanIsComplete = (): boolean =>
    planningMode !== "model" ||
    Boolean(
      ledger.taskGraph &&
      ledger.taskGraph.nodes.length > 0 &&
      ledger.taskGraph.nodes.every(
        (node) => node.status === "passed" || node.status === "superseded",
      ),
    );
  const updateTaskNode = (
    nodeId: string | undefined,
    status: Parameters<typeof setTaskNodeStatus>[2],
  ): void => {
    if (!ledger.taskGraph || !nodeId) return;
    if (!setTaskNodeStatus(ledger.taskGraph, nodeId, status)) return;
    if (ledger.plan?.source === "model") projectModelPlan();
    persistLedger();
    if (ledger.plan?.source === "model") emitPlan();
  };
  const mutationNodeForPath = (
    target: string | undefined,
  ): string | undefined => {
    if (!ledger.taskGraph) return undefined;
    if (!target && planningMode === "model") return currentModelNode()?.id;
    if (!target) return undefined;
    const normalized = normalizeWorkspacePath(target);
    return ledger.taskGraph.nodes.find(
      (node) =>
        node.status !== "passed" &&
        node.status !== "superseded" &&
        node.scope.candidateFiles.some(
          (candidate) => normalizeWorkspacePath(candidate) === normalized,
        ),
    )?.id;
  };
  const syncTargetPlan = (activePaths: readonly string[] = []): void => {
    if (ledger.plan?.source === "model") {
      projectModelPlan();
      emitPlan();
      return;
    }
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
  // Keep mutation scope separate from diagnostic context. After a failed
  // verification the model must be able to re-read the file it just changed
  // even when the failing test path is the next acceptance target.
  let criteriaReadPaths = [...criteriaWritePaths];
  const syncModelPlanScope = (): void => {
    if (planningMode !== "model") return;
    const node = currentModelNode();
    const scope = (node?.scope.candidateFiles ?? [])
      .map(normalizeWorkspacePath)
      .filter((value) => value.length > 0);
    criteriaWritePaths = [...new Set(scope)];
    criteriaReadPaths = [...new Set(scope)];
  };
  interface ModelNodeActionState {
    readCount: number;
    mutationCount: number;
    executionCount: number;
    semanticCount: number;
  }

  const modelNodeActions = new Map<string, ModelNodeActionState>();
  let lastActionedModelNodeId: string | undefined;
  // Keep the mutation boundary separate from the current graph pointer. A
  // host verification can run after the graph has advanced or after a
  // recovery revision has been appended, so closing `currentModelNode()` at
  // that point can leave the actual mutating node stuck in `verifying`.
  let lastModelMutationNodeId: string | undefined;
  const modelNodeActionState = (nodeId: string): ModelNodeActionState => {
    const existing = modelNodeActions.get(nodeId);
    if (existing) return existing;
    const created = {
      readCount: 0,
      mutationCount: 0,
      executionCount: 0,
      semanticCount: 0,
    };
    modelNodeActions.set(nodeId, created);
    return created;
  };
  const modelNodeIsReadOnly = (node: TaskNode): boolean => {
    const allowedTools = node.scope.allowedTools;
    return (
      allowedTools.length > 0 &&
      allowedTools.every((name) => MODEL_PLAN_READ_ONLY_TOOLS.has(name))
    );
  };
  const modelNodeIsSemantic = (node: TaskNode): boolean =>
    node.kind === "semantic" && node.scope.allowedTools.length === 0;
  const modelNodeNeedsClarification = (node: TaskNode): boolean =>
    node.kind === "clarification" && node.scope.allowedTools.length === 0;
  const successfulExecution = (call: ToolCall, result: ToolResult): boolean => {
    if (!result.ok) return false;
    if (call.name !== "Shell" && call.name !== "RunTests") return true;
    const output = objectOutput(result.output);
    return typeof output?.exitCode !== "number" || output.exitCode === 0;
  };
  const modelNodeAllowsPath = (node: TaskNode, input: unknown): boolean => {
    // Candidate files describe the LLM's intended scope. An explicit user
    // approval may authorize a legitimate deviation, so observation must not
    // silently discard successful evidence merely because the path was not in
    // the original proposal. Workspace-root and security checks still happen
    // at the tool boundary.
    void node;
    void input;
    return true;
  };
  const observeModelPlanAction = (
    call: ToolCall,
    tool: ToolDefinition<unknown, unknown> | undefined,
    result: ToolResult,
    input: unknown,
    planNodeId?: string,
  ): void => {
    if (planningMode !== "model") return;
    const node =
      (planNodeId
        ? ledger.taskGraph?.nodes.find(
            (candidate) => candidate.id === planNodeId,
          )
        : undefined) ?? currentModelNode();
    const nonGitRepository = isNonGitRepositoryFailure(call.name, result);
    if (!result.ok) {
      if (nonGitRepository) {
        // Git metadata is optional for a disposable or newly created
        // workspace. Preserve the real tool failure in the action ledger,
        // but do not turn an unavailable Git capability into a failed
        // semantic work node or an endless retry. The host's final review
        // already falls back to the mutation ledger in this situation.
        if (node && modelNodeIsReadOnly(node)) {
          modelNodeActionState(node.id).readCount += 1;
          // Git metadata is optional in a disposable workspace, but the
          // read-only LLM node still needs to complete through the same
          // captured-node path as every other successful observation. This
          // keeps progress/replan counters and the active-node identity in
          // sync when the graph advances.
          completeCurrentModelNodeAfterAction(node.id);
        }
        return;
      }
      if (node) node.lastFailure = result.error;
      const retryable = result.recoverable !== false;
      const isPlanBoundaryFailure =
        (result.code === "CONFLICT" || result.code === "PERMISSION_DENIED") &&
        result.error?.includes("LLM-authored plan node") === true;
      if (isPlanBoundaryFailure) {
        // The semantic plan remains LLM-authored, while its workspace
        // boundary remains controller-enforced. Never widen the boundary
        // because a worker guessed a different path; request a monotonic
        // replacement node instead.
        const attemptedPath =
          typeof input === "object" &&
          input !== null &&
          "path" in input &&
          typeof input.path === "string"
            ? normalizeWorkspacePath(input.path)
            : undefined;
        updateTaskNode(node?.id, "failed");
        pendingModelPlanRecovery ??= {
          cause: "PLAN_SCOPE_CONFLICT",
          issues: [
            result.error ?? "The action was outside the current plan scope.",
          ],
          nextActions: [
            `Reconsider the worker's attempted workspace path ${attemptedPath ?? "(missing path)"} and return a new replacement node with the semantically correct explicit candidateFiles scope.`,
            result.suggestedAction ??
              "Propose a replacement plan node with the exact intended workspace path.",
          ],
          ...(node?.id ? { supersedeNodeId: node.id } : {}),
        };
      }
      const semanticExecutionFailure =
        result.code === "TEST_FAILED" || result.code === "COMMAND_FAILED";
      if (
        semanticExecutionFailure &&
        node &&
        !nonGitRepository &&
        !pendingModelPlanRecovery
      ) {
        // A failed command/test is semantic evidence about the current
        // LLM-authored work unit, not merely another raw tool error. Mark the
        // unit failed and return control to the same LLM planner for an
        // append-only repair/replan. The controller does not choose the fix;
        // it only preserves the failure boundary and prevents the worker
        // from continuing under a plan whose declared verification failed.
        updateTaskNode(node.id, "failed");
        pendingModelPlanRecovery = {
          cause: result.code ?? "COMMAND_FAILED",
          issues: [
            result.error ?? "The planned verification or command failed.",
          ],
          nextActions: [
            result.suggestedAction ??
              "Inspect the failure evidence and return a replacement repair node.",
            "Preserve valid completed plan history and propose the next semantic repair with explicit scope and verification.",
          ],
          supersedeNodeId: node.id,
        };
      }
      recordRecoveryContract(ledger, {
        id: `${task.id}:tool-recovery:${call.id}`,
        cause: result.code ?? "TOOL_FAILURE",
        evidence: [result.error ?? "The planned tool action failed."],
        attemptedStrategies: [
          `${call.name}:${JSON.stringify(summarizeToolInput(input))}`,
        ],
        forbiddenRepeats: [
          `${call.name}:${JSON.stringify(summarizeToolInput(input))}`,
        ],
        proposedRecovery:
          result.code === "TEST_FAILED" || result.code === "COMMAND_FAILED"
            ? "repair"
            : retryable
              ? "retry"
              : "stop",
        createdAt: new Date().toISOString(),
      });
      persistLedger();
      return;
    }
    if (!node) return;
    if (!modelNodeAllowsPath(node, input)) return;
    const state = modelNodeActionState(node.id);
    const isMutation = tool?.risk === "write" || tool?.risk === "destructive";
    const isExecution = tool?.risk === "execute";
    if (isMutation) lastModelMutationNodeId = node.id;
    if (tool?.risk === "read") state.readCount += 1;
    if (isMutation) state.mutationCount += 1;
    if (isExecution && successfulExecution(call, result))
      state.executionCount += 1;

    // A successful observation is not a successful mutation. In particular,
    // a read used to advance the next write node in the v20 CLI journey even
    // though that node had not changed anything. Keep the LLM-authored
    // semantic order, but require an action of the node's declared class
    // before its completion can be considered.
    if (isMutation || (isExecution && successfulExecution(call, result)))
      updateTaskNode(node.id, "verifying");
  };
  const modelNodeHasRequiredAction = (
    node: TaskNode,
    state: ModelNodeActionState,
  ): boolean => {
    const readOnlyNode = modelNodeIsReadOnly(node);
    return modelNodeIsSemantic(node)
      ? state.semanticCount > 0
      : readOnlyNode
        ? state.readCount > 0
        : node.scope.allowedTools.some((name) =>
              MODEL_PLAN_FILE_MUTATION_TOOLS.has(name),
            )
          ? state.mutationCount > 0
          : state.executionCount > 0;
  };
  const completeCurrentModelNode = (
    objectiveVerified: boolean,
    nodeId?: string,
  ): boolean => {
    if (planningMode !== "model") return false;
    const node =
      (nodeId
        ? ledger.taskGraph?.nodes.find((candidate) => candidate.id === nodeId)
        : undefined) ?? currentModelNode();
    if (!node) return false;
    const state = modelNodeActions.get(node.id);
    if (!state) return false;
    if (!modelNodeHasRequiredAction(node, state)) return false;
    const hasFileMutationTool = node.scope.allowedTools.some((name) =>
      MODEL_PLAN_FILE_MUTATION_TOOLS.has(name),
    );
    // A single-file workspace node has an unambiguous action boundary: a
    // successful mutation is enough to unlock the next LLM-authored node.
    // For a node that intentionally spans several candidate files, the
    // candidate list is an allowed scope rather than proof that every file
    // was completed. Keep that node active until the objective verifier
    // proves its broader acceptance, otherwise one partial mutation would
    // silently skip the rest of the LLM-authored work unit.
    if (
      !objectiveVerified &&
      hasFileMutationTool &&
      node.scope.candidateFiles.length > 1
    )
      return false;
    // A node is the LLM's bounded semantic unit, while the objective is the
    // user's global outcome. A successful typed action proves that the node's
    // declared action boundary was executed; the objective verifier still
    // decides whether the whole request is complete. Keeping those facts
    // separate lets a multi-node plan advance after index.html succeeds
    // instead of rejecting the next file as outside the stale node scope.
    lastActionedModelNodeId = node.id;
    // Replan attempts are a bounded recovery budget, not a lifetime quota for
    // the task. An accepted replacement plan followed by a successful scoped
    // action is meaningful progress, so a malformed earlier plan must not
    // consume the recovery budget for every later independent node. Keeping
    // the counter consecutive-to-progress still prevents an unproductive
    // sequence of accepted-but-never-runnable plans from becoming unbounded.
    modelReplanCount = 0;
    updateTaskNode(node.id, "passed");
    syncModelPlanScope();
    return true;
  };
  const completeCurrentModelNodeAfterAction = (nodeId?: string): boolean =>
    completeCurrentModelNode(false, nodeId);
  const completeCurrentModelNodeAfterVerification = (
    nodeId?: string,
  ): boolean => completeCurrentModelNode(true, nodeId);
  const observedExistingPaths = new Set<string>();
  const observedMissingPaths = new Set<string>();
  const contextFallback =
    profile === "minimal"
      ? ""
      : "\n\nNo repository context was provided. Inspect the workspace before editing.";
  const declaredEvidenceState =
    task.contextEvidenceState ??
    (task.context?.trim() ? "SUFFICIENT" : "INSUFFICIENT");
  // Host-staged work units are the compatibility controller's fallback for
  // coding turns without an LLM-authored execution plan. Once the semantic
  // planner is active, the LLM owns the work order and node scope; keeping the
  // old target-by-target stage here would silently replace that plan with a
  // monotone host sequence.
  const stagedTask =
    planningMode !== "model" && mode === "coding" && objectivePaths.length > 1;
  const stagedNeedsSupportingEvidence = requiresSupportingStagedEvidence(
    task.objective,
    objectivePaths.length,
  );
  let stagedMutationRequired = false;
  // The repository context builder may already have selected more than the
  // active target. Preserve that host observation as supporting evidence;
  // otherwise a local model can be trapped reading the same target forever
  // even though the controller has already supplied the related file in the
  // bounded context. Synthetic/unit tasks without explicit context headings
  // still require the normal supporting ReadFile/SearchText step.
  const hostContextPaths = new Set(
    (task.context ?? "").split(/\r?\n/u).flatMap((line) => {
      const match = line.match(/^###\s+(.+)$/u);
      if (!match?.[1] || match[1].startsWith("Instruction ")) return [];
      return [normalizeWorkspacePath(match[1].trim())];
    }),
  );
  const activeStagedTarget = normalizeWorkspacePath(
    criteriaWritePaths[0] ?? objectivePaths[0] ?? "",
  );
  let stagedSupportingEvidenceObserved =
    stagedNeedsSupportingEvidence &&
    declaredEvidenceState === "SUFFICIENT" &&
    [...hostContextPaths].some(
      (candidate) =>
        candidate !== activeStagedTarget &&
        objectivePaths.some(
          (objectivePath) =>
            normalizeWorkspacePath(objectivePath) === candidate,
        ),
    );
  const stagedDeletionAllowed = objectiveAuthorizesDeletion(task.objective);
  const stagedExecutionInstruction = (): string =>
    stagedWorkUnitInstruction(
      criteriaWritePaths[0] ?? objectivePaths[0],
      objectivePaths.length,
      observedExistingPaths.has(
        normalizeWorkspacePath(
          criteriaWritePaths[0] ?? objectivePaths[0] ?? "",
        ),
      ),
      stagedNeedsSupportingEvidence && !stagedMutationRequired,
    );
  const baseSystemPrompt = SYSTEM_PROMPT_BY_PROFILE[profile];
  const messages: NormalizedMessage[] = [
    {
      role: "system",
      content: baseSystemPrompt + stagedExecutionInstruction(),
    },
    {
      role: "user",
      content: compiledTaskContext
        ? `${compiledTaskContext}${stagedExecutionInstruction()}`
        : `${task.objective}${contextFallback}${stagedExecutionInstruction()}`,
    },
  ];
  const modelPlanInstruction = (): string => {
    if (planningMode !== "model") return "";
    const plan = ledger.taskGraph;
    const node = currentModelNode();
    if (!plan || !node)
      return "\n\nLLM-AUTHORED PLAN: no executable node is currently ready; do not invent workspace actions.";
    const scopedPaths = node.scope.candidateFiles.filter(
      (candidate) => candidate.trim().length > 0,
    );
    const pathRule =
      scopedPaths.length > 0
        ? `A path-bearing call in this turn must use only these exact relative paths: ${scopedPaths.join(", ")}. Do not call a later node's path early, even if it appears elsewhere in the objective or plan.`
        : "This node has no path scope; do not invent a workspace path unless one is returned by an allowed observation.";
    const toolRule =
      node.scope.allowedTools.length > 0
        ? `The semantic action must use only these planned tools: ${node.scope.allowedTools.join(", ")}.`
        : "No workspace tool call is legal for this node.";
    return (
      "\n\nLLM-AUTHORED MONOTONIC PLAN (authoritative semantic work order): " +
      `revision ${plan.revision ?? 0}; current node ${node.id}. ` +
      "The controller validates this plan and owns completion, but it does not replace the LLM's semantic ordering with a fixed task tree. " +
      `Current node objective: ${node.objective} ` +
      `Dependencies: ${node.dependencies.join(", ") || "none"}. ` +
      `Allowed tools: ${node.scope.allowedTools.join(", ") || "host-approved tools"}. ` +
      `Scoped paths: ${node.scope.candidateFiles.join(", ") || "not yet localized"}. ` +
      `Required evidence: ${node.contextRequirements.join("; ") || "the current observation"}. ` +
      `${toolRule} ${pathRule} ` +
      (modelNodeIsSemantic(node)
        ? "This is a semantic node: return one concise plain-text decision or design result. No workspace tool call, JSON tool envelope, XML tool tag, or tool-shaped code block is legal for this node. "
        : modelNodeNeedsClarification(node)
          ? "This node is a clarification boundary: do not invent a workspace action; surface the missing user decision. "
          : "") +
      "Complete only this bounded node, observe the result, then continue from the next ready node."
    );
  };
  const refreshStagedWorkUnitPrompt = (): void => {
    const systemMessage = messages[0];
    if (systemMessage?.role === "system")
      systemMessage.content =
        baseSystemPrompt +
        stagedExecutionInstruction() +
        modelPlanInstruction();
  };
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
  // Controller-owned phase marker: once the active staged target has been
  // read successfully, the next model decision must be mutation/verification.
  // A failed mutation resets this marker so fresh discovery can recover it.
  const pendingMutations: Array<{
    before: FileMutationSnapshot;
    after: FileMutationSnapshot;
    protectedCriterionIds: string[];
  }> = [];
  const protectedCriterionIds = new Set<string>();
  const readRevisions = new Map<string, number>();
  const readObservations = new Map<
    string,
    {
      revision: number;
      successfulReads: number;
      truncated: boolean;
    }
  >();
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
      relevance: declaredEvidenceState === "SUFFICIENT" ? 0.8 : 0.2,
      freshness: 1,
    });
  updateTaskNode(
    "discover",
    declaredEvidenceState === "CONFLICTING"
      ? "failed"
      : declaredEvidenceState === "SUFFICIENT"
        ? "passed"
        : "running",
  );
  transitionPhase(ledger, "analyze", loopOptions);
  updateTaskNode("analyze", "running");
  persistLedger();
  if (
    planningMode === "compatibility" &&
    (mode === "plan" || (task.successCriteria?.length ?? 0) > 1)
  ) {
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
  const MUTATION_FAILURE_LIMIT = 2;
  let lastCallSignature: string | undefined;
  let repeatedCallCount = 0;
  let forceNoToolsOnNextTurn = false;
  let readLoopRecoveryCount = 0;
  let lastErrorCode: string | undefined;
  let repeatedErrorCount = 0;
  let lastMutationFailureKey: string | undefined;
  let repeatedMutationFailureCount = 0;
  let noActionCount = 0;
  let oversizedBatchCount = 0;
  let modelProtocolRecoveryCount = 0;
  let forcedRecoveryTool: { name: "ReadFile"; path: string } | undefined;
  let pendingRecoveryInstruction: string | undefined;
  let modelReplanCount = 0;
  // A model can make real file mutations that change bytes without making
  // any acceptance criterion closer to true. Keep this separate from the
  // identical-call watchdog: rewriting the same artifact with different
  // placeholder content is still a semantic loop. Once the threshold is
  // reached, the LLM planner must choose a new repair/replacement node; the
  // controller never invents the semantic repair itself.
  const MODEL_MUTATION_STAGNATION_LIMIT = 3;
  let criteriaProgressNodeId: string | undefined;
  let criteriaProgressFingerprint: string | undefined;
  let criteriaProgressMutationRevision = -1;
  let stagnantMutationCount = 0;
  let pendingModelPlanRecovery:
    | {
        cause: string;
        issues: string[];
        nextActions: string[];
        supersedeNodeId?: string;
      }
    | undefined;

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
    const nonGitRepository = isNonGitRepositoryFailure(call.name, result);
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
    const observedPath =
      typeof input === "object" &&
      input !== null &&
      "path" in input &&
      typeof input.path === "string"
        ? input.path
        : undefined;
    const planBoundaryFailure =
      !result.ok &&
      (result.code === "CONFLICT" || result.code === "PERMISSION_DENIED") &&
      result.error?.includes("LLM-authored plan node") === true;
    if (
      (tool?.risk === "write" || tool?.risk === "destructive") &&
      !planBoundaryFailure
    ) {
      // A successful mutation is only an observation for an LLM-authored
      // node. The node still needs objective/declared verification before it
      // can become terminal; otherwise a placeholder or partial edit can
      // make the plan appear complete and leave completion recovery without
      // the failed node that needs supersession.
      const successfulMutationStatus =
        planningMode === "model" ? "verifying" : "passed";
      const failedMutationStatus =
        result.recoverable === false ? "failed" : "running";
      updateTaskNode(
        mutationNodeForPath(observedPath),
        result.ok ? successfulMutationStatus : failedMutationStatus,
      );
      if (result.ok) {
        addTaskEvidence(ledger, {
          id: `${task.id}:mutation-evidence:${call.id}`,
          kind: "file",
          source: call.name,
          summary: observedPath
            ? `Successful ${call.name} mutation recorded for ${normalizeWorkspacePath(observedPath)}.`
            : `Successful ${call.name} mutation recorded by the host.`,
          relevance: 0.85,
          freshness: 1,
        });
      }
    } else if (result.ok && tool?.risk === "read") {
      updateTaskNode("discover", "passed");
    }
    if (call.name === "RunTests")
      updateTaskNode(
        "verify",
        result.ok && !executionFailed ? "passed" : "failed",
      );
    if (
      call.name === "ListFiles" &&
      result.code === "PATH_IS_FILE" &&
      typeof input === "object" &&
      input !== null &&
      "path" in input &&
      typeof input.path === "string"
    ) {
      const recoveryPath = normalizeWorkspacePath(input.path);
      forcedRecoveryTool = { name: "ReadFile", path: recoveryPath };
      pendingRecoveryInstruction =
        `Host recovery: ${recoveryPath} is a file, not a directory. ` +
        "Use ReadFile on that exact path now; do not call ListFiles again.";
    } else if (
      call.name === "EditFile" &&
      !result.ok &&
      typeof input === "object" &&
      input !== null &&
      "path" in input &&
      typeof input.path === "string" &&
      [
        "INVALID_ARGUMENT",
        "NOT_FOUND",
        "PATH_NOT_FOUND",
        "CONFLICT",
        "STALE_EDIT",
      ].includes(result.code ?? "")
    ) {
      // A rejected exact edit is not recoverable by repeating the same
      // proposal. Force one fresh host observation before exposing EditFile
      // again in both staged and LLM-authored execution. This is the
      // control-plane recovery boundary that prevents a small model from
      // burning the remaining turns on an empty/stale or ambiguous oldText
      // payload.
      const recoveryPath = normalizeWorkspacePath(input.path);
      forcedRecoveryTool = { name: "ReadFile", path: recoveryPath };
      pendingRecoveryInstruction =
        `Host recovery: the EditFile proposal for ${recoveryPath} was rejected. ` +
        "Read that exact file now and construct a new exact oldText/newText edit; do not repeat the previous EditFile call.";
    } else if (call.name === "Shell" && !result.ok && result.suggestedAction) {
      // Shell failures are observations, not permission to repeat the same
      // command. Put the typed host guidance in the next decision so the
      // model can change strategy instead of guessing from a raw exit code.
      pendingRecoveryInstruction = `Host recovery: the shell command failed. ${result.suggestedAction} Do not repeat the identical command.`;
    } else if (forcedRecoveryTool && call.name === forcedRecoveryTool.name) {
      const observedRecoveryPath =
        typeof input === "object" &&
        input !== null &&
        "path" in input &&
        typeof input.path === "string"
          ? normalizeWorkspacePath(input.path)
          : undefined;
      if (result.ok && observedRecoveryPath === forcedRecoveryTool.path) {
        forcedRecoveryTool = undefined;
        pendingRecoveryInstruction = undefined;
      } else {
        pendingRecoveryInstruction = `Host recovery: use ReadFile on ${forcedRecoveryTool.path} with a valid path before continuing.`;
      }
    } else if (forcedRecoveryTool) {
      pendingRecoveryInstruction = `Host recovery: use ReadFile on ${forcedRecoveryTool.path} before any other repository action.`;
    }
    transitionPhase(ledger, "observe", loopOptions);
    const normalizedObservedPath = observedPath
      ? normalizeWorkspacePath(observedPath)
      : undefined;
    const explicitTargetMatch = normalizedObservedPath
      ? objectivePaths.some(
          (candidate) =>
            normalizeWorkspacePath(candidate) === normalizedObservedPath,
        )
      : false;
    const objectiveMentionsPath = normalizedObservedPath
      ? task.objective
          .toLowerCase()
          .includes(path.basename(normalizedObservedPath).toLowerCase())
      : false;
    const searchReturnedMatches =
      Array.isArray(output?.matches) && output.matches.length > 0;
    const evidenceRelevance =
      call.name === "ReadFile"
        ? explicitTargetMatch || objectiveMentionsPath
          ? 0.95
          : objectivePaths.length === 0
            ? 0.55
            : 0.35
        : call.name === "SearchText" && searchReturnedMatches
          ? 0.9
          : call.name === "ListFiles" || call.name === "GlobFiles"
            ? mode === "coding"
              ? 0.35
              : 0.75
            : call.name === "GitStatus" || call.name === "GitDiff"
              ? 0.75
              : call.name === "RunTests"
                ? 0.9
                : 0.3;
    if (result.ok && tool?.risk === "read")
      addTaskEvidence(ledger, {
        id: `${task.id}:evidence:${call.id}`,
        kind: "tool-result",
        source: call.name,
        summary: `Successful ${call.name} result used as repository evidence.`,
        relevance: evidenceRelevance,
        freshness: 1,
      });
    if (nonGitRepository) {
      addTaskEvidence(ledger, {
        id: `${task.id}:evidence:${call.id}:git-not-applicable`,
        kind: "git",
        source: call.name,
        summary:
          "Git metadata is not applicable because the workspace is not a Git repository; continue with filesystem and mutation evidence.",
        relevance: 0.35,
        freshness: 1,
      });
      pendingRecoveryInstruction =
        "Host observation: this workspace is not a Git repository, so GitStatus/GitDiff are not applicable. Do not retry Git metadata; continue using the successful filesystem, mutation, and objective-verification evidence.";
    }
    if (tool?.risk === "write" || tool?.risk === "destructive") {
      if (result.ok) {
        readLoopRecoveryCount = 0;
        stagedMutationRequired = false;
        stagedSupportingEvidenceObserved = false;
        lastMutationFailureKey = undefined;
        repeatedMutationFailureCount = 0;
        if (observedPath) {
          const normalizedMutationPath = normalizeWorkspacePath(observedPath);
          observedExistingPaths.add(normalizedMutationPath);
          observedMissingPaths.delete(normalizedMutationPath);
        }
      } else if (stagedTask) {
        // A failed mutation invalidates the current edit proposal. Reopen
        // discovery so the model can acquire a fresh observation and recover.
        stagedMutationRequired = false;
        stagedSupportingEvidenceObserved = false;
        const failureKey = mutationFailureKey(call, tool, result, input);
        if (failureKey === lastMutationFailureKey)
          repeatedMutationFailureCount += 1;
        else {
          lastMutationFailureKey = failureKey;
          repeatedMutationFailureCount = 1;
        }
      }
    }
    if (
      result.ok &&
      tool?.name === "ReadFile" &&
      typeof input === "object" &&
      input !== null &&
      "path" in input &&
      typeof input.path === "string"
    ) {
      const normalizedPath = normalizeWorkspacePath(input.path);
      const previousObservation = readObservations.get(normalizedPath);
      const observationIsCurrent =
        previousObservation?.revision === mutationRevision;
      const outputWasTruncated = modelVisibleReadWasTruncated(result.output);
      readObservations.set(normalizedPath, {
        revision: mutationRevision,
        successfulReads: observationIsCurrent
          ? previousObservation.successfulReads + 1
          : 1,
        // A later bounded range read can replace a model-visible truncated
        // observation. Keeping the old `true` forever made it impossible for
        // the controller to recognize that the requested edit range was now
        // actually present in context.
        truncated: outputWasTruncated,
      });
      readRevisions.set(normalizedPath, mutationRevision);
      observedExistingPaths.add(normalizedPath);
      observedMissingPaths.delete(normalizedPath);
      rejectedEditPaths.delete(normalizedPath);
      const activeTarget = criteriaWritePaths[0] ?? objectivePaths[0];
      if (
        stagedTask &&
        activeTarget !== undefined &&
        normalizedPath === normalizeWorkspacePath(activeTarget)
      )
        stagedMutationRequired =
          !outputWasTruncated &&
          (!stagedNeedsSupportingEvidence || stagedSupportingEvidenceObserved);
    }
    if (
      stagedTask &&
      stagedNeedsSupportingEvidence &&
      result.ok &&
      (call.name === "SearchText" || call.name === "ReadFile")
    ) {
      const activeTarget = criteriaWritePaths[0] ?? objectivePaths[0];
      const normalizedTarget = activeTarget
        ? normalizeWorkspacePath(activeTarget)
        : undefined;
      const isSupportingRead =
        call.name === "SearchText"
          ? searchReturnedMatches
          : normalizedObservedPath !== undefined &&
            normalizedObservedPath !== normalizedTarget;
      if (isSupportingRead) {
        stagedSupportingEvidenceObserved = true;
        const targetObservation = normalizedTarget
          ? readObservations.get(normalizedTarget)
          : undefined;
        const targetReadIsUsable =
          normalizedTarget === undefined ||
          observedMissingPaths.has(normalizedTarget) ||
          targetObservation?.truncated !== true;
        if (
          normalizedTarget &&
          targetReadIsUsable &&
          (observedExistingPaths.has(normalizedTarget) ||
            observedMissingPaths.has(normalizedTarget))
        )
          stagedMutationRequired = true;
      }
    }
    if (
      call.name === "ReadFile" &&
      !result.ok &&
      ["NOT_FOUND", "PATH_NOT_FOUND"].includes(result.code ?? "") &&
      typeof input === "object" &&
      input !== null &&
      "path" in input &&
      typeof input.path === "string"
    ) {
      const normalizedPath = normalizeWorkspacePath(input.path);
      observedMissingPaths.add(normalizedPath);
      if (forcedRecoveryTool?.path === normalizedPath) {
        // The forced observation itself proved that the path is unavailable.
        // Keeping the force marker would trap recovery in the same read.
        forcedRecoveryTool = undefined;
      }
      pendingRecoveryInstruction =
        `Host recovery: ReadFile confirmed that ${normalizedPath} does not exist. ` +
        "Do not repeat ReadFile for that path. Use ListFiles, GlobFiles or SearchText to discover an existing path; " +
        "if this is an intended new artifact, use the write operation allowed by the active plan node.";
      const activeTarget = criteriaWritePaths[0] ?? objectivePaths[0];
      if (
        activeTarget &&
        normalizeWorkspacePath(activeTarget) === normalizedPath &&
        (!stagedNeedsSupportingEvidence || stagedSupportingEvidenceObserved)
      )
        stagedMutationRequired = true;
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
    if (nonGitRepository) {
      // The command failure remains visible in toolRuns/actions, but it is a
      // capability absence rather than a task error. Reset the repeated
      // error detector so a valid non-Git workspace cannot enter a doom loop.
      lastErrorCode = undefined;
      repeatedErrorCount = 0;
    } else if (!result.ok && result.code) {
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
    // A verifier may provide only failure-specific paths. Keep the host's
    // inferred objective paths as a second source of repair context; an
    // empty/partial verifier response must never erase the files that were
    // just changed or the files named by the objective.
    const nextPaths = [
      ...new Set([...(verification.nextPaths ?? []), ...inferredPaths]),
    ]
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

  const criteriaMutationStagnated = (criteria: { ready: boolean }): boolean => {
    if (planningMode !== "model" || criteria.ready) {
      criteriaProgressNodeId = undefined;
      criteriaProgressFingerprint = undefined;
      criteriaProgressMutationRevision = mutationRevision;
      stagnantMutationCount = 0;
      return false;
    }
    const node = currentModelNode();
    if (!node) return false;
    const fingerprint = JSON.stringify(
      ledger.successCriteria
        .filter((criterion) => criterion.required)
        .map((criterion) => [criterion.id, criterion.satisfied]),
    );
    if (
      criteriaProgressNodeId !== node.id ||
      criteriaProgressFingerprint === undefined
    ) {
      criteriaProgressNodeId = node.id;
      criteriaProgressFingerprint = fingerprint;
      criteriaProgressMutationRevision = mutationRevision;
      stagnantMutationCount = 0;
      return false;
    }
    if (mutationRevision > criteriaProgressMutationRevision) {
      const mutationDelta = mutationRevision - criteriaProgressMutationRevision;
      stagnantMutationCount =
        criteriaProgressFingerprint === fingerprint
          ? stagnantMutationCount + mutationDelta
          : 0;
      criteriaProgressMutationRevision = mutationRevision;
      criteriaProgressFingerprint = fingerprint;
    }
    return stagnantMutationCount >= MODEL_MUTATION_STAGNATION_LIMIT;
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

    const context = await createExecutionContext();
    if (!context.checkpoint)
      return {
        regressed: true,
        restored: false,
        notice:
          "A previously satisfied criterion regressed, but the active checkpoint service is unavailable.",
      };
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

  const objectiveProofForLedger = () =>
    contractCriteriaEnabled
      ? assessObjectiveProof(taskContract, ledger, ledger.evidence)
      : undefined;

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
      verificationPolicy === "required" && mode === "coding";
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
    const objectiveProof = objectiveProofForLedger();
    let completion = evaluateCompletionGate({
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
      verificationState:
        verificationPolicy === "required" ? "available" : verificationPolicy,
      finalReviewPerformed,
      unresolvedBlockers,
      userWorkPreserved: preserved,
      ...(objectiveProof ? { objectiveProof } : {}),
    });
    if (!modelPlanIsComplete())
      completion = {
        ...completion,
        canComplete: false,
        reasons: [
          ...completion.reasons,
          "The LLM-authored plan still contains unverified work nodes.",
        ],
      };
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
      ...(objectiveProof ? { objectiveProof } : {}),
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

  const CONTINUE_AGENT_LOOP = Symbol("continue-agent-loop");
  const finish = async (
    turns: number,
    allowRecovery = true,
  ): Promise<AgentRunResult | typeof CONTINUE_AGENT_LOOP> => {
    if (ledger.phase !== "review") {
      transitionPhase(ledger, "review", loopOptions);
      updateTaskNode("review", "running");
      persistLedger();
    }
    const preserved = await userWorkPreserved();
    const finalReviewPerformed = await reviewFinalDiff();
    const criteria = await verifySuccessCriteria();
    if (
      planningMode === "model" &&
      (mode !== "coding" ||
        (criteria.ready &&
          (verificationPlan.length === 0 ||
            (verified && verifiedMutationRevision === mutationRevision))))
    )
      completeCurrentModelNodeAfterVerification();
    if (!criteria.ready) {
      if (planningMode === "model" && allowRecovery) {
        const activeNodeId = currentModelNode()?.id;
        const failedNodeId = activeNodeId ?? lastActionedModelNodeId;
        if (activeNodeId) updateTaskNode(activeNodeId, "failed");
        const replanned = await appendModelRecoveryPlan(
          criteria.issues,
          criteria.nextActions,
          "OBJECTIVE_VERIFICATION_FAILED",
          failedNodeId,
        );
        if (replanned) {
          // A failed completion check is recoverable work, not a terminal
          // result. The accepted append-only revision owns the next action;
          // the outer loop must execute it before completion is evaluated
          // again.
          unresolvedBlockers = 0;
          repeatedErrorCount = 0;
          lastErrorCode = undefined;
          repeatedCallCount = 0;
          lastCallSignature = undefined;
          noActionCount = 0;
          transitionPhase(ledger, "plan", loopOptions);
          persistLedger();
          return CONTINUE_AGENT_LOOP;
        }
      }
      unresolvedBlockers = Math.max(1, unresolvedBlockers);
      addTaskBlocker(ledger, {
        id: `${task.id}:success-criteria`,
        summary: criteria.issues.join(" "),
        recoverable: false,
      });
      persistLedger();
    }
    const objectiveProof = objectiveProofForLedger();
    const independent = options.independentVerifier
      ? await options.independentVerifier(task, ledger)
      : independentlyVerifyTask({
          objective: task.objective,
          mode,
          ledger,
          verificationRequired: Boolean(
            (verificationPolicy === "required" ||
              verificationPolicy === "unavailable") &&
            mode === "coding",
          ),
          verificationCommands: verificationPlan,
          verificationState:
            verificationPolicy === "required"
              ? "available"
              : verificationPolicy,
          finalReviewPerformed,
          userWorkPreserved: preserved,
          ...(objectiveProof ? { objectiveProof } : {}),
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
      updateTaskNode("verify", "passed");
      updateTaskNode("review", "passed");
      updateTaskNode("answer", "passed");
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
      updateTaskNode("verify", "failed");
      updateTaskNode("review", "failed");
      updateTaskNode("answer", "failed");
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

  const requiresMutationInNextModelPlan = (
    recovery?: RecoveryContract,
  ): boolean => {
    if (mode !== "coding" || ledger.filesChanged.length > 0) return false;

    // The initial proposal must establish a mutation path. A recovery
    // proposal, however, is append-only and may be repairing a read/scope
    // node while the original mutation node is still in the graph. Requiring
    // every recovery response to repeat a mutation incorrectly rejects a
    // valid LLM-authored replacement for that read node and strands the
    // otherwise valid mutation plan. Only require a mutation when the failed
    // node was the last mutation opportunity.
    const supersedeNodeId = recovery?.supersedeNodeId;
    const hasOtherMutationNode = (ledger.taskGraph?.nodes ?? []).some(
      (node) =>
        node.id !== supersedeNodeId &&
        node.status !== "superseded" &&
        node.status !== "failed" &&
        node.scope.allowedTools.some((tool) =>
          MODEL_PLAN_FILE_MUTATION_TOOLS.has(tool),
        ),
    );
    return !recovery ? true : !hasOtherMutationNode;
  };

  const acceptModelPlan = (
    proposal: PlanProposal,
    reason?: string,
    recovery?: RecoveryContract,
  ): void => {
    if (!ledger.taskGraph)
      throw new Error(
        "Cannot accept a model plan before the task graph exists.",
      );
    const accepted = appendModelPlanToGraph(ledger.taskGraph, proposal, {
      objective: task.objective,
      mode,
      allowedTools: [...toolMap.keys()],
      workspaceRoot: task.root,
      requireWorkspaceMutation: requiresMutationInNextModelPlan(recovery),
      ...(reason ? { reason } : {}),
    });
    ledger.taskGraph = accepted.graph;
    recordPlanRevision(ledger, accepted.revision);
    syncModelPlanScope();
    projectModelPlan();
    emitPlan();
    logger?.info("agent.plan.accepted", {
      revision: accepted.revision.revision,
      proposalId: accepted.revision.proposalId,
      addedNodeCount: accepted.revision.addedNodeIds.length,
      supersededNodeCount: accepted.revision.supersededNodeIds.length,
    });
  };

  const requestModelPlanForCurrentTask = async (
    recovery?: RecoveryContract,
    plannerRetryReason?: string,
  ): Promise<PlanModelResult> =>
    requestModelPlan({
      provider: options.provider,
      modelId: providerModelId(task),
      objective: task.objective,
      mode,
      context: compiledTaskContext,
      constraints: taskContract.constraints.map(
        (constraint) => constraint.description,
      ),
      allowedTools: [...toolMap.keys()],
      requireWorkspaceMutation: requiresMutationInNextModelPlan(recovery),
      existingPlan:
        ledger.taskGraph?.planSource === "model"
          ? {
              rootObjective: ledger.taskGraph.rootObjective,
              revision: ledger.taskGraph.revision ?? 0,
              currentNodeId: ledger.taskGraph.currentNodeId || undefined,
              nodes: ledger.taskGraph.nodes.map((node) => ({
                id: node.id,
                objective: node.objective,
                dependencies: [...node.dependencies],
                kind:
                  node.kind ??
                  (node.scope.allowedTools.length > 0
                    ? "workspace"
                    : "semantic"),
                scope: {
                  candidateFiles: [...node.scope.candidateFiles],
                  allowedTools: [...node.scope.allowedTools],
                },
                contextRequirements: [...node.contextRequirements],
                requiredEvidence: [...node.contextRequirements],
                acceptance: [...node.acceptance],
                verification: [...(node.verification ?? [])],
                status:
                  node.status === "passed"
                    ? ("verified" as const)
                    : node.status,
                source:
                  node.source === "controller-recovery" ? node.source : "model",
                revision: node.revision ?? 0,
              })),
              revisions: ledger.taskGraph.revisions ?? [],
              acceptanceCriteria: [
                ...(ledger.taskGraph.acceptanceCriteria ?? []),
              ],
              evidenceRequirements: [
                ...(ledger.taskGraph.evidenceRequirements ?? []),
              ],
              constraints: [...ledger.taskGraph.globalConstraints],
            }
          : undefined,
      ...(recovery
        ? {
            recovery: {
              cause: recovery.cause,
              evidence: recovery.evidence,
              forbiddenRepeats: recovery.forbiddenRepeats,
              ...(recovery.supersedeNodeId
                ? { supersedeNodeId: recovery.supersedeNodeId }
                : {}),
              ...(plannerRetryReason
                ? { retryReason: plannerRetryReason }
                : {}),
            },
          }
        : {}),
      signal,
    });

  const initializeModelPlan = async (): Promise<AgentRunResult | undefined> => {
    if (planningMode !== "model") return undefined;
    transitionPhase(ledger, "plan", loopOptions);
    const result = await requestModelPlanForCurrentTask();
    if (!result.proposal) {
      // Initial proposals are validated at the planner boundary too. A
      // semantic model can therefore fail before acceptModelPlan is reached
      // (for example by labelling repository discovery as a semantic node).
      // Treat that rejection exactly like an invalid accepted proposal: keep
      // the original objective, ask the same LLM planner for one bounded
      // replacement, and only fail if that recovery is also unusable.
      const reason =
        result.error ?? "The LLM planner did not return a structured plan.";
      const recovered = await appendModelRecoveryPlan(
        [
          `The controller rejected the initial LLM plan before execution: ${reason}`,
          "Return a new plan that conforms to the node-kind rules, explicit workspace scope, dependencies, and tool schema.",
        ],
        [
          "Do not repeat the rejected semantic label or invalid scope.",
          "Keep semantic work LLM-authored, but represent repository reads and mutations as bounded workspace nodes.",
        ],
        "INVALID_INITIAL_PLAN",
      );
      if (recovered) return undefined;
      return await failureResult(
        0,
        `The LLM planner did not produce an acceptable plan: ${reason}`,
      );
    }
    try {
      acceptModelPlan(
        result.proposal,
        "Initial semantic plan proposed by the LLM.",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const recovered = await appendModelRecoveryPlan(
        [
          `The controller rejected the initial LLM plan: ${message}`,
          "Return a new plan that conforms to the declared node kinds, tool scopes, workspace boundaries, dependencies, and required schema.",
        ],
        [
          "Do not repeat the invalid proposal.",
          "Keep the plan semantic and LLM-authored, but make every executable path legal and bounded.",
        ],
        "INVALID_INITIAL_PLAN",
      );
      if (recovered) return undefined;
      return await failureResult(0, message);
    }
    const firstNode = currentModelNode();
    if (firstNode && modelNodeNeedsClarification(firstNode)) {
      // A clarification node is a legitimate LLM decision only when the
      // user's answer is genuinely required.  Weak local planners sometimes
      // ask about optional style/format choices before doing any work. Give
      // the same semantic planner one bounded, append-only opportunity to
      // replace that blocker with a conventional-default plan. The
      // controller does not invent the replacement; it only reports that
      // there is no reason to stop before checking whether a safe default
      // exists. If the planner still requires a decision, the task remains
      // honestly blocked and the user can answer it in a later turn.
      await appendModelRecoveryPlan(
        [
          `The initial LLM plan is blocked immediately by clarification node ${firstNode.id}: ${firstNode.objective}.`,
          "Re-evaluate whether the original objective can proceed with a safe conventional default.",
          "A clarification is justified only when alternatives are materially incompatible, irreversible, security-sensitive, or change the requested outcome.",
        ],
        [
          "Do not repeat optional style, format, naming, or preference questions when a conventional default is sufficient.",
          `If a safe default exists, return a new executable plan that supersedes ${firstNode.id}; preserve all valid prior plan history and do not reuse the superseded node id.`,
        ],
        "PLAN_CLARIFICATION_REVIEW",
        firstNode.id,
      );
    }
    return undefined;
  };

  const appendModelRecoveryPlan = async (
    issues: readonly string[],
    nextActions: readonly string[],
    cause = "OBJECTIVE_VERIFICATION_FAILED",
    supersedeNodeId?: string,
  ): Promise<boolean> => {
    if (planningMode !== "model" || modelReplanCount >= 2) return false;
    const replanNumber = modelReplanCount + 1;
    // Count attempts, not only accepted revisions. A malformed or unusable
    // recovery proposal must not create an unbounded planner loop.
    modelReplanCount = replanNumber;
    const recovery = createRecoveryContract({
      id: `${task.id}:recovery:${replanNumber}`,
      cause,
      failedRequirement: issues[0],
      evidence: issues,
      attemptedStrategies: [
        ...ledger.recoveryContracts.flatMap((item) => item.attemptedStrategies),
      ],
      forbiddenRepeats: nextActions,
      proposedRecovery: "replan",
      ...(supersedeNodeId ? { supersedeNodeId } : {}),
    });
    recordRecoveryContract(ledger, recovery);
    persistLedger();
    try {
      let result = await requestModelPlanForCurrentTask(recovery);
      for (let attempt = 0; attempt < 2; attempt += 1) {
        let rejectionReason: string | undefined;
        if (!result.proposal) {
          rejectionReason = result.error ?? "planner returned no proposal";
        } else {
          const normalizedProposal = supersedeNodeId
            ? normalizeRecoveryPlanProposal(
                result.proposal,
                ledger.taskGraph?.nodes ?? [],
                supersedeNodeId,
              )
            : {
                ...normalizeAppendOnlyRecoveryPlanProposal(
                  result.proposal,
                  ledger.taskGraph?.nodes ?? [],
                ),
                inferred: false,
              };
          if (!normalizedProposal.proposal) {
            rejectionReason =
              normalizedProposal.reason ??
              `Recovery proposal did not supersede failed node ${supersedeNodeId}.`;
          } else {
            try {
              acceptModelPlan(
                normalizedProposal.proposal,
                `Model replan after ${cause.toLowerCase().replaceAll("_", " ")}.${
                  normalizedProposal.inferred
                    ? " Controller recorded the matching failed-node supersession."
                    : ""
                }`,
                recovery,
              );
              return true;
            } catch (error) {
              rejectionReason =
                error instanceof Error ? error.message : String(error);
            }
          }
        }

        logger?.warn("agent.plan.rejected", {
          reason: rejectionReason,
          replan: replanNumber,
          attempt: attempt + 1,
        });
        if (attempt === 1 || !rejectionReason) return false;

        // A local model can produce a useful initial plan and then fall back
        // to prose or repeat stale node ids after a tool-boundary failure.
        // Give the same semantic planner one bounded retry with the exact
        // controller rejection. This preserves LLM plan authority while
        // preventing a single malformed recovery response from becoming a
        // terminal completion blocker.
        result = await requestModelPlanForCurrentTask(
          recovery,
          rejectionReason,
        );
      }
      return false;
    } catch (error) {
      if (
        signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      )
        return false;
      logger?.warn("agent.plan.rejected", {
        reason: error instanceof Error ? error.message : String(error),
        replan: replanNumber,
      });
    }
    return false;
  };

  const recoverModelPlanDeadEnd = async (turn: number): Promise<boolean> => {
    if (
      planningMode !== "model" ||
      !modelPlanHasUnfinishedNodes() ||
      currentModelNode()
    )
      return false;

    const unfinishedNodes = (ledger.taskGraph?.nodes ?? []).filter(
      (node) => node.status !== "passed" && node.status !== "superseded",
    );
    const staleNodeSummary = unfinishedNodes
      .filter((node) => node.status === "failed" || node.status === "blocked")
      .map((node) => `${node.id} (${node.status})`)
      .slice(0, 12)
      .join(", ");
    const issues = [
      `The accepted LLM-authored plan has no ready or running node at turn ${turn}.`,
      staleNodeSummary
        ? `The following plan history is failed or blocked and may be preventing progress: ${staleNodeSummary}.`
        : "The remaining plan nodes are not executable from the current dependency state.",
    ];
    const nextActions = [
      "Return a fresh append-only continuation for the remaining objective.",
      "Supersede every obsolete failed or blocked node required to reopen the remaining path; preserve valid passed history.",
      "Add fresh nodes for the complete remaining semantic work, including any required workspace mutation and verification.",
      "Do not make a new node depend on a blocked, failed, or superseded node.",
    ];
    const replanned = await appendModelRecoveryPlan(
      issues,
      nextActions,
      "PLAN_DEAD_END",
    );
    if (!replanned) return false;

    // This recovery is still a planner proposal. The controller only resets
    // transient execution counters and schedules the newly accepted graph;
    // it does not manufacture semantic nodes or reorder the LLM's plan.
    unresolvedBlockers = 0;
    repeatedErrorCount = 0;
    lastErrorCode = undefined;
    repeatedCallCount = 0;
    lastCallSignature = undefined;
    noActionCount = 0;
    transitionPhase(ledger, "plan", loopOptions);
    persistLedger();
    return true;
  };

  const initialPlanResult = await initializeModelPlan();
  if (initialPlanResult) return initialPlanResult;

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
    if (pendingRecoveryInstruction) {
      messages.push({ role: "user", content: pendingRecoveryInstruction });
      pendingRecoveryInstruction = undefined;
    }
    syncModelPlanScope();
    refreshStagedWorkUnitPrompt();
    const activeWorkUnitTarget = criteriaWritePaths[0] ?? objectivePaths[0];
    const activeTargetExists =
      stagedTask &&
      activeWorkUnitTarget !== undefined &&
      observedExistingPaths.has(normalizeWorkspacePath(activeWorkUnitTarget));
    const activeTargetKnown =
      stagedTask &&
      activeWorkUnitTarget !== undefined &&
      (observedExistingPaths.has(
        normalizeWorkspacePath(activeWorkUnitTarget),
      ) ||
        observedMissingPaths.has(normalizeWorkspacePath(activeWorkUnitTarget)));
    const activeTargetReadIsUsable =
      !activeWorkUnitTarget ||
      readObservations.get(normalizeWorkspacePath(activeWorkUnitTarget))
        ?.truncated !== true;
    const activeTargetReadWasTruncated =
      activeWorkUnitTarget !== undefined &&
      readObservations.get(normalizeWorkspacePath(activeWorkUnitTarget))
        ?.truncated === true;
    const activeTargetEvidenceReady =
      stagedTask &&
      activeTargetKnown &&
      activeTargetReadIsUsable &&
      stagedMutationRequired;
    const activeTargetRejected =
      stagedTask &&
      activeWorkUnitTarget !== undefined &&
      rejectedEditPaths.has(normalizeWorkspacePath(activeWorkUnitTarget));
    // Once ReadFile has proven that the active staged target exists, exposing
    // the full discovery catalog lets a small local model postpone the
    // required mutation indefinitely. Narrow the next schema to mutation
    // tools. A failed edit on an existing target reopens only the exact read /
    // edit recovery pair; it must not fall through to arbitrary Shell calls.
    const activeModelNode = currentModelNode();
    const runnableModelNode =
      activeModelNode &&
      ["ready", "running", "verifying"].includes(activeModelNode.status)
        ? activeModelNode
        : undefined;
    if (
      planningMode === "model" &&
      modelPlanHasUnfinishedNodes() &&
      !runnableModelNode
    ) {
      if (await recoverModelPlanDeadEnd(turn)) continue;
      // A failed/blocked LLM node cannot be used as an implicit permission
      // surface. If its recovery plan was rejected, stop with the exact
      // blocker instead of making another provider call that can only emit
      // stale or unexposed tools.
      finalText =
        finalText.trim() ||
        "The LLM-authored plan has no executable ready node after recovery failed; a new semantic replacement plan is required before continuing.";
      unresolvedBlockers = Math.max(1, unresolvedBlockers);
      addTaskBlocker(ledger, {
        id: `${task.id}:plan-no-runnable-node:${turn}`,
        summary: finalText,
        recoverable: true,
        suggestedAction:
          "Request a new LLM-authored replacement plan for the failed node.",
      });
      const finished = await finish(turn, false);
      if (finished === CONTINUE_AGENT_LOOP)
        throw new Error("A failed LLM plan has no runnable recovery node.");
      return finished;
    }
    const plannedTools = activeModelNode?.scope.allowedTools ?? [];
    const planCanMutate = plannedTools.some((name) =>
      ["EditFile", "WriteFile", "CreateFile", "DeleteFile", "Shell"].includes(
        name,
      ),
    );
    const modelAllowedTools = activeModelNode
      ? [
          ...new Set([
            ...plannedTools,
            ...(planCanMutate ? MODEL_PLAN_CONTEXT_TOOLS : []),
          ]),
        ]
      : [];
    // An empty tool scope is meaningful: it is either a bounded semantic
    // decision or an explicit user clarification. Never reinterpret it as
    // access to the complete host tool catalog.
    if (
      planningMode === "model" &&
      activeModelNode &&
      activeModelNode.status === "ready" &&
      modelNodeNeedsClarification(activeModelNode)
    ) {
      updateTaskNode(activeModelNode.id, "blocked");
      unresolvedBlockers = Math.max(1, unresolvedBlockers);
      finalText = `The LLM-authored plan requires a user decision before continuing: ${activeModelNode.objective}`;
      const finished = await finish(turn, false);
      if (finished === CONTINUE_AGENT_LOOP)
        throw new Error("A non-executable LLM plan node cannot continue.");
      return finished;
    }
    if (
      planningMode === "model" &&
      activeModelNode &&
      activeModelNode.status === "ready" &&
      modelAllowedTools.length === 0 &&
      !modelNodeIsSemantic(activeModelNode)
    ) {
      updateTaskNode(activeModelNode.id, "blocked");
      unresolvedBlockers = Math.max(1, unresolvedBlockers);
      finalText = `The LLM-authored plan contains a node with no executable action: ${activeModelNode.objective}`;
      const finished = await finish(turn, false);
      if (finished === CONTINUE_AGENT_LOOP)
        throw new Error("A non-executable LLM plan node cannot continue.");
      return finished;
    }
    if (
      planningMode === "model" &&
      activeModelNode &&
      activeModelNode.status === "ready" &&
      modelNodeIsSemantic(activeModelNode)
    )
      updateTaskNode(activeModelNode.id, "running");
    const turnTools = options.tools.filter((tool) => {
      if (
        planningMode === "model" &&
        (!activeModelNode || !modelAllowedTools.includes(tool.name))
      )
        return false;
      if (forcedRecoveryTool) return tool.name === forcedRecoveryTool.name;
      if (activeTargetExists && tool.name === "CreateFile") return false;
      if (activeTargetRejected)
        return STAGED_EDIT_RECOVERY_TOOL_NAMES.has(tool.name);
      if (
        stagedTask &&
        activeTargetReadWasTruncated &&
        !activeTargetEvidenceReady
      )
        return STAGED_DISCOVERY_TOOL_NAMES.has(tool.name);
      if (
        stagedTask &&
        stagedNeedsSupportingEvidence &&
        !activeTargetEvidenceReady
      )
        return STAGED_DISCOVERY_TOOL_NAMES.has(tool.name);
      if (!activeTargetEvidenceReady) return true;
      if (activeTargetExists)
        return (
          stagedDeletionAllowed
            ? STAGED_EXISTING_DESTRUCTIVE_TOOL_NAMES
            : STAGED_EXISTING_MUTATION_TOOL_NAMES
        ).has(tool.name);
      return STAGED_MUTATION_TOOL_NAMES.has(tool.name);
    });
    const executableTurnTools = new Set(turnTools.map((tool) => tool.name));
    const turnMaxOutputTokens =
      task.maxOutputTokens === undefined && stagedTask
        ? activeTargetEvidenceReady
          ? STAGED_MUTATION_OUTPUT_TOKENS
          : STAGED_DISCOVERY_OUTPUT_TOKENS
        : maxOutputTokens;
    const currentNode = currentModelNode();
    const decisionContext = compileDecisionContext({
      turn,
      ...(currentNode?.id ? { nodeId: currentNode.id } : {}),
      objective: task.objective,
      subtask:
        currentNode?.objective ??
        (activeWorkUnitTarget
          ? `Continue the bounded work unit for ${activeWorkUnitTarget}.`
          : undefined),
      constraints,
      ...(task.context?.trim()
        ? {
            evidence: [
              {
                source: "host-context",
                kind: "repository",
                summary: task.context,
                relevance: 1,
              },
              ...ledger.evidence.map((evidence) => ({
                source: evidence.source,
                kind: evidence.kind,
                summary: evidence.summary,
                relevance: evidence.relevance,
              })),
            ],
          }
        : {
            evidence: ledger.evidence.map((evidence) => ({
              source: evidence.source,
              kind: evidence.kind,
              summary: evidence.summary,
              relevance: evidence.relevance,
            })),
          }),
      observations: messages
        .filter((message) => message.role !== "system")
        .slice(-16)
        .map((message) => ({
          source: message.role,
          text: message.content,
        })),
      ...(pendingRecoveryInstruction
        ? { unresolvedProblem: pendingRecoveryInstruction }
        : ledger.blockers.at(-1)?.summary
          ? { unresolvedProblem: ledger.blockers.at(-1)!.summary }
          : {}),
      legalActions: turnTools.map((tool) => tool.name),
      expectedOutput:
        currentNode?.objective ?? "Choose one bounded, legal next action.",
      tokenBudget: Math.min(
        16_384,
        Math.max(1_024, Math.ceil((contextBudgetChars ?? 50_000) / 4)),
      ),
    });
    const continuation = latestToolContinuation(messages);
    const decisionUser: NormalizedMessage = {
      role: "user",
      content: decisionContext.text,
    };
    const requestMessages: NormalizedMessage[] = [
      {
        role: "system",
        content:
          messages[0]?.role === "system"
            ? messages[0].content
            : baseSystemPrompt,
      },
      ...(messages.at(-1)?.role === "tool"
        ? [decisionUser, ...continuation]
        : [...continuation, decisionUser]),
    ];
    logger?.debug("agent.decision_context.compiled", {
      turn,
      sourceCount: decisionContext.sourceIds.length,
      omittedSections: decisionContext.omittedSections,
      packetChars: decisionContext.text.length,
      continuationMessages: requestMessages.length - 2,
    });
    const assistantTextParts: string[] = [];
    options.trace?.record({
      taskId: task.id,
      type: "turn.started",
      phase: ledger.phase,
      data: {
        turn,
        messageCount: messages.length,
        toolChoice: turnToolChoice,
        maxOutputTokens: turnMaxOutputTokens,
      },
    });
    logger?.info("agent.turn.started", {
      turn,
      messageCount: messages.length,
      toolChoice: turnToolChoice,
      maxOutputTokens: turnMaxOutputTokens,
      contextChars: messages.reduce(
        (total, message) => total + message.content.length,
        0,
      ),
    });
    const toolCalls: ToolCall[] = [];
    let sawText = false;
    let reasoningChars = 0;
    let lastReasoningNotice = 0;
    let recoverableProviderFailure: ProviderFailure | undefined;
    let done = false;
    const presentAssistantText = (text: string): void => {
      if (!text) return;
      assistantTextParts.push(text);
      emit(loopOptions, { type: "assistant.delta", text });
    };
    try {
      for await (const event of normalizeProviderEvents(
        options.provider.stream(
          {
            modelId: providerModelId(task),
            messages: requestMessages,
            temperature,
            maxOutputTokens: turnMaxOutputTokens,
            ...(turnTools.length > 0
              ? {
                  tools: turnTools.map(toolSchema),
                  toolChoice: turnToolChoice,
                }
              : {}),
            stream: true,
          },
          signal,
        ),
        turn,
      )) {
        if (event.type === "text.delta") {
          sawText = true;
          // Provider normalization has already quarantined tool-shaped text;
          // every text delta reaching the kernel is ordinary assistant text.
          presentAssistantText(event.text);
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
          if (signal.aborted || event.error.code === "CANCELLED")
            return await cancellationResult(turn);
          if (event.error.code === "MODEL_PROTOCOL_ERROR") {
            // The provider boundary has already quarantined the malformed
            // textual envelope, so the bad payload must never be echoed back
            // to the provider. Leave the current turn, add only a typed
            // correction, and let the next bounded model decision recover.
            recoverableProviderFailure = event.error;
            break;
          }
          const message = failureMessage(event);
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
    if (recoverableProviderFailure) {
      modelProtocolRecoveryCount += 1;
      const message = failureMessage({
        type: "error",
        error: recoverableProviderFailure,
      });
      logger?.warn("agent.model.protocol_recovery", {
        turn,
        count: modelProtocolRecoveryCount,
        maximum: MAX_MODEL_PROTOCOL_RECOVERIES,
        code: recoverableProviderFailure.code,
      });
      if (modelProtocolRecoveryCount > MAX_MODEL_PROTOCOL_RECOVERIES)
        return await failureResult(turn, message, recoverableProviderFailure);

      const assistantText = assistantTextParts.join("").trim();
      if (assistantText && !isToolShapedAssistantText(assistantText))
        messages.push({ role: "assistant", content: assistantText });
      messages.push({
        role: "user",
        content: JSON.stringify({
          type: "model_protocol_error",
          code: recoverableProviderFailure.code,
          message: recoverableProviderFailure.message,
          recoverable: true,
          instruction:
            "Discard the malformed envelope. Continue the current task with exactly one native structured tool call matching the available schema, or plain text only when this node is semantic. Never emit JSON, XML, Markdown fences, or pseudo-tool syntax as prose.",
        }),
      });
      finalText = message;
      transitionPhase(ledger, "reflect", loopOptions);
      persistLedger();
      continue;
    }
    // A valid provider response resets only the consecutive protocol-error
    // budget; later independent model/runtime failures get their own bounded
    // opportunity without making the task unbounded.
    modelProtocolRecoveryCount = 0;
    if (!done && !sawText && toolCalls.length === 0)
      return await failureResult(turn, "Provider ended without a response.");
    if (toolCalls.length > MAX_TOOL_CALLS_PER_RESPONSE) {
      oversizedBatchCount += 1;
      const error = new ToolError(
        "TOOL_BATCH_TOO_LARGE",
        `The model requested ${toolCalls.length} tool calls in one response; the maximum tool calls per response is ${MAX_TOOL_CALLS_PER_RESPONSE}.`,
        {
          recoverable: true,
          suggestedAction:
            "Use the result of the current observation and request a smaller next tool batch.",
          details: {
            requested: toolCalls.length,
            maximum: MAX_TOOL_CALLS_PER_RESPONSE,
          },
        },
      );
      logger?.warn("agent.tool_batch.rejected", {
        turn,
        code: error.code,
        ...(error.details ?? {}),
      });
      if (oversizedBatchCount >= 2)
        return await failureResult(turn, error.message);

      // Do not execute or acknowledge the speculative calls individually.
      // Give the model one bounded recovery turn with a structured correction
      // instead, preserving provider message validity while preventing a
      // single response from becoming an unobserved tool storm.
      const presentedAssistantText = assistantTextParts.join("");
      messages.push({
        role: "assistant",
        content: presentedAssistantText,
      });
      messages.push({
        role: "user",
        content: JSON.stringify({
          type: "tool_batch_rejected",
          code: error.code,
          message: error.message,
          recoverable: true,
          suggestedAction: error.suggestedAction,
          maximum: MAX_TOOL_CALLS_PER_RESPONSE,
        }),
      });
      finalText = error.message;
      transitionPhase(ledger, "reflect", loopOptions);
      persistLedger();
      continue;
    }

    const presentedAssistantText = assistantTextParts.join("");
    finalText = presentedAssistantText || finalText;
    logger?.debug("agent.model.response", {
      turn,
      done,
      textLength: presentedAssistantText.length,
      toolCallCount: toolCalls.length,
    });

    // A local runtime may still turn a textual pseudo-tool envelope into a
    // tool event even when this request deliberately exposed no tools. Do
    // not let that event fall through to the ordinary permission path: that
    // would manufacture a misleading PERMISSION_DENIED result and could
    // execute a call with an empty argument object on the next retry. Treat
    // it as a provider/model protocol defect, quarantine the call, and give
    // the model one bounded correction turn instead.
    if (toolCalls.length > 0 && turnToolChoice === "none") {
      const protocolError: ProviderFailure = {
        code: "MODEL_PROTOCOL_ERROR",
        message:
          "The model emitted a tool call although this decision exposed no tools.",
      };
      const suggestedAction =
        "Answer from the available observation or wait for the next turn with an explicitly exposed tool.";
      modelProtocolRecoveryCount += 1;
      logger?.warn("agent.model.protocol_recovery", {
        turn,
        count: modelProtocolRecoveryCount,
        maximum: MAX_MODEL_PROTOCOL_RECOVERIES,
        code: protocolError.code,
        reason: "tool_call_when_tools_disabled",
      });
      if (modelProtocolRecoveryCount > MAX_MODEL_PROTOCOL_RECOVERIES)
        return await failureResult(turn, protocolError.message, {
          code: protocolError.code,
          message: protocolError.message,
        });
      messages.push({
        role: "user",
        content: JSON.stringify({
          type: "model_protocol_error",
          code: protocolError.code,
          message: protocolError.message,
          recoverable: true,
          suggestedAction,
          instruction:
            "Discard the attempted tool call. This turn has no tools. Continue with plain text only, or wait for a later turn that explicitly exposes the required native tool.",
        }),
      });
      finalText = protocolError.message;
      transitionPhase(ledger, "reflect", loopOptions);
      persistLedger();
      continue;
    }

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
      const repeatedReadObservation = (() => {
        if (
          mode !== "coding" ||
          toolCalls.length !== 1 ||
          toolCalls[0]?.name !== "ReadFile" ||
          readLoopRecoveryCount >= 2
        )
          return undefined;
        let input: unknown = {};
        try {
          input = parseToolInput(toolCalls[0]);
        } catch {
          return undefined;
        }
        if (
          typeof input !== "object" ||
          input === null ||
          !("path" in input) ||
          typeof input.path !== "string"
        )
          return undefined;
        const path = normalizeWorkspacePath(input.path);
        // A forced recovery read is deliberately allowed even when the same
        // file was observed earlier. Its exact path is the controller's way
        // to refresh the post-failure state; the execution boundary below
        // rejects every other path.
        if (forcedRecoveryTool || rejectedEditPaths.has(path)) return undefined;
        const observation = readObservations.get(path);
        if (!observation || observation.revision !== mutationRevision)
          return undefined;
        // One extra read is legitimate when the first bounded response was
        // truncated. Once the same file has been observed twice at the same
        // workspace revision, changing line ranges is not new progress.
        const minimumReadsBeforeRecovery = observation.truncated ? 2 : 1;
        return observation.successfulReads >= minimumReadsBeforeRecovery
          ? { path }
          : undefined;
      })();
      const repeatedReadCall =
        mode === "coding" &&
        toolCalls.length === 1 &&
        toolCalls[0]?.name === "ReadFile" &&
        readLoopRecoveryCount < 2;
      if (
        (repeatedCallCount >= NON_PROGRESS_LIMIT || repeatedReadObservation) &&
        repeatedReadCall
      ) {
        const repeatedCall = toolCalls[0]!;
        let repeatedInput: unknown = {};
        try {
          repeatedInput = parseToolInput(repeatedCall);
        } catch {
          repeatedInput = {};
        }
        const repeatedPath =
          typeof repeatedInput === "object" &&
          repeatedInput !== null &&
          "path" in repeatedInput &&
          typeof repeatedInput.path === "string"
            ? normalizeWorkspacePath(repeatedInput.path)
            : undefined;
        const currentTarget = criteriaWritePaths[0] ?? objectivePaths[0];
        const target = currentTarget ?? repeatedPath ?? "the current target";
        if (
          stagedTask &&
          stagedNeedsSupportingEvidence &&
          !stagedSupportingEvidenceObserved
        ) {
          const normalizedTarget = currentTarget
            ? normalizeWorkspacePath(currentTarget)
            : undefined;
          const supportingPath =
            [...hostContextPaths].find(
              (candidate) =>
                candidate !== normalizedTarget &&
                objectivePaths.some(
                  (objectivePath) =>
                    normalizeWorkspacePath(objectivePath) === candidate,
                ),
            ) ??
            objectivePaths.find(
              (candidate) =>
                normalizeWorkspacePath(candidate) !== normalizedTarget,
            );
          if (supportingPath) {
            forcedRecoveryTool = { name: "ReadFile", path: supportingPath };
            pendingRecoveryInstruction =
              `Host recovery: ${target} has already been observed. ` +
              `Read the supporting target ${supportingPath} once before editing ${target}.`;
          }
        }
        const correction: ToolResult = {
          tool: repeatedCall.name,
          ok: false,
          error:
            "The host already has a successful observation for this file; the repeated read was not executed.",
          code: "CONFLICT",
          recoverable: true,
          ...(repeatedPath ? { path: repeatedPath } : {}),
          suggestedAction: `Use the existing observation and make the smallest implementation change in ${target}.`,
          durationMs: 0,
        };
        messages.push({
          role: "assistant",
          content: presentedAssistantText,
          toolCalls: normalizeToolCallsForContinuation(toolCalls),
        });
        messages.push({
          role: "tool",
          toolCallId: repeatedCall.id,
          content: toolMessageContent(correction, task),
        });
        messages.push({
          role: "user",
          content:
            stagedNeedsSupportingEvidence && !stagedSupportingEvidenceObserved
              ? (pendingRecoveryInstruction ??
                `Host recovery: read one supporting target before editing ${target}.`)
              : `Host recovery: ReadFile has already returned evidence for ${repeatedPath ?? target}. ` +
                `This is bounded work unit ${target}. Do not call ReadFile on the same path again. ` +
                "Use exactly one EditFile or WriteFile now for the smallest requested change, " +
                "or use SearchText only if a specific symbol is still missing. Do not narrate.",
        });
        toolRuns.push(correction);
        observeTool(
          repeatedCall,
          toolMap.get(repeatedCall.name),
          correction,
          repeatedInput,
        );
        readLoopRecoveryCount += 1;
        lastCallSignature = undefined;
        repeatedCallCount = 0;
        noActionCount = 0;
        logger?.warn("agent.non_progress.recovered", {
          reason: "repeated_read",
          recoveryAttempt: readLoopRecoveryCount,
          target,
        });
        transitionPhase(ledger, "reflect", loopOptions);
        persistLedger();
        continue;
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
        const finished = await finish(turn);
        if (finished === CONTINUE_AGENT_LOOP) continue;
        return finished;
      }
    }

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
      const finished = await finish(turn);
      if (finished === CONTINUE_AGENT_LOOP) continue;
      return finished;
    }

    // A repeated call is an observation failure, not permission to execute
    // the same action again. Feed a typed conflict back once and force the
    // following turn to answer from the existing observation.
    const repeatedTextualBatch = toolCalls.some((call) =>
      call.id.startsWith("recovered-"),
    );
    if (
      repeatedTextualBatch &&
      repeatedCallCount >= 2 &&
      toolCalls.length > 0
    ) {
      messages.push({
        role: "assistant",
        content: presentedAssistantText,
        toolCalls: normalizeToolCallsForContinuation(toolCalls),
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
            "The model repeated a tool call that already produced an observation; the duplicate was not executed.",
          code: "CONFLICT",
          recoverable: true,
          suggestedAction:
            "Use the previous tool result and choose a different action or answer.",
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
          content: toolMessageContent(result, task),
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
      ...(toolCalls.length > 0
        ? { toolCalls: normalizeToolCallsForContinuation(toolCalls) }
        : {}),
    });

    // A semantic node is an LLM-authored bounded decision, not a missing
    // workspace permission.  Let the worker return its decision as evidence,
    // keep it in the task transcript for the dependent node, and advance the
    // graph without pretending that prose was a file mutation.
    if (
      planningMode === "model" &&
      activeModelNode &&
      modelNodeIsSemantic(activeModelNode) &&
      toolCalls.length === 0 &&
      !isToolShapedAssistantText(presentedAssistantText)
    ) {
      const semanticText = presentedAssistantText.trim();
      if (semanticText.length > 0) {
        const timestamp = new Date().toISOString();
        modelNodeActionState(activeModelNode.id).semanticCount += 1;
        recordTaskAction(ledger, {
          id: `${task.id}:semantic:${activeModelNode.id}:${turn}`,
          kind: "decide",
          target: activeModelNode.id,
          status: "succeeded",
          startedAt: timestamp,
          completedAt: timestamp,
          summary: "The LLM completed a bounded semantic plan node.",
        });
        addTaskEvidence(ledger, {
          id: `${task.id}:decision-evidence:${activeModelNode.id}:${turn}`,
          kind: "decision",
          source: "LLM semantic worker",
          summary: summarizeFailure(semanticText),
          relevance: 0.75,
          freshness: 1,
        });
        updateTaskNode(activeModelNode.id, "passed");
        modelReplanCount = 0;
        transitionPhase(ledger, "reflect", loopOptions);
        persistLedger();
        finalText = semanticText;
        continue;
      }
    }

    if (toolCalls.length > 0) {
      noActionCount = 0;
      const firstMutationCallIndex = toolCalls.findIndex((call) => {
        const tool = toolMap.get(call.name);
        return tool?.risk === "write" || tool?.risk === "destructive";
      });
      let responseMutationSeen = false;
      // An LLM-authored plan node is an observation boundary. Once its first
      // action has returned, the graph may advance to a different scope, so
      // later calls from the same provider response are stale by definition.
      // Keep the tool-result envelope valid, but defer those calls to a fresh
      // model turn instead of executing them against the next node.
      let modelPlanObservationClosed = false;
      for (const [callIndex, call] of toolCalls.entries()) {
        transitionPhase(ledger, "act", loopOptions);
        const tool = toolMap.get(call.name);
        // Capture the LLM-authored node before any result handling. Parsing or
        // schema validation can fail before the executor is reached, but the
        // failure still belongs to this node and must remain visible to the
        // same plan/recovery boundary.
        const planNodeIdBeforeCall =
          planningMode === "model" ? currentModelNode()?.id : undefined;
        if (planningMode === "model" && modelPlanObservationClosed) {
          let deferredInput: unknown = {};
          try {
            deferredInput = parseToolInput(call);
          } catch {
            deferredInput = {};
          }
          const result: ToolResult = {
            tool: call.name,
            ok: false,
            error:
              "The host deferred this call because the preceding LLM plan-node action already produced an observation in this response.",
            code: "CONFLICT",
            recoverable: true,
            suggestedAction:
              "Use the preceding tool result and choose the next action in a new model turn.",
            durationMs: 0,
          };
          emit(loopOptions, {
            type: "tool.started",
            callId: call.id,
            tool: call.name,
            input: deferredInput,
            ...(tool?.risk ? { risk: tool.risk } : {}),
          });
          toolRuns.push(result);
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: toolMessageContent(result, task),
          });
          emit(loopOptions, {
            type: "tool.finished",
            callId: call.id,
            tool: call.name,
            result,
          });
          continue;
        }
        if (planningMode === "model") modelPlanObservationClosed = true;
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
            content: toolMessageContent(result, task),
          });
          emit(loopOptions, {
            type: "tool.finished",
            callId: call.id,
            tool: call.name,
            result,
          });
          continue;
        }
        const isMutationCall =
          tool.risk === "write" || tool.risk === "destructive";
        if (
          stagedTask &&
          isMutationCall &&
          firstMutationCallIndex > 0 &&
          callIndex === firstMutationCallIndex
        ) {
          const result: ToolResult = {
            tool: call.name,
            ok: false,
            error:
              "The host did not execute this mutation because the model bundled it after another tool call in the same response.",
            code: "CONFLICT",
            recoverable: true,
            suggestedAction:
              "Use the preceding tool result in a new model turn, then emit exactly one EditFile, WriteFile or DeleteFile call.",
            durationMs: 0,
          };
          emit(loopOptions, {
            type: "tool.started",
            callId: call.id,
            tool: call.name,
            input: {},
            risk: tool.risk,
          });
          toolRuns.push(result);
          observeTool(call, tool, result, {});
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: toolMessageContent(result, task),
          });
          emit(loopOptions, {
            type: "tool.finished",
            callId: call.id,
            tool: call.name,
            result,
          });
          continue;
        }
        // Tool calls in one provider response share the same pre-action
        // context. Once a mutation is requested, executing another call from
        // that response would let a small model batch dependent edits before
        // observing the first result. In staged work units, also quarantine
        // later reads/commands so the next model turn gets a clean observation
        // boundary. The skipped call still receives a structured tool result
        // so the provider message remains valid, but it never reaches the
        // executor.
        if (
          responseMutationSeen &&
          (stagedTask || planningMode === "model" || isMutationCall)
        ) {
          const result: ToolResult = {
            tool: call.name,
            ok: false,
            error:
              "The host did not execute this call because a prior mutation was already requested in the same model response.",
            code: "CONFLICT",
            recoverable: true,
            suggestedAction:
              "Wait for the previous tool result, then choose exactly one next action in a new model turn.",
            durationMs: 0,
          };
          emit(loopOptions, {
            type: "tool.started",
            callId: call.id,
            tool: call.name,
            input: {},
            risk: tool.risk,
          });
          toolRuns.push(result);
          observeModelPlanAction(call, tool, result, {}, planNodeIdBeforeCall);
          observeTool(call, tool, result, {});
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: toolMessageContent(result, task),
          });
          emit(loopOptions, {
            type: "tool.finished",
            callId: call.id,
            tool: call.name,
            result,
          });
          continue;
        }
        if (isMutationCall) responseMutationSeen = true;
        if (!executableTurnTools.has(call.name)) {
          const result: ToolResult = {
            tool: call.name,
            ok: false,
            error: `Tool ${call.name} is not allowed in the current ${
              planningMode === "model"
                ? "LLM-authored plan node"
                : "staged work unit"
            }.`,
            code: "PERMISSION_DENIED",
            recoverable: true,
            suggestedAction:
              activeTargetEvidenceReady || activeTargetRejected
                ? "Use the currently exposed bounded mutation or ReadFile recovery tool instead of Shell or another unexposed tool."
                : "Use only tools exposed for the current turn policy.",
            durationMs: 0,
          };
          emit(loopOptions, {
            type: "tool.started",
            callId: call.id,
            tool: call.name,
            input: {},
            risk: tool.risk,
          });
          toolRuns.push(result);
          observeModelPlanAction(call, tool, result, {}, planNodeIdBeforeCall);
          observeTool(call, tool, result, {});
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: toolMessageContent(result, task),
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
          observeModelPlanAction(
            call,
            tool,
            result,
            input,
            planNodeIdBeforeCall,
          );
          observeTool(call, tool, result, input);
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: toolMessageContent(result, task),
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
          observeModelPlanAction(
            call,
            tool,
            result,
            input,
            planNodeIdBeforeCall,
          );
          observeTool(call, tool, result, input);
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: toolMessageContent(result, task),
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
        let planNodeIdAtAction: string | undefined = planNodeIdBeforeCall;
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
          const context = await createExecutionContext();
          const requestControllerApproval = async (
            risk: ToolRisk,
            description: string,
          ): Promise<void> => {
            if (context.approvalGranted === true) return;
            if (!context.requestApproval)
              throw new ToolError(
                "PERMISSION_DENIED",
                `Approval is required before ${tool.name} can execute this action.`,
                {
                  recoverable: true,
                  ...(requestedPath ? { path: requestedPath } : {}),
                  suggestedAction:
                    "Run this task from an interactive session and approve the exact action, or choose an explicit non-interactive permission mode.",
                },
              );
            const allowed = await context.requestApproval({
              description,
              risk,
              tool: tool.name,
              ...(requestedPath ? { path: requestedPath } : {}),
            });
            if (!allowed)
              throw new ToolError(
                "PERMISSION_DENIED",
                "The user denied this exact workspace action.",
                {
                  recoverable: true,
                  ...(requestedPath ? { path: requestedPath } : {}),
                  suggestedAction:
                    "Do not repeat the identical action. Replan around the user's decision or ask again only for a changed action.",
                  details: { reason: "user_denied" },
                },
              );
            // The approval is scoped to this single invocation. The workspace
            // tool consumes it so ASK/PLAN does not display a duplicate prompt.
            context.approvalGranted = true;
          };
          const asksForPlanBoundary =
            context.permissionMode === "ASK" ||
            context.permissionMode === "PLAN";
          if (planningMode === "model") {
            planNodeIdAtAction ??= currentModelNode()?.id;
            const planNode = currentModelNode();
            if (!planNode)
              throw new ToolError(
                "PERMISSION_DENIED",
                "The LLM-authored plan has no ready node for this action.",
                {
                  recoverable: true,
                  suggestedAction:
                    "Wait for the controller to expose the next ready plan node; do not invent work outside the plan.",
                },
              );
            const planAllowsTool =
              planNode.scope.allowedTools.length === 0 ||
              planNode.scope.allowedTools.includes(tool.name) ||
              (tool.risk === "read" && MODEL_PLAN_CONTEXT_TOOLS.has(tool.name));
            if (!planAllowsTool) {
              if (asksForPlanBoundary)
                await requestControllerApproval(
                  tool.risk,
                  `Allow ${tool.name} outside the tools declared by LLM plan node ${planNode.id}${requestedPath ? ` for ${requestedPath}` : ""}`,
                );
              else
                throw new ToolError(
                  "PERMISSION_DENIED",
                  `Tool ${tool.name} is not allowed by the current LLM-authored plan node ${planNode.id}.`,
                  {
                    recoverable: true,
                    suggestedAction: `Use one of the tools allowed by plan node ${planNode.id}: ${planNode.scope.allowedTools.join(", ")}.`,
                  },
                );
            }
            const scopedPaths = planNode.scope.candidateFiles.map(
              normalizeWorkspacePath,
            );
            if (
              tool.risk === "read" &&
              requestedPath &&
              scopedPaths.length > 0 &&
              !scopedPaths.includes(requestedPath)
            ) {
              if (asksForPlanBoundary)
                await requestControllerApproval(
                  "read",
                  `Allow ${tool.name} to access ${requestedPath} outside the paths declared by LLM plan node ${planNode.id}`,
                );
              else
                throw new ToolError(
                  "CONFLICT",
                  `Read ${requestedPath} is outside the bounded scope of LLM-authored plan node ${planNode.id}.`,
                  {
                    path: requestedPath,
                    recoverable: true,
                    suggestedAction: `The planner must provide a replacement workspace node whose explicit candidateFiles include ${requestedPath}, or choose a path inside the current node scope.`,
                  },
                );
            }
            if (tool.risk === "write" || tool.risk === "destructive") {
              if (
                scopedPaths.length === 0 ||
                !requestedPath ||
                !scopedPaths.includes(requestedPath)
              ) {
                if (!requestedPath)
                  throw new ToolError(
                    "CONFLICT",
                    `Mutation without a path is outside the bounded scope of LLM-authored plan node ${planNode.id}.`,
                    {
                      recoverable: true,
                      suggestedAction: `The planner must provide an explicit workspace path for node ${planNode.id} before mutating.`,
                    },
                  );
                if (asksForPlanBoundary)
                  await requestControllerApproval(
                    tool.risk,
                    `Allow ${tool.name} to mutate ${requestedPath} outside the paths declared by LLM plan node ${planNode.id}`,
                  );
                else
                  throw new ToolError(
                    "CONFLICT",
                    `Mutation ${requestedPath} is outside the bounded scope of LLM-authored plan node ${planNode.id}.`,
                    {
                      path: requestedPath,
                      recoverable: true,
                      suggestedAction: `The planner must provide a replacement node whose explicit candidateFiles include ${requestedPath}.`,
                    },
                  );
              }
            }
            if (planNode.status === "ready")
              updateTaskNode(planNode.id, "running");
          }
          if (
            forcedRecoveryTool &&
            tool.name === forcedRecoveryTool.name &&
            requestedPath !== forcedRecoveryTool.path
          )
            throw new ToolError(
              "CONFLICT",
              `Recovery requires ReadFile on ${forcedRecoveryTool.path}; ${requestedPath ?? "the requested path"} is outside the authorized recovery target.`,
              {
                ...(requestedPath ? { path: requestedPath } : {}),
                recoverable: true,
                suggestedAction: `Use ReadFile on the exact recovery path ${forcedRecoveryTool.path}; do not select another file until that observation succeeds.`,
              },
            );
          if (
            tool.name === "ReadFile" &&
            requestedPath &&
            observedMissingPaths.has(requestedPath) &&
            forcedRecoveryTool?.path !== requestedPath
          )
            throw new ToolError(
              "CONFLICT",
              `ReadFile already confirmed that ${requestedPath} does not exist at the current workspace revision.`,
              {
                path: requestedPath,
                recoverable: true,
                suggestedAction:
                  "Do not repeat ReadFile. Use ListFiles, GlobFiles or SearchText to discover an existing path, or use the write operation allowed by the active plan node if this is a new artifact.",
                details: { reason: "MISSING_PATH_ALREADY_OBSERVED" },
              },
            );
          if (
            activeTargetExists &&
            tool.name === "CreateFile" &&
            requestedPath === normalizeWorkspacePath(activeWorkUnitTarget ?? "")
          )
            throw new ToolError(
              "PATH_EXISTS",
              `${requestedPath} already exists and is the active staged target. Use EditFile for a precise change or WriteFile only when a complete replacement is intentional.`,
              {
                path: requestedPath,
                recoverable: true,
                suggestedAction:
                  "Use EditFile with exact observed text; do not recreate an existing file.",
              },
            );
          if (
            activeTargetEvidenceReady &&
            STAGED_DISCOVERY_TOOL_NAMES.has(tool.name)
          )
            throw new ToolError(
              "CONFLICT",
              "The host already has sufficient evidence for the active staged target; choose a bounded mutation or verification tool.",
              {
                ...(requestedPath ? { path: requestedPath } : {}),
                recoverable: true,
                suggestedAction:
                  "Use EditFile, WriteFile, DeleteFile, RunTests, GitStatus or GitDiff for the current work unit. A failed mutation will reopen fresh discovery.",
              },
            );
          const editInput =
            tool.name === "EditFile" ? objectOutput(input) : undefined;
          const oldText = editInput?.oldText;
          const newText = editInput?.newText;
          if (
            stagedTask &&
            activeTargetEvidenceReady &&
            typeof oldText === "string" &&
            typeof newText === "string" &&
            oldText.length >= MAX_STAGED_FULL_REWRITE_CHARS &&
            newText.length >= MAX_STAGED_FULL_REWRITE_CHARS
          )
            throw new ToolError(
              "CONFLICT",
              "The host rejected a wholesale rewrite inside a bounded work unit.",
              {
                recoverable: true,
                ...(requestedPath ? { path: requestedPath } : {}),
                suggestedAction:
                  "Use the observed file and send one small exact oldText/newText replacement; do not resend the entire file.",
                details: {
                  reason: "STAGED_FULL_REWRITE_TOO_LARGE",
                  oldTextChars: oldText.length,
                  newTextChars: newText.length,
                  maximum: MAX_STAGED_FULL_REWRITE_CHARS,
                },
              },
            );
          if (tool.risk === "write" || tool.risk === "destructive")
            updateTaskNode(mutationNodeForPath(requestedPath), "running");
          if (tool.risk === "write" || tool.risk === "destructive") {
            const evidenceGate = evaluateMutationEvidenceGate({
              mode,
              declaredState: declaredEvidenceState,
              evidence: ledger.evidence,
              repositoryState: task.repositoryState,
              greenfieldIntent: task.greenfieldIntent,
            });
            if (!evidenceGate.allowed)
              throw new ToolError(
                "INSUFFICIENT_CONTEXT",
                `Mutation blocked: ${evidenceGate.reason ?? "relevant repository evidence is insufficient"}.`,
                {
                  recoverable: true,
                  ...(requestedPath ? { path: requestedPath } : {}),
                  suggestedAction:
                    "Use SearchText, ListFiles or ReadFile to acquire relevant repository evidence, then retry the mutation.",
                  details: { evidenceState: evidenceGate.state },
                },
              );
          }
          if (
            planningMode !== "model" &&
            (tool.risk === "write" || tool.risk === "destructive") &&
            criteriaWritePaths.length > 0 &&
            requestedPath &&
            !criteriaWritePaths.includes(requestedPath)
          )
            throw new ToolError(
              "CONFLICT",
              "The mutation targets " +
                requestedPath +
                ", but the current host mutation scope is " +
                criteriaWritePaths.join(", ") +
                ".",
              {
                path: requestedPath,
                recoverable: true,
                suggestedAction:
                  "Edit only one of the current host mutation targets: " +
                  criteriaWritePaths.join(", ") +
                  ".",
              },
            );
          if (
            planningMode !== "model" &&
            tool.name === "ReadFile" &&
            criteriaFeedbackActive &&
            criteriaReadPaths.length > 0 &&
            requestedPath &&
            !criteriaReadPaths.includes(requestedPath)
          )
            throw new ToolError(
              "CONFLICT",
              "The diagnostic read targets " +
                requestedPath +
                ", but the current repair context is " +
                criteriaReadPaths.join(", ") +
                ".",
              {
                path: requestedPath,
                recoverable: true,
                suggestedAction:
                  "Read the changed file, the reported failure path, or one of the current repair-context files: " +
                  criteriaReadPaths.join(", ") +
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
          if (context.checkpoint)
            checkpointPreservationCheck = async (activeCheckpoint) =>
              activeCheckpoint
                ? context.checkpoint!.isPreserved(activeCheckpoint)
                : true;
          if (checkpointId) context.checkpointId = checkpointId;
          if (stagedTask) context.allowExistingFileOverwrite = false;
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
          observeModelPlanAction(call, tool, result, input, planNodeIdAtAction);
          if (result.ok)
            completeCurrentModelNodeAfterAction(planNodeIdAtAction);
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: toolMessageContent(result, task),
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
          observeModelPlanAction(call, tool, result, input, planNodeIdAtAction);
          if (result.ok)
            completeCurrentModelNodeAfterAction(planNodeIdAtAction);
          messages.push({
            role: "tool",
            toolCallId: call.id,
            content: toolMessageContent(result, task),
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
      if (pendingModelPlanRecovery) {
        const recoveryRequest = pendingModelPlanRecovery;
        pendingModelPlanRecovery = undefined;
        const replanned = await appendModelRecoveryPlan(
          recoveryRequest.issues,
          recoveryRequest.nextActions,
          recoveryRequest.cause,
          recoveryRequest.supersedeNodeId,
        );
        if (replanned) {
          // The failed boundary is represented by the superseded node in the
          // append-only plan. It must not remain as a completion blocker while
          // the replacement node is being executed.
          unresolvedBlockers = 0;
          repeatedErrorCount = 0;
          lastErrorCode = undefined;
          repeatedCallCount = 0;
          lastCallSignature = undefined;
          noActionCount = 0;
          transitionPhase(ledger, "plan", loopOptions);
          persistLedger();
          continue;
        }
      }
      // A failed LLM-authored node has no legal next worker turn until the
      // semantic planner supplies a replacement. Calling the model with an
      // empty tool surface here is both misleading and unsafe: local models
      // commonly repeat the last textual tool envelope, which turns a plan
      // recovery failure into an unrelated provider BAD_REQUEST. Finish the
      // task as a truthful, structured blocker instead.
      if (
        planningMode === "model" &&
        modelPlanHasUnfinishedNodes() &&
        !currentModelNode()
      ) {
        if (await recoverModelPlanDeadEnd(turn)) continue;
        finalText =
          finalText.trim() ||
          "The LLM-authored plan has no ready node after recovery failed; a new semantic plan is required before continuing.";
        unresolvedBlockers = Math.max(1, unresolvedBlockers);
        addTaskBlocker(ledger, {
          id: `${task.id}:plan-recovery-unavailable`,
          summary: finalText,
          recoverable: true,
          suggestedAction:
            "Ask the LLM planner for a monotonic replacement node with an explicit workspace scope, then resume the task.",
        });
        const finished = await finish(turn, false);
        if (finished === CONTINUE_AGENT_LOOP)
          throw new Error(
            "A blocked LLM plan cannot continue without a ready node.",
          );
        return finished;
      }
      if (repeatedErrorCount >= NON_PROGRESS_LIMIT) {
        logger?.warn("agent.non_progress.detected", {
          reason: "repeated_tool_error",
          repeatedCount: repeatedErrorCount,
          code: lastErrorCode,
        });
        unresolvedBlockers = 1;
        finalText = `Agent made no progress after ${repeatedErrorCount} ${lastErrorCode ?? "recoverable"} errors.`;
        const finished = await finish(turn);
        if (finished === CONTINUE_AGENT_LOOP) continue;
        return finished;
      }
      if (repeatedMutationFailureCount >= MUTATION_FAILURE_LIMIT) {
        logger?.warn("agent.non_progress.detected", {
          reason: "repeated_mutation_failure",
          repeatedCount: repeatedMutationFailureCount,
          mutationFailureKey: lastMutationFailureKey,
        });
        unresolvedBlockers = 1;
        finalText =
          "Agent could not produce a valid mutation after repeated attempts; the workspace was left unchanged for this work unit.";
        const finished = await finish(turn);
        if (finished === CONTINUE_AGENT_LOOP) continue;
        return finished;
      }
      if (
        !mutated ||
        (verificationPlan.length === 0 && planningMode !== "model") ||
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
      const context = await createExecutionContext();
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
      updateTaskNode("verify", verified ? "passed" : "failed");
      transitionPhase(ledger, "reflect", loopOptions);
      persistLedger();
      if (verified && planningMode === "model") {
        // A model-authored workspace node may intentionally cover several
        // coupled files. Its mutation remains `verifying` until the
        // verification contract declared by that node has produced host
        // evidence. Close that node before evaluating the global objective;
        // otherwise the objective verifier can require a passed node while
        // the node itself is waiting for the exact verification that just
        // succeeded (a completion deadlock).
        const node = currentModelNode();
        if (node?.verification && node.verification.length > 0)
          completeCurrentModelNodeAfterVerification(lastModelMutationNodeId);
      }
      if (explicitSuccessCriteria) {
        const criteria = await verifySuccessCriteria();
        const regression = await restoreRegressedMutations(criteria);
        if (regression.regressed && !regression.restored) {
          unresolvedBlockers = 1;
          finalText =
            regression.notice ??
            "A criteria regression could not be restored safely.";
          const finished = await finish(turn);
          if (finished === CONTINUE_AGENT_LOOP) continue;
          return finished;
        }
        if (!regression.regressed) {
          pendingMutations.length = 0;
          protectedCriterionIds.clear();
        } else {
          verified = false;
          verifiedMutationRevision = -1;
        }
        if (!criteria.ready && !modelPlanHasRunnableContinuation()) {
          // Objective verification belongs to the currently active LLM node.
          // Carry that identity into recovery so the planner can append a new
          // semantic replacement instead of echoing the whole old plan. If
          // the model returns a full snapshot, normalizeRecoveryPlanProposal
          // can preserve identical valid history while requiring a fresh
          // replacement node for the failed work.
          const failedNodeId =
            planningMode === "model"
              ? (currentModelNode()?.id ?? lastActionedModelNodeId)
              : undefined;
          await appendModelRecoveryPlan(
            criteria.issues,
            criteria.nextActions,
            "OBJECTIVE_VERIFICATION_FAILED",
            failedNodeId,
          );
        } else if (!criteria.ready && planningMode === "model") {
          // A configured project check can legitimately fail between two
          // LLM-authored work nodes. For example, a migration may temporarily
          // leave tests red until the planned consumer/test node runs. That
          // failure is useful evidence for the next ready node, not proof that
          // the next node should be superseded. Do not let an intermediate
          // check invalidate valid semantic plan history or trigger a replan
          // before the LLM has executed its own declared continuation.
          logger?.info("agent.verification.deferred", {
            reason: "llm_plan_has_runnable_continuation",
            currentNodeId: currentModelNode()?.id,
            failedVerificationCount: ledger.verificationRuns.filter(
              (run) => run.status === "failed",
            ).length,
          });
        }
        if (verified && criteria.ready && !regression.regressed) {
          syncTargetPlan([]);
          if (updateTaskPlanStep(ledger, "step-verify", "done")) emitPlan();
          if (planningMode === "model")
            completeCurrentModelNodeAfterVerification(lastModelMutationNodeId);
          criteriaWritePaths = [];
          criteriaReadPaths = [];
          criteriaFeedbackActive = false;
          stagedMutationRequired = false;
          if (planningMode === "model" && modelPlanHasUnfinishedNodes()) {
            syncModelPlanScope();
            finalText =
              finalText.trim() ||
              "The current plan node was verified; continuing with the next ready node.";
            continue;
          }
          finalText =
            finalText.trim() ||
            "Changes were applied and verified by host verification.";
          logger?.info("agent.host_completion.short_circuit", {
            turn,
            reason: "verification_and_success_criteria_passed",
          });
          const finished = await finish(turn);
          if (finished === CONTINUE_AGENT_LOOP) continue;
          return finished;
        }
        criteriaFeedbackActive = true;
        const changedPaths = [
          ...new Set(ledger.filesChanged.map(normalizeWorkspacePath)),
        ];
        const failedVerificationPaths = [
          ...new Set(
            ledger.verificationRuns
              .filter((run) => run.status === "failed")
              .slice(-3)
              .flatMap((run) => run.failurePaths ?? [])
              .map(normalizeWorkspacePath),
          ),
        ];
        // A failed verification is a repair phase, not a new write-scope
        // declaration. The current mutation and the failure evidence must be
        // readable together; otherwise the host rejects the exact read needed
        // to repair the code it just proved invalid.
        const nextWritePaths = [
          ...(verified ? [] : [...failedVerificationPaths, ...changedPaths]),
          ...criteria.nextPaths,
          ...(criteria.nextPaths.length === 0 ? objectivePaths : []),
        ]
          .map(normalizeWorkspacePath)
          .filter((value) => value.length > 0);
        const nextReadPaths = [
          ...nextWritePaths,
          ...failedVerificationPaths,
          ...(verified ? [] : changedPaths),
          ...objectivePaths,
        ]
          .map(normalizeWorkspacePath)
          .filter((value) => value.length > 0);
        criteriaWritePaths = [...new Set(nextWritePaths)].slice(0, 8);
        criteriaReadPaths = [...new Set(nextReadPaths)].slice(0, 12);
        stagedMutationRequired = false;
        syncTargetPlan(criteriaWritePaths);
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
        const freshReadPath = requiredFreshReadPath(criteriaWritePaths);
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
    if (
      planningMode === "model" &&
      criteria &&
      criteria.ready &&
      (verificationPlan.length === 0 ||
        (verified && verifiedMutationRevision === mutationRevision))
    )
      completeCurrentModelNodeAfterVerification();
    if (
      criteria &&
      criteriaMutationStagnated(criteria) &&
      planningMode === "model"
    ) {
      const stagnantNodeId = currentModelNode()?.id;
      if (stagnantNodeId) updateTaskNode(stagnantNodeId, "failed");
      const replanned = await appendModelRecoveryPlan(
        criteria.issues,
        criteria.nextActions.length > 0
          ? criteria.nextActions
          : [
              "Do not repeat another mutation in the same semantic direction; propose a different repair or ask for the missing product decision.",
            ],
        "NO_OBJECTIVE_PROGRESS",
        stagnantNodeId,
      );
      if (replanned) {
        criteriaProgressNodeId = undefined;
        criteriaProgressFingerprint = undefined;
        criteriaProgressMutationRevision = mutationRevision;
        stagnantMutationCount = 0;
        unresolvedBlockers = 0;
        repeatedErrorCount = 0;
        lastErrorCode = undefined;
        repeatedCallCount = 0;
        lastCallSignature = undefined;
        noActionCount = 0;
        criteriaFeedbackActive = false;
        stagedMutationRequired = false;
        transitionPhase(ledger, "plan", loopOptions);
        persistLedger();
        continue;
      }
      // The planner remains the source of semantic work. If it cannot provide
      // a valid monotonic repair, stop with truthful evidence instead of
      // allowing the worker to keep rewriting the same artifact.
      unresolvedBlockers = Math.max(1, unresolvedBlockers);
      finalText =
        "The LLM worker made repeated mutations without satisfying a new objective criterion, and the semantic planner did not provide a valid repair plan.";
      const finished = await finish(turn, false);
      if (finished === CONTINUE_AGENT_LOOP)
        throw new Error(
          "Stagnant execution cannot continue without a repair plan.",
        );
      return finished;
    }
    const modelPlanNeedsAction = modelPlanHasUnfinishedNodes();
    // A completed LLM-authored plan has no legal model action left. Evaluate
    // completion or create a controller-driven recovery revision immediately;
    // never issue another provider turn with an empty tool surface and let a
    // local model invent a post-plan action.
    if (
      mode === "coding" &&
      planningMode === "model" &&
      modelPlanIsComplete() &&
      criteria?.ready === false
    ) {
      finalText =
        finalText.trim() ||
        "The authored plan is complete; the host is verifying the requested outcome.";
      const finished = await finish(turn);
      if (finished === CONTINUE_AGENT_LOOP) continue;
      return finished;
    }
    const codingRequiresAction =
      mode === "coding" &&
      (!mutated ||
        (verificationPlan.length > 0 &&
          mutationRevision !== verifiedMutationRevision) ||
        (verificationRan && !verified) ||
        criteria?.ready === false ||
        modelPlanNeedsAction);
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
        const semanticNodeFeedback =
          planningMode === "model" && currentModelNode()
            ? modelNodeIsSemantic(currentModelNode()!)
              ? "The current LLM-authored node is semantic and has no workspace tools. Return one concise plain-text decision for that node now; do not emit a tool call, JSON, XML, or a code block pretending to be a tool call."
              : modelNodeNeedsClarification(currentModelNode()!)
                ? "The current LLM-authored node requires a user decision. Do not invent a workspace action."
                : ""
            : "";
        messages.push({
          role: "user",
          content: semanticNodeFeedback
            ? semanticNodeFeedback + criteriaFeedback + criteriaActions
            : hasReadEvidence
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
      const finished = await finish(turn);
      if (finished === CONTINUE_AGENT_LOOP) continue;
      return finished;
    }
    noActionCount = 0;

    if (planningMode === "model" && modelPlanHasUnfinishedNodes()) {
      messages.push({
        role: "user",
        content:
          "The current LLM-authored plan is not complete. Continue with exactly one action for the ready node shown in the authoritative plan context; do not declare completion until every required node is verified.",
      });
      continue;
    }

    const finished = await finish(turn);
    if (finished === CONTINUE_AGENT_LOOP) continue;
    return finished;
  }

  unresolvedBlockers = 1;
  finalText =
    finalText ||
    `Agent stopped after reaching the maximum turn budget (${maxTurns}).`;
  const finalResult = await finish(maxTurns, false);
  if (finalResult === CONTINUE_AGENT_LOOP)
    throw new Error("Completion recovery cannot continue after max turns.");
  return finalResult;
}
