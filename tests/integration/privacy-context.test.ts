import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildRepositoryContext } from "../../src/context/repository.js";
import { createLogger, type LogRecord } from "../../src/shared/logging.js";

describe("privacy-aware repository context", () => {
  test("excludes never-remote paths and redacts high-confidence secrets", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "localcode-privacy-"));
    await mkdir(path.join(root, "private"));
    await mkdir(path.join(root, "src"));
    await writeFile(
      path.join(root, ".env"),
      "API_KEY='sk-super-secret-value-123456789'\n",
      "utf8",
    );
    await writeFile(
      path.join(root, "private", "customer.ts"),
      "const password = 'customer-password-value';\n",
      "utf8",
    );
    await writeFile(
      path.join(root, "src", "public.ts"),
      "export const answer = 42;\n",
      "utf8",
    );

    const context = await buildRepositoryContext({
      root,
      objective: "explain public answer",
    });

    expect(context.containsHighConfidenceSecret).toBe(true);
    expect(context.secretPaths).toContain(".env");
    expect(context.prompt).not.toContain("sk-super-secret-value-123456789");
    expect(context.prompt).not.toContain("customer-password-value");
    expect(context.prompt).toContain("public.ts");
    expect(context.prompt).toContain("Host-detected repository facts");
    expect(context.prompt).toContain("- Languages: TypeScript");
  });
});

test("loads scoped project instructions without preloading skill content", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-instructions-context-"),
  );
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, ".agents", "skills", "secret-skill"), {
    recursive: true,
  });
  await writeFile(
    path.join(root, "AGENTS.md"),
    "Always run focused tests.\n",
    "utf8",
  );
  await writeFile(
    path.join(root, "src", "AGENTS.md"),
    "Keep exports stable.\n",
    "utf8",
  );
  await writeFile(
    path.join(root, "src", "auth.ts"),
    "export const auth = true;\n",
    "utf8",
  );
  await writeFile(
    path.join(root, ".agents", "skills", "secret-skill", "SKILL.md"),
    "DO NOT PRELOAD THIS SKILL\n",
    "utf8",
  );

  const context = await buildRepositoryContext({
    root,
    objective: "Explain auth",
  });

  expect(context.prompt).toContain("Always run focused tests");
  expect(context.prompt).toContain("Keep exports stable");
  expect(context.prompt).not.toContain("DO NOT PRELOAD THIS SKILL");
  expect(context.instructions).toEqual(["AGENTS.md", "src/AGENTS.md"]);
});

test("keeps direct language questions focused on host facts and root manifests", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-language-context-"),
  );
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "src", "providers"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    '{"name":"fixture","scripts":{"test":"bun test"}}\n',
    "utf8",
  );
  await writeFile(
    path.join(root, "bun.lock"),
    "unrelated dependency lock details\n",
    "utf8",
  );
  await writeFile(
    path.join(root, "tsconfig.json"),
    '{"compilerOptions":{"strict":true}}\n',
    "utf8",
  );
  await writeFile(
    path.join(root, "AGENTS.md"),
    "Use the full engineering workflow.\n",
    "utf8",
  );
  await writeFile(
    path.join(root, "src", "providers", "AGENTS.md"),
    "Provider implementation details are not relevant to this fact.\n",
    "utf8",
  );
  await writeFile(
    path.join(root, "src", "index.ts"),
    "export const answer = 42;\n",
    "utf8",
  );

  const context = await buildRepositoryContext({
    root,
    objective: "What programming language is this project written in?",
  });

  expect(context.prompt).toContain("Host-detected repository facts");
  expect(context.prompt).toContain("- Languages: TypeScript");
  expect(context.prompt).toContain("### package.json");
  expect(context.prompt).toContain("### tsconfig.json");
  expect(context.prompt).not.toContain("unrelated dependency lock details");
  expect(context.prompt).not.toContain("Use the full engineering workflow.");
  expect(context.prompt).not.toContain("Provider implementation details");
  expect(context.instructions).toEqual([]);
  expect(context.files).toEqual(
    expect.arrayContaining(["package.json", "tsconfig.json"]),
  );
});

test("context logs discovery counters without repository content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-context-logs-"));
  await writeFile(
    path.join(root, "package.json"),
    '{"name":"logged"}\n',
    "utf8",
  );
  await writeFile(
    path.join(root, "src.ts"),
    "export const privateValue = 'do-not-log-this-content';\n",
    "utf8",
  );
  const records: LogRecord[] = [];
  const logger = createLogger({
    level: "debug",
    sink: { write: (record) => records.push(record) },
  });

  await buildRepositoryContext({
    root,
    objective: "explain the project",
    logger,
  });

  const rendered = JSON.stringify(records);
  expect(records.map((record) => record.event)).toContain(
    "context.discovery.started",
  );
  expect(records.map((record) => record.event)).toContain(
    "context.discovery.finished",
  );
  expect(rendered).not.toContain("do-not-log-this-content");
});
