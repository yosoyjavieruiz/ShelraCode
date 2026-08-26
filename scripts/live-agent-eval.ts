import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { CheckpointService } from "../src/checkpoint/checkpoint.js";
import { runAgent } from "../src/agent/loop.js";
import { LocalCodeDatabase } from "../src/storage/database.js";
import { OpenAICompatibleLocalRuntime } from "../src/runtimes/http.js";
import { runCommand } from "../src/shared/process.js";
import { workspaceTools } from "../src/tools/workspace.js";
import { recommendedAgentContextChars } from "../src/agent/context-budget.js";

const runtime = new OpenAICompatibleLocalRuntime(
  "lm-studio",
  "LM Studio",
  "http://127.0.0.1:1234/v1",
);
const complex = process.argv.includes("--complex");
const requiredToolChoice = process.argv.includes("--required");
const debugMessages = process.argv.includes("--debug");
const configuredTemperature = Number(
  process.env.LOCALCODE_LIVE_TEMPERATURE ?? "0",
);
const liveTemperature = Number.isFinite(configuredTemperature)
  ? configuredTemperature
  : 0;
const modelId = process.env.LOCALCODE_LIVE_MODEL_ID;
const candidates = await runtime.listModels();
const candidate = candidates.find((item) =>
  modelId
    ? item.modelId === modelId
    : item.modelId?.includes("qwen2.5-coder-7b"),
);

if (!candidate) {
  throw new Error(
    `No live LM Studio model matched ${modelId ?? "qwen2.5-coder-7b"}. Available: ${candidates
      .map((item) => item.modelId ?? item.displayName)
      .join(", ")}`,
  );
}

const root = await mkdtemp(path.join(os.tmpdir(), "localcode-live-agent-"));
const database = new LocalCodeDatabase(":memory:");
const checkpoint = new CheckpointService(database, root);
const events: string[] = [];

