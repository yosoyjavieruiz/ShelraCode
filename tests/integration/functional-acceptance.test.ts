// LocalCode functional-MVP acceptance suite. Each test drives the same
// pipeline the real TUI drives (analyzeTask -> resolveTurnMode ->
// resolveTurnPolicy -> runAgent) against a disposable fixture repository and
// a deterministic scripted provider — no live model or network required.
// Run with `bun run test:functional`.
import { expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CheckpointService } from "../../src/checkpoint/checkpoint.js";
import { runAgent } from "../../src/agent/loop.js";
import {
  resolveTurnMode,
  resolveTurnPolicy,
} from "../../src/agent/turn-policy.js";
import { analyzeTask } from "../../src/router/task-analysis.js";
import type {
  ProviderAdapter,
  ProviderEvent,
} from "../../src/providers/types.js";
import { LocalCodeDatabase } from "../../src/storage/database.js";
import { workspaceTools } from "../../src/tools/workspace.js";
import {
  breakFixtureMathAdd,
  createFunctionalFixtureRepo,
} from "../support/fixture-repo.js";
import {
  createScriptedProvider,
  fakeAgentCandidate,
} from "../support/fake-provider.js";

async function runTurn(
  objective: string,
  root: string,
  provider: ProviderAdapter,
  signal: AbortSignal = new AbortController().signal,
  events?: string[],
) {
  const mode = resolveTurnMode(objective, analyzeTask(objective));
  const policy = resolveTurnPolicy(mode);
  const db = new LocalCodeDatabase(":memory:");
  const checkpoint = new CheckpointService(db, root);
  try {
    const result = await runAgent(
      {
        id: crypto.randomUUID(),
        objective,
        root,
        candidate: fakeAgentCandidate,
        repositoryPolicy: "private",
        permissionMode: "EDIT",
        mode,
        verificationCommand: mode === "coding" ? "bun test" : undefined,
        maxTurns: 6,
        systemPromptProfile: policy.systemPromptProfile,
      },
      {
        provider,
        tools: workspaceTools.filter((tool) =>
          policy.allowedTools.includes(tool.name),
        ),
        toolChoice: policy.toolChoice,
        onEvent: (event) => events?.push(event.type),
        async createExecutionContext(task) {
          return {
            root: task.root,
            permissionMode: task.permissionMode,
            signal,
            checkpoint,
            env: process.env,
          };
        },
      },
      signal,
    );
    return { mode, policy, result };
  } finally {
    db.close();
  }
}

function textTurn(text: string): ProviderEvent[] {
  return [{ type: "text.delta", text }, { type: "done" }];
}

function toolTurn(id: string, name: string, args: unknown): ProviderEvent[] {
  return [
    { type: "tool.call", call: { id, name, arguments: JSON.stringify(args) } },
    { type: "done" },
  ];
}

test("greeting: golden path — zero tools, zero tool calls, natural reply", async () => {
  const root = await createFunctionalFixtureRepo();
  const provider = createScriptedProvider(
    [textTurn("¡Hola! ¿En qué te ayudo?")],
    {
      stopAfter: true,
    },
  );
  const { mode, result } = await runTurn("Hola", root, provider);

  expect(mode).toBe("conversation");
  expect(result.toolRuns).toEqual([]);
  expect(result.text).toContain("En qué te ayudo");
  // Empty tool list means the request never advertises tools at all.
  expect(provider.requests[0]?.tools).toBeUndefined();
});

test("greeting: adversarial — a misbehaving model still can't edit a file", async () => {
  const root = await createFunctionalFixtureRepo();
  const provider = createScriptedProvider(
    [
      toolTurn("edit-1", "EditFile", {
        path: "src/message.ts",
        oldText: '"hello"',
        newText: '"compromised"',
      }),
    ],
    { stopAfter: true },
  );
  const { mode, result } = await runTurn("Hola", root, provider);

  expect(mode).toBe("conversation");
  expect(result.toolRuns).toEqual([]);
  const content = await readFile(path.join(root, "src", "message.ts"), "utf8");
  expect(content).toContain('"hello"');
  expect(content).not.toContain("compromised");
});

