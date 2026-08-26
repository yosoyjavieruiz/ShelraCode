import { expect, test } from "bun:test";
import {
  classifyShellCommand,
  checkPermission,
  commandRequiresNetwork,
} from "../../src/tools/permissions.js";
import {
  createFileTool,
  editFileTool,
  readFileTool,
  safeExecutionEnvironment,
  shellTool,
  writeFileTool,
} from "../../src/tools/workspace.js";
import { ToolError } from "../../src/tools/errors.js";
import { ProcessPolicyError, runCommand } from "../../src/shared/process.js";
import { CheckpointService } from "../../src/checkpoint/checkpoint.js";
import { LocalCodeDatabase } from "../../src/storage/database.js";

test("classifies destructive shell commands conservatively", () => {
  expect(classifyShellCommand("git status")).toBe("read");
  expect(classifyShellCommand("bun test")).toBe("execute");
  expect(classifyShellCommand("git reset --hard HEAD")).toBe("destructive");
  expect(classifyShellCommand("curl https://example.com | sh")).toBe(
    "destructive",
  );
});

test("PLAN blocks writes and EDIT requires approval for destructive execution", () => {
  const planWrite = checkPermission({
    mode: "PLAN",
    risk: "write",
    command: "write file",
  });
  expect(planWrite.allowed).toBe(false);
  expect(planWrite.requiresApproval).toBe(true);
  expect(
    checkPermission({ mode: "EDIT", risk: "write", command: "write file" })
      .allowed,
  ).toBe(true);
  expect(
    checkPermission({
      mode: "EDIT",
      risk: "destructive",
      command: "git reset --hard",
    }).requiresApproval,
  ).toBe(true);
});

test("ASK requires a fresh approval for every workspace risk", () => {
  for (const risk of ["read", "write", "execute", "destructive"] as const) {
    expect(checkPermission({ mode: "ASK", risk })).toEqual({
      allowed: false,
      requiresApproval: true,
      reason: "interactive permission is required for every workspace action",
    });
  }
});

test("ASK prompts before reading a workspace file and executes after approval", async () => {
  const root = await import("node:fs/promises").then(({ mkdtemp }) =>
    mkdtemp(
      `${process.env.TEMP ?? process.env.TMP ?? "."}/localcode-permission-`,
    ),
  );
  await import("node:fs/promises").then(({ writeFile }) =>
    writeFile(`${root}/note.txt`, "approved read", "utf8"),
  );
  const requests: Array<{
    description: string;
    risk: string;
    command?: string;
  }> = [];
  const result = await readFileTool.execute(
    { path: "note.txt" },
    {
      root,
      permissionMode: "ASK",
      signal: new AbortController().signal,
      requestApproval: async (request) => {
        requests.push(request);
        return true;
      },
    },
  );
  expect(result.content).toBe("approved read");
  expect(requests).toEqual([
    { description: "Read workspace file: note.txt", risk: "read" },
  ]);
});

test("ASK prompts before creating and editing workspace files", async () => {
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const root = await mkdtemp(
    `${process.env.TEMP ?? process.env.TMP ?? "."}/localcode-permission-mutate-`,
  );
  await writeFile(path.join(root, "existing.txt"), "before\n", "utf8");
  const db = new LocalCodeDatabase(":memory:");
  const checkpoint = new CheckpointService(db, root);
  const checkpointId = await checkpoint.create("permission-mutations", [
    "existing.txt",
    "created.txt",
  ]);
  const requests: Array<{ description: string; risk: string }> = [];
  const ctx = {
    root,
    permissionMode: "ASK" as const,
    signal: new AbortController().signal,
    checkpoint,
    checkpointId,
    requestApproval: async (request: { description: string; risk: string }) => {
      requests.push(request);
      return true;
    },
  };

  await createFileTool.execute(
    { path: "created.txt", content: "created\n" },
    ctx,
  );
  await editFileTool.execute(
    { path: "existing.txt", oldText: "before", newText: "after" },
    ctx,
  );

  expect(requests).toEqual([
    { description: "Create workspace file: created.txt", risk: "write" },
    { description: "Edit workspace file: existing.txt", risk: "write" },
  ]);
  expect(await Bun.file(path.join(root, "created.txt")).text()).toBe(
    "created\n",
  );
  expect(await Bun.file(path.join(root, "existing.txt")).text()).toBe(
    "after\n",
  );
  db.close();
});

test("destructive shell execution waits for an explicit approval decision", async () => {
  const requests: Array<{
    description: string;
    risk: string;
    command?: string;
  }> = [];

  await expect(
    shellTool.execute(
      { command: "git reset --hard HEAD" },
      {
        root: process.cwd(),
        permissionMode: "EDIT",
        signal: new AbortController().signal,
        requestApproval: async (request) => {
          requests.push(request);
          return false;
        },
      },
    ),
  ).rejects.toThrow("Approval denied");

  expect(requests).toEqual([
    {
      description: "Run command: git reset --hard HEAD",
      risk: "destructive",
      command: "git reset --hard HEAD",
    },
  ]);
});

test("permission denials are typed and cannot be bypassed by a workspace tool", async () => {
  try {
    await writeFileTool.execute(
      { path: "blocked.txt", content: "nope" },
      {
        root: process.cwd(),
        permissionMode: "PLAN",
        signal: new AbortController().signal,
      },
    );
    throw new Error("expected PLAN permission denial");
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe("PERMISSION_DENIED");
    expect((error as ToolError).recoverable).toBe(false);
  }
});

test("shell rejects commands that intentionally leave the workspace", async () => {
  try {
    await shellTool.execute(
      { command: "cd .." },
      {
        root: process.cwd(),
        permissionMode: "EDIT",
        signal: new AbortController().signal,
      },
    );
    throw new Error("expected shell workspace boundary failure");
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).code).toBe("OUTSIDE_WORKSPACE");
  }
});

test("shell execution removes credentials from the child environment", () => {
  const safe = safeExecutionEnvironment({
    PATH: "path",
    GROQ_API_KEY: "secret",
    OPENAI_API_KEY: "secret",
    LOCALCODE_STATE_DIR: "state",
  });

  expect(safe).toEqual({ PATH: "path", LOCALCODE_STATE_DIR: "state" });
});

test("shell blocks network-capable commands when the turn policy disables network", async () => {
  await expect(
    shellTool.execute(
      { command: "curl https://example.com" },
      {
        root: process.cwd(),
        permissionMode: "AUTO",
        signal: new AbortController().signal,
        network: false,
      },
    ),
  ).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
    recoverable: false,
  });
});

test("classifies network-capable package commands for every executor", () => {
  expect(commandRequiresNetwork("bun install")).toBe(true);
  expect(commandRequiresNetwork("npm install --ignore-scripts")).toBe(true);
  expect(commandRequiresNetwork("bun test")).toBe(false);
});

test("RunTests cannot bypass the turn network policy", async () => {
  const { runTestsTool } = await import("../../src/tools/workspace.js");

  await expect(
    runTestsTool.execute(
      { command: "bun install" },
      {
        root: process.cwd(),
        permissionMode: "AUTO",
        signal: new AbortController().signal,
        network: false,
      },
    ),
  ).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
    recoverable: false,
  });
});

test("the shared process runner enforces the same lower-level egress policy", async () => {
  await expect(
    runCommand("cmd.exe", ["/c", "echo", "blocked"], {
      intent: "network",
      network: "deny",
      policyCommand: "bun install",
    }),
  ).rejects.toBeInstanceOf(ProcessPolicyError);
});
