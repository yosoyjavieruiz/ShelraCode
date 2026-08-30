import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "bun:test";
import {
  buildRepositoryIntelligence,
  type RepositorySymbol,
} from "../../src/context/repository-intelligence.js";
import {
  RepositoryQueryInputError,
  RepositoryQueryService,
} from "../../src/context/repository-queries.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture(): Promise<{
  root: string;
  index: Awaited<ReturnType<typeof buildRepositoryIntelligence>>;
}> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "shelra-repository-queries-"),
  );
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
  return {
    root,
    index: await buildRepositoryIntelligence({
      root,
      files: ["src/parser.ts", "src/service.ts", "tests/parser.test.ts"],
    }),
  };
}

test("normalizes deterministic symbol, relation, dependency, test, and diagnostic queries", async () => {
  const { index } = await fixture();
  const queries = new RepositoryQueryService({ index });

  expect(queries.findSymbol({ name: "parse" })).toMatchObject({
    source: "deterministic",
    degraded: false,
  });
  expect(queries.findSymbol({ name: "parse" }).items).toEqual([
    expect.objectContaining({ path: "src/parser.ts", kind: "function" }),
  ]);

  const definition = await queries.findDefinition({ name: "parse" });
  expect(definition).toMatchObject({
    source: "deterministic",
    degraded: false,
  });
  expect(definition.items[0]).toMatchObject({
    path: "src/parser.ts",
    source: "deterministic",
  });

  const references = await queries.findReferences({
    name: "parse",
    path: "src/parser.ts",
  });
  expect(references.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "src/service.ts", kind: "import" }),
      expect.objectContaining({ path: "tests/parser.test.ts", kind: "import" }),
    ]),
  );

  const callers = await queries.findCallers({
    name: "parse",
    path: "src/parser.ts",
  });
  expect(callers.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "src/service.ts", kind: "usage" }),
      expect.objectContaining({ path: "tests/parser.test.ts", kind: "usage" }),
    ]),
  );

  const dependencies = await queries.findDependencies({
    path: "src/service.ts",
  });
  expect(dependencies.items).toEqual([
    expect.objectContaining({
      direction: "dependency",
      resolvedPath: "src/parser.ts",
      source: "deterministic",
    }),
  ]);

  const dependents = await queries.findDependents({ path: "src/parser.ts" });
  expect(dependents.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: "src/service.ts",
        direction: "dependent",
      }),
      expect.objectContaining({
        path: "tests/parser.test.ts",
        direction: "dependent",
      }),
    ]),
  );

  const relatedTests = await queries.findRelatedTests({
    path: "src/parser.ts",
  });
  expect(relatedTests).toMatchObject({
    source: "deterministic",
    degraded: false,
  });
  expect(relatedTests.items).toEqual([
    expect.objectContaining({
      sourcePath: "src/parser.ts",
      testPath: "tests/parser.test.ts",
      source: "deterministic",
    }),
  ]);

  const implementations = await queries.findImplementations({ name: "parse" });
  expect(implementations).toMatchObject({
    degraded: true,
    source: "deterministic",
  });
  expect(implementations.warning).toMatch(/No language provider/u);

  const diagnostics = await queries.getDiagnostics({ path: "src/parser.ts" });
  expect(diagnostics).toMatchObject({
    degraded: true,
    source: "deterministic",
  });
  expect(diagnostics.items).toEqual([]);
});

test("falls back to deterministic facts when a language provider fails", async () => {
  const { index } = await fixture();
  const service = new RepositoryQueryService({
    index,
    provider: {
      findDefinition: async () => {
        throw new Error("provider secret detail");
      },
    },
  });

  const result = await service.findDefinition({ name: "parse" });
  expect(result).toMatchObject({
    source: "deterministic",
    degraded: true,
  });
  expect(result.warning).toContain("deterministic repository facts");
  expect(result.warning).not.toContain("secret detail");
  expect(result.items[0]).toMatchObject({
    path: "src/parser.ts",
    source: "deterministic",
  });
});

test("marks successful provider results without leaking provider-specific shapes", async () => {
  const { index } = await fixture();
  const symbol = index.symbols.find(
    (candidate) => candidate.name === "parse",
  ) as RepositorySymbol;
  const service = new RepositoryQueryService({
    index,
    provider: {
      findDefinition: async () => [
        {
          ...symbol,
          providerSecret: "must not cross boundary",
        } as RepositorySymbol,
      ],
      getDiagnostics: async () => [
        {
          path: "src/parser.ts",
          line: 2,
          severity: "warning" as const,
          message: "unused parameter",
        },
      ],
    },
  });
  const result = await service.findDefinition({ name: "parse" });

  expect(result).toMatchObject({
    source: "language-provider",
    degraded: false,
  });
  expect(result.items[0]).toMatchObject({
    path: "src/parser.ts",
    source: "language-provider",
  });
  expect(JSON.stringify(result)).not.toContain("providerSecret");

  const diagnostics = await service.getDiagnostics({ path: "src/parser.ts" });
  expect(diagnostics).toMatchObject({
    source: "language-provider",
    degraded: false,
  });
  expect(diagnostics.items[0]).toEqual({
    path: "src/parser.ts",
    line: 2,
    severity: "warning",
    message: "unused parameter",
    source: "language-provider",
  });
});

