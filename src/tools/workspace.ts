import { readFile, readdir, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  runCommand,
  runShellCommand,
  ProcessPolicyError,
  ProcessIsolationError,
  type ProcessOptions,
  type ProcessResult,
} from "../shared/process.js";
import { assertWorkspacePath, resolveWorkspacePath } from "../shared/paths.js";
import { isNeverRemotePath, scanSecrets } from "../privacy/policy.js";
import { safeProcessEnvironment } from "../shared/process-policy.js";
import {
  checkPermission,
  classifyShellCommand,
  commandRequiresNetwork,
  shellCommandEscapesWorkspace,
} from "./permissions.js";
import { ToolError } from "./errors.js";
import type {
  ToolApprovalRequest,
  ToolDefinition,
  ToolExecutionContext,
} from "./types.js";

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

/**
 * Stats a workspace-relative path up front and turns the two failure modes
 * that a model can actually act on — "nothing there" and "wrong kind of
 * path for this tool" — into a ToolError with a concrete next step, instead
 * of letting a raw ENOENT/ENOTDIR/EISDIR reach the model as an opaque
 * message it has no structured way to recover from.
 */
async function statForTool(
  absolute: string,
  relativePath: string,
): Promise<{ isFile: boolean; isDirectory: boolean }> {
  try {
    const info = await stat(absolute);
    return { isFile: info.isFile(), isDirectory: info.isDirectory() };
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new ToolError(
        "PATH_NOT_FOUND",
        `No such file or directory: ${relativePath}. List the parent directory or search for the correct path instead of guessing.`,
        {
          path: relativePath,
          suggestedAction:
            "List the parent directory or search for the correct path before retrying.",
        },
      );
    }
    throw error;
  }
}

export interface FileChangeSummary {
  operation: "created" | "overwritten" | "edited" | "deleted";
  beforeExists: boolean;
  afterExists: boolean;
  addedLines: number;
  removedLines: number;
  diffLines: string[];
  diffTruncated: boolean;
}

function contentLines(content: string): string[] {
  if (!content) return [];
  const normalized = content.replaceAll("\r\n", "\n");
  return (
    normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized
  ).split("\n");
}

function changeDiff(
  filePath: string,
  before: string,
  after: string,
  operation: FileChangeSummary["operation"],
): FileChangeSummary {
  const oldLines = contentLines(before);
  const newLines = contentLines(after);
  const tooLarge = oldLines.length * newLines.length > 200_000;
  const lines: string[] = [];
  let addedLines = 0;
  let removedLines = 0;
  if (tooLarge) {
    addedLines = newLines.length;
    removedLines = oldLines.length;
  } else {
    const matrix: number[][] = Array.from({ length: oldLines.length + 1 }, () =>
      new Array<number>(newLines.length + 1).fill(0),
    );
    for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
      for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
        matrix[oldIndex]![newIndex] =
          oldLines[oldIndex] === newLines[newIndex]
            ? (matrix[oldIndex + 1]?.[newIndex + 1] ?? 0) + 1
            : Math.max(
                matrix[oldIndex + 1]?.[newIndex] ?? 0,
                matrix[oldIndex]?.[newIndex + 1] ?? 0,
              );
      }
    }
    let oldIndex = 0;
    let newIndex = 0;
    while (oldIndex < oldLines.length && newIndex < newLines.length) {
      if (oldLines[oldIndex] === newLines[newIndex]) {
        lines.push(`  ${oldLines[oldIndex]}`);
        oldIndex += 1;
        newIndex += 1;
      } else if (
        (matrix[oldIndex + 1]?.[newIndex] ?? 0) >=
        (matrix[oldIndex]?.[newIndex + 1] ?? 0)
      ) {
        lines.push(`- ${oldLines[oldIndex]}`);
        removedLines += 1;
        oldIndex += 1;
      } else {
        lines.push(`+ ${newLines[newIndex]}`);
        addedLines += 1;
        newIndex += 1;
      }
    }
    while (oldIndex < oldLines.length) {
      lines.push(`- ${oldLines[oldIndex]}`);
      removedLines += 1;
      oldIndex += 1;
    }
    while (newIndex < newLines.length) {
      lines.push(`+ ${newLines[newIndex]}`);
      addedLines += 1;
      newIndex += 1;
    }
  }
  const redacted =
    isNeverRemotePath(filePath) ||
    scanSecrets(before).length > 0 ||
    scanSecrets(after).length > 0;
  const maxLines = 80;
  return {
    operation,
    beforeExists: before.length > 0 || operation !== "created",
    afterExists: operation !== "deleted",
    addedLines,
    removedLines,
    diffLines: redacted
      ? ["[content redacted: secret-shaped or protected path]"]
      : lines.slice(0, maxLines),
    diffTruncated: redacted || tooLarge || lines.length > maxLines,
  };
}

async function requireParentDirectory(
  root: string,
  relativePath: string,
): Promise<void> {
  const parent = path.dirname(relativePath).replaceAll("\\", "/") || ".";
  const absoluteParent = await assertWorkspacePath(root, parent);
  const info = await statForTool(absoluteParent, parent);
  if (!info.isDirectory)
    throw new ToolError(
      "PATH_IS_FILE",
      `${parent} is a file, so ${relativePath} has no valid parent directory.`,
      {
        path: parent,
        suggestedAction: "Choose an existing directory returned by ListFiles.",
      },
    );
}

async function readExistingFile(
  root: string,
  relativePath: string,
): Promise<{ exists: boolean; content: string }> {
  const absolute = await assertWorkspacePath(root, relativePath);
  try {
    const info = await statForTool(absolute, relativePath);
    if (info.isDirectory)
      throw new ToolError(
        "PATH_IS_DIRECTORY",
        `${relativePath} is a directory, not a file. Choose a file path or use ListFiles.`,
        { path: relativePath },
      );
    return { exists: true, content: await readFile(absolute, "utf8") };
  } catch (error) {
    if (error instanceof ToolError && error.code === "PATH_NOT_FOUND")
      return { exists: false, content: "" };
    throw error;
  }
}

