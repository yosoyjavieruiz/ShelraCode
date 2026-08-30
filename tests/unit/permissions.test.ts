import { expect, test } from "bun:test";
import {
  classifyShellCommand,
  checkPermission,
  commandRequiresNetwork,
  shellCommandEscapesWorkspace,
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

test("classifies a force-push as destructive regardless of long or short flag", () => {
  expect(classifyShellCommand("git push --force")).toBe("destructive");
  expect(classifyShellCommand("git push -f origin main")).toBe("destructive");
  expect(classifyShellCommand("git push origin main --force")).toBe(
    "destructive",
  );
  expect(classifyShellCommand("git push --force-with-lease")).toBe(
    "destructive",
  );
  expect(classifyShellCommand("git push origin main")).toBe("execute");
  expect(classifyShellCommand("git push -u origin feature")).toBe("execute");
});

test("does not misattribute an unrelated -f flag on a chained command to the push", () => {
  expect(
    classifyShellCommand(
      "git push origin main && curl -f https://example.com/notify",
    ),
  ).toBe("execute");
  expect(
    classifyShellCommand("git push origin main; grep -f patterns.txt file.txt"),
  ).toBe("execute");
  expect(
    classifyShellCommand("git push origin main | grep -f patterns.txt"),
  ).toBe("execute");
});

test("classifies a recursive/forced delete as destructive regardless of tool spelling", () => {
  expect(classifyShellCommand("rm -rf node_modules")).toBe("destructive");
  expect(classifyShellCommand("Remove-Item -Recurse -Force .\\dist")).toBe(
    "destructive",
  );
  expect(classifyShellCommand("del /s /q build")).toBe("destructive");
  expect(classifyShellCommand("rm package.json")).toBe("execute");
});

test("does not misattribute an unrelated recursive/force flag on a chained command to a delete", () => {
  expect(classifyShellCommand("rm package.json && robocopy src dist /s")).toBe(
    "execute",
  );
  expect(
    classifyShellCommand("del temp.txt; git status --force-with-lease"),
  ).not.toBe("destructive");
  expect(
    classifyShellCommand("rm build.log | tar -czf out.tar.gz -recurse"),
  ).toBe("execute");
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
    tool?: string;
    path?: string;
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
    {
      description: "Read workspace file: note.txt",
      risk: "read",
      tool: "ReadFile",
      path: "note.txt",
    },
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
  const requests: Array<{
    description: string;
    risk: string;
    tool?: string;
    path?: string;
    preview?: string[];
  }> = [];
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
    {
      description: "Create workspace file: created.txt",
      risk: "write",
      tool: "CreateFile",
      path: "created.txt",
      // Approval must never be blind to the actual content — see
      // contentApprovalPreview, tools/workspace.ts.
      preview: ["+ created"],
    },
    {
      description: "Edit workspace file: existing.txt",
      risk: "write",
      tool: "EditFile",
      path: "existing.txt",
      preview: ["- before", "+ after"],
    },
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
    tool?: string;
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
      tool: "Shell",
      command: "git reset --hard HEAD",
    },
  ]);
});

test("an approved destructive shell command reaches execution without weakening network policy", async () => {
  const command = process.platform === "win32" ? "runas /?" : "sudo --version";
  const requests: string[] = [];
  const result = await shellTool.execute(
    { command },
    {
      root: process.cwd(),
      permissionMode: "EDIT",
      signal: new AbortController().signal,
      network: false,
      requestApproval: async (request) => {
        requests.push(request.command ?? "");
        return true;
      },
    },
  );

  expect(requests).toEqual([command]);
  expect(result.exitCode).toBeTypeOf("number");
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
    SHELRACODE_STATE_DIR: "state",
  });

  expect(safe).toEqual({ PATH: "path", SHELRACODE_STATE_DIR: "state" });
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

test("classifies remote Git and common socket clients as network-capable", () => {
  expect(commandRequiresNetwork("git push origin main")).toBe(true);
  expect(commandRequiresNetwork("git ls-remote origin")).toBe(true);
  expect(commandRequiresNetwork("ssh user@example.com")).toBe(true);
  expect(commandRequiresNetwork("bun test")).toBe(false);
});

test("recognizes PowerShell location escapes and absolute shell paths", () => {
  expect(shellCommandEscapesWorkspace("Set-Location -Path ..")).toBe(true);
  expect(shellCommandEscapesWorkspace("Set-Location -Path '..'")).toBe(true);
  expect(shellCommandEscapesWorkspace('cd "../outside"')).toBe(true);
  expect(shellCommandEscapesWorkspace("Push-Location ..")).toBe(true);
  expect(shellCommandEscapesWorkspace('pushd "C:\\outside"')).toBe(true);
  expect(shellCommandEscapesWorkspace("pushd C:\\outside")).toBe(true);
  expect(shellCommandEscapesWorkspace("echo C:\\outside\\secret.txt")).toBe(
    true,
  );
  expect(shellCommandEscapesWorkspace("Set-Location -Path src")).toBe(false);
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
