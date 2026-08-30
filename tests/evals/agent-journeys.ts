import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CheckpointService } from "../../src/checkpoint/checkpoint.js";
import { runAgent } from "../../src/agent/loop.js";
import {
  addTaskEvidence,
  createTaskLedger,
  setTaskPhase,
} from "../../src/agent/task-state.js";
import { createTaskRuntimeSnapshot } from "../../src/agent/task-runtime-state.js";
import {
  resolveTurnMode,
  resolveTurnPolicy,
} from "../../src/agent/turn-policy.js";
import { LocalCodeDatabase } from "../../src/storage/database.js";
import { selectRoute } from "../../src/router/router.js";
import { analyzeTask } from "../../src/router/task-analysis.js";
import { runCommand } from "../../src/shared/process.js";
import { prepareIsolatedSubagentWorkspace } from "../../src/agent/subagents/worktree.js";
import type {
  NormalizedMessage,
  ProviderEvent,
} from "../../src/providers/types.js";
import type { ModelCandidate } from "../../src/shared/types.js";
import type { AgentRunResult } from "../../src/agent/types.js";
import type { VerificationCommand } from "../../src/agent/verification-plan.js";
import { workspaceTools } from "../../src/tools/workspace.js";
import {
  createScriptedProvider,
  fakeAgentCandidate,
} from "../support/fake-provider.js";

/** Changes to this manifest invalidate historical matrix comparisons. */
export const AGENT_EVALUATION_FIXTURE_REVISION = "agent-evals-2026-08-26-v1";

export const EXPECTED_AGENT_JOURNEYS = [
  "conversation",
  "repository-question",
  "symbol-lookup",
  "architecture-analysis",
  "plan-only",
  "one-file-modification",
  "multi-file-modification",
  "failing-test-repair",
  "greenfield-creation",
  "configuration-modification",
  "refactor",
  "error-recovery",
  "long-horizon-compaction",
  "resume",
  "dirty-worktree-safety",
  "false-completion",
  "false-blocking",
  "strict-zero-rejection",
] as const;

export type AgentJourneyStatus =
  | "completed"
  | "blocked"
  | "failed"
  | "cancelled"
  | "rejected"
  | "skipped"
  | "unproven";

export type JourneyVerificationStatus =
  "passed" | "failed" | "not_required" | "not_applicable" | "unknown";

export interface AgentJourneyResult {
  id: string;
  category: string;
  expectedStatus: AgentJourneyStatus;
  status: AgentJourneyStatus;
  passed: boolean;
  verified: boolean;
  verificationStatus: JourneyVerificationStatus;
  recoveryCount: number;
  turns: number;
  toolRuns: number;
  evidenceCount: number;
  filesChanged: string[];
  compactionObserved: boolean;
  reason: string;
  evidence?: string[];
}

export interface AgentEvaluationSummary {
  passed: number;
  failed: number;
  skipped: number;
  unproven: number;
  aggregateStatus: "PASS" | "FAIL" | "UNPROVEN";
  successRate?: number;
}

export interface AgentEvaluationReport {
  schemaVersion: 1;
  fixtureRevision: string;
  generatedAt: string;
  journeys: AgentJourneyResult[];
  summary: AgentEvaluationSummary;
}

interface CriterionCheck {
  description: string;
  check: (root: string, result: AgentRunResult) => Promise<boolean>;
  paths?: string[];
}

interface ScriptedJourneyInput {
  id: string;
  category: string;
  objective: string;
  turns: ProviderEvent[][];
  expectedStatus?: AgentJourneyStatus;
  checks?: CriterionCheck[];
  verificationCommands?: VerificationCommand[];
  repositoryState?: "empty" | "non_empty";
  greenfieldIntent?: boolean;
  contextEvidenceState?: "SUFFICIENT" | "INSUFFICIENT" | "CONFLICTING";
  context?: string;
  contextBudgetChars?: number;
  maxTurns?: number;
  fixture?: "standard" | "broken" | "empty";
  allowProviderTail?: boolean;
  validate?: (
    root: string,
    result: AgentRunResult,
    requests: readonly { messages: NormalizedMessage[] }[],
  ) => Promise<{
    pass: boolean;
    evidence: string[];
    reason?: string;
  }>;
}

function textTurn(text: string): ProviderEvent[] {
  return [{ type: "text.delta", text }, { type: "done" }];
}

function toolTurn(id: string, name: string, args: unknown): ProviderEvent[] {
  return [
    {
      type: "tool.call",
      call: { id, name, arguments: JSON.stringify(args) },
    },
    { type: "done" },
  ];
}

function latestVerificationStatus(
  result: AgentRunResult,
): JourneyVerificationStatus {
  const runs = result.ledger.verificationRuns;
  if (runs.length === 0)
    return result.ledger.verificationPlan.length > 0
      ? "unknown"
      : "not_required";
  const latest = runs.at(-1);
  if (latest?.status === "passed" && latest.exitCode === 0) return "passed";
  if (runs.some((run) => run.status === "failed")) return "failed";
  return "unknown";
}

