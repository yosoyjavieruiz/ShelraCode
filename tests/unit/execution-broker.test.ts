import { expect, test } from "bun:test";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { CheckpointService } from "../../src/checkpoint/checkpoint.js";
import { ExecutionBroker } from "../../src/security/execution-broker.js";
import { ToolError } from "../../src/tools/errors.js";
import { LocalCodeDatabase } from "../../src/storage/database.js";
import {
  globFilesTool,
  listFilesTool,
  readFileTool,
  searchTextTool,
  shellTool,
  writeFileTool,
} from "../../src/tools/workspace.js";

async function workspace(prefix: string): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

test("ExecutionBroker keeps command cwd and file paths inside the workspace", async () => {
  const root = await workspace("shelra-broker-boundary-");
  const outside = await workspace("shelra-broker-outside-");
  const broker = new ExecutionBroker({ root, networkMode: "strict-zero" });

  await expect(broker.resolvePath("../outside.txt")).rejects.toMatchObject({
    code: "OUTSIDE_WORKSPACE",
  });
  await expect(
    broker.runCommand(process.execPath, ["--version"], {
      intent: "read",
      cwd: outside,
    }),
  ).rejects.toMatchObject({ code: "OUTSIDE_WORKSPACE" });
});

test("ExecutionBroker rejects symlink escapes before a write", async () => {
  const root = await workspace("shelra-broker-symlink-");
  const outside = await workspace("shelra-broker-symlink-outside-");
  await symlink(outside, path.join(root, "linked"), "junction");
  const broker = new ExecutionBroker({ root, networkMode: "strict-zero" });

  await expect(
    broker.writeFile("linked/secret.txt", "must not write"),
  ).rejects.toMatchObject({
    code: "OUTSIDE_WORKSPACE",
  });
});