async function verifyWrittenContent(
  absolute: string,
  relativePath: string,
  expected: string,
): Promise<void> {
  try {
    const actual = await readFile(absolute, "utf8");
    if (actual === expected) return;
  } catch {
    // Normalize a disappearing or unreadable target into a recoverable tool
    // result instead of reporting a successful write that cannot be observed.
  }
  throw new ToolError(
    "CONFLICT",
    `The write to ${relativePath} did not produce the requested file content. The workspace may have changed concurrently.`,
    {
      path: relativePath,
      recoverable: true,
      suggestedAction:
        "Read the current path again, compare the observed content, and retry only if the target is still in scope.",
    },
  );
}

async function verifyDeleted(
  absolute: string,
  relativePath: string,
): Promise<void> {
  try {
    await stat(absolute);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") return;
    throw error;
  }
  throw new ToolError(
    "CONFLICT",
    `DeleteFile could not confirm that ${relativePath} was removed.`,
    {
      path: relativePath,
      recoverable: true,
      suggestedAction:
        "Read or list the path again before attempting another destructive action.",
    },
  );
}

function stringInput(input: unknown): string {
  if (typeof input !== "string" || !input.trim())
    throw new ToolError("INVALID_ARGUMENT", "Expected a non-empty string.", {
      recoverable: true,
    });
  return input;
}

function recordInput(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    throw new ToolError("INVALID_ARGUMENT", "Expected an object input.", {
      recoverable: true,
    });
  return input as Record<string, unknown>;
}

export function safeExecutionEnvironment(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  return safeProcessEnvironment(env);
}

async function runToolCommand(
  command: string,
  args: string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  return runToolProcess(() =>
    runCommand(command, args, {
      ...options,
      env: safeExecutionEnvironment(options.env),
    }),
  );
}

async function runToolShellCommand(
  command: string,
  options: ProcessOptions,
): Promise<ProcessResult> {
  return runToolProcess(() =>
    runShellCommand(command, {
      ...options,
      env: safeExecutionEnvironment(options.env),
    }),
  );
}

async function runToolProcess(
  execute: () => Promise<ProcessResult>,
): Promise<ProcessResult> {
  try {
    return await execute();
  } catch (error) {
    if (error instanceof ProcessIsolationError)
      throw new ToolError(
        "PERMISSION_DENIED",
        "The command was blocked because OS-enforced process isolation is required but unavailable.",
        {
          recoverable: false,
          suggestedAction:
            "Use a host with an OS isolation adapter or explicitly permit the weaker application policy.",
          details: {
            applicationPolicy: error.status.applicationPolicy,
            osEnforced: error.status.osEnforced,
            mechanism: error.status.mechanism,
          },
        },
      );
    if (error instanceof ProcessPolicyError)
      throw new ToolError(
        "PERMISSION_DENIED",
        error.code === "DESTRUCTIVE_PROCESS_DISABLED"
          ? "Destructive process execution is disabled for this turn."
          : "Network-capable process execution is disabled for this turn.",
        {
          recoverable: false,
          suggestedAction:
            error.code === "DESTRUCTIVE_PROCESS_DISABLED"
              ? "Use a non-destructive command or request explicit approval for the destructive action."
              : "Use a local command or a turn policy that explicitly permits network access.",
          details: { processPolicyCode: error.code },
        },
      );
    if (error instanceof DOMException && error.name === "AbortError")
      throw new ToolError("CANCELLED", "The command was cancelled.", {
        recoverable: true,
        suggestedAction:
          "Wait for cancellation to finish before starting another command.",
      });
    if (error instanceof DOMException && error.name === "TimeoutError")
      throw new ToolError(
        "COMMAND_TIMEOUT",
        "The command exceeded its timeout.",
        {
          recoverable: true,
          suggestedAction:
            "Inspect the command or retry with a narrower verification step.",
        },
      );
    throw error;
  }
}

const SHELL_TOOL_DESCRIPTION =
  process.platform === "win32"
    ? "Run a classified workspace command on Windows. Prefer ReadFile/SearchText for repository content; use PowerShell syntax and do not assume Unix-only commands such as head, tail, grep or sed are installed."
    : "Run a classified workspace command. Prefer ReadFile/SearchText for repository content and keep commands narrow.";

function inputString(input: Record<string, unknown>, key: string): string {
  return stringInput(input[key]);
}

function inputBoolean(input: Record<string, unknown>, key: string): boolean {
  return input[key] === true;
}

function isRuntimeStatePath(relative: string): boolean {
  return (
    relative.replaceAll("\\", "/") === "agent.jsonl" ||
    relative.replaceAll("\\", "/").startsWith(".localcode/")
  );
}

async function requirePermission(
  ctx: ToolExecutionContext,
  risk: "read" | "write" | "execute" | "destructive",
  description = `Run ${risk} workspace action`,
  command?: string,
  target: Pick<ToolApprovalRequest, "tool" | "path"> = {},
): Promise<boolean> {
  const decision = checkPermission({
    mode: ctx.permissionMode,
    risk,
    ...(command ? { command } : {}),
  });
  ctx.logger?.debug("tool.permission.checked", {
    risk,
    permissionMode: ctx.permissionMode,
    allowed: decision.allowed,
    requiresApproval: decision.requiresApproval,
  });
  if (decision.allowed) return false;
  if (decision.requiresApproval && ctx.approvalGranted === true) {
    ctx.logger?.info("tool.permission.approved", {
      risk,
      source: "controller-one-shot-approval",
    });
    return risk === "destructive";
  }
  if (decision.requiresApproval && ctx.requestApproval) {
    ctx.logger?.info("tool.permission.approval_requested", { risk });
    const allowed = await ctx.requestApproval({
      description,
      risk,
      ...(target.tool ? { tool: target.tool } : {}),
      ...(target.path ? { path: target.path } : {}),
      ...(command ? { command } : {}),
    });
    if (allowed) {
      ctx.logger?.info("tool.permission.approved", { risk });
      return risk === "destructive";
    }
    ctx.logger?.warn("tool.permission.denied", {
      risk,
      reason: "approval_denied",
    });
    throw new ToolError(
      "PERMISSION_DENIED",
      "Approval denied for this workspace action.",
      {
        recoverable: true,
        suggestedAction:
          "Do not repeat this identical action. Use the user's decision and request approval again only for a changed action.",
        details: { reason: "user_denied" },
      },
    );
  }
  ctx.logger?.warn("tool.permission.denied", {
    risk,
    reason: decision.reason ?? "policy_denied",
  });
  throw new ToolError(
    "PERMISSION_DENIED",
    decision.reason ?? "Tool permission denied",
    {
      recoverable: false,
      suggestedAction:
        "Use a policy mode that permits this action or ask for approval.",
    },
  );
}