function compactionObserved(
  requests: readonly { messages: NormalizedMessage[] }[],
  finalMessages: readonly NormalizedMessage[] = [],
): boolean {
  return [...requests.map((request) => request.messages), finalMessages].some(
    (messages) =>
      messages.some(
        (message) =>
          message.role === "system" &&
          message.content.includes("ShelraCode structured task state"),
      ),
  );
}

function resultFromAgent(
  input: ScriptedJourneyInput,
  result: AgentRunResult,
  requests: readonly { messages: NormalizedMessage[] }[],
  passed: boolean,
  evidence: string[],
  reason: string,
): AgentJourneyResult {
  const toolDiagnostic = result.toolRuns
    .map(
      (run) =>
        `${run.tool}:${run.ok ? "ok" : `${run.code ?? "error"}:${(run.error ?? "").slice(0, 120)}`}`,
    )
    .join(",");
  const diagnostic = [
    ...(toolDiagnostic ? [`tools=${toolDiagnostic}`] : []),
    ...result.completion.reasons,
    ...(result.failure?.message ? [result.failure.message] : []),
  ]
    .filter(Boolean)
    .slice(0, 4)
    .join(" | ");
  return {
    id: input.id,
    category: input.category,
    expectedStatus: input.expectedStatus ?? "completed",
    status: result.status,
    passed,
    verified: result.verified,
    verificationStatus: latestVerificationStatus(result),
    recoveryCount:
      result.ledger.recoveryContracts.length +
      result.ledger.actions.filter((action) => action.status === "failed")
        .length,
    turns: result.turns,
    toolRuns: result.toolRuns.length,
    evidenceCount: result.evidenceCount,
    filesChanged: [...result.ledger.filesChanged],
    compactionObserved: compactionObserved(requests, result.messages),
    reason: diagnostic && !passed ? `${reason} ${diagnostic}` : reason,
    ...(evidence.length > 0 ? { evidence } : {}),
  };
}