test("strict-zero blocks network-capable process text before spawning", async () => {
  const root = await workspace("shelra-broker-network-");
  const broker = new ExecutionBroker({ root, networkMode: "strict-zero" });

  await expect(
    broker.runShellCommand("node -e \"fetch('https://example.com')\"", {
      intent: "execute",
    }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
});

test("strict-zero blocks dynamic runtime network APIs before spawning", async () => {
  const root = await workspace("shelra-broker-runtime-network-");
  const broker = new ExecutionBroker({ root, networkMode: "strict-zero" });

  await expect(
    broker.runShellCommand(
      `node -e "require('node:net').connect(443, 'example.com')"`,
      { intent: "execute" },
    ),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
});

test("strict-zero blocks unmeasured runtime scripts without OS network isolation", async () => {
  const root = await workspace("shelra-broker-runtime-script-");
  const broker = new ExecutionBroker({ root, networkMode: "strict-zero" });

  await expect(
    broker.runShellCommand("node network-script.js", { intent: "execute" }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
});

test("model-facing strict-zero broker rejects arbitrary processes without an OS adapter", async () => {
  const root = await workspace("shelra-broker-process-allowlist-");
  const broker = new ExecutionBroker({
    root,
    networkMode: "strict-zero",
    allowUnverifiedProcesses: false,
  });

  await expect(
    broker.runShellCommand("custom-local-tool --inspect", {
      intent: "execute",
    }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
});

test("model-facing strict-zero allowlist rejects shell chaining", async () => {
  const root = await workspace("shelra-broker-process-chain-");
  const broker = new ExecutionBroker({
    root,
    networkMode: "strict-zero",
    allowUnverifiedProcesses: false,
  });

  await expect(
    broker.runShellCommand("rg --files; whoami", { intent: "execute" }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
});

test("strict-zero blocks remote Git operations before spawning", async () => {
  const root = await workspace("shelra-broker-git-network-");
  const broker = new ExecutionBroker({ root, networkMode: "strict-zero" });

  await expect(
    broker.runShellCommand("git push origin main", { intent: "execute" }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
});

test("broker rejects an absolute shell executable path", async () => {
  const root = await workspace("shelra-broker-absolute-shell-");
  const broker = new ExecutionBroker({ root, networkMode: "strict-zero" });

  await expect(
    broker.runShellCommand("C:\\outside\\tool.exe", { intent: "execute" }),
  ).rejects.toMatchObject({ code: "OUTSIDE_WORKSPACE" });
});

test("process observations and live output are redacted before they cross the broker", async () => {
  const root = await workspace("shelra-broker-redaction-");
  const broker = new ExecutionBroker({ root, networkMode: "strict-zero" });
  const chunks: string[] = [];
  const result = await broker.runCommand(
    process.execPath,
    [
      "-e",
      "process.stdout.write('Authorization: Bearer super-secret-token-123')",
    ],
    {
      intent: "read",
      onOutput: (chunk) => chunks.push(chunk.text),
    },
  );

  expect(result.stdout).not.toContain("super-secret-token-123");
  expect(chunks.join("")).not.toContain("super-secret-token-123");
  expect(result.stdout).toContain("REDACTED");
});

test("broker writes require a checkpoint baseline and preserve stale-edit checks", async () => {
  const root = await workspace("shelra-broker-checkpoint-");
  await writeFile(path.join(root, "value.txt"), "before\n", "utf8");
  const database = new LocalCodeDatabase(":memory:");
  const checkpoint = new CheckpointService(database, root);
  const checkpointId = await checkpoint.create("task-broker", ["value.txt"]);
  const broker = new ExecutionBroker({ root, networkMode: "strict-zero" });

  await expect(broker.writeFile("value.txt", "after\n")).rejects.toMatchObject({
    code: "CONFLICT",
  });
  await broker.writeFile("value.txt", "after\n", {
    checkpoint,
    checkpointId,
  });
  expect(await Bun.file(path.join(root, "value.txt")).text()).toBe("after\n");
  database.close();
});

test("an unmeasured model broker cannot write even with a valid workspace path", async () => {
  const root = await workspace("shelra-broker-unmeasured-");
  const broker = new ExecutionBroker({
    root,
    networkMode: "strict-zero",
    writeAuthority: "none",
  });

  await expect(broker.writeFile("new.txt", "blocked\n")).rejects.toMatchObject({
    code: "PERMISSION_DENIED",
  });
});

test("model-facing tools default to no write authority without a certified profile", async () => {
  const root = await workspace("shelra-broker-model-authority-");

  await expect(
    readFileTool.execute(
      { path: "missing.txt" },
      {
        root,
        permissionMode: "EDIT",
        signal: new AbortController().signal,
        network: false,
        modelAuthority: "model",
      },
    ),
  ).rejects.toMatchObject({ code: "PATH_NOT_FOUND" });

  await expect(
    writeFileTool.execute(
      { path: "new.txt", content: "blocked\n" },
      {
        root,
        permissionMode: "EDIT",
        signal: new AbortController().signal,
        network: false,
        modelAuthority: "model",
      },
    ),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
});

test("protected-path observations are fully redacted", async () => {
  const root = await workspace("shelra-broker-protected-");
  await writeFile(path.join(root, ".env"), "TOKEN=secret-value\n", "utf8");
  const broker = new ExecutionBroker({ root, networkMode: "strict-zero" });

  expect(broker.redactText("TOKEN=secret-value", { protectedPath: true })).toBe(
    "[REDACTED: protected path]",
  );
  await expect(broker.resolvePath(".env")).resolves.toBe(
    path.join(root, ".env"),
  );
});

test("ReadFile redacts a protected target reached through an in-workspace junction", async () => {
  const root = await workspace("shelra-broker-junction-secret-");
  await mkdir(path.join(root, "secrets"), { recursive: true });
  await writeFile(
    path.join(root, "secrets", "opaque.txt"),
    "opaque-value-not-patterned\n",
    "utf8",
  );
  await symlink(
    path.join(root, "secrets"),
    path.join(root, "public"),
    "junction",
  );
  const read = await readFileTool.execute(
    { path: "public/opaque.txt" },
    {
      root,
      permissionMode: "PLAN",
      signal: new AbortController().signal,
      network: false,
    },
  );

  expect(read.content).toBe("[REDACTED: protected path]");
  expect(read.sensitivePath).toBe(true);
});

test("SearchText does not expose opaque content through a protected junction alias", async () => {
  const root = await workspace("shelra-broker-junction-search-");
  await mkdir(path.join(root, "secrets"), { recursive: true });
  await writeFile(
    path.join(root, "secrets", "opaque.txt"),
    "opaque-search-value\n",
    "utf8",
  );
  await symlink(
    path.join(root, "secrets"),
    path.join(root, "public"),
    "junction",
  );

  const result = await searchTextTool.execute(
    { query: "opaque-search-value" },
    {
      root,
      permissionMode: "PLAN",
      signal: new AbortController().signal,
      network: false,
    },
  );

  expect(result.matches).toEqual([]);
});

test("ListFiles and GlobFiles hide protected junction aliases", async () => {
  const root = await workspace("shelra-broker-junction-list-");
  await mkdir(path.join(root, "secrets"), { recursive: true });
  await writeFile(path.join(root, ".env"), "TOKEN=opaque\n", "utf8");
  await writeFile(path.join(root, "secrets", "opaque.txt"), "opaque\n", "utf8");
  await symlink(
    path.join(root, "secrets"),
    path.join(root, "public"),
    "junction",
  );

  const context = {
    root,
    permissionMode: "PLAN" as const,
    signal: new AbortController().signal,
    network: false,
  };
  const listed = await listFilesTool.execute(
    listFilesTool.validate(undefined),
    context,
  );
  const globbed = await globFilesTool.execute(
    globFilesTool.validate({ pattern: "public/**" }),
    context,
  );

  expect(listed.files).not.toContain(".env");
  expect(listed.files).not.toContain("secrets/opaque.txt");
  expect(listed.files).not.toContain("public/opaque.txt");
  expect(globbed.files).not.toContain("secrets/opaque.txt");
  expect(globbed.files).not.toContain("public/opaque.txt");
});

test("workspace tools cannot downgrade a strict-zero broker or leak a protected read", async () => {
  const root = await workspace("shelra-broker-tool-boundary-");
  await writeFile(path.join(root, ".env"), "TOKEN=secret-value\n", "utf8");
  const broker = new ExecutionBroker({ root, networkMode: "strict-zero" });

  const read = await readFileTool.execute(
    { path: ".env" },
    {
      root,
      permissionMode: "PLAN",
      signal: new AbortController().signal,
      network: true,
      executionBroker: broker,
    },
  );
  expect(read.content).toBe("[REDACTED: protected path]");

  await expect(
    shellTool.execute(
      { command: "node -e \"fetch('https://example.com')\"" },
      {
        root,
        permissionMode: "EDIT",
        signal: new AbortController().signal,
        network: false,
        executionBroker: new ExecutionBroker({
          root,
          networkMode: "allow",
        }),
      },
    ),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
});

test("broker denial errors remain typed host failures", async () => {
  const root = await workspace("shelra-broker-typed-");
  const broker = new ExecutionBroker({ root, networkMode: "strict-zero" });
  try {
    await broker.resolvePath("../../escape");
    throw new Error("expected boundary denial");
  } catch (error) {
    expect(error).toBeInstanceOf(ToolError);
    expect((error as ToolError).recoverable).toBe(false);
  }
});

test("the strict-zero allowlist now agrees with permissions.ts's safe-read classification", async () => {
  const root = await workspace("shelra-broker-allowlist-parity-");
  await writeFile(path.join(root, "value.txt"), "hello\n", "utf8");
  const broker = new ExecutionBroker({
    root,
    networkMode: "strict-zero",
    allowUnverifiedProcesses: false,
  });

  // Previously rejected by the broker's own narrower spawn allowlist
  // (PERMISSION_DENIED, "not in the strict-zero local allowlist") even
  // though src/tools/permissions.ts already classified it as safe-read.
  // Whether the underlying shell can actually resolve "type" as a command
  // is a separate concern from the allowlist gate this test verifies.
  const result = await broker.runShellCommand("type value.txt", {
    intent: "read",
  });
  expect(typeof result.exitCode).toBe("number");
});

test("runCommand rejects a traversal segment embedded mid-argument, not only a leading one", async () => {
  const root = await workspace("shelra-broker-mid-traversal-");
  const broker = new ExecutionBroker({ root, networkMode: "strict-zero" });

  await expect(
    broker.runCommand("rg", ["sub/../../secret.txt"], { intent: "read" }),
  ).rejects.toMatchObject({ code: "OUTSIDE_WORKSPACE" });
});

test("the broker rejects a destructive command even when network is allowed", async () => {
  const root = await workspace("shelra-broker-destructive-allow-");
  const broker = new ExecutionBroker({ root, networkMode: "allow" });

  await expect(
    broker.runShellCommand("git reset --hard HEAD~1", { intent: "execute" }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
});

test("strict-zero allows the project's configured non-Bun test command verbatim", async () => {
  const root = await workspace("shelra-broker-test-command-");
  const broker = new ExecutionBroker({
    root,
    networkMode: "strict-zero",
    allowUnverifiedProcesses: false,
    defaultTestCommand: "npm test",
  });

  await expect(
    broker.runShellCommand("npm test", { intent: "test" }),
  ).resolves.toMatchObject({ exitCode: expect.any(Number) });

  // An arbitrary command that just happens to differ from the configured
  // one must still be rejected -- this isn't a general npm allowlist.
  await expect(
    broker.runShellCommand("npm run malicious-script", { intent: "execute" }),
  ).rejects.toMatchObject({ code: "PERMISSION_DENIED" });
});

test("redactText redacts a private key even when the END marker hasn't arrived yet", async () => {
  const root = await workspace("shelra-broker-chunk-redact-");
  const broker = new ExecutionBroker({ root, networkMode: "strict-zero" });

  // Simulates one live-output chunk from the ~150ms process output batcher
  // (src/shared/process.ts) landing between the BEGIN line and the rest of
  // a streamed private key -- the END marker hasn't been written/flushed
  // yet, so this chunk in isolation has no complete BEGIN...END pair.
  const splitChunk =
    "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEA";

  const result = broker.redactText(splitChunk);

  expect(result).not.toContain("MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEA");
  expect(result).toContain("REDACTED");
});