test("general knowledge question: zero tools, answered from model knowledge", async () => {
  const root = await createFunctionalFixtureRepo();
  const provider = createScriptedProvider(
    [
      textTurn(
        "GGUF is a binary file format for storing quantized model weights.",
      ),
    ],
    { stopAfter: true },
  );
  const { mode, result } = await runTurn("¿Qué es GGUF?", root, provider);

  expect(mode).toBe("knowledge");
  expect(result.toolRuns).toEqual([]);
  expect(result.text).toContain("GGUF");
});

test('repository review: a naive ListFiles("/") call lists the root instead of erroring', async () => {
  // Regression test for a real live-model bug report: qwen2.5-coder-1.5b
  // called `ListFiles` with path "/" (meaning "the whole project") and got
  // "Path escapes workspace: /" instead of a listing.
  const root = await createFunctionalFixtureRepo();
  const provider = createScriptedProvider(
    [
      toolTurn("list-1", "ListFiles", { path: "/" }),
      textTurn("The project contains package.json, AGENTS.md and src/."),
    ],
    { stopAfter: true },
  );
  const { mode, result } = await runTurn(
    "revisa todo el codigo del proyecto",
    root,
    provider,
  );

  expect(mode).toBe("review");
  expect(result.toolRuns).toEqual([
    expect.objectContaining({ tool: "ListFiles", ok: true }),
  ]);
  const listing = result.toolRuns[0]?.output as { files: string[] } | undefined;
  expect(listing?.files).toContain("package.json");
});

test("repository question: read-only tools only, never writes", async () => {
  const root = await createFunctionalFixtureRepo();
  const provider = createScriptedProvider(
    [
      toolTurn("read-1", "ReadFile", { path: "package.json" }),
      textTurn("This project is named functional-fixture."),
    ],
    { stopAfter: true },
  );
  const { mode, result } = await runTurn(
    "Lee package.json y dime el nombre del proyecto.",
    root,
    provider,
  );

  expect(mode).toBe("workspace_question");
  expect(result.toolRuns.map((run) => run.tool)).toEqual(["ReadFile"]);
  expect(result.toolRuns[0]?.ok).toBe(true);
  expect(result.text).toContain("functional-fixture");
});

test("project language: uses root evidence and performs no writes", async () => {
  const root = await createFunctionalFixtureRepo();
  const provider = createScriptedProvider(
    [
      toolTurn("read-1", "ReadFile", { path: "package.json" }),
      toolTurn("read-2", "ReadFile", { path: "src/math.ts" }),
      textTurn("This fixture is a TypeScript project."),
    ],
    { stopAfter: true },
  );
  const { mode, result } = await runTurn(
    "What programming language is this project written in?",
    root,
    provider,
  );

  expect(mode).toBe("workspace_question");
  expect(result.toolRuns.map((run) => run.tool)).toEqual([
    "ReadFile",
    "ReadFile",
  ]);
  expect(result.text).toContain("TypeScript");
  expect(result.toolRuns.some((run) => run.tool === "EditFile")).toBe(false);
});

test("project language: a hostile EditFile attempt is denied without mutation", async () => {
  const root = await createFunctionalFixtureRepo();
  const provider = createScriptedProvider(
    [
      toolTurn("read-1", "ReadFile", { path: "package.json" }),
      toolTurn("edit-1", "EditFile", {
        path: "src/math.ts",
        oldText: "return a + b;",
        newText: "return compromised;",
      }),
      textTurn("This fixture is a TypeScript project."),
    ],
    { stopAfter: true },
  );
  const { mode, policy, result } = await runTurn(
    "What programming language is this project written in?",
    root,
    provider,
  );

  expect(mode).toBe("workspace_question");
  expect(policy.repositoryWrite).toBe(false);
  expect(policy.allowedTools).not.toContain("EditFile");
  expect(result.toolRuns).toEqual([
    expect.objectContaining({ tool: "ReadFile", ok: true }),
    expect.objectContaining({
      tool: "EditFile",
      ok: false,
      code: "PERMISSION_DENIED",
    }),
  ]);
  expect(result.text).toContain("TypeScript");
  expect(await readFile(path.join(root, "src", "math.ts"), "utf8")).toContain(
    "return a + b;",
  );
});

