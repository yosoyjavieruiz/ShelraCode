import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  NormalizedMessage,
  ProviderAdapter,
  ProviderEvent,
  ToolCall,
} from "../providers/types.js";
import type {
  AgentProbeExecutionEvidence,
  AgentProbeEnvironment,
  AgentProbeHardwareSnapshot,
  AgentCapabilityProfile,
  AgentCapabilityClass,
  ModelCandidate,
} from "../shared/types.js";
import { CheckpointService } from "../checkpoint/checkpoint.js";
import { LocalCodeDatabase } from "../storage/database.js";
import { ToolError } from "../tools/errors.js";
import { runTestsTool, workspaceTools } from "../tools/workspace.js";
import type { LocalCodeLogger } from "../shared/logging.js";
import { recoverTextToolCalls } from "./tool-envelope.js";
import { runAgent } from "./loop.js";

export interface AgentCapabilityProbeResult {
  /** Increment when probe semantics or its executable protocol changes. */
  probeVersion: number;
  /** Responded to a plain greeting without calling a tool. */
  conversation: boolean;
  /** Called the right tool with valid, parseable arguments when asked to. */
  readTool: boolean;
  /** Produced a text continuation after seeing a tool result, instead of
   * repeating the same tool call. Only meaningful (and only set true) when
   * `readTool` also passed — there is nothing to continue otherwise. */
  multiTurnTools: boolean;
  /** All of the above. This — not raw parameter count or a `tools: true`
   * flag — is what should gate autonomous coding eligibility. */
  agenticCodingEligible: boolean;
  agentCapabilityClass: AgentCapabilityClass;
  profile?: AgentCapabilityProfile;
  execution?: AgentProbeExecutionEvidence;
  environment?: AgentProbeEnvironment;
  notes: string[];
}

export const AGENT_CAPABILITY_PROBE_VERSION = 11;

const PROBE_TEMPERATURE = 0;
const PROBE_MAX_OUTPUT_TOKENS = 512;

const PROBE_READ_TOOL = {
  type: "function",
  function: {
    name: "ReadFile",
    description: "Read the UTF-8 text contents of a workspace file.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
};

const PROBE_LIST_TOOL = {
  type: "function",
  function: {
    name: "ListFiles",
    description: "List entries in a workspace directory.",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
  },
};

const PROBE_EDIT_TOOL = {
  type: "function",
  function: {
    name: "EditFile",
    description: "Replace an exact string in a workspace file.",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        oldText: { type: "string" },
        newText: { type: "string" },
      },
      required: ["path", "oldText", "newText"],
      additionalProperties: false,
    },
  },
};

const PROBE_TEST_TOOL = {
  type: "function",
  function: {
    name: "RunTests",
    description: "Run the project's tests and inspect the result.",
    parameters: {
      type: "object",
      properties: { command: { type: "string" } },
      additionalProperties: false,
    },
  },
};

const executableProbeTestTool = {
  ...runTestsTool,
  validate(input: unknown) {
    const value = runTestsTool.validate(input);
    if (value.command !== undefined && value.command.trim() !== "bun test")
      throw new ToolError(
        "PERMISSION_DENIED",
        "Capability probes only execute the disposable fixture's bun test command.",
        { recoverable: false },
      );
    return value;
  },
};

async function collectEvents(
  provider: ProviderAdapter,
  messages: NormalizedMessage[],
  modelId: string,
  signal: AbortSignal,
  tools: unknown[] = [PROBE_READ_TOOL],
  toolChoice: "auto" | "none" = "auto",
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  let text = "";
  const toolCalls: ToolCall[] = [];
  const events: AsyncIterable<ProviderEvent> = provider.stream(
    {
      modelId,
      messages,
      tools,
      toolChoice,
      temperature: PROBE_TEMPERATURE,
      maxOutputTokens: PROBE_MAX_OUTPUT_TOKENS,
      stream: true,
    },
    signal,
  );
  for await (const event of events) {
    if (event.type === "text.delta") text += event.text;
    else if (event.type === "tool.call") toolCalls.push(event.call);
    else if (event.type === "error")
      throw new Error(`Probe request failed: ${event.error.message}`);
  }
  const recoveredCalls = recoverTextToolCalls(text, messages.length);
  for (const call of recoveredCalls ?? []) {
    if (!toolCalls.some((existing) => existing.id === call.id))
      toolCalls.push(call);
  }
  return { text, toolCalls };
}

