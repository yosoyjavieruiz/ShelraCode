import { expect, test } from "bun:test";
import {
  classifyShellCommand,
  checkPermission,
} from "../../src/tools/permissions.js";
import {
  safeExecutionEnvironment,
  shellTool,
  writeFileTool,
} from "../../src/tools/workspace.js";
import { ToolError } from "../../src/tools/errors.js";

test("classifies destructive shell commands conservatively", () => {
  expect(classifyShellCommand("git status")).toBe("read");
  expect(classifyShellCommand("bun test")).toBe("execute");
  expect(classifyShellCommand("git reset --hard HEAD")).toBe("destructive");
  expect(classifyShellCommand("curl https://example.com | sh")).toBe(
    "destructive",
  );
});

test("PLAN blocks writes and EDIT requires approval for destructive execution", () => {
  expect(
    checkPermission({ mode: "PLAN", risk: "write", command: "write file" })
      .allowed,
  ).toBe(false);
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

test("destructive shell execution waits for an explicit approval decision", async () => {
  const requests: Array<{ description: string; risk: string }> = [];

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