test("symbol lookup: searches before reading the defining file", async () => {
  const root = await createFunctionalFixtureRepo();
  const provider = createScriptedProvider(
    [
      toolTurn("search-1", "SearchText", { pattern: "export function add" }),
      toolTurn("read-1", "ReadFile", { path: "src/math.ts" }),
      textTurn("add is implemented in src/math.ts."),
    ],
    { stopAfter: true },
  );
  const { result } = await runTurn("Where is add implemented?", root, provider);

  expect(result.toolRuns.map((run) => run.tool)).toEqual([
    "SearchText",
    "ReadFile",
  ]);
  expect(result.text).toContain("src/math.ts");
});

test("architecture explanation collects multiple relevant evidence sources", async () => {
  const root = await createFunctionalFixtureRepo();
  const provider = createScriptedProvider(
    [
      toolTurn("read-1", "ReadFile", { path: "AGENTS.md" }),
      toolTurn("read-2", "ReadFile", { path: "src/math.ts" }),
      toolTurn("read-3", "ReadFile", { path: "math.test.ts" }),
      textTurn(
        "The project keeps arithmetic in src/math.ts and verifies it from math.test.ts under the repository instructions.",
      ),
    ],
    { stopAfter: true },
  );
  const { mode, result } = await runTurn(
    "Explain the architecture of this project.",
    root,
    provider,
  );

  expect(mode).toBe("workspace_question");
  expect(result.toolRuns.filter((run) => run.ok)).toHaveLength(3);
  expect(result.evidenceCount).toBeGreaterThanOrEqual(3);
  expect(result.text).toContain("math.ts");
});

test("review-only task cannot expose mutation tools", async () => {
  const root = await createFunctionalFixtureRepo();
  const provider = createScriptedProvider(
    [
      toolTurn("read-1", "ReadFile", { path: "src/math.ts" }),
      textTurn(
        "The add implementation is simple and has a matching regression test.",
      ),
    ],
    { stopAfter: true },
  );
  const { mode, policy, result } = await runTurn(
    "Review src/math.ts for possible bugs.",
    root,
    provider,
  );

  expect(mode).toBe("review");
  expect(policy.repositoryWrite).toBe(false);
  expect(policy.allowedTools).not.toContain("EditFile");
  expect(result.toolRuns.map((run) => run.tool)).toEqual(["ReadFile"]);
});

test("test execution is a first-class command with structured result", async () => {
  const root = await createFunctionalFixtureRepo();
  const provider = createScriptedProvider(
    [
      toolTurn("test-1", "RunTests", {}),
      textTurn("The fixture test command passed."),
    ],
    { stopAfter: true },
  );
  const { mode, result } = await runTurn("Run the tests.", root, provider);

  expect(mode).toBe("command");
  expect(result.toolRuns[0]?.ok).toBe(true);
  expect((result.toolRuns[0]?.output as { exitCode: number }).exitCode).toBe(0);
  expect(result.ledger.verificationRuns[0]?.status).toBe("passed");
});

test("a failing command cannot be reported as completed", async () => {
  const root = await createFunctionalFixtureRepo();
  await breakFixtureMathAdd(root);
  const events: string[] = [];
  const provider = createScriptedProvider(
    [
      toolTurn("test-1", "RunTests", {}),
      textTurn("The tests failed, but the command is done."),
    ],
    { stopAfter: true },
  );
  const { result } = await runTurn("Run the tests.", root, provider, undefined, events);

  expect(result.status).toBe("blocked");
  expect(result.verified).toBe(false);
  expect(result.toolRuns[0]).toEqual(
    expect.objectContaining({
      ok: false,
      code: "TEST_FAILED",
      recoverable: true,
    }),
  );
  expect(result.ledger.verificationRuns[0]?.status).toBe("failed");
  expect(events).toContain("task.blocked");
  expect(events).not.toContain("task.failed");
});

test("failed test observations are typed and bounded before the next model turn", async () => {
  const root = await createFunctionalFixtureRepo();
  await writeFile(
    path.join(root, "long-fail.ts"),
    "process.stdout.write('x'.repeat(20000)); process.exit(1);\n",
    "utf8",
  );
  const provider = createScriptedProvider(
    [
      toolTurn("test-1", "RunTests", {
        command: "bun long-fail.ts",
      }),
      textTurn(
        "The test command failed; the bounded failure evidence is available.",
      ),
      textTurn("I still have not executed the corrective workspace action."),
      textTurn(
        "The coding task remains unverified without a workspace action.",
      ),
    ],
    { stopAfter: true },
  );

  const { result } = await runTurn("Run the tests.", root, provider);
  const toolMessage = provider.requests[1]?.messages.find(
    (message) => message.role === "tool",
  );

  expect(result.toolRuns[0]).toEqual(
    expect.objectContaining({
      ok: false,
      code: "TEST_FAILED",
      recoverable: true,
    }),
  );
  expect(toolMessage?.content.length ?? 0).toBeLessThan(6_000);
  expect(toolMessage?.content).toContain('"code":"TEST_FAILED"');
  expect(toolMessage?.content).toContain(
    "host output truncated for model context",
  );
});