async function createEvaluationRepo(
  fixture: ScriptedJourneyInput["fixture"] = "standard",
): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "shelra-agent-eval-"));
  if (fixture === "empty") {
    await mkdir(path.join(root, "src"), { recursive: true });
    return root;
  }

  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "tests"), { recursive: true });
  await mkdir(path.join(root, "python"), { recursive: true });
  await mkdir(path.join(root, "go"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: "shelra-agent-evaluation-fixture",
        version: "0.0.0",
        scripts: { test: "bun test" },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await writeFile(
    path.join(root, "AGENTS.md"),
    "# evaluation fixture\n\nPreserve the public API. Run bun test after TypeScript changes.\n",
    "utf8",
  );
  await writeFile(
    path.join(root, "src", "math.ts"),
    fixture === "broken"
      ? "export function add(a: number, b: number): number {\n  return a - b;\n}\n"
      : "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
    "utf8",
  );
  await writeFile(
    path.join(root, "src", "message.ts"),
    'export const greeting = "hello";\n',
    "utf8",
  );
  await writeFile(
    path.join(root, "src", "config.json"),
    '{\n  "featureFlag": false,\n  "name": "fixture"\n}\n',
    "utf8",
  );
  await writeFile(
    path.join(root, "src", "index.ts"),
    'export { add } from "./math.ts";\n',
    "utf8",
  );
  await writeFile(
    path.join(root, "tests", "math.test.ts"),
    "import { expect, test } from 'bun:test';\n" +
      "import { add } from '../src/math.ts';\n" +
      "test('add sums two numbers', () => {\n" +
      "  expect(add(2, 3)).toBe(5);\n" +
      "});\n",
    "utf8",
  );
  await writeFile(
    path.join(root, "python", "service.py"),
    'def greeting(name: str) -> str:\n    return f"Hello {name}"\n',
    "utf8",
  );
  await writeFile(
    path.join(root, "python", "test_service.py"),
    "def test_greeting():\n    assert greeting('Ada') == 'Hello Ada'\n",
    "utf8",
  );
  await writeFile(
    path.join(root, "go", "main.go"),
    'package main\n\nfunc Greeting() string { return "hello" }\n',
    "utf8",
  );
  await writeFile(
    path.join(root, "go", "main_test.go"),
    'package main\n\nimport "testing"\n\nfunc TestGreeting(t *testing.T) {\n  if Greeting() != "hello" { t.Fail() }\n}\n',
    "utf8",
  );
  return root;
}

async function verifyChecks(
  root: string,
  result: AgentRunResult,
  checks: readonly CriterionCheck[],
): Promise<{
  pass: boolean;
  satisfiedCriterionIds: string[];
  issues: string[];
  nextPaths: string[];
  nextActions: string[];
}> {
  const statuses = await Promise.all(
    checks.map(async (check) => ({
      check,
      pass: await check.check(root, result),
    })),
  );
  const satisfiedCriterionIds = statuses.flatMap(({ pass }, index) =>
    pass ? [`criterion-${index + 1}`] : [],
  );
  const failed = statuses.filter(({ pass }) => !pass).map(({ check }) => check);
  return {
    pass: failed.length === 0,
    satisfiedCriterionIds,
    issues: failed.map(
      (check) => `Evaluation criterion is not satisfied: ${check.description}`,
    ),
    nextPaths: [...new Set(failed.flatMap((check) => check.paths ?? []))],
    nextActions: failed.map((check) => `Satisfy: ${check.description}`),
  };
}

async function runScriptedJourney(
  input: ScriptedJourneyInput,
): Promise<AgentJourneyResult> {
  const root = await createEvaluationRepo(input.fixture);
  const database = new LocalCodeDatabase(":memory:");
  const checkpoint = new CheckpointService(database, root);
  const provider = createScriptedProvider(input.turns, {
    stopAfter: input.allowProviderTail !== true,
  });
  const controller = new AbortController();
  const mode = resolveTurnMode(input.objective, analyzeTask(input.objective));
  const policy = resolveTurnPolicy(mode);
  const verificationCommands = input.verificationCommands ?? [];
  const checks = input.checks ?? [];
  try {
    const result = await runAgent(
      {
        id: `eval-${input.id}`,
        objective: input.objective,
        root,
        candidate: fakeAgentCandidate,
        repositoryPolicy: "private",
        permissionMode: "EDIT",
        mode,
        verificationCommands,
        verificationPolicy:
          verificationCommands.length > 0 ? "required" : "not_required",
        successCriteria: checks.map((check) => check.description),
        repositoryState: input.repositoryState ?? "non_empty",
        ...(input.greenfieldIntent === undefined
          ? {}
          : { greenfieldIntent: input.greenfieldIntent }),
        ...(input.contextEvidenceState
          ? { contextEvidenceState: input.contextEvidenceState }
          : {}),
        ...(input.context ? { context: input.context } : {}),
        ...(checks.length > 0 ? { enforceTaskContract: false } : {}),
        maxTurns: input.maxTurns ?? 16,
        contextBudgetChars: input.contextBudgetChars,
        systemPromptProfile: policy.systemPromptProfile,
      },
      {
        provider,
        tools: workspaceTools.filter((tool) =>
          policy.allowedTools.includes(tool.name),
        ),
        toolChoice: policy.toolChoice,
        checkUserWorkPreserved: (checkpointId) =>
          checkpointId ? checkpoint.isPreserved(checkpointId) : true,
        reviewFinalDiff: () => true,
        ...(checks.length > 0
          ? {
              verifySuccessCriteria: (
                _task: unknown,
                ledger: AgentRunResult["ledger"],
              ) => verifyChecks(root, { ...resultPlaceholder(ledger) }, checks),
            }
          : {}),
        async createExecutionContext(task) {
          return {
            root: task.root,
            permissionMode: task.permissionMode,
            signal: controller.signal,
            network: false,
            osIsolation: "best_effort" as const,
            allowWeakProcessIsolation: true,
            checkpoint,
            env: process.env,
          };
        },
      },
      controller.signal,
    );
    // The callback above intentionally receives a compact ledger projection;
    // checks only inspect files and verification state, never model prose.
    const validation = input.validate
      ? await input.validate(root, result, provider.requests)
      : { pass: true, evidence: [] as string[] };
    const expected = input.expectedStatus ?? "completed";
    const statusMatches = result.status === expected;
    const passed = statusMatches && validation.pass;
    return resultFromAgent(
      input,
      result,
      provider.requests,
      passed,
      validation.evidence,
      validation.reason ??
        (passed
          ? `Expected terminal status ${expected} was observed.`
          : `Expected ${expected}, observed ${result.status}.`),
    );
  } catch (error) {
    return {
      id: input.id,
      category: input.category,
      expectedStatus: input.expectedStatus ?? "completed",
      status: "failed",
      passed: false,
      verified: false,
      verificationStatus: "unknown",
      recoveryCount: 0,
      turns: provider.requests.length,
      toolRuns: 0,
      evidenceCount: 0,
      filesChanged: [],
      compactionObserved: compactionObserved(provider.requests),
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * Keep the callback type independent from model output. The real verifier
 * receives the live ledger; this projection is enough for the fixture checks
 * and prevents the evaluator from accidentally asserting on assistant prose.
 */
function resultPlaceholder(ledger: AgentRunResult["ledger"]): AgentRunResult {
  return {
    text: "",
    verified: false,
    status: "blocked",
    completion: {
      canComplete: false,
      reasons: [],
      evidenceState: "INSUFFICIENT",
    },
    evidenceCount: ledger.evidence.length,
    ledger,
    turns: 0,
    toolRuns: [],
    messages: [],
  };
}

function criterion(
  description: string,
  check: CriterionCheck["check"],
  paths?: string[],
): CriterionCheck {
  return { description, check, ...(paths ? { paths } : {}) };
}

const testVerification: VerificationCommand[] = [
  { stage: "test", command: "bun test" },
];

async function runResumeJourney(): Promise<AgentJourneyResult> {
  const root = await createEvaluationRepo("standard");
  const databasePath = path.join(root, "resume-state.sqlite");
  const objective =
    "Inspect src/math.ts and report the persisted implementation.";
  const taskId = "eval-resume";
  try {
    const firstDatabase = new LocalCodeDatabase(databasePath);
    const ledger = createTaskLedger({
      id: taskId,
      objective,
      mode: "workspace_question",
      planningMode: "none",
    });
    addTaskEvidence(ledger, {
      id: "eval-resume-evidence",
      kind: "file",
      source: "src/math.ts",
      summary: "The persisted task already inspected src/math.ts.",
      relevance: 1,
      freshness: 1,
    });
    ledger.filesRead.push("src/math.ts");
    setTaskPhase(ledger, "blocked");
    firstDatabase.createSession("eval-resume-session", root, objective);
    firstDatabase.saveAgentRuntime(
      createTaskRuntimeSnapshot({
        ledger,
        repositoryRoot: root,
        sessionId: "eval-resume-session",
        repositoryRevision: "fixture-revision",
        route: {
          candidateId: fakeAgentCandidate.id,
          providerId: fakeAgentCandidate.providerId,
        },
        contextAnchor: {
          sourceIds: ["src/math.ts"],
          instructionSources: ["AGENTS.md"],
          memoryIds: [],
          proofGapIds: [],
          summary: "Resume fixture anchor",
        },
        updatedRevision: 3,
      }),
      "eval-resume-session",
    );
    firstDatabase.close();

    const secondDatabase = new LocalCodeDatabase(databasePath);
    const restored = secondDatabase.getLatestAgentRuntime(
      "eval-resume-session",
    );
    const provider = createScriptedProvider(
      [textTurn("The persisted implementation is in src/math.ts.")],
      { stopAfter: true },
    );
    if (!restored?.ok) throw new Error("resume runtime was not restored");
    const checkpoint = new CheckpointService(secondDatabase, root);
    const result = await runAgent(
      {
        id: restored.snapshot.taskId,
        objective,
        root,
        candidate: fakeAgentCandidate,
        repositoryPolicy: "private",
        permissionMode: "PLAN",
        mode: "workspace_question",
        planningMode: "none",
        systemPromptProfile: "workspace",
        runtimeSnapshot: restored.snapshot,
        maxTurns: 1,
      },
      {
        provider,
        tools: [],
        toolChoice: "none",
        createExecutionContext: async () => ({
          root,
          permissionMode: "PLAN",
          signal: new AbortController().signal,
          checkpoint,
        }),
      },
    );
    const passed =
      result.status === "completed" &&
      result.ledger.filesRead.includes("src/math.ts") &&
      result.ledger.evidence.some((item) => item.source === "src/math.ts");
    secondDatabase.close();
    return resultFromAgent(
      {
        id: "resume",
        category: "sessions",
        objective,
        turns: [],
        expectedStatus: "completed",
      },
      result,
      provider.requests,
      passed,
      [
        "SQLite runtime snapshot restored after closing and reopening the process boundary.",
        "The resumed ledger retained the prior source evidence.",
      ],
      passed
        ? "The persisted task resumed with its objective and source evidence."
        : "The resumed task did not retain the expected authoritative evidence.",
    );
  } catch (error) {
    return {
      id: "resume",
      category: "sessions",
      expectedStatus: "completed",
      status: "failed",
      passed: false,
      verified: false,
      verificationStatus: "unknown",
      recoveryCount: 0,
      turns: 0,
      toolRuns: 0,
      evidenceCount: 0,
      filesChanged: [],
      compactionObserved: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function initializeGit(root: string): Promise<void> {
  const options = {
    cwd: root,
    intent: "execute" as const,
    network: "deny" as const,
    isolation: "best_effort" as const,
    allowWeakIsolation: true,
    timeoutMs: 10_000,
  };
  for (const args of [
    ["init", "-q"],
    ["config", "user.name", "Shelra evaluation"],
    ["config", "user.email", "evaluation@shelra.invalid"],
    ["add", "."],
    ["commit", "-qm", "evaluation baseline"],
  ]) {
    const result = await runCommand("git", args, options);
    if (result.exitCode !== 0)
      throw new Error(
        `fixture git setup failed: ${result.stderr || result.stdout}`,
      );
  }
}

async function runDirtyWorktreeJourney(): Promise<AgentJourneyResult> {
  const root = await createEvaluationRepo("standard");
  try {
    await initializeGit(root);
    await writeFile(
      path.join(root, "src", "message.ts"),
      'export const greeting = "user-owned change";\n',
      "utf8",
    );
    const prepared = await prepareIsolatedSubagentWorkspace(
      root,
      new AbortController().signal,
    );
    const refused = !prepared.ok;
    const reason = refused
      ? prepared.reason
      : "The dirty worktree was not refused.";
    if (prepared.ok) await prepared.workspace.cleanup();
    return {
      id: "dirty-worktree-safety",
      category: "safety",
      expectedStatus: "rejected",
      status: refused ? "rejected" : "failed",
      passed: refused,
      verified: false,
      verificationStatus: "not_applicable",
      recoveryCount: 0,
      turns: 0,
      toolRuns: 1,
      evidenceCount: 0,
      filesChanged: [],
      compactionObserved: false,
      reason,
      evidence: [
        "A child worktree request was refused before creating an isolated checkout because user-owned changes were present.",
      ],
    };
  } catch (error) {
    return {
      id: "dirty-worktree-safety",
      category: "safety",
      expectedStatus: "rejected",
      status: "failed",
      passed: false,
      verified: false,
      verificationStatus: "unknown",
      recoveryCount: 0,
      turns: 0,
      toolRuns: 0,
      evidenceCount: 0,
      filesChanged: [],
      compactionObserved: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function paidCandidate(): ModelCandidate {
  return {
    ...fakeAgentCandidate,
    id: "paid/frontier",
    providerId: "paid",
    source: "paid_cloud",
    free: { status: "paid" },
    privacy: {
      classification: "private_allowed",
      retentionKnown: true,
      trainsOnInputs: false,
    },
  };
}

async function runStrictZeroJourney(): Promise<AgentJourneyResult> {
  const task = analyzeTask("Implement the requested repository change.");
  const decision = selectRoute({
    now: new Date("2026-08-26T12:00:00.000Z"),
    task,
    repositoryPolicy: "private",
    routingMode: "strict-zero",
    contextTokens: 1_000,
    candidates: [paidCandidate()],
  });
  const refused =
    decision.selected === undefined &&
    decision.rejections.some((item) =>
      item.reasons.some((reason) => reason.includes("paid")),
    );
  return {
    id: "strict-zero-rejection",
    category: "routing",
    expectedStatus: "rejected",
    status: refused ? "rejected" : "failed",
    passed: refused,
    verified: false,
    verificationStatus: "not_applicable",
    recoveryCount: 0,
    turns: 0,
    toolRuns: 0,
    evidenceCount: 0,
    filesChanged: [],
    compactionObserved: false,
    reason: refused
      ? "Strict-zero rejected the paid candidate before selection."
      : "Strict-zero selected a paid candidate or lost the billing cause.",
    evidence: decision.rejections.flatMap((item) => item.reasons).slice(0, 4),
  };
}

function standardChecks(): CriterionCheck[] {
  return [
    criterion(
      'src/message.ts exports greeting = "hello world"',
      async (root) =>
        (await readFile(path.join(root, "src", "message.ts"), "utf8")).includes(
          'greeting = "hello world"',
        ),
      ["src/message.ts"],
    ),
  ];
}

function testPassed(result: AgentRunResult): boolean {
  return result.ledger.verificationRuns.some(
    (run) =>
      run.stage === "test" && run.status === "passed" && run.exitCode === 0,
  );
}

export async function runDeterministicAgentEvaluation(): Promise<AgentEvaluationReport> {
  const journeys: AgentJourneyResult[] = [];
  journeys.push(
    await runScriptedJourney({
      id: "conversation",
      category: "conversation",
      objective: "Hola",
      turns: [textTurn("¡Hola! ¿En qué te ayudo?")],
      validate: async (_root, result) => ({
        pass: result.toolRuns.length === 0,
        evidence: ["Conversation mode exposed no repository tools."],
      }),
    }),
  );
  journeys.push(
    await runScriptedJourney({
      id: "repository-question",
      category: "repository_question",
      objective: "Lee package.json y dime el nombre del proyecto.",
      turns: [
        toolTurn("read-package", "ReadFile", { path: "package.json" }),
        textTurn("The project is named shelra-agent-evaluation-fixture."),
      ],
      validate: async (_root, result) => ({
        pass:
          result.toolRuns.length === 1 &&
          result.toolRuns[0]?.ok === true &&
          result.text.includes("shelra-agent-evaluation-fixture"),
        evidence: ["The answer followed a successful package manifest read."],
      }),
    }),
  );
  journeys.push(
    await runScriptedJourney({
      id: "symbol-lookup",
      category: "repository_intelligence",
      objective: "Where is add implemented in this repository?",
      turns: [
        toolTurn("search-add", "SearchText", {
          pattern: "export function add",
        }),
        toolTurn("read-math", "ReadFile", { path: "src/math.ts" }),
        textTurn("The add symbol is implemented in src/math.ts."),
      ],
      validate: async (_root, result) => ({
        pass:
          result.toolRuns.map((run) => run.tool).join(",") ===
            "SearchText,ReadFile" && result.text.includes("src/math.ts"),
        evidence: ["The journey searched before reading the defining file."],
      }),
    }),
  );
  journeys.push(
    await runScriptedJourney({
      id: "architecture-analysis",
      category: "analysis",
      objective: "Explain the architecture of this heterogeneous repository.",
      turns: [
        toolTurn("read-agents", "ReadFile", { path: "AGENTS.md" }),
        toolTurn("read-ts", "ReadFile", { path: "src/math.ts" }),
        toolTurn("read-python", "ReadFile", { path: "python/service.py" }),
        toolTurn("read-go", "ReadFile", { path: "go/main.go" }),
        textTurn(
          "The fixture contains TypeScript, Python, and Go source with scoped instructions and tests.",
        ),
      ],
      validate: async (_root, result) => ({
        pass: result.toolRuns.filter((run) => run.ok).length === 4,
        evidence: [
          "The analysis collected evidence from instructions and multiple language directories.",
        ],
      }),
    }),
  );
  journeys.push(
    await runScriptedJourney({
      id: "plan-only",
      category: "planning",
      objective:
        "Analyze how to improve this repository and give me a plan. Do not modify anything.",
      turns: [
        toolTurn("plan-read", "ReadFile", { path: "src/math.ts" }),
        toolTurn("plan-edit", "EditFile", {
          path: "src/math.ts",
          oldText: "return a + b;",
          newText: "return b + a;",
        }),
        textTurn(
          "The plan is to preserve the API, add coverage, and verify callers.",
        ),
      ],
      validate: async (root, result) => ({
        pass:
          result.toolRuns.at(-1)?.code === "PERMISSION_DENIED" &&
          (await readFile(path.join(root, "src", "math.ts"), "utf8")).includes(
            "return a + b;",
          ),
        evidence: [
          "Plan mode denied the attempted mutation and preserved the file.",
        ],
      }),
    }),
  );
  journeys.push(
    await runScriptedJourney({
      id: "one-file-modification",
      category: "coding",
      objective:
        'Change src/message.ts from "hello" to "hello world" and run bun test.',
      turns: [
        toolTurn("one-read", "ReadFile", { path: "src/message.ts" }),
        toolTurn("one-edit", "EditFile", {
          path: "src/message.ts",
          oldText: 'greeting = "hello"',
          newText: 'greeting = "hello world"',
        }),
        textTurn("The greeting was changed and the host verification passed."),
      ],
      checks: [
        ...standardChecks(),
        criterion("bun test passes", async (_root, result) =>
          testPassed(result),
        ),
      ],
      verificationCommands: testVerification,
      validate: async (_root, result) => ({
        pass: result.status === "completed" && result.verified,
        evidence: [
          "A single-file mutation was checkpointed and host-verified.",
        ],
      }),
    }),
  );
  journeys.push(
    await runScriptedJourney({
      id: "multi-file-modification",
      category: "coding",
      fixture: "broken",
      objective:
        "Repair the arithmetic API, add multiplication coverage, run bun test, and review the final diff.",
      context:
        "The bounded multi-file objective concerns src/math.ts, src/index.ts, and tests/math.test.ts. Keep the public API and verify all three files.",
      turns: [
        toolTurn("multi-read-math", "ReadFile", { path: "src/math.ts" }),
        toolTurn("multi-read-index", "ReadFile", { path: "src/index.ts" }),
        toolTurn("multi-read-test", "ReadFile", { path: "tests/math.test.ts" }),
        toolTurn("multi-edit-math", "EditFile", {
          path: "src/math.ts",
          oldText:
            "export function add(a: number, b: number): number {\n  return a - b;\n}\n",
          newText:
            "export function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport function multiply(a: number, b: number): number {\n  return a * b;\n}\n",
        }),
        toolTurn("multi-refresh-index", "ReadFile", { path: "src/index.ts" }),
        toolTurn("multi-edit-index", "EditFile", {
          path: "src/index.ts",
          oldText: 'export { add } from "./math.ts";\n',
          newText: 'export { add, multiply } from "./math.ts";\n',
        }),
        toolTurn("multi-refresh-test", "ReadFile", {
          path: "tests/math.test.ts",
        }),
        toolTurn("multi-edit-test", "EditFile", {
          path: "tests/math.test.ts",
          oldText:
            "import { expect, test } from 'bun:test';\n" +
            "import { add } from '../src/math.ts';\n" +
            "test('add sums two numbers', () => {\n" +
            "  expect(add(2, 3)).toBe(5);\n" +
            "});\n",
          newText:
            "import { expect, test } from 'bun:test';\n" +
            "import { add, multiply } from '../src/index.ts';\n" +
            "test('add sums two numbers', () => {\n" +
            "  expect(add(2, 3)).toBe(5);\n" +
            "});\n" +
            "test('multiply multiplies two numbers', () => {\n" +
            "  expect(multiply(2, 3)).toBe(6);\n" +
            "});\n",
        }),
        textTurn("All requested files were updated and the tests passed."),
      ],
      checks: [
        criterion(
          "add and multiply are implemented in src/math.ts",
          async (root) => {
            const source = await readFile(
              path.join(root, "src", "math.ts"),
              "utf8",
            );
            return (
              source.includes("return a + b") && source.includes("multiply")
            );
          },
          ["src/math.ts"],
        ),
        criterion(
          "both functions are exported from src/index.ts",
          async (root) =>
            (
              await readFile(path.join(root, "src", "index.ts"), "utf8")
            ).includes("add, multiply"),
          ["src/index.ts"],
        ),
        criterion(
          "multiply has a focused test",
          async (root) =>
            (
              await readFile(path.join(root, "tests", "math.test.ts"), "utf8")
            ).includes("multiply(2, 3)"),
          ["tests/math.test.ts"],
        ),
        criterion("bun test passes", async (_root, result) =>
          testPassed(result),
        ),
      ],
      verificationCommands: testVerification,
      maxTurns: 18,
      validate: async (_root, result) => ({
        pass: result.status === "completed" && result.verified,
        evidence: [
          "Three files were changed and verification was observed after the mutations.",
        ],
      }),
    }),
  );
  journeys.push(
    await runScriptedJourney({
      id: "failing-test-repair",
      category: "debugging",
      fixture: "broken",
      objective:
        "Run bun test, inspect the failure, fix src/math.ts, rerun bun test, and report the verified repair.",
      turns: [
        toolTurn("repair-test", "RunTests", {}),
        toolTurn("repair-read", "ReadFile", { path: "src/math.ts" }),
        toolTurn("repair-edit", "EditFile", {
          path: "src/math.ts",
          oldText: "return a - b;",
          newText: "return a + b;",
        }),
        textTurn("The failing test was repaired and bun test passed."),
      ],
      checks: [
        criterion(
          "the broken add implementation is repaired",
          async (root) =>
            (
              await readFile(path.join(root, "src", "math.ts"), "utf8")
            ).includes("return a + b;"),
          ["src/math.ts"],
        ),
        criterion("bun test passes after repair", async (_root, result) =>
          testPassed(result),
        ),
      ],
      verificationCommands: testVerification,
      maxTurns: 14,
      validate: async (_root, result) => ({
        pass:
          result.status === "completed" &&
          result.toolRuns.some((run) => run.code === "TEST_FAILED") &&
          result.verified,
        evidence: [
          "The sequence included a failed test observation followed by edit and passing verification.",
        ],
      }),
    }),
  );
  journeys.push(
    await runScriptedJourney({
      id: "greenfield-creation",
      category: "greenfield",
      fixture: "empty",
      repositoryState: "empty",
      greenfieldIntent: true,
      contextEvidenceState: "INSUFFICIENT",
      objective: 'Create src/hello.ts exporting const greeting = "hello".',
      turns: [
        toolTurn("green-create", "CreateFile", {
          path: "src/hello.ts",
          content: 'export const greeting = "hello";\n',
        }),
        textTurn("The greenfield module was created."),
      ],
      checks: [
        criterion(
          "src/hello.ts exists with the requested export",
          async (root) =>
            (
              await readFile(path.join(root, "src", "hello.ts"), "utf8")
            ).includes('greeting = "hello"'),
          ["src/hello.ts"],
        ),
      ],
      validate: async (_root, result) => ({
        pass: result.status === "completed" && result.verified,
        evidence: [
          "Empty-workspace creation was allowed only under explicit greenfield intent.",
        ],
      }),
    }),
  );
  journeys.push(
    await runScriptedJourney({
      id: "configuration-modification",
      category: "configuration",
      objective:
        "Update src/config.json so featureFlag is true and preserve the other setting.",
      turns: [
        toolTurn("config-read", "ReadFile", { path: "src/config.json" }),
        toolTurn("config-edit", "EditFile", {
          path: "src/config.json",
          oldText: '"featureFlag": false',
          newText: '"featureFlag": true',
        }),
        textTurn(
          "The configuration flag was updated without an applicable test command.",
        ),
      ],
      checks: [
        criterion(
          "featureFlag is true and the fixture name is preserved",
          async (root) => {
            const value = await readFile(
              path.join(root, "src", "config.json"),
              "utf8",
            );
            return (
              value.includes('"featureFlag": true') &&
              value.includes('"name": "fixture"')
            );
          },
          ["src/config.json"],
        ),
      ],
      validate: async (_root, result) => ({
        pass:
          result.status === "completed" &&
          latestVerificationStatus(result) === "not_required",
        evidence: [
          "The no-applicable-test path completed from an artifact-specific host criterion.",
        ],
      }),
    }),
  );
  journeys.push(
    await runScriptedJourney({
      id: "refactor",
      category: "refactor",
      objective:
        "Refactor src/math.ts to use a private sum helper while preserving add behavior, then run bun test.",
      turns: [
        toolTurn("refactor-read", "ReadFile", { path: "src/math.ts" }),
        toolTurn("refactor-edit", "EditFile", {
          path: "src/math.ts",
          oldText:
            "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
          newText:
            "function sum(a: number, b: number): number {\n  return a + b;\n}\n\nexport function add(a: number, b: number): number {\n  return sum(a, b);\n}\n",
        }),
        textTurn("The helper refactor preserved add and bun test passed."),
      ],
      checks: [
        criterion(
          "the private sum helper is used by add",
          async (root) => {
            const value = await readFile(
              path.join(root, "src", "math.ts"),
              "utf8",
            );
            return (
              value.includes("function sum") &&
              value.includes("return sum(a, b)")
            );
          },
          ["src/math.ts"],
        ),
        criterion("bun test passes after refactor", async (_root, result) =>
          testPassed(result),
        ),
      ],
      verificationCommands: testVerification,
      validate: async (_root, result) => ({
        pass: result.status === "completed" && result.verified,
        evidence: [
          "A behavior-preserving single-file refactor was followed by host tests.",
        ],
      }),
    }),
  );
  journeys.push(
    await runScriptedJourney({
      id: "error-recovery",
      category: "recovery",
      objective:
        "Find the missing source file in this repository and report the available implementation.",
      turns: [
        toolTurn("missing-read", "ReadFile", { path: "src/missing.ts" }),
        toolTurn("recovery-list", "ListFiles", { path: "src" }),
        toolTurn("recovery-read", "ReadFile", { path: "src/math.ts" }),
        textTurn(
          "The requested file is absent; src/math.ts is the available implementation.",
        ),
      ],
      validate: async (_root, result) => ({
        pass:
          result.status === "completed" &&
          result.toolRuns[0]?.code === "PATH_NOT_FOUND" &&
          result.toolRuns[1]?.ok === true,
        evidence: [
          "A typed missing-path error led to a different discovery action.",
        ],
      }),
    }),
  );
  journeys.push(
    await runScriptedJourney({
      id: "long-horizon-compaction",
      category: "long_horizon",
      objective:
        "Inspect the repository instructions and all source-language examples, then summarize the evidence.",
      context:
        "This is a bounded long-horizon evaluation. Preserve the objective, inspect each requested source, and base the final summary on host observations. " +
        "The context is intentionally verbose so the evaluator must compact the transcript before the final decision.",
      contextBudgetChars: 1_200,
      maxTurns: 10,
      turns: [
        toolTurn("compact-agents", "ReadFile", { path: "AGENTS.md" }),
        toolTurn("compact-ts", "ReadFile", { path: "src/math.ts" }),
        toolTurn("compact-python", "ReadFile", { path: "python/service.py" }),
        toolTurn("compact-go", "ReadFile", { path: "go/main.go" }),
        toolTurn("compact-tests", "ReadFile", { path: "tests/math.test.ts" }),
        textTurn(
          "The repository contains scoped instructions and three language examples backed by a TypeScript test.",
        ),
      ],
      validate: async (_root, result, requests) => ({
        pass:
          result.status === "completed" &&
          result.evidenceCount >= 5 &&
          compactionObserved(requests, result.messages),
        evidence: [
          "The provider received a compacted authoritative state packet during the multi-turn journey.",
          "Objective, file evidence, and next-turn context remained available after pressure.",
        ],
      }),
    }),
  );
  journeys.push(await runResumeJourney());
  journeys.push(await runDirtyWorktreeJourney());
  journeys.push(
    await runScriptedJourney({
      id: "false-completion",
      category: "completion_truthfulness",
      expectedStatus: "blocked",
      objective:
        'Change src/message.ts from "hello" to "hello world" and report completion.',
      turns: [
        textTurn("The requested change is complete."),
        textTurn("I have not performed the workspace mutation yet."),
        textTurn("The change remains unverified."),
      ],
      allowProviderTail: true,
      checks: standardChecks(),
      validate: async (root, result) => ({
        pass:
          result.status === "blocked" &&
          !(
            await readFile(path.join(root, "src", "message.ts"), "utf8")
          ).includes("hello world"),
        evidence: [
          "Assistant completion prose was rejected without a mutation and proof.",
        ],
      }),
    }),
  );
  journeys.push(
    await runScriptedJourney({
      id: "false-blocking",
      category: "completion_truthfulness",
      objective:
        "Change src/message.ts to hello world; no project test is applicable to this isolated artifact.",
      turns: [
        toolTurn("no-test-read", "ReadFile", { path: "src/message.ts" }),
        toolTurn("no-test-edit", "EditFile", {
          path: "src/message.ts",
          oldText: 'greeting = "hello"',
          newText: 'greeting = "hello world"',
        }),
        textTurn(
          "The isolated artifact is complete and its host criterion passed.",
        ),
      ],
      checks: standardChecks(),
      validate: async (_root, result) => ({
        pass: result.status === "completed" && result.verified,
        evidence: [
          "An applicable verifier was explicitly not required, so a proven artifact was not falsely blocked.",
        ],
      }),
    }),
  );
  journeys.push(await runStrictZeroJourney());

  return {
    schemaVersion: 1,
    fixtureRevision: AGENT_EVALUATION_FIXTURE_REVISION,
    generatedAt: new Date().toISOString(),
    journeys,
    summary: summarizeAgentEvaluation(journeys),
  };
}

export function summarizeAgentEvaluation(
  journeys: readonly AgentJourneyResult[],
): AgentEvaluationSummary {
  const passed = journeys.filter((journey) => journey.passed).length;
  const failed = journeys.filter(
    (journey) =>
      !journey.passed &&
      journey.status !== "unproven" &&
      journey.status !== "skipped",
  ).length;
  const skipped = journeys.filter(
    (journey) => journey.status === "skipped",
  ).length;
  const unproven = journeys.filter(
    (journey) => journey.status === "unproven",
  ).length;
  const result: AgentEvaluationSummary = {
    passed,
    failed,
    skipped,
    unproven,
    aggregateStatus:
      unproven > 0 || skipped > 0 ? "UNPROVEN" : failed > 0 ? "FAIL" : "PASS",
  };
  if (unproven === 0 && skipped === 0 && journeys.length > 0)
    result.successRate = passed / journeys.length;
  return result;
}