async function listFallback(
  root: string,
  directory = ".",
  depth = 0,
): Promise<string[]> {
  if (depth > 6) return [];
  const absolute = resolveWorkspacePath(root, directory);
  const entries = await readdir(absolute, { withFileTypes: true });
  const result: string[] = [];
  for (const entry of entries) {
    if (
      [".git", "node_modules", ".localcode", "dist", ".next"].includes(
        entry.name,
      )
    )
      continue;
    const relative = path.join(directory, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory())
      result.push(...(await listFallback(root, relative, depth + 1)));
    else if (!isRuntimeStatePath(relative)) result.push(relative);
  }
  return result;
}

export interface FileReadResult {
  path: string;
  kind: "file";
  content: string;
  sensitivePath: boolean;
  truncated: boolean;
  lineStart: number;
  lineEnd: number;
  totalLines: number;
  hasMore: boolean;
  nextStartLine?: number;
}

const DEFAULT_READ_LINE_WINDOW = 160;

export const readFileTool: ToolDefinition<
  {
    path: string;
    startLine?: number;
    endLine?: number;
    /** Host-only compatibility field; never advertised in the model schema. */
    maxChars?: number;
  },
  FileReadResult
> = {
  name: "ReadFile",
  description: "Read a workspace text file with a bounded result.",
  risk: "read",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Workspace-relative path of the file to read.",
      },
      startLine: {
        type: "number",
        description: "Optional first line to return, starting at 1.",
      },
      endLine: {
        type: "number",
        description:
          "Optional last line to return, inclusive. If omitted with startLine, only a bounded 160-line window is returned.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  validate(input) {
    const value = recordInput(input);
    const startLine = value.startLine;
    const endLine = value.endLine;
    if (
      (startLine !== undefined &&
        (typeof startLine !== "number" ||
          !Number.isInteger(startLine) ||
          startLine < 1)) ||
      (endLine !== undefined &&
        (typeof endLine !== "number" ||
          !Number.isInteger(endLine) ||
          endLine < 1))
    )
      throw new ToolError(
        "INVALID_ARGUMENT",
        "startLine and endLine must be positive integers when provided.",
        { recoverable: true, field: "startLine" },
      );
    if (
      typeof startLine === "number" &&
      typeof endLine === "number" &&
      startLine > endLine
    )
      throw new ToolError(
        "INVALID_ARGUMENT",
        "startLine cannot be greater than endLine.",
        { recoverable: true, field: "endLine" },
      );
    const maxChars = value.maxChars;
    if (
      maxChars !== undefined &&
      (typeof maxChars !== "number" ||
        !Number.isInteger(maxChars) ||
        maxChars < 1)
    )
      throw new ToolError(
        "INVALID_ARGUMENT",
        "maxChars must be a positive integer. Omit it entirely to use the default of 20000 characters.",
      );
    return {
      path: inputString(value, "path"),
      ...(typeof startLine === "number" ? { startLine } : {}),
      ...(typeof endLine === "number" ? { endLine } : {}),
      ...(maxChars === undefined ? {} : { maxChars }),
    };
  },
  async execute(input, ctx) {
    await requirePermission(
      ctx,
      "read",
      `Read workspace file: ${input.path}`,
      undefined,
      { tool: "ReadFile", path: input.path },
    );
    const absolute = await assertWorkspacePath(ctx.root, input.path);
    const info = await statForTool(absolute, input.path);
    if (info.isDirectory)
      throw new ToolError(
        "PATH_IS_DIRECTORY",
        `${input.path} is a directory, not a file. Use ListFiles to see its contents, then ReadFile a specific file inside it.`,
      );
    const content = await readFile(absolute, "utf8");
    if (content.includes("\u0000"))
      throw new ToolError(
        "BINARY_FILE",
        `${input.path} appears to be a binary file and is not exposed as text.`,
        {
          recoverable: true,
          path: input.path,
          suggestedAction:
            "Use a text source file or an explicit binary-aware inspection step.",
        },
      );
    const maxChars = input.maxChars ?? 20_000;
    const lines = content.split(/\r?\n/);
    const lineStart = input.startLine ?? 1;
    const lineEndRequest =
      input.endLine ??
      (input.startLine === undefined
        ? undefined
        : input.startLine + DEFAULT_READ_LINE_WINDOW - 1);
    const selected =
      input.startLine !== undefined || input.endLine !== undefined
        ? lines.slice(lineStart - 1, lineEndRequest).join("\n")
        : content;
    const truncated = selected.length > maxChars;
    const lineEnd = Math.min(lineEndRequest ?? lines.length, lines.length);
    const hasMore = truncated || lineEnd < lines.length;
    return {
      path: input.path,
      kind: "file",
      content: selected.slice(0, maxChars),
      sensitivePath: isNeverRemotePath(input.path),
      truncated,
      lineStart,
      lineEnd,
      totalLines: lines.length,
      hasMore,
      ...(hasMore && !truncated && lineEnd < lines.length
        ? { nextStartLine: lineEnd + 1 }
        : {}),
    };
  },
};

export const writeFileTool: ToolDefinition<
  { path: string; content: string },
  {
    path: string;
    bytes: number;
    operation: "created" | "overwritten";
    change: FileChangeSummary;
  }