test("a non-zero shell command becomes recoverable COMMAND_FAILED evidence", async () => {
  const root = await createFunctionalFixtureRepo();
  const provider = createScriptedProvider(
    [
      toolTurn("shell-1", "Shell", { command: "cmd /c exit 1" }),
      textTurn(
        "The command failed; I would inspect the failure before retrying.",
      ),
      textTurn("I still have not executed the corrective workspace action."),
      textTurn(
        "The coding task remains unverified without a workspace action.",
      ),
      textTurn("No verified mutation is available yet."),
    ],
    { stopAfter: true },
  );

  const { result } = await runTurn(
    "Fix the failing command and verify it.",
    root,
    provider,
  );

  expect(result.toolRuns[0]).toEqual(
    expect.objectContaining({
      ok: false,
      code: "COMMAND_FAILED",
      recoverable: true,
    }),
  );
  expect(result.status).toBe("blocked");
});

test("plan-only work remains read-only even when the model attempts a write", async () => {
  const root = await createFunctionalFixtureRepo();
  const provider = createScriptedProvider(
    [
      toolTurn("read-1", "ReadFile", { path: "src/math.ts" }),
      toolTurn("edit-1", "EditFile", {
        path: "src/math.ts",
        oldText: "return a + b;",
        newText: "return b + a;",
      }),
      textTurn("The plan is to preserve add(), add tests, and verify callers."),
    ],
    { stopAfter: true },
  );
  const { mode, result } = await runTurn(
    "Analyze how to improve this project and give me a plan. Do not modify anything.",
    root,
    provider,
  );

  expect(mode).toBe("plan");
  expect(result.toolRuns.map((run) => run.tool)).toEqual([
    "ReadFile",
    "EditFile",
  ]);
  expect(result.toolRuns[1]?.ok).toBe(false);
  expect(result.ledger.plan?.steps.length).toBeGreaterThan(0);
  expect(await readFile(path.join(root, "src", "math.ts"), "utf8")).toContain(
    "return a + b;",
  );
});

test("missing path recovery returns a typed observation and continues", async () => {
  const root = await createFunctionalFixtureRepo();
  const provider = createScriptedProvider(
    [
      toolTurn("missing-1", "ReadFile", { path: "src/missing.ts" }),
      toolTurn("list-1", "ListFiles", { path: "src" }),
      textTurn(
        "The requested file is absent; the available source files are listed under src.",
      ),
    ],
    { stopAfter: true },
  );
  const { result } = await runTurn(
    "Find the missing source file in this project.",
    root,
    provider,
  );

  expect(result.toolRuns[0]).toEqual(
    expect.objectContaining({
      tool: "ReadFile",
      ok: false,
      code: "PATH_NOT_FOUND",
    }),
  );
  expect(result.toolRuns[1]?.ok).toBe(true);
  expect(result.status).toBe("completed");
});

test("false completion is blocked when a coding turn has not verified its changes", async () => {
  const root = await createFunctionalFixtureRepo();
  const provider = createScriptedProvider(
    [
      textTurn("The change is complete."),
      textTurn("I have not executed a workspace action yet."),
      textTurn("The change still lacks a verified workspace mutation."),
    ],
    {
      stopAfter: true,
    },
  );
  const { result } = await runTurn("Fix the greeting bug.", root, provider);

  expect(result.status).toBe("blocked");
  expect(result.verified).toBe(false);
  expect(result.completion.reasons).toContain(
    "required verification has not passed",
  );
});