try {
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "localcode-live-agent-fixture",
      version: "0.0.0",
      scripts: { test: "bun test" },
    }) + "\n",
    "utf8",
  );
  await writeFile(
    path.join(root, "AGENTS.md"),
    "Use the existing TypeScript style. Run bun test after edits.\n",
    "utf8",
  );
  await mkdir(path.join(root, "src"));
  if (complex) {
    await mkdir(path.join(root, "tests"));
    await writeFile(
      path.join(root, "src", "math.ts"),
      "export function add(a: number, b: number): number {\n" +
        "  return a - b;\n" +
        "}\n",
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
        "import { add } from '../src/index.ts';\n" +
        "test('adds two numbers', () => {\n" +
        "  expect(add(2, 3)).toBe(5);\n" +
        "});\n",
      "utf8",
    );
  } else {
    await writeFile(
      path.join(root, "src", "message.ts"),
      'export const greeting = "hello";\n',
      "utf8",
    );
    await writeFile(
      path.join(root, "src", "message.test.ts"),
      "import { expect, test } from 'bun:test';\n" +
        "import { greeting } from './message.ts';\n" +
        "test('uses the updated greeting', () => {\n" +
        "  expect(greeting).toBe('hello world');\n" +
        "});\n",
      "utf8",
    );
  }

  const gitInit = await runCommand("git", ["init", "-q"], {
    intent: "execute",
    cwd: root,
    timeoutMs: 10_000,
  });
  if (gitInit.exitCode !== 0)
    throw new Error(
      `Could not initialize the disposable fixture Git repo: ${gitInit.stderr}`,
    );
  for (const args of [
    ["config", "user.name", "LocalCode Fixture"],
    ["config", "user.email", "fixture@localcode.invalid"],
    ["add", "."],
    ["commit", "-qm", "fixture baseline"],
  ]) {
    const result = await runCommand("git", args, {
      intent: "execute",
      cwd: root,
      timeoutMs: 10_000,
    });
    if (result.exitCode !== 0)
      throw new Error(
        `Could not prepare the disposable fixture Git repo: ${result.stderr}`,
      );
  }

  const objective = complex
    ? "Use the workspace tools to complete this coding task. Inspect src/math.ts, src/index.ts, and tests/math.test.ts. Fix add(a, b) so it sums, implement multiply(a, b) in src/math.ts, export both functions from src/index.ts, add a multiply unit test, run bun test, and review the final diff. Do not write a plan or code in prose and do not modify package metadata."
    : "Read src/message.ts, change the exact greeting value from hello to hello world, run bun test, and report the verified result.";
  const successCriteria = complex
    ? [
        "add(2, 3) returns 5",
        "multiply(2, 3) returns 6 and is exported from src/index.ts",
        "bun test passes",
      ]
    : ['src/message.ts exports greeting = "hello world"', "bun test passes"];

  const controller = new AbortController();
  const result = await runAgent(
    {
      id: complex
        ? "live-qwen-7b-multi-file-math"
        : "live-qwen-7b-edit-and-test",
      objective,
      root,
      candidate,
      repositoryPolicy: "local_only",
      permissionMode: "AUTO",
      mode: "coding",
      successCriteria,
      verificationCommands: [{ stage: "test", command: "bun test" }],
      context:
        "This is a disposable fixture. Use only the exposed workspace tools. Preserve the existing file structure.",
      maxTurns: complex ? 24 : 16,
      contextBudgetChars: recommendedAgentContextChars(
        candidate,
        "coding",
        complex ? 0.9 : 0.35,
      ),
      temperature: liveTemperature,
      maxOutputTokens: complex ? 1_024 : 512,
      systemPromptProfile: "coding",
    },
    {
      provider: runtime.provider(),
      tools: workspaceTools,
      toolChoice: requiredToolChoice ? "required" : "auto",
      onEvent(event) {
        if (event.type === "tool.started") events.push(`start:${event.tool}`);
        if (event.type === "tool.finished")
          events.push(`${event.result.ok ? "ok" : "fail"}:${event.tool}`);
        if (event.type === "verification.finished")
          events.push(`verify:${event.stage ?? "unknown"}:${event.exitCode}`);
      },
      checkUserWorkPreserved: (checkpointId) =>
        checkpointId ? checkpoint.isPreserved(checkpointId) : true,
      reviewFinalDiff: () => true,
      async verifySuccessCriteria(_task, ledger) {
        const satisfiedCriterionIds: string[] = [];
        const issues: string[] = [];
        const nextActions: string[] = [];
        const nextPaths: string[] = [];
        const latestTest = [...ledger.verificationRuns]
          .reverse()
          .find((run) => run.stage === "test");
        const testPassed =
          latestTest?.status === "passed" && latestTest.exitCode === 0;
        if (complex) {
          const math = await readFile(
            path.join(root, "src", "math.ts"),
            "utf8",
          );
          const index = await readFile(
            path.join(root, "src", "index.ts"),
            "utf8",
          );
          const tests = await readFile(
            path.join(root, "tests", "math.test.ts"),
            "utf8",
          );
          const addFixed = math.includes("return a + b");
          const multiplyImplemented = math.includes("multiply");
          const multiplyExported = index.includes("multiply");
          const multiplyTested = tests.includes("multiply");
          if (addFixed) satisfiedCriterionIds.push("criterion-1");
          else {
            issues.push("add(a, b) is not fixed yet.");
            nextPaths.push("src/math.ts");
            nextActions.push(
              "Read src/math.ts and edit only add(a, b) so it returns a + b; preserve any already-correct multiply implementation.",
            );
          }
          if (multiplyImplemented && multiplyExported && multiplyTested)
            satisfiedCriterionIds.push("criterion-2");
          else {
            issues.push(
              "multiply is not fully implemented, exported, and tested yet.",
            );
            if (!multiplyImplemented) nextPaths.push("src/math.ts");
            if (!multiplyImplemented)
              nextActions.push(
                "Read src/math.ts and add multiply(a, b) returning a * b without changing add(a, b).",
              );
            if (!multiplyImplemented) {
              // Keep the next action on the implementation stage until the
              // function exists; later stages become eligible on the next
              // host verification.
            } else if (!multiplyExported) {
              nextPaths.push("src/index.ts");
              nextActions.push(
                "Read src/index.ts and export multiply alongside add from ./math.ts.",
              );
            } else if (!multiplyTested) {
              nextPaths.push("tests/math.test.ts");
              nextActions.push(
                "Read tests/math.test.ts and add a focused test asserting multiply(2, 3) equals 6 and import multiply from src/index.ts.",
              );
            }
          }
        } else {
          const message = await readFile(
            path.join(root, "src", "message.ts"),
            "utf8",
          );
          if (message.includes('greeting = "hello world"'))
            satisfiedCriterionIds.push("criterion-1");
          else {
            issues.push("The requested greeting value is not present yet.");
            nextPaths.push("src/message.ts");
            nextActions.push(
              'Read src/message.ts and change only the greeting value to "hello world".',
            );
          }
        }
        if (testPassed)
          satisfiedCriterionIds.push(complex ? "criterion-3" : "criterion-2");
        else {
          issues.push("The required bun test verification has not passed yet.");
          const evidence = (latestTest?.summary ?? "")
            .split(/\r?\n/u)
            .map((line) => line.trim())
            .filter((line) =>
              /(?:expected:|received:|error:|fail\)|failed|\.test\.)/iu.test(
                line,
              ),
            )
            .slice(0, 6)
            .join(" ");
          if (evidence)
            nextActions.push(
              `Latest verification evidence: ${evidence}. Correct the failing assertion and preserve behavior that already passes.`,
            );
          if (latestTest?.failurePaths)
            nextPaths.push(...latestTest.failurePaths);
          nextActions.push(
            "Inspect the failing bun test output, repair the relevant implementation, and rerun bun test.",
          );
        }
        return {
          pass: issues.length === 0,
          satisfiedCriterionIds,
          issues,
          nextActions,
          nextPaths,
        };
      },
      async createExecutionContext() {
        return {
          root,
          permissionMode: "AUTO" as const,
          signal: controller.signal,
          network: false,
          checkpoint,
          env: process.env,
        };
      },
    },
    controller.signal,
  );

  const inspectedFiles = { math: "", index: "", tests: "", message: "" };
  if (complex) {
    inspectedFiles.math = await readFile(
      path.join(root, "src", "math.ts"),
      "utf8",
    );
    inspectedFiles.index = await readFile(
      path.join(root, "src", "index.ts"),
      "utf8",
    );
    inspectedFiles.tests = await readFile(
      path.join(root, "tests", "math.test.ts"),
      "utf8",
    );
  } else {
    inspectedFiles.message = await readFile(
      path.join(root, "src", "message.ts"),
      "utf8",
    );
  }
  console.log(
    JSON.stringify(
      {
        model: {
          id: candidate.modelId,
          displayName: candidate.displayName,
          quantization: candidate.local?.quant,
          context: candidate.capabilities.maxContext,
        },
        task: {
          status: result.status,
          verified: result.verified,
          turns: result.turns,
          filesChanged: result.ledger.filesChanged,
          toolRuns: result.toolRuns.map((run) => ({
            tool: run.tool,
            ok: run.ok,
            code: run.code,
          })),
          verification: result.ledger.verificationRuns.map((run) => ({
            stage: run.stage,
            status: run.status,
            exitCode: run.exitCode,
          })),
          events,
          finalText: result.text.slice(0, 1_000),
          contentChecks: complex
            ? {
                addFixed: inspectedFiles.math.includes("return a + b"),
                multiplyImplemented: inspectedFiles.math.includes("multiply"),
                multiplyExported: inspectedFiles.index.includes("multiply"),
                multiplyTested: inspectedFiles.tests.includes("multiply"),
              }
            : {
                greetingUpdated: inspectedFiles.message.includes(
                  'greeting = "hello world"',
                ),
              },
          ...(debugMessages
            ? {
                messages: result.messages.map((message) => ({
                  role: message.role,
                  content: message.content.slice(0, 1_200),
                  ...(message.toolCalls
                    ? {
                        toolCalls: message.toolCalls.map((call) => ({
                          name: call.name,
                          arguments: call.arguments.slice(0, 600),
                        })),
                      }
                    : {}),
                })),
              }
            : {}),
        },
      },
      null,
      2,
    ),
  );
} finally {
  database.close();
  await rm(root, { recursive: true, force: true });
}