> = {
  name: "WriteFile",
  description: "Write a workspace file after permission and checkpoint checks.",
  risk: "write",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Workspace-relative path of the file to create or overwrite.",
      },
      content: {
        type: "string",
        description: "Full UTF-8 text content to write.",
      },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  validate(input) {
    const value = recordInput(input);
    if (typeof value.content !== "string")
      throw new ToolError("INVALID_ARGUMENT", "content must be a string.", {
        field: "content",
        recoverable: true,
      });
    return { path: inputString(value, "path"), content: value.content };
  },
  async execute(input, ctx) {
    await requirePermission(
      ctx,
      "write",
      `Write workspace file: ${input.path}`,
      undefined,
      { tool: "WriteFile", path: input.path },
    );
    if (!ctx.checkpoint || !ctx.checkpointId)
      throw new ToolError(
        "CONFLICT",
        "WriteFile requires an active LocalCode checkpoint.",
        {
          recoverable: true,
          suggestedAction:
            "Let the agent create a checkpoint before retrying the write.",
        },
      );
    const absolute = await assertWorkspacePath(ctx.root, input.path);
    await ctx.checkpoint.assertNoExternalChange(ctx.checkpointId, input.path);
    await requireParentDirectory(ctx.root, input.path);
    const before = await readExistingFile(ctx.root, input.path);
    if (before.exists && ctx.allowExistingFileOverwrite === false)
      throw new ToolError(
        "PATH_EXISTS",
        `${input.path} already exists in this staged work unit. Use EditFile with an exact observed replacement instead of replacing the entire file.`,
        {
          path: input.path,
          recoverable: true,
          suggestedAction:
            "Read the current file if needed, then use EditFile for a bounded change. Use WriteFile only for a new path.",
        },
      );
    await writeFile(absolute, input.content, "utf8");
    await verifyWrittenContent(absolute, input.path, input.content);
    await ctx.checkpoint.recordMutation(
      ctx.checkpointId,
      input.path,
      input.content,
    );
    return {
      path: input.path,
      bytes: Buffer.byteLength(input.content, "utf8"),
      operation: before.exists ? "overwritten" : "created",
      change: changeDiff(
        input.path,
        before.content,
        input.content,
        before.exists ? "overwritten" : "created",
      ),
    };
  },
};

export const createFileTool: ToolDefinition<
  { path: string; content: string },
  {
    path: string;
    bytes: number;
    operation: "created";
    change: FileChangeSummary;
  }
> = {
  name: "CreateFile",
  description:
    "Create a new workspace text file without overwriting an existing path.",
  risk: "write",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Workspace-relative path of the new file.",
      },
      content: { type: "string", description: "Full UTF-8 text content." },
    },
    required: ["path", "content"],
    additionalProperties: false,
  },
  validate(input) {
    const value = recordInput(input);
    if (typeof value.content !== "string")
      throw new ToolError("INVALID_ARGUMENT", "content must be a string.", {
        field: "content",
        recoverable: true,
      });
    return { path: inputString(value, "path"), content: value.content };
  },
  async execute(input, ctx) {
    await requirePermission(
      ctx,
      "write",
      `Create workspace file: ${input.path}`,
      undefined,
      { tool: "CreateFile", path: input.path },
    );
    if (!ctx.checkpoint || !ctx.checkpointId)
      throw new ToolError(
        "CONFLICT",
        "CreateFile requires an active LocalCode checkpoint.",
        {
          recoverable: true,
          suggestedAction: "Create a checkpoint before creating the file.",
        },
      );
    const absolute = await assertWorkspacePath(ctx.root, input.path);
    await requireParentDirectory(ctx.root, input.path);
    const before = await readExistingFile(ctx.root, input.path);
    if (before.exists)
      throw new ToolError(
        "PATH_EXISTS",
        `${input.path} already exists. Use EditFile or WriteFile only when replacing an existing file is intentional.`,
        { path: input.path, recoverable: false },
      );
    await ctx.checkpoint.assertNoExternalChange(ctx.checkpointId, input.path);
    try {
      await writeFile(absolute, input.content, {
        encoding: "utf8",
        flag: "wx",
      });
    } catch (error) {
      if (isErrnoException(error) && error.code === "EEXIST")
        throw new ToolError("PATH_EXISTS", `${input.path} already exists.`, {
          path: input.path,
          recoverable: false,
        });
      throw error;
    }
    await verifyWrittenContent(absolute, input.path, input.content);
    await ctx.checkpoint.recordMutation(
      ctx.checkpointId,
      input.path,
      input.content,
    );
    return {
      path: input.path,
      bytes: Buffer.byteLength(input.content, "utf8"),
      operation: "created",
      change: changeDiff(input.path, "", input.content, "created"),
    };
  },
};

export const editFileTool: ToolDefinition<
  { path: string; oldText: string; newText: string; replaceAll?: boolean },
  {
    path: string;
    replacements: number;
    operation: "edited";
    change: FileChangeSummary;
  }
