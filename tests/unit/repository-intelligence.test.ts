import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "bun:test";
import {
  buildRepositoryIntelligence,
  selectRelatedRepositoryEvidence,
} from "../../src/context/repository-intelligence.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

test("indexes TypeScript symbols, relative imports, references, and related tests", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-intelligence-"));
  roots.push(root);
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "tests"), { recursive: true });
  await writeFile(
    path.join(root, "src", "parser.ts"),
    "export interface Token { value: string }\nexport function parse(input: string): Token { return { value: input }; }\n",
  );
  await writeFile(
    path.join(root, "src", "service.ts"),
    'import { parse } from "./parser";\nexport const parseRequest = (input: string) => parse(input);\n',
  );
  await writeFile(
    path.join(root, "tests", "parser.test.ts"),
    'import { parse } from "../src/parser";\ntest("parse", () => parse("ok"));\n',
  );
  await writeFile(
    path.join(root, "src", "unrelated.ts"),
    "export function renderDashboard() { return true; }\n",
  );

  const index = await buildRepositoryIntelligence({
    root,
    files: [
      "src/parser.ts",
      "src/service.ts",
      "tests/parser.test.ts",
      "src/unrelated.ts",
    ],
  });

  expect(index.symbols).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "parse",
        path: "src/parser.ts",
        kind: "function",
        exported: true,
      }),
      expect.objectContaining({
        name: "Token",
        path: "src/parser.ts",
        kind: "interface",
        exported: true,
      }),
    ]),
  );
  expect(index.imports).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: "src/service.ts",
        source: "./parser",
        resolvedPath: "src/parser.ts",
      }),
    ]),
  );
  expect(index.references).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "parse",
        path: "src/service.ts",
        targetPath: "src/parser.ts",
        kind: "import",
      }),
    ]),
  );
  expect(index.relatedTests).toContainEqual(
    expect.objectContaining({
      sourcePath: "src/parser.ts",
      testPath: "tests/parser.test.ts",
    }),
  );
});

test("ranks explicit files, structural neighbors, and related tests before unrelated files", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-intelligence-rank-"),
  );
  roots.push(root);
  await mkdir(path.join(root, "src"), { recursive: true });
  await mkdir(path.join(root, "tests"), { recursive: true });
  await writeFile(
    path.join(root, "src", "parser.ts"),
    "export function parse() { return true; }\n",
  );
  await writeFile(
    path.join(root, "src", "service.ts"),
    'import { parse } from "./parser"; export const run = () => parse();\n',
  );
  await writeFile(
    path.join(root, "tests", "parser.test.ts"),
    "test('parse', () => true);\n",
  );
  await writeFile(
    path.join(root, "src", "unrelated.ts"),
    "export function parseDashboard() { return false; }\n",
  );

  const index = await buildRepositoryIntelligence({
    root,
    files: [
      "src/parser.ts",
      "src/service.ts",
      "tests/parser.test.ts",
      "src/unrelated.ts",
    ],
  });
  const selection = selectRelatedRepositoryEvidence(
    index,
    "Fix the parser service",
    ["src/parser.ts"],
  );

  expect(selection.files.slice(0, 3)).toEqual([
    "src/parser.ts",
    "src/service.ts",
    "tests/parser.test.ts",
  ]);
  expect(selection.files).not.toContain("src/unrelated.ts");
  expect(selection.sourceIds).toEqual(
    expect.arrayContaining([
      "src/parser.ts",
      "src/service.ts",
      "tests/parser.test.ts",
    ]),
  );
});

test("extracts Python and Go declarations without executing repository code", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-intelligence-languages-"),
  );
  roots.push(root);
  await mkdir(path.join(root, "pkg"), { recursive: true });
  await writeFile(
    path.join(root, "pkg", "auth.py"),
    "class Session:\n    pass\n\ndef refresh_token(value):\n    return value\n",
  );
  await writeFile(
    path.join(root, "pkg", "auth.go"),
    "package auth\n\ntype Token struct{}\nfunc Refresh(value string) string { return value }\n",
  );

  const index = await buildRepositoryIntelligence({
    root,
    files: ["pkg/auth.py", "pkg/auth.go"],
  });

  expect(index.symbols).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        name: "Session",
        path: "pkg/auth.py",
        kind: "class",
      }),
      expect.objectContaining({
        name: "refresh_token",
        path: "pkg/auth.py",
        kind: "function",
      }),
      expect.objectContaining({
        name: "Token",
        path: "pkg/auth.go",
        kind: "type",
      }),
      expect.objectContaining({
        name: "Refresh",
        path: "pkg/auth.go",
        kind: "function",
      }),
    ]),
  );
});