test("rejects malformed provider facts without leaking their shape", async () => {
  const { index } = await fixture();
  const result = await new RepositoryQueryService({
    index,
    provider: {
      findDefinition: async () => [
        {
          name: "parse",
          path: "../outside.ts",
          line: 1,
          kind: "function",
          exported: true,
          providerSecret: "must not appear",
        } as unknown as RepositorySymbol,
      ],
    },
  }).findDefinition({ name: "parse" });

  expect(result).toMatchObject({
    source: "deterministic",
    degraded: true,
  });
  expect(result.warning).toBe(
    "Language provider failed for findDefinition; deterministic repository facts were used.",
  );
  expect(result.warning).not.toContain("outside");
  expect(JSON.stringify(result)).not.toContain("providerSecret");
  expect(result.items[0]).toMatchObject({
    path: "src/parser.ts",
    source: "deterministic",
  });
});

test("composes service and per-call cancellation, including ordinary provider errors", async () => {
  const { index } = await fixture();
  const serviceController = new AbortController();
  const perCallController = new AbortController();
  const service = new RepositoryQueryService({
    index,
    signal: serviceController.signal,
    provider: {
      findDefinition: async () => {
        serviceController.abort();
        throw new Error("ordinary provider failure");
      },
    },
  });
  await expect(
    service.findDefinition({ name: "parse" }, perCallController.signal),
  ).rejects.toThrow(/aborted/u);

  const alreadyAborted = new AbortController();
  alreadyAborted.abort();
  const fresh = new AbortController();
  await expect(
    new RepositoryQueryService({
      index,
      signal: alreadyAborted.signal,
    }).findDefinition({ name: "parse" }, fresh.signal),
  ).rejects.toThrow(/aborted/u);
});

test("enforces positive integer index limits and reports truncation by fact type", async () => {
  const { root } = await fixture();
  await writeFile(
    path.join(root, "src", "many.ts"),
    "export function first(): void {}\nexport function second(): void {}\n",
  );
  const limited = await buildRepositoryIntelligence({
    root,
    files: ["src/many.ts"],
    maxSymbols: 1,
  });
  expect(limited.symbols).toHaveLength(1);
  expect(limited.truncated).toBe(true);

  const referenceLimited = await buildRepositoryIntelligence({
    root,
    files: ["src/parser.ts", "src/service.ts"],
    maxReferences: 1,
  });
  expect(referenceLimited.references).toHaveLength(1);
  expect(referenceLimited.truncated).toBe(true);

  for (const field of [
    "maxFiles",
    "maxSymbols",
    "maxImports",
    "maxReferences",
  ] as const) {
    await expect(
      buildRepositoryIntelligence({
        root,
        files: ["src/many.ts"],
        [field]: 1.5,
      }),
    ).rejects.toThrow(new RegExp(`${field} must be a positive integer`, "u"));
  }
});

test("does not index a symlink that resolves outside the workspace", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "shelra-repository-symlink-"),
  );
  const outside = await mkdtemp(
    path.join(os.tmpdir(), "shelra-repository-outside-"),
  );
  roots.push(root, outside);
  await mkdir(path.join(root, "src"), { recursive: true });
  const outsideFile = path.join(outside, "secret.ts");
  await writeFile(outsideFile, "export function secret(): void {}\n");
  try {
    await symlink(outsideFile, path.join(root, "src", "linked.ts"), "file");
  } catch {
    // Symlink creation can be unavailable on restricted Windows hosts.
    return;
  }
  const index = await buildRepositoryIntelligence({
    root,
    files: ["src/linked.ts"],
  });
  expect(index.indexedFiles).toEqual([]);
  expect(index.symbols).toEqual([]);
});

test("rejects unsafe or unbounded query inputs and preserves cancellation", async () => {
  const { index } = await fixture();
  const service = new RepositoryQueryService({ index });

  expect(() => service.findSymbol({ name: "" })).toThrow(
    RepositoryQueryInputError,
  );
  expect(() => service.findDependencies({ path: "../outside" })).toThrow(
    /safe repository path/u,
  );
  expect(() =>
    service.findSymbol({ name: "parse", path: "src/file.ts:stream" }),
  ).toThrow(/safe repository path/u);
  expect(() =>
    service.findSymbol({ name: "parse", path: "src/\u0000secret.ts" }),
  ).toThrow(/safe repository path/u);
  expect(() => service.findSymbol({ name: "parse", maxResults: 257 })).toThrow(
    /maxResults/u,
  );

  const controller = new AbortController();
  controller.abort();
  await expect(
    service.findDefinition({ name: "parse" }, controller.signal),
  ).rejects.toThrow(/aborted/u);
});