> = {
  name: "EditFile",
  description: "Replace exact text in a workspace file.",
  risk: "write",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Workspace-relative path of the file to edit.",
      },
      oldText: {
        type: "string",
        description: "Exact existing text to find and replace.",
      },
      newText: {
        type: "string",
        description: "Replacement text.",
      },
      replaceAll: {
        type: "boolean",
        description:
          "Replace every occurrence instead of failing on ambiguous matches (default false).",
      },
    },
    required: ["path", "oldText", "newText"],
    additionalProperties: false,
  },
  validate(input) {
    const value = recordInput(input);
    if (typeof value.oldText !== "string" || typeof value.newText !== "string")
      throw new ToolError(
        "INVALID_ARGUMENT",
        "oldText and newText must be strings.",
        { recoverable: true },
      );
    if (value.oldText === value.newText)
      throw new ToolError(
        "INVALID_ARGUMENT",
        "oldText and newText must differ; an identical replacement makes no change.",
        {
          field: "newText",
          recoverable: true,
          suggestedAction:
            "Read the current file and provide a different replacement or choose the next missing criterion.",
        },
      );
    return {
      path: inputString(value, "path"),
      oldText: value.oldText,
      newText: value.newText,
      replaceAll: inputBoolean(value, "replaceAll"),
    };
  },
  async execute(input, ctx) {
    await requirePermission(
      ctx,
      "write",
      `Edit workspace file: ${input.path}`,
      undefined,
      { tool: "EditFile", path: input.path },
    );
    if (!ctx.checkpoint || !ctx.checkpointId)
      throw new ToolError(
        "CONFLICT",
        "EditFile requires an active LocalCode checkpoint.",
        {
          recoverable: true,
          suggestedAction:
            "Let the agent create a checkpoint before retrying the edit.",
        },
      );
    const absolute = await assertWorkspacePath(ctx.root, input.path);
    await ctx.checkpoint.assertNoExternalChange(ctx.checkpointId, input.path);
    const existing = await readExistingFile(ctx.root, input.path);
    if (!existing.exists)
      throw new ToolError(
        "PATH_NOT_FOUND",
        `No such file or directory: ${input.path}. Read or list the correct path before editing.`,
        {
          path: input.path,
          suggestedAction:
            "Use ListFiles or SearchText to locate an existing file before EditFile.",
        },
      );
    const current = existing.content;
    const occurrences = current.split(input.oldText).length - 1;
    if (occurrences === 0)
      throw new ToolError("NOT_FOUND", "EditFile target text was not found.", {
        recoverable: true,
        suggestedAction:
          "Use the currentContentPreview from this error as the canonical file content, or read the file again, then retry with exact text.",
        ...(isNeverRemotePath(input.path)
          ? {}
          : {
              details: {
                ...(scanSecrets(current).length === 0
                  ? {
                      currentContentPreview: current.slice(0, 16_384),
                      currentContentTruncated: current.length > 16_384,
                    }
                  : {
                      currentContentPreview:
                        "[REDACTED: secret-shaped content]",
                    }),
              },
            }),
      });
    if (occurrences > 1 && !input.replaceAll)
      throw new ToolError(
        "CONFLICT",
        "EditFile target is ambiguous; set replaceAll to continue.",
        {
          recoverable: true,
          suggestedAction:
            "Set replaceAll true only when every occurrence should change.",
        },
      );
    const updated = input.replaceAll
      ? current.replaceAll(input.oldText, input.newText)
      : current.replace(input.oldText, input.newText);
    await writeFile(absolute, updated, "utf8");
    await verifyWrittenContent(absolute, input.path, updated);
    await ctx.checkpoint.recordMutation(ctx.checkpointId, input.path, updated);
    return {
      path: input.path,
      replacements: input.replaceAll ? occurrences : 1,
      operation: "edited",
      change: changeDiff(input.path, current, updated, "edited"),
    };
  },
};

export const deleteFileTool: ToolDefinition<
  { path: string },
  { path: string; operation: "deleted"; change: FileChangeSummary }
> = {
  name: "DeleteFile",
  description:
    "Delete one existing workspace file after explicit destructive approval.",
  risk: "destructive",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Workspace-relative file path to delete.",
      },
    },
    required: ["path"],
    additionalProperties: false,
  },
  validate(input) {
    const value = recordInput(input);
    return { path: inputString(value, "path") };
  },
  async execute(input, ctx) {
    await requirePermission(
      ctx,
      "destructive",
      `Delete workspace file: ${input.path}`,
      undefined,
      { tool: "DeleteFile", path: input.path },
    );
    if (!ctx.checkpoint || !ctx.checkpointId)
      throw new ToolError(
        "CONFLICT",
        "DeleteFile requires an active LocalCode checkpoint.",
        {
          recoverable: true,
          suggestedAction: "Create a checkpoint before deleting the file.",
        },
      );
    const absolute = await assertWorkspacePath(ctx.root, input.path);
    const before = await readExistingFile(ctx.root, input.path);
    if (!before.exists)
      throw new ToolError(
        "PATH_NOT_FOUND",
        `No such file or directory: ${input.path}. List or search before deleting.`,
        {
          path: input.path,
          suggestedAction:
            "Confirm the exact existing file path before deleting.",
        },
      );
    await ctx.checkpoint.assertNoExternalChange(ctx.checkpointId, input.path);
    await unlink(absolute);
    await verifyDeleted(absolute, input.path);
    await ctx.checkpoint.recordMutation(ctx.checkpointId, input.path, "");
    return {
      path: input.path,
      operation: "deleted",
      change: changeDiff(input.path, before.content, "", "deleted"),
    };
  },
};

export const listFilesTool: ToolDefinition<
  { path?: string },
  { path: string; kind: "directory"; files: string[] }
> = {
  name: "ListFiles",
  description: "List non-generated files in the workspace.",
  risk: "read",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description:
          "Workspace-relative directory to list (default: repository root).",
      },
    },
    additionalProperties: false,
  },
  validate(input) {
    if (input === undefined) return {};
    const value = recordInput(input);
    return value.path === undefined ? {} : { path: inputString(value, "path") };
  },
  async execute(input, ctx) {
    // A leading "/" means "the workspace root" here (see
    // resolveWorkspacePath), not an OS-absolute path — normalize it the
    // same way so returned paths read as "package.json", not "/package.json".
    const normalizedPath = (input.path ?? "").replace(/^[/\\]+/, "");
    const directory = normalizedPath || ".";
    await requirePermission(
      ctx,
      "read",
      `List workspace directory: ${directory}`,
      undefined,
      { tool: "ListFiles", path: directory },
    );
    const absoluteDirectory = await assertWorkspacePath(ctx.root, directory);
    const info = await statForTool(absoluteDirectory, directory);
    if (info.isFile)
      throw new ToolError(
        "PATH_IS_FILE",
        `${directory} is a file, not a directory. Use ReadFile to read it instead of ListFiles.`,
      );
    const result = await runCommand(
      "rg",
      [
        "--files",
        "--hidden",
        "-g",
        "!.git/**",
        "-g",
        "!node_modules/**",
        "-g",
        "!.localcode/**",
      ],
      {
        intent: "read",
        cwd: absoluteDirectory,
        signal: ctx.signal,
        timeoutMs: 5_000,
        logger: ctx.logger,
      },
    );
    let files: string[];
    if (result.exitCode === 0 || result.exitCode === 1) {
      files = result.stdout
        .split(/\r?\n/)
        .filter((file) => Boolean(file) && !isRuntimeStatePath(file))
        .slice(0, 1_000);
    } else if (result.exitCode === 127) {
      files = await listFallback(ctx.root, directory);
    } else {
      throw new ToolError(
        "COMMAND_FAILED",
        `ListFiles search backend failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`,
        {
          recoverable: true,
          suggestedAction:
            "Retry with a smaller directory or use GlobFiles/SearchText after confirming the local search backend is available.",
        },
      );
    }
    return {
      path: directory,
      kind: "directory",
      files: files.map((file) =>
        directory === "."
          ? file.replaceAll("\\", "/")
          : path.join(directory, file).replaceAll("\\", "/"),
      ),
    };
  },
};