async function retryAfterTextualDuplicate(
  provider: ProviderAdapter,
  modelId: string,
  signal: AbortSignal,
  messages: NormalizedMessage[],
  duplicateCalls: ToolCall[],
  tools: unknown[],
): Promise<{ text: string; toolCalls: ToolCall[] }> {
  return collectEvents(
    provider,
    [
      ...messages,
      { role: "assistant", content: "", toolCalls: duplicateCalls },
      ...duplicateCalls.map((call) => ({
        role: "tool" as const,
        toolCallId: call.id,
        content: JSON.stringify({
          code: "CONFLICT",
          recoverable: true,
          suggestedAction:
            "Use the previous tool result and answer without another tool call.",
        }),
      })),
    ],
    modelId,
    signal,
    tools,
    "none",
  );
}

function parseReadFilePath(call: ToolCall): string | undefined {
  try {
    const parsed = JSON.parse(call.arguments || "{}") as Record<
      string,
      unknown
    >;
    return typeof parsed.path === "string" ? parsed.path : undefined;
  } catch {
    return undefined;
  }
}

function parseObjectArguments(
  call: ToolCall,
): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(call.arguments || "{}");
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

async function probeToolErrorRecovery(
  provider: ProviderAdapter,
  modelId: string,
  signal: AbortSignal,
  notes: string[],
): Promise<boolean> {
  const messages: NormalizedMessage[] = [
    {
      role: "user",
      content:
        "List the entries inside demo.txt. If the host reports that the path is a file, switch to ReadFile and answer with its contents.",
    },
  ];
  try {
    const first = await collectEvents(provider, messages, modelId, signal, [
      PROBE_LIST_TOOL,
      PROBE_READ_TOOL,
    ]);
    const listCall = first.toolCalls.find((call) => call.name === "ListFiles");
    const listArguments = listCall ? parseObjectArguments(listCall) : undefined;
    const pathValue =
      typeof listArguments?.path === "string" ? listArguments.path : undefined;
    if (!listCall || !pathValue) {
      notes.push(
        "Model did not select ListFiles with a valid path before the injected PATH_IS_FILE error.",
      );
      return false;
    }

    const continuation = await collectEvents(
      provider,
      [
        ...messages,
        { role: "assistant", content: "", toolCalls: [listCall] },
        {
          role: "tool",
          toolCallId: listCall.id,
          content: JSON.stringify({
            ok: false,
            code: "PATH_IS_FILE",
            path: pathValue,
            recoverable: true,
            suggestedAction: "Use ReadFile for this path.",
          }),
        },
      ],
      modelId,
      signal,
      [PROBE_LIST_TOOL, PROBE_READ_TOOL],
    );
    const readCall = continuation.toolCalls.find(
      (call) => call.name === "ReadFile",
    );
    const readArguments = readCall ? parseObjectArguments(readCall) : undefined;
    const recoveredPath =
      typeof readArguments?.path === "string" ? readArguments.path : undefined;
    if (!readCall || recoveredPath !== pathValue) {
      notes.push(
        "Model did not switch from ListFiles to ReadFile after PATH_IS_FILE.",
      );
      return false;
    }
    return true;
  } catch (error) {
    notes.push(
      `Tool-error recovery probe failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return false;
  }
}

function capabilityResult(
  passed: boolean,
  notes: string[],
): { status: "pass" | "fail"; notes: string[] } {
  return { status: passed ? "pass" : "fail", notes };
}

function buildCapabilityProfile(
  provider: ProviderAdapter,
  modelId: string,
  conversation: boolean,
  readTool: boolean,
  multiTurnTools: boolean,
  errorRecovery: boolean | undefined,
  overall: AgentCapabilityClass,
  notes: string[],
): AgentCapabilityProfile {
  const unmeasured = (label: string) => ({
    status: "unmeasured" as const,
    notes: [`${label} was not included in this probe.`],
  });
  return {
    modelId,
    runtimeId: provider.id,
    conversation: capabilityResult(conversation, notes),
    noToolDiscipline: capabilityResult(conversation, notes),
    toolSelection: capabilityResult(readTool, notes),
    toolArguments: capabilityResult(readTool, notes),
    multiTurnTools: capabilityResult(multiTurnTools, notes),
    errorRecovery:
      errorRecovery === undefined
        ? unmeasured("Error recovery")
        : capabilityResult(errorRecovery, notes),
    repositoryReasoning: unmeasured("Repository reasoning"),
    editReliability: unmeasured("Editing"),
    verificationBehavior: unmeasured("Verification"),
    overall,
  };
}

function probeCandidate(
  provider: ProviderAdapter,
  modelId: string,
): ModelCandidate {
  return {
    id: `probe/${provider.id}/${modelId}`,
    providerId: provider.id,
    displayName: modelId,
    source: "local",
    capabilities: {
      tools: true,
      structuredOutput: true,
      reasoning: false,
      vision: false,
    },
    free: { status: "verified_free" },
    privacy: {
      classification: "local",
      retentionKnown: true,
      trainsOnInputs: false,
    },
    quality: { coding: 0.5, toolUse: 0.5, confidence: "measured" },
    health: { state: "healthy" },
  };
}

function runOutputExitCode(run: { output?: unknown }): number | undefined {
  if (typeof run.output !== "object" || run.output === null) return undefined;
  const value = (run.output as Record<string, unknown>).exitCode;
  return typeof value === "number" ? value : undefined;
}

async function runExecutableCapabilityProbe(
  provider: ProviderAdapter,
  modelId: string,
  signal: AbortSignal,
  logger?: LocalCodeLogger,
): Promise<AgentProbeExecutionEvidence> {
  const notes: string[] = [];
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-capability-probe-"),
  );
  const database = new LocalCodeDatabase(
    path.join(root, "probe-state.sqlite"),
    logger,
  );
  const checkpoint = new CheckpointService(database, root, logger);
  const candidate = probeCandidate(provider, modelId);

  try {
    await mkdir(path.join(root, "src"), { recursive: true });
    await writeFile(
      path.join(root, "package.json"),
      JSON.stringify({ name: "localcode-capability-probe", version: "0.0.0" }) +
        "\n",
      "utf8",
    );
    await writeFile(
      path.join(root, "src", "message.ts"),
      'export const greeting = "hello";\n',
      "utf8",
    );
    await writeFile(
      path.join(root, "src", "math.ts"),
      "export function add(a: number, b: number): number {\n  return a - b;\n}\n",
      "utf8",
    );
    await writeFile(
      path.join(root, "math.test.ts"),
      "import { expect, test } from 'bun:test';\n" +
        "import { add } from './src/math.ts';\n" +
        "test('add sums two numbers', () => {\n" +
        "  expect(add(2, 3)).toBe(5);\n" +
        "});\n",
      "utf8",
    );

    const runProbeTask = async (
      id: string,
      objective: string,
      toolNames: readonly string[],
      verificationCommands: Array<{
        stage: "test" | "typecheck" | "lint" | "build";
        command: string;
      }>,
    ) => {
      const tools = workspaceTools
        .filter((tool) => toolNames.includes(tool.name))
        .map((tool) =>
          tool.name === "RunTests" ? executableProbeTestTool : tool,
        );
      return runAgent(
        {
          id,
          objective,
          root,
          candidate,
          mode: "coding",
          repositoryPolicy: "local_only",
          permissionMode: "AUTO",
          context:
            "This is a disposable capability-probe workspace. Use only the " +
            "available workspace tools. The host will inspect the resulting " +
            "files and test evidence.",
          verificationCommands,
          maxTurns: 10,
          systemPromptProfile: "coding",
        },
        {
          provider,
          tools,
          toolChoice: "auto",
          checkUserWorkPreserved: (checkpointId) =>
            checkpointId ? checkpoint.isPreserved(checkpointId) : true,
          reviewFinalDiff: () => true,
          logger,
          async createExecutionContext() {
            return {
              root,
              permissionMode: "AUTO" as const,
              signal,
              network: false,
              checkpoint,
              env: process.env,
            };
          },
        },
        signal,
      );
    };

    const editResult = await runProbeTask(
      "capability-probe-edit",
      "CAPABILITY EDIT: Read src/message.ts, change the exact greeting value from hello to hello world, then confirm the change.",
      ["ReadFile", "EditFile"],
      [],
    );
    const editedContent = await readFile(
      path.join(root, "src", "message.ts"),
      "utf8",
    );
    const editApplied =
      editResult.status === "completed" &&
      editResult.ledger.filesChanged.length > 0 &&
      editedContent.includes('greeting = "hello world"');
    if (!editApplied)
      notes.push(
        "The executable edit probe did not produce the requested verified file change.",
      );

    const testResult = await runProbeTask(
      "capability-probe-test",
      "CAPABILITY TEST: Run bun test first. Inspect the failing result, fix src/math.ts so add(2, 3) passes, run bun test again, and report the verified result.",
      ["ReadFile", "EditFile", "RunTests"],
      [{ stage: "test", command: "bun test" }],
    );
    const failedTestIndex = testResult.toolRuns.findIndex(
      (run) => run.tool === "RunTests" && run.code === "TEST_FAILED",
    );
    const editAfterFailure = testResult.toolRuns.findIndex(
      (run, index) =>
        run.tool === "EditFile" && run.ok && index > failedTestIndex,
    );
    const passedTestAfterEdit = testResult.toolRuns.findIndex(
      (run, index) =>
        run.tool === "RunTests" &&
        run.ok &&
        runOutputExitCode(run) === 0 &&
        index > editAfterFailure,
    );
    const hostPassedTestAfterEdit =
      editAfterFailure > failedTestIndex &&
      testResult.ledger.verificationRuns.some(
        (run) =>
          run.stage === "test" && run.status === "passed" && run.exitCode === 0,
      );
    const testIteration =
      testResult.status === "completed" &&
      failedTestIndex >= 0 &&
      editAfterFailure > failedTestIndex &&
      (passedTestAfterEdit > editAfterFailure || hostPassedTestAfterEdit);
    if (!testIteration)
      notes.push(
        "The executable test probe did not demonstrate fail -> inspect/edit -> retest -> pass.",
      );

    return { editApplied, testIteration, notes };
  } catch (error) {
    notes.push(
      `Executable capability probe failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return { editApplied: false, testIteration: false, notes };
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * Probe whether a model+runtime combination is reliable enough for autonomous
 * coding, not just chat. The protocol probes are non-destructive; when a root
 * option is supplied, a second pass executes the edit and failing-test probes
 * inside a disposable temporary workspace.
 */
export interface AgentCapabilityProbeEnvironmentInput {
  task?: string;
  modelRevision?: string;
  quantization?: string;
  contextLength?: number;
  runtimeVersion?: string;
  chatTemplate?: string;
  toolParser?: string;
  hardware?: AgentProbeHardwareSnapshot;
}

export interface AgentCapabilityProbeOptions {
  /** Disposable repository root for executable edit/test probes. */
  root?: string;
  /** Optional runtime and hardware facts captured with the result. */
  environment?: AgentCapabilityProbeEnvironmentInput;
  logger?: LocalCodeLogger;
}

function buildProbeEnvironment(
  provider: ProviderAdapter,
  modelId: string,
  input: AgentCapabilityProbeEnvironmentInput = {},
): AgentProbeEnvironment {
  return {
    modelId,
    runtimeId: provider.id,
    task: input.task ?? "capability-probe",
    ...(input.modelRevision === undefined
      ? {}
      : { modelRevision: input.modelRevision }),
    ...(input.quantization === undefined
      ? {}
      : { quantization: input.quantization }),
    ...(input.contextLength === undefined
      ? {}
      : { contextLength: input.contextLength }),
    ...(input.runtimeVersion === undefined
      ? {}
      : { runtimeVersion: input.runtimeVersion }),
    ...(input.chatTemplate === undefined
      ? {}
      : { chatTemplate: input.chatTemplate }),
    ...(input.toolParser === undefined ? {} : { toolParser: input.toolParser }),
    generation: {
      temperature: PROBE_TEMPERATURE,
      maxOutputTokens: PROBE_MAX_OUTPUT_TOKENS,
    },
    ...(input.hardware === undefined ? {} : { hardware: input.hardware }),
  };
}

export async function probeAgentCapability(
  provider: ProviderAdapter,
  modelId: string,
  signal = new AbortController().signal,
  options: AgentCapabilityProbeOptions = {},
): Promise<AgentCapabilityProbeResult> {
  const logger = options.logger?.child({
    component: "capability-probe",
    providerId: provider.id,
    modelId,
  });
  logger?.info("capability.probe.started", {
    executable: options.root !== undefined,
    probeVersion: AGENT_CAPABILITY_PROBE_VERSION,
  });
  const notes: string[] = [];

  const chat = await collectEvents(
    provider,
    [{ role: "user", content: "Hi" }],
    modelId,
    signal,
  );
  const conversation = chat.toolCalls.length === 0;
  if (!conversation)
    notes.push(
      "Model made a tool call in response to a plain greeting that needed none.",
    );

  const readMessages: NormalizedMessage[] = [
    {
      role: "user",
      content: "Read the file demo.txt and tell me its contents.",
    },
  ];
  const read = await collectEvents(provider, readMessages, modelId, signal);
  const readCall = read.toolCalls.find((call) => call.name === "ReadFile");
  const readPath = readCall ? parseReadFilePath(readCall) : undefined;
  const readTool = Boolean(readCall) && readPath !== undefined;
  if (!readCall)
    notes.push(
      "Model did not call ReadFile when explicitly asked to read a file.",
    );
  else if (readPath === undefined)
    notes.push("Model called ReadFile with malformed or missing arguments.");

  let multiTurnTools = false;
  if (readTool && readCall) {
    let continuation = await collectEvents(
      provider,
      [
        ...readMessages,
        { role: "assistant", content: "", toolCalls: [readCall] },
        {
          role: "tool",
          toolCallId: readCall.id,
          content: JSON.stringify({ path: readPath, content: "hello probe" }),
        },
      ],
      modelId,
      signal,
    );
    if (continuation.toolCalls.length > 0)
      continuation = await retryAfterTextualDuplicate(
        provider,
        modelId,
        signal,
        [
          ...readMessages,
          { role: "assistant", content: "", toolCalls: [readCall] },
          {
            role: "tool",
            toolCallId: readCall.id,
            content: JSON.stringify({ path: readPath, content: "hello probe" }),
          },
        ],
        continuation.toolCalls,
        [PROBE_READ_TOOL],
      );
    multiTurnTools = continuation.toolCalls.length === 0;
    if (!multiTurnTools)
      notes.push(
        "Model called a tool again instead of continuing after seeing the tool result — likely stuck in a loop.",
      );
  }

  const editRequest: NormalizedMessage[] = [
    {
      role: "user",
      content:
        "Change hello to hello world in demo.txt, then tell me what changed.",
    },
  ];
  const edit = await collectEvents(provider, editRequest, modelId, signal, [
    PROBE_EDIT_TOOL,
  ]);
  const editCall = edit.toolCalls.find((call) => call.name === "EditFile");
  const editArguments = editCall ? parseObjectArguments(editCall) : undefined;
  const editSelection = Boolean(
    editArguments &&
    typeof editArguments.path === "string" &&
    typeof editArguments.oldText === "string" &&
    typeof editArguments.newText === "string",
  );
  let editContinuation = false;
  if (editCall && editSelection) {
    let continuation = await collectEvents(
      provider,
      [
        ...editRequest,
        { role: "assistant", content: "", toolCalls: [editCall] },
        {
          role: "tool",
          toolCallId: editCall.id,
          content: JSON.stringify({ path: "demo.txt", changed: true }),
        },
      ],
      modelId,
      signal,
      [PROBE_EDIT_TOOL],
    );
    if (continuation.toolCalls.length > 0)
      continuation = await retryAfterTextualDuplicate(
        provider,
        modelId,
        signal,
        [
          ...editRequest,
          { role: "assistant", content: "", toolCalls: [editCall] },
          {
            role: "tool",
            toolCallId: editCall.id,
            content: JSON.stringify({ path: "demo.txt", changed: true }),
          },
        ],
        continuation.toolCalls,
        [PROBE_EDIT_TOOL],
      );
    editContinuation = continuation.toolCalls.length === 0;
  }
  if (!editSelection)
    notes.push(
      "Model did not select EditFile with valid arguments for an explicit edit.",
    );
  else if (!editContinuation)
    notes.push("Model did not complete its response after an EditFile result.");

  const testRequest: NormalizedMessage[] = [
    { role: "user", content: "Run the project tests and inspect any failure." },
  ];
  const testProbe = await collectEvents(
    provider,
    testRequest,
    modelId,
    signal,
    [PROBE_TEST_TOOL],
  );
  const testCall = testProbe.toolCalls.find((call) => call.name === "RunTests");
  const testSelection = Boolean(testCall && parseObjectArguments(testCall));
  let testContinuation = false;
  if (testCall && testSelection) {
    let continuation = await collectEvents(
      provider,
      [
        ...testRequest,
        { role: "assistant", content: "", toolCalls: [testCall] },
        {
          role: "tool",
          toolCallId: testCall.id,
          content: JSON.stringify({
            exitCode: 1,
            failures: ["fixture failure"],
          }),
        },
      ],
      modelId,
      signal,
      [PROBE_TEST_TOOL],
    );
    if (continuation.toolCalls.length > 0)
      continuation = await retryAfterTextualDuplicate(
        provider,
        modelId,
        signal,
        [
          ...testRequest,
          { role: "assistant", content: "", toolCalls: [testCall] },
          {
            role: "tool",
            toolCallId: testCall.id,
            content: JSON.stringify({
              exitCode: 1,
              failures: ["fixture failure"],
            }),
          },
        ],
        continuation.toolCalls,
        [PROBE_TEST_TOOL],
      );
    testContinuation = continuation.toolCalls.length === 0;
  }
  if (!testSelection)
    notes.push(
      "Model did not select RunTests with valid arguments for verification.",
    );
  else if (!testContinuation)
    notes.push("Model did not continue after a failing test observation.");

  let errorRecovery: boolean | undefined;
  if (options.root) {
    errorRecovery = await probeToolErrorRecovery(
      provider,
      modelId,
      signal,
      notes,
    );
  }

  const protocolCodingReady =
    conversation &&
    readTool &&
    multiTurnTools &&
    editSelection &&
    editContinuation;
  const protocolAdvancedReady =
    protocolCodingReady && testSelection && testContinuation;
  const executableProbeRequired = options.root !== undefined;
  let execution: AgentProbeExecutionEvidence | undefined;
  if (options.root && protocolCodingReady) {
    execution = await runExecutableCapabilityProbe(
      provider,
      modelId,
      signal,
      logger,
    );
    notes.push(...execution.notes);
  } else if (executableProbeRequired) {
    notes.push(
      "Executable edit/test probes were skipped because the protocol capability gate did not pass.",
    );
  }
  const executableEditReady =
    !executableProbeRequired || execution?.editApplied === true;
  const executableTestReady =
    !executableProbeRequired || execution?.testIteration === true;
  const recoveryReady = !executableProbeRequired || errorRecovery === true;
  const codingReady = protocolCodingReady && executableEditReady;
  const advancedReady =
    protocolAdvancedReady && executableTestReady && recoveryReady;
  const readerReady = readTool && multiTurnTools;
  const agentCapabilityClass: AgentCapabilityClass = !readerReady
    ? "chat_only"
    : !codingReady
      ? "workspace_reader"
      : advancedReady
        ? "advanced_coding_agent"
        : "coding_agent";
  const profile = buildCapabilityProfile(
    provider,
    modelId,
    conversation,
    readTool,
    multiTurnTools,
    errorRecovery,
    agentCapabilityClass,
    notes,
  );
  profile.editReliability = capabilityResult(
    editSelection && editContinuation && executableEditReady,
    notes,
  );
  profile.verificationBehavior = capabilityResult(
    testSelection && testContinuation && executableTestReady,
    notes,
  );

  const result = {
    probeVersion: AGENT_CAPABILITY_PROBE_VERSION,
    conversation,
    readTool,
    multiTurnTools,
    agenticCodingEligible: codingReady,
    agentCapabilityClass,
    profile,
    ...(execution ? { execution } : {}),
    environment: buildProbeEnvironment(provider, modelId, options.environment),
    notes,
  };
  logger?.info("capability.probe.finished", {
    classification: result.agentCapabilityClass,
    agenticCodingEligible: result.agenticCodingEligible,
    conversation: result.conversation,
    readTool: result.readTool,
    multiTurnTools: result.multiTurnTools,
    errorRecovery: result.profile?.errorRecovery?.status,
    executable: options.root !== undefined,
  });
  return result;
}

/**
 * Probe only executable local candidates and attach the result to the exact
 * model/runtime pair. A failed probe is evidence of ineligibility, not a
 * reason to pretend that a catalog entry is a coding agent.
 */
export async function probeLocalModelCapabilities(
  candidates: readonly ModelCandidate[],
  providers: readonly ProviderAdapter[],
  signal: AbortSignal,
  root?: string,
  options: {
    hardware?: AgentProbeHardwareSnapshot;
    logger?: LocalCodeLogger;
  } = {},
): Promise<ModelCandidate[]> {
  const providerById = new Map(
    providers.map((provider) => [provider.id, provider]),
  );
  const result: ModelCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.source !== "local") {
      result.push(candidate);
      continue;
    }
    const provider = providerById.get(candidate.providerId);
    if (!provider) {
      result.push(candidate);
      continue;
    }
    const modelId = candidate.modelId ?? candidate.displayName;
    options.logger?.info("capability.candidate.started", {
      candidateId: candidate.id,
      providerId: candidate.providerId,
      modelId,
    });
    const environment: AgentCapabilityProbeEnvironmentInput = {
      ...(candidate.local?.modelRevision === undefined
        ? {}
        : { modelRevision: candidate.local.modelRevision }),
      ...(candidate.local?.quant === undefined
        ? {}
        : { quantization: candidate.local.quant }),
      ...(candidate.capabilities.maxContext === undefined
        ? {}
        : { contextLength: candidate.capabilities.maxContext }),
      ...(candidate.local?.runtimeVersion === undefined
        ? {}
        : { runtimeVersion: candidate.local.runtimeVersion }),
      ...(candidate.local?.chatTemplate === undefined
        ? {}
        : { chatTemplate: candidate.local.chatTemplate }),
      ...(candidate.local?.toolParser === undefined
        ? {}
        : { toolParser: candidate.local.toolParser }),
      ...(options.hardware === undefined ? {} : { hardware: options.hardware }),
    };
    try {
      const agentProbe = await probeAgentCapability(provider, modelId, signal, {
        ...(root ? { root } : {}),
        environment,
        logger: options.logger,
      });
      options.logger?.info("capability.candidate.finished", {
        candidateId: candidate.id,
        classification: agentProbe.agentCapabilityClass,
        eligible: agentProbe.agenticCodingEligible,
      });
      result.push({
        ...candidate,
        agentProbe,
        quality: {
          ...candidate.quality,
          toolUse: agentProbe.readTool ? 1 : 0,
          confidence: "measured",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.logger?.warn("capability.candidate.failed", {
        candidateId: candidate.id,
        errorType: error instanceof Error ? error.name : "unknown",
        detailLength: message.length,
      });
      result.push({
        ...candidate,
        agentProbe: {
          probeVersion: AGENT_CAPABILITY_PROBE_VERSION,
          conversation: false,
          readTool: false,
          multiTurnTools: false,
          agenticCodingEligible: false,
          agentCapabilityClass: "chat_only",
          environment: buildProbeEnvironment(provider, modelId, environment),
          notes: [`Capability probe failed: ${message}`],
        },
        quality: {
          ...candidate.quality,
          toolUse: 0,
          confidence: "measured",
        },
      });
    }
  }
  return result;
}