test("pre-existing dirty work is preserved while another file is edited", async () => {
  const root = await createFunctionalFixtureRepo();
  const userPath = path.join(root, "src", "message.ts");
  await writeFile(userPath, 'export const greeting = "user change";\n', "utf8");
  const provider = createScriptedProvider(
    [
      toolTurn("read-1", "ReadFile", { path: "src/math.ts" }),
      toolTurn("edit-1", "EditFile", {
        path: "src/math.ts",
        oldText: "return a + b;",
        newText: "return b + a;",
      }),
      textTurn("Updated math."),
      textTurn("Updated math and verified the result."),
    ],
    { stopAfter: true },
  );
  const { result } = await runTurn(
    "Change the math implementation.",
    root,
    provider,
  );

  expect(result.verified).toBe(true);
  expect(await readFile(userPath, "utf8")).toContain("user change");
});

test("small edit: reads then edits the right file and verifies", async () => {
  const root = await createFunctionalFixtureRepo();
  const provider = createScriptedProvider(
    [
      toolTurn("read-1", "ReadFile", { path: "src/message.ts" }),
      toolTurn("edit-1", "EditFile", {
        path: "src/message.ts",
        oldText: '"hello"',
        newText: '"hello world"',
      }),
      // The turn right after a mutation is consumed by LocalCode's own
      // automatic post-mutation verification pass, not treated as final —
      // the model gets one more turn to report on the (now known) result.
      textTurn("Updated the greeting."),
      textTurn("Updated the greeting and confirmed the tests still pass."),
    ],
    { stopAfter: true },
  );
  const { mode, result } = await runTurn(
    'Cambia el texto "hello" por "hello world" en src/message.ts.',
    root,
    provider,
  );

  expect(mode).toBe("coding");
  expect(result.toolRuns.map((run) => run.tool)).toEqual([
    "ReadFile",
    "EditFile",
  ]);
  expect(result.verified).toBe(true);
  const content = await readFile(path.join(root, "src", "message.ts"), "utf8");
  expect(content).toContain("hello world");
});

test("feature plus tests creates both implementation and regression coverage", async () => {
  const root = await createFunctionalFixtureRepo();
  const provider = createScriptedProvider(
    [
      toolTurn("read-1", "ReadFile", { path: "src/math.ts" }),
      toolTurn("write-1", "WriteFile", {
        path: "src/multiply.ts",
        content:
          "export function multiply(a: number, b: number): number { return a * b; }\n",
      }),
      toolTurn("write-2", "WriteFile", {
        path: "multiply.test.ts",
        content:
          "import { expect, test } from 'bun:test'; import { multiply } from './src/multiply.ts'; test('multiply', () => expect(multiply(2, 3)).toBe(6));\n",
      }),
      textTurn(
        "The implementation and test files are written; I am running verification.",
      ),
      textTurn("Added multiply and its unit test; the suite is green."),
    ],
    { stopAfter: true },
  );
  const { result } = await runTurn(
    "Add multiply(a, b) and unit tests.",
    root,
    provider,
  );

  expect(result.verified).toBe(true);
  expect(result.ledger.filesChanged).toEqual(
    expect.arrayContaining(["src/multiply.ts", "multiply.test.ts"]),
  );
  expect(await readFile(path.join(root, "multiply.test.ts"), "utf8")).toContain(
    "multiply",
  );
});

test("multi-file feature updates exports and callers before verification", async () => {
  const root = await createFunctionalFixtureRepo();
  const provider = createScriptedProvider(
    [
      toolTurn("read-1", "ReadFile", { path: "src/math.ts" }),
      toolTurn("write-1", "WriteFile", {
        path: "src/math-extra.ts",
        content:
          "export const double = (value: number): number => value * 2;\n",
      }),
      toolTurn("write-2", "WriteFile", {
        path: "math-extra.test.ts",
        content:
          "import { expect, test } from 'bun:test'; import { double } from './src/math-extra.ts'; test('double', () => expect(double(4)).toBe(8));\n",
      }),
      textTurn("The helper and test are written; I am running verification."),
      textTurn("Added the helper and its caller-facing regression test."),
    ],
    { stopAfter: true },
  );
  const { mode, result } = await runTurn(
    "Implement a multi-file math feature with tests across the repository.",
    root,
    provider,
  );

  expect(mode).toBe("coding");
  expect(result.verified).toBe(true);
  expect(result.ledger.filesChanged.length).toBe(2);
});