function globToRegExp(pattern: string): RegExp {
  const normalized = pattern.replaceAll("\\", "/");
  let expression = "^";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index] ?? "";
    if (character === "*" && normalized[index + 1] === "*") {
      index += 1;
      if (normalized[index + 1] === "/") {
        index += 1;
        expression += "(?:.*/)?";
      } else expression += ".*";
    } else if (character === "*") expression += "[^/]*";
    else if (character === "?") expression += "[^/]";
    else expression += character.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
  }
  return new RegExp(`${expression}$`, "u");
}

export const globFilesTool: ToolDefinition<
  { pattern: string; path?: string },
  { files: string[] }
> = {
  name: "GlobFiles",
  description: "Find workspace files by a bounded filename glob.",
  risk: "read",
  parameters: {
    type: "object",
    properties: {
      pattern: {
        type: "string",
        description: "Filename glob such as src/**/*.ts or **/*auth*.",
      },
      path: {
        type: "string",
        description: "Optional workspace-relative directory to search within.",
      },
    },
    required: ["pattern"],
    additionalProperties: false,
  },
  validate(input) {
    const value = recordInput(input);
    const pattern = inputString(value, "pattern");
    return {
      pattern,
      ...(value.path === undefined ? {} : { path: inputString(value, "path") }),
    };
  },
  async execute(input, ctx) {
    const normalizedPath = (input.path ?? "").replace(/^[/\\]+/u, "");
    const directory = normalizedPath || ".";
    await requirePermission(
      ctx,
      "read",
      `Find workspace files matching ${input.pattern} in ${directory}`,
      undefined,
      { tool: "GlobFiles", path: directory },
    );
    const absoluteDirectory = await assertWorkspacePath(ctx.root, directory);
    const info = await statForTool(absoluteDirectory, directory);
    if (info.isFile)
      throw new ToolError(
        "PATH_IS_FILE",
        `${directory} is a file, not a directory. Use ReadFile for a file path.`,
        {
          recoverable: true,
          suggestedAction: "Use the parent directory as the glob scope.",
        },
      );
    const result = await runCommand(
      "rg",
      [
        "--files",
        "--hidden",
        "-g",
        "!.git/**",
        "-g",
        "!node_modules/**",
        "-g",
        "!.localcode/**",
        "-g",
        input.pattern,
      ],
      {
        intent: "read",
        cwd: absoluteDirectory,
        signal: ctx.signal,
        timeoutMs: 5_000,
        logger: ctx.logger,
      },
    );
    let files: string[];
    if (result.exitCode === 0 || result.exitCode === 1) {
      files = result.stdout
        .split(/\r?\n/)
        .filter((file) => Boolean(file) && !isRuntimeStatePath(file))
        .slice(0, 500);
    } else if (result.exitCode === 127) {
      files = (await listFallback(ctx.root, "."))
        .filter((file) => globToRegExp(input.pattern).test(file))
        .slice(0, 500);
    } else {
      throw new ToolError(
        "COMMAND_FAILED",
        `GlobFiles search backend failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`,
        {
          recoverable: true,
          suggestedAction:
            "Retry with a simpler pattern or use SearchText after confirming the local search backend is available.",
        },
      );
    }
    return {
      files: files.map((file) =>
        directory === "."
          ? file.replaceAll("\\", "/")
          : path.join(directory, file).replaceAll("\\", "/"),
      ),
    };
  },
};

const SEARCH_EXCLUDED_NAME_PATTERN = /^(?:\.env|credentials)/i;
const SEARCH_MAX_MATCHES = 200;
const SEARCH_MAX_FILE_BYTES = 1_000_000;

export interface SearchMatch {
  path: string;
  line: number;
  column?: number;
  preview: string;
}

async function searchFallback(
  cwd: string,
  query: string,
  glob?: string,
): Promise<SearchMatch[]> {
  let regex: RegExp;
  try {
    regex = new RegExp(query);
  } catch {
    throw new ToolError(
      "INVALID_ARGUMENT",
      `SearchText query is not a valid regular expression: ${query}`,
      { field: "pattern", recoverable: true },
    );
  }
  const globRegex = glob ? globToRegExp(glob) : undefined;
  const files = await listFallback(cwd, ".");
  const matches: SearchMatch[] = [];
  for (const relative of files) {
    if (matches.length >= SEARCH_MAX_MATCHES) break;
    if (SEARCH_EXCLUDED_NAME_PATTERN.test(path.basename(relative))) continue;
    if (globRegex && !globRegex.test(relative.replaceAll("\\", "/"))) continue;
    const absolute = path.join(cwd, relative);
    let content: string;
    try {
      const info = await stat(absolute);
      if (!info.isFile() || info.size > SEARCH_MAX_FILE_BYTES) continue;
      content = await readFile(absolute, "utf8");
    } catch {
      continue;
    }
    const lines = content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (matches.length >= SEARCH_MAX_MATCHES) break;
      const line = lines[index] ?? "";
      regex.lastIndex = 0;
      const match = regex.exec(line);
      if (match) {
        matches.push({
          path: relative.replaceAll("\\", "/"),
          line: index + 1,
          ...(match.index === undefined ? {} : { column: match.index + 1 }),
          preview: line,
        });
      }
    }
  }
  return matches;
}

