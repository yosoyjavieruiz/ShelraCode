import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "bun:test";
import { buildRepositoryContext } from "../../src/context/repository.js";
import { runCommand } from "../../src/shared/process.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

test("context discovery promotes source files matching the objective text", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-context-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "context-fixture", scripts: { test: "bun test" } }),
  );
  await writeFile(
    path.join(root, "src", "session.ts"),
    'export function refreshTokenLifecycle() { return "refresh token lifecycle"; }\n',
  );
  await writeFile(
    path.join(root, "src", "unrelated.ts"),
    'export function renderLandingPage() { return "landing"; }\n',
  );

  const context = await buildRepositoryContext({
    root,
    objective: "Fix the authentication refresh token lifecycle.",
    maxChars: 12_000,
  });

  expect(context.files.map((file) => file.replaceAll("\\", "/"))).toContain(
    "src/session.ts",
  );
  expect(context.prompt).toContain("Objective search matches");
  expect(context.prompt).toContain("src/session.ts");
  expect(context.prompt).toContain("refreshTokenLifecycle");
});

test("context includes bounded structural evidence for the objective neighborhood", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-context-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "tests"), { recursive: true });
  await writeFile(
    path.join(root, "src", "parser.ts"),
    "export function parse(input: string) { return input; }\n",
  );
  await writeFile(
    path.join(root, "src", "service.ts"),
    'import { parse } from "./parser";\nexport function handle(input: string) { return parse(input); }\n',
  );
  await writeFile(
    path.join(root, "tests", "parser.test.ts"),
    'import { parse } from "../src/parser";\ntest("parse", () => parse("ok"));\n',
  );

  const context = await buildRepositoryContext({
    root,
    objective: "Fix the parser service",
    maxChars: 16_000,
  });

  expect(context.intelligence?.symbols).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ name: "parse", path: "src/parser.ts" }),
    ]),
  );
  expect(context.intelligenceSources).toEqual(
    expect.arrayContaining([
      "src/parser.ts",
      "src/service.ts",
      "tests/parser.test.ts",
    ]),
  );
  expect(context.prompt).toContain("Repository structural intelligence");
  expect(context.prompt).toContain(
    "src/service.ts:1 ./parser -> src/parser.ts",
  );
  expect(context.prompt).toContain("Related tests:");
});

test("context relevance does not promote ignored credential paths", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-context-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(
    path.join(root, ".env"),
    "AUTHENTICATION_REFRESH_TOKEN=do-not-load\n",
  );
  await writeFile(
    path.join(root, "src", "auth.ts"),
    "export function authenticate() { return true; }\n",
  );

  const context = await buildRepositoryContext({
    root,
    objective: "Inspect authentication refresh token handling.",
    maxChars: 12_000,
  });

  const normalizedFiles = context.files.map((file) =>
    file.replaceAll("\\", "/"),
  );
  expect(normalizedFiles).toContain("src/auth.ts");
  expect(normalizedFiles).not.toContain(".env");
  expect(context.prompt).not.toContain("do-not-load");
  expect(context.secretPaths).toContain(".env");
});

test("context marks coding discovery insufficient when no objective evidence matches", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-context-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "context-fixture" }),
  );
  await writeFile(
    path.join(root, "src", "known.ts"),
    "export const known = true;\n",
  );

  const context = await buildRepositoryContext({
    root,
    objective: "Fix the nonexistent quantum teleportation subsystem.",
    maxChars: 12_000,
  });

  expect(context.relevantMatches).toEqual([]);
  expect(context.evidenceState).toBe("INSUFFICIENT");
});

test("direct repository language facts are sufficient when manifests or language evidence exist", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-context-"));
  temporaryRoots.push(root);
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "language-fixture" }),
  );
  await writeFile(path.join(root, "index.ts"), "export const value = 1;\n");

  const context = await buildRepositoryContext({
    root,
    objective: "What programming language is this project using?",
    maxChars: 12_000,
  });

  expect(context.evidenceState).toBe("SUFFICIENT");
  expect(
    context.snapshot?.manifests.map((manifest) => manifest.path),
  ).toContain("package.json");
});

test("repository state does not treat ShelraCode runtime state as project content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-context-"));
  temporaryRoots.push(root);
  await mkdir(path.join(root, ".localcode"), { recursive: true });
  await mkdir(path.join(root, ".shelracode"), { recursive: true });
  await writeFile(
    path.join(root, ".localcode", "config.json"),
    JSON.stringify({ setup: true }),
  );
  await writeFile(
    path.join(root, ".shelracode", "config.json"),
    JSON.stringify({ setup: true }),
  );
  await writeFile(path.join(root, "agent.jsonl"), '{"event":"runtime"}\n');
  const git = await runCommand("git", ["init", "--quiet"], {
    intent: "execute",
    cwd: root,
  });
  expect(git.exitCode).toBe(0);

  const context = await buildRepositoryContext({
    root,
    objective: "Create a new application from scratch.",
    maxChars: 12_000,
  });

  expect(context.files).toEqual([]);
  expect(context.snapshot?.topLevelEntries).toEqual([
    ".git",
    ".localcode",
    ".shelracode",
    "agent.jsonl",
  ]);
  expect(context.evidenceState).toBe("INSUFFICIENT");
});
