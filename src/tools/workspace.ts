import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  runCommand,
  type ProcessOptions,
  type ProcessResult,
} from "../shared/process.js";
import { assertWorkspacePath, resolveWorkspacePath } from "../shared/paths.js";
import { isNeverRemotePath } from "../privacy/policy.js";
import {
  checkPermission,
  classifyShellCommand,
  shellCommandEscapesWorkspace,
} from "./permissions.js";
import { ToolError } from "./errors.js";
import type { ToolDefinition, ToolExecutionContext } from "./types.js";

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
      );
    }
    throw error;
  }
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

const SECRET_ENV_NAME =
  /(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|COOKIE|PRIVATE[_-]?KEY)/iu;

export function safeExecutionEnvironment(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && !SECRET_ENV_NAME.test(key)) safe[key] = value;
  }
  return safe;
}

async function runToolCommand(
  command: string,
  args: string[],
  options: ProcessOptions,
): Promise<ProcessResult> {
  try {
    return await runCommand(command, args, {
      ...options,
      env: safeExecutionEnvironment(options.env),
    });
  } catch (error) {
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

function inputString(input: Record<string, unknown>, key: string): string {
  return stringInput(input[key]);
}

function inputBoolean(input: Record<string, unknown>, key: string): boolean {
  return input[key] === true;
}

async function requirePermission(
  ctx: ToolExecutionContext,
  risk: "read" | "write" | "execute" | "destructive",
  description = `Run ${risk} workspace action`,
): Promise<void> {
  const decision = checkPermission({ mode: ctx.permissionMode, risk });
  ctx.logger?.debug("tool.permission.checked", {
    risk,
    permissionMode: ctx.permissionMode,
    allowed: decision.allowed,
    requiresApproval: decision.requiresApproval,
  });
  if (decision.allowed) return;
  if (decision.requiresApproval && ctx.requestApproval) {
    ctx.logger?.info("tool.permission.approval_requested", { risk });
    const allowed = await ctx.requestApproval({ description, risk });
    if (allowed) {
      ctx.logger?.info("tool.permission.approved", { risk });
      return;
    }
    ctx.logger?.warn("tool.permission.denied", {
      risk,
      reason: "approval_denied",
    });
    throw new ToolError(
      "PERMISSION_DENIED",
      "Approval denied for this workspace action.",
      {
        recoverable: false,
        suggestedAction: "Ask the user for explicit approval before retrying.",
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
    else result.push(relative);
  }
  return result;
}

export interface FileReadResult {
  path: string;
  content: string;
  sensitivePath: boolean;
  truncated: boolean;
}

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
        description: "Optional last line to return, inclusive.",
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
    await requirePermission(ctx, "read");
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
    return {
      path: input.path,
      content: (() => {
        const lines = content.split(/\r?\n/);
        const selected =
          typeof input.startLine === "number" ||
          typeof input.endLine === "number"
            ? lines.slice((input.startLine ?? 1) - 1, input.endLine).join("\n")
            : content;
        return selected.slice(0, maxChars);
      })(),
      sensitivePath: isNeverRemotePath(input.path),
      truncated:
        (typeof input.startLine === "number" ||
        typeof input.endLine === "number"
          ? content
              .split(/\r?\n/)
              .slice((input.startLine ?? 1) - 1, input.endLine)
              .join("\n")
          : content
        ).length > maxChars,
    };
  },
};

export const writeFileTool: ToolDefinition<
  { path: string; content: string },
  { path: string; bytes: number }
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
    await requirePermission(ctx, "write");
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
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, input.content, "utf8");
    await ctx.checkpoint.recordMutation(
      ctx.checkpointId,
      input.path,
      input.content,
    );
    return {
      path: input.path,
      bytes: Buffer.byteLength(input.content, "utf8"),
    };
  },
};