function parseSearchMatches(output: string): SearchMatch[] {
  const matches: SearchMatch[] = [];
  for (const raw of output.split(/\r?\n/u).filter(Boolean)) {
    const match = raw.match(/^(.*?):(\d+)(?::(\d+))?:(.*)$/u);
    if (!match?.[1] || !match[2]) continue;
    matches.push({
      path: match[1].replaceAll("\\", "/"),
      line: Number(match[2]),
      ...(match[3] ? { column: Number(match[3]) } : {}),
      preview: match[4] ?? "",
    });
    if (matches.length >= SEARCH_MAX_MATCHES) break;
  }
  return matches;
}

export const searchTextTool: ToolDefinition<
  { query: string; path?: string; glob?: string; pattern?: string },
  { matches: SearchMatch[] }
> = {
  name: "SearchText",
  description:
    "Search workspace text with a regular-expression query and optional filename glob.",
  risk: "read",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "Regular expression to search for in text.",
      },
      pattern: {
        type: "string",
        description: "Deprecated host alias for query; prefer query.",
      },
      path: {
        type: "string",
        description:
          "Workspace-relative directory to search within (default: repository root).",
      },
      glob: {
        type: "string",
        description: "Optional filename glob such as src/**/*.ts.",
      },
    },
    additionalProperties: false,
  },
  validate(input) {
    const value = recordInput(input);
    const queryValue = value.query ?? value.pattern;
    const query = stringInput(queryValue);
    try {
      new RegExp(query);
    } catch {
      throw new ToolError(
        "INVALID_ARGUMENT",
        `SearchText query is not a valid regular expression: ${query}`,
        { field: "query", recoverable: true },
      );
    }
    const glob = value.glob === undefined ? undefined : stringInput(value.glob);
    return {
      query,
      ...(value.pattern === undefined ? {} : { pattern: query }),
      ...(value.path === undefined ? {} : { path: inputString(value, "path") }),
      ...(glob === undefined ? {} : { glob }),
    };
  },
  async execute(input, ctx) {
    await requirePermission(
      ctx,
      "read",
      `Search workspace for ${JSON.stringify(input.query)}`,
      undefined,
      { tool: "SearchText" },
    );
    const cwd = await assertWorkspacePath(ctx.root, input.path ?? ".");
    const result = await runCommand(
      "rg",
      [
        "--line-number",
        "--column",
        "--no-heading",
        "--hidden",
        "-g",
        "!.git/**",
        "-g",
        "!node_modules/**",
        "-g",
        "!.env*",
        "-g",
        "!credentials*",
        ...(input.glob ? ["-g", input.glob] : []),
        "--",
        input.query,
      ],
      {
        intent: "read",
        cwd,
        signal: ctx.signal,
        timeoutMs: 10_000,
        logger: ctx.logger,
      },
    );
    // Exit code 127 means rg itself isn't installed (see runCommand) — fall
    // back to a pure-JS search rather than surface "command not found" as a
    // fake match. Exit code 1 with no output is ripgrep's normal "no
    // matches" result and is left as an empty match list.
    if (result.exitCode === 127) {
      return { matches: await searchFallback(cwd, input.query, input.glob) };
    }
    if (result.exitCode !== 0 && result.exitCode !== 1)
      throw new ToolError(
        "COMMAND_FAILED",
        `SearchText backend failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`,
        {
          recoverable: true,
          suggestedAction:
            "Retry with a simpler query or use ListFiles/ReadFile while the search backend is unavailable.",
        },
      );
    return {
      matches: parseSearchMatches(result.stdout),
    };
  },
};

export const shellTool: ToolDefinition<
  { command: string },
  {
    command: string;
    cwd: string;
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
    timedOut: boolean;
  }
> = {
  name: "Shell",
  description: SHELL_TOOL_DESCRIPTION,
  risk: "execute",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description:
          process.platform === "win32"
            ? "PowerShell-compatible command to run in the workspace root; use ReadFile/SearchText instead of Unix-only text pipelines."
            : "Shell command to run in the workspace root.",
      },
    },
    required: ["command"],
    additionalProperties: false,
  },
  validate(input) {
    const value = recordInput(input);
    return { command: inputString(value, "command") };
  },
  async execute(input, ctx) {
    if (ctx.network === false && commandRequiresNetwork(input.command))
      throw new ToolError(
        "PERMISSION_DENIED",
        "Network-capable shell commands are disabled for this turn.",
        {
          recoverable: false,
          suggestedAction:
            "Use a local command or a turn policy that explicitly permits network access.",
        },
      );
    if (shellCommandEscapesWorkspace(input.command))
      throw new ToolError(
        "OUTSIDE_WORKSPACE",
        "The shell command attempts to leave the workspace boundary.",
        {
          recoverable: false,
          suggestedAction:
            "Run a command relative to the configured workspace root.",
        },
      );
    const classification = classifyShellCommand(input.command);
    const destructiveApproved = await requirePermission(
      ctx,
      classification,
      `Run command: ${input.command}`,
      input.command,
      { tool: "Shell" },
    );
    const started = performance.now();
    const result = await runToolShellCommand(input.command, {
      intent:
        classification === "destructive"
          ? "destructive"
          : classification === "read"
            ? "read"
            : "execute",
      cwd: ctx.root,
      signal: ctx.signal,
      timeoutMs: 120_000,
      maxOutputChars: 50_000,
      network: ctx.network === false ? "deny" : "allow",
      isolation: ctx.osIsolation ?? "best_effort",
      allowWeakIsolation: ctx.allowWeakProcessIsolation ?? true,
      allowDestructive: destructiveApproved,
      policyCommand: input.command,
      env: ctx.env,
      onOutput: ctx.onOutput,
      logger: ctx.logger,
    });
    return {
      command: input.command,
      cwd: ctx.root,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs ?? Math.round(performance.now() - started),
      timedOut: result.timedOut ?? false,
    };
  },
};

export const gitStatusTool: ToolDefinition<
  Record<string, never>,
  { output: string }