test("file-versus-directory recovery switches from ListFiles to ReadFile", async () => {
  const root = await createFunctionalFixtureRepo();
  const provider = createScriptedProvider(
    [
      toolTurn("bad-list", "ListFiles", { path: "src/math.ts" }),
      toolTurn("read-1", "ReadFile", { path: "src/math.ts" }),
      textTurn("src/math.ts is a file, so I read it with ReadFile."),
    ],
    { stopAfter: true },
  );
  const { result } = await runTurn("Inspect src/math.ts.", root, provider);

  expect(result.toolRuns[0]).toEqual(
    expect.objectContaining({ code: "PATH_IS_FILE", recoverable: true }),
  );
  expect(result.toolRuns[1]?.ok).toBe(true);
  expect(result.status).toBe("completed");
});

test("fix a failing test: discovers the failure, edits the source, re-verifies green", async () => {
  const root = await createFunctionalFixtureRepo();
  await breakFixtureMathAdd(root);
  const provider = createScriptedProvider(
    [
      toolTurn("run-1", "RunTests", {}),
      toolTurn("read-1", "ReadFile", { path: "src/math.ts" }),
      toolTurn("edit-1", "EditFile", {
        path: "src/math.ts",
        oldText: "return a - b;",
        newText: "return a + b;",
      }),
      // Consumed by LocalCode's automatic post-mutation verification pass.
      textTurn("Applied the fix."),
      textTurn("Fixed add() and the test suite is green."),
    ],
    { stopAfter: true },
  );
  const { mode, result } = await runTurn(
    "Corrige la prueba fallida y asegúrate de que pase.",
    root,
    provider,
  );

  expect(mode).toBe("coding");
  expect(result.toolRuns.map((run) => run.tool)).toEqual([
    "RunTests",
    "ReadFile",
    "EditFile",
  ]);
  expect(result.toolRuns[0]?.ok).toBe(false);
  expect(result.toolRuns[0]?.code).toBe("TEST_FAILED");
  const firstRun = result.toolRuns[0]?.output as
    { exitCode: number } | undefined;
  expect(firstRun?.exitCode).not.toBe(0); // really was failing before the edit
  expect(result.verified).toBe(true); // and really passes after it
  const content = await readFile(path.join(root, "src", "math.ts"), "utf8");
  expect(content).toContain("return a + b;");
});

test("malformed tool call: rejected without executing or leaking raw JSON", async () => {
  const root = await createFunctionalFixtureRepo();
  const provider = createScriptedProvider(
    [
      [
        {
          type: "tool.call",
          call: { id: "edit-1", name: "EditFile", arguments: '{"path": 42}' },
        },
        { type: "done" },
      ],
      textTurn("I couldn't run that edit — the arguments were invalid."),
    ],
    { stopAfter: true },
  );
  const { result } = await runTurn(
    "Corrige este bug y ejecuta los tests.",
    root,
    provider,
  );

  expect(result.toolRuns).toEqual([
    expect.objectContaining({
      tool: "EditFile",
      ok: false,
      code: "INVALID_ARGUMENT",
    }),
  ]);
  expect(result.text).not.toContain('"path"');
  const content = await readFile(path.join(root, "src", "message.ts"), "utf8");
  expect(content).toContain('"hello"'); // untouched
});

test("cancellation: aborting mid-run stops the agent without partial mutation", async () => {
  const root = await createFunctionalFixtureRepo();
  const controller = new AbortController();
  const events: string[] = [];
  const provider = createScriptedProvider([
    [
      { type: "text.delta", text: "Starting..." },
      {
        type: "tool.call",
        call: {
          id: "edit-1",
          name: "EditFile",
          arguments: JSON.stringify({
            path: "src/message.ts",
            oldText: '"hello"',
            newText: '"should not land"',
          }),
        },
      },
      { type: "done" },
    ],
  ]);

  const runPromise = runTurn(
    "Corrige este bug y ejecuta los tests.",
    root,
    provider,
    controller.signal,
    events,
  );
  controller.abort();

  const result = (await runPromise).result;
  expect(result.status).toBe("cancelled");
  expect(result.ledger.phase).toBe("cancelled");
  expect(events).toContain("task.cancelled");
  expect(events).not.toContain("task.failed");
  const content = await readFile(path.join(root, "src", "message.ts"), "utf8");
  expect(content).toContain('"hello"');
  expect(content).not.toContain("should not land");
});