export const editFileTool: ToolDefinition<
  { path: string; oldText: string; newText: string; replaceAll?: boolean },
  { path: string; replacements: number }
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
    return {
      path: inputString(value, "path"),
      oldText: value.oldText,
      newText: value.newText,
      replaceAll: inputBoolean(value, "replaceAll"),
    };
  },
  async execute(input, ctx) {
    await requirePermission(ctx, "write");
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
    const current = await readFile(absolute, "utf8");
    const occurrences = current.split(input.oldText).length - 1;
    if (occurrences === 0)
      throw new ToolError("NOT_FOUND", "EditFile target text was not found.", {
        recoverable: true,
        suggestedAction: "Read the current file and retry with exact text.",
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
    await ctx.checkpoint.recordMutation(ctx.checkpointId, input.path, updated);
    return {
      path: input.path,
      replacements: input.replaceAll ? occurrences : 1,
    };
  },
};

export const listFilesTool: ToolDefinition<
  { path?: string },
  { files: string[] }
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
    await requirePermission(ctx, "read");
    // A leading "/" means "the workspace root" here (see
    // resolveWorkspacePath), not an OS-absolute path — normalize it the
    // same way so returned paths read as "package.json", not "/package.json".
    const normalizedPath = (input.path ?? "").replace(/^[/\\]+/, "");
    const directory = normalizedPath || ".";
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
        cwd: absoluteDirectory,
        signal: ctx.signal,
        timeoutMs: 5_000,
        logger: ctx.logger,
      },
    );
    const files =
      result.exitCode === 0
        ? result.stdout.split(/\r?\n/).filter(Boolean).slice(0, 1_000)
        : await listFallback(ctx.root, directory);
    return {
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
    await requirePermission(ctx, "read");
    const normalizedPath = (input.path ?? "").replace(/^[/\\]+/u, "");
    const directory = normalizedPath || ".";
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
        cwd: absoluteDirectory,
        signal: ctx.signal,
        timeoutMs: 5_000,
        logger: ctx.logger,
      },
    );
    const files =
      result.exitCode === 0
        ? result.stdout.split(/\r?\n/).filter(Boolean).slice(0, 500)
        : result.exitCode === 127
          ? (await listFallback(ctx.root, "."))
              .filter((file) => globToRegExp(input.pattern).test(file))
              .slice(0, 500)
          : [];
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
    await requirePermission(ctx, "read");
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
  description: "Run a classified workspace command.",
  risk: "execute",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "Shell command to run in the workspace root.",
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
    if (
      ctx.network === false &&
      /\b(?:curl|wget|irm|invoke-webrequest|git\s+(?:clone|fetch|pull)|npm\s+install|pnpm\s+install|yarn\s+install|bun\s+install)\b/iu.test(
        input.command,
      )
    )
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
    await requirePermission(
      ctx,
      classification,
      `Run command: ${input.command}`,
    );
    const shell =
      process.platform === "win32"
        ? ["cmd.exe", "/d", "/s", "/c", input.command]
        : ["/bin/sh", "-lc", input.command];
    const started = performance.now();
    const result = await runToolCommand(shell[0]!, shell.slice(1), {
      cwd: ctx.root,
      signal: ctx.signal,
      timeoutMs: 120_000,
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
    await requirePermission(ctx, "read");
    const result = await runCommand("git", ["status", "--short", "--branch"], {
      cwd: ctx.root,
      signal: ctx.signal,
      timeoutMs: 10_000,
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
    await requirePermission(ctx, "read");
    const result = await runCommand(
      "git",
      input.staged ? ["diff", "--cached", "--"] : ["diff", "--"],
      {
        cwd: ctx.root,
        signal: ctx.signal,
        timeoutMs: 10_000,
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
    await requirePermission(ctx, "execute");
    const command = input.command ?? "bun test";
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
    const shell =
      process.platform === "win32"
        ? ["cmd.exe", "/d", "/s", "/c", command]
        : ["/bin/sh", "-lc", command];
    const started = performance.now();
    const result = await runToolCommand(shell[0]!, shell.slice(1), {
      cwd: ctx.root,
      signal: ctx.signal,
      timeoutMs: 120_000,
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
  editFileTool,
  globFilesTool,
  listFilesTool,
  searchTextTool,
  shellTool,
  gitStatusTool,
  gitDiffTool,
  runTestsTool,
] as const;