> = {
  name: "GitStatus",
  description: "Show concise Git status.",
  risk: "read",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  validate() {
    return {};
  },
  async execute(_input, ctx) {
    await requirePermission(ctx, "read", "Read Git status", undefined, {
      tool: "GitStatus",
    });
    const result = await runCommand("git", ["status", "--short", "--branch"], {
      intent: "read",
      cwd: ctx.root,
      signal: ctx.signal,
      timeoutMs: 10_000,
      network: ctx.network === false ? "deny" : "allow",
      policyCommand: "git status --short --branch",
      logger: ctx.logger,
    });
    if (result.exitCode !== 0)
      throw new ToolError(
        "COMMAND_FAILED",
        `GitStatus failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`,
        {
          recoverable: true,
          suggestedAction:
            "Confirm the workspace is a Git repository before retrying GitStatus.",
        },
      );
    return { output: result.stdout || result.stderr };
  },
};

export const gitDiffTool: ToolDefinition<
  { staged?: boolean },
  { output: string }
> = {
  name: "GitDiff",
  description: "Show the current Git diff.",
  risk: "read",
  parameters: {
    type: "object",
    properties: {
      staged: {
        type: "boolean",
        description: "Show the staged diff instead of the working tree diff.",
      },
    },
    additionalProperties: false,
  },
  validate(input) {
    if (input === undefined) return {};
    const value = recordInput(input);
    return { staged: inputBoolean(value, "staged") };
  },
  async execute(input, ctx) {
    await requirePermission(
      ctx,
      "read",
      `Read ${input.staged ? "staged " : "working tree "}Git diff`,
      undefined,
      { tool: "GitDiff" },
    );
    const result = await runCommand(
      "git",
      input.staged ? ["diff", "--cached", "--"] : ["diff", "--"],
      {
        intent: "read",
        cwd: ctx.root,
        signal: ctx.signal,
        timeoutMs: 10_000,
        network: ctx.network === false ? "deny" : "allow",
        policyCommand: input.staged ? "git diff --cached --" : "git diff --",
        logger: ctx.logger,
      },
    );
    if (result.exitCode !== 0)
      throw new ToolError(
        "COMMAND_FAILED",
        `GitDiff failed with exit code ${result.exitCode}: ${result.stderr || result.stdout}`,
        {
          recoverable: true,
          suggestedAction:
            "Confirm the workspace is a Git repository before retrying GitDiff.",
        },
      );
    return { output: (result.stdout || result.stderr).slice(0, 50_000) };
  },
};

export interface TestFailure {
  summary: string;
}

export interface TestRun {
  command: string;
  exitCode: number;
  passed?: number;
  failed?: number;
  skipped?: number;
  durationMs: number;
  failures: TestFailure[];
  output: string;
}

function countTestStatus(
  output: string,
  status: "pass" | "fail" | "skip",
): number | undefined {
  const match = output.match(new RegExp(`(\\d+)\\s+${status}\\b`, "i"));
  return match?.[1] ? Number(match[1]) : undefined;
}

function testFailures(output: string, exitCode: number): TestFailure[] {
  if (exitCode === 0) return [];
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && /\b(?:error|fail|failed)\b/i.test(line));
  const summaries = lines.slice(0, 20).map((summary) => ({ summary }));
  return summaries.length > 0
    ? summaries
    : [{ summary: `Command exited with code ${exitCode}.` }];
}

export const runTestsTool: ToolDefinition<{ command?: string }, TestRun> = {
  name: "RunTests",
  description: "Run the repository's configured test command.",
  risk: "execute",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description:
          "Test command to run (default: the project's configured test command).",
      },
    },
    additionalProperties: false,
  },
  validate(input) {
    if (input === undefined) return {};
    const value = recordInput(input);
    return value.command === undefined
      ? {}
      : { command: inputString(value, "command") };
  },
  async execute(input, ctx) {
    const command = input.command ?? ctx.defaultTestCommand ?? "bun test";
    if (ctx.network === false && commandRequiresNetwork(command))
      throw new ToolError(
        "PERMISSION_DENIED",
        "Network-capable test commands are disabled for this turn.",
        {
          recoverable: false,
          suggestedAction:
            "Use a local test command or a turn policy that explicitly permits network access.",
        },
      );
    await requirePermission(
      ctx,
      "execute",
      `Run tests: ${command}`,
      command,
      { tool: "RunTests" },
    );
    const classification = classifyShellCommand(command);
    if (classification === "destructive")
      throw new ToolError(
        "PERMISSION_DENIED",
        "RunTests rejected a destructive command.",
        {
          recoverable: false,
          suggestedAction:
            "Use a read-only test command or request explicit approval for the destructive action.",
        },
      );
    const started = performance.now();
    const result = await runToolShellCommand(command, {
      intent: "test",
      cwd: ctx.root,
      signal: ctx.signal,
      timeoutMs: 120_000,
      maxOutputChars: 50_000,
      network: ctx.network === false ? "deny" : "allow",
      isolation: ctx.osIsolation ?? "best_effort",
      allowWeakIsolation: ctx.allowWeakProcessIsolation ?? true,
      policyCommand: command,
      env: ctx.env,
      onOutput: ctx.onOutput,
      logger: ctx.logger,
    });
    const output = `${result.stdout}${result.stderr}`.slice(0, 50_000);
    return {
      command,
      exitCode: result.exitCode,
      ...(countTestStatus(output, "pass") === undefined
        ? {}
        : { passed: countTestStatus(output, "pass") }),
      ...(countTestStatus(output, "fail") === undefined
        ? {}
        : { failed: countTestStatus(output, "fail") }),
      ...(countTestStatus(output, "skip") === undefined
        ? {}
        : { skipped: countTestStatus(output, "skip") }),
      durationMs: Math.round(performance.now() - started),
      failures: testFailures(output, result.exitCode),
      output,
    };
  },
};

export const workspaceTools = [
  readFileTool,
  writeFileTool,
  createFileTool,
  editFileTool,
  deleteFileTool,
  globFilesTool,
  listFilesTool,
  searchTextTool,
  shellTool,
  gitStatusTool,
  gitDiffTool,
  runTestsTool,
] as const;
