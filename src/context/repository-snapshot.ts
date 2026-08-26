import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../shared/process.js";
import type { LocalCodeLogger } from "../shared/logging.js";
import { memoryFactId, type MemoryFact } from "../shared/memory.js";

export interface ProjectManifest {
  path: string;
  kind: string;
  scripts: string[];
}

export interface LanguageEvidence {
  language: string;
  extensions: string[];
  files: number;
}

export interface InstructionFile {
  path: string;
  scope: string;
}

export interface RepositorySnapshot {
  cwd: string;
  gitRoot?: string;
  revision?: string;
  branch?: string;
  topLevelEntries: string[];
  manifests: ProjectManifest[];
  languages: LanguageEvidence[];
  sourceRoots: string[];
  testRoots: string[];
  buildFiles: string[];
  instructionFiles: InstructionFile[];
  gitStatus?: string;
}

/**
 * Convert deterministic repository observations into bounded semantic memory.
 * The facts are retrieval hints only: callers must still use the current
 * snapshot and required file reads as authoritative evidence.
 */
export function repositorySnapshotMemoryFacts(
  snapshot: RepositorySnapshot,
  repository = snapshot.gitRoot ?? snapshot.cwd,
  now = new Date().toISOString(),
): MemoryFact[] {
  const revision = snapshot.revision;
  const evidence = (sources: readonly string[]) =>
    sources.slice(0, 12).map((source) => ({
      source,
      ...(revision ? { revision } : {}),
    }));
  const facts: MemoryFact[] = [];
  const manifestSources = snapshot.manifests.map((manifest) => manifest.path);
  const languageNames = snapshot.languages.map((language) => language.language);

  if (languageNames.length > 0 || manifestSources.length > 0) {
    facts.push({
      id: memoryFactId(repository, "semantic", "project-languages"),
      repository,
      kind: "semantic",
      fact: `The repository uses ${languageNames.join(", ") || "an undetermined language"}; manifests: ${manifestSources.join(", ") || "none detected"}.`,
      evidence: evidence(
        manifestSources.length > 0
          ? manifestSources
          : ["source-extension-scan"],
      ),
      provenance: "observed",
      confidence: manifestSources.length > 0 ? 0.95 : 0.8,
      scope: ["repository", "language"],
      tags: [
        "language",
        ...languageNames.map((language) => language.toLowerCase()),
      ],
      createdAt: now,
      lastValidatedAt: now,
    });
  }

  if (snapshot.sourceRoots.length > 0 || snapshot.testRoots.length > 0) {
    facts.push({
      id: memoryFactId(repository, "semantic", "project-layout"),
      repository,
      kind: "semantic",
      fact: `Source roots: ${snapshot.sourceRoots.join(", ") || "none detected"}; test roots: ${snapshot.testRoots.join(", ") || "none detected"}.`,
      evidence: evidence([...snapshot.sourceRoots, ...snapshot.testRoots]),
      provenance: "observed",
      confidence: 0.9,
      scope: ["repository", "layout"],
      tags: ["source", "tests"],
      createdAt: now,
      lastValidatedAt: now,
    });
  }

  const commandSources = snapshot.manifests.filter(
    (manifest) => manifest.scripts.length > 0,
  );
  if (commandSources.length > 0) {
    facts.push({
      id: memoryFactId(repository, "semantic", "project-commands"),
      repository,
      kind: "semantic",
      fact: `Project command scripts are available in ${commandSources.map((manifest) => `${manifest.path}: ${manifest.scripts.join(", ")}`).join("; ")}.`,
      evidence: evidence(commandSources.map((manifest) => manifest.path)),
      provenance: "observed",
      confidence: 0.9,
      scope: ["repository", "commands"],
      tags: ["commands", "verification"],
      createdAt: now,
      lastValidatedAt: now,
    });
  }

  return facts;
}

const manifestKinds: Record<string, string> = {
  "package.json": "JavaScript/TypeScript package",
  "tsconfig.json": "TypeScript compiler",
  "bun.lock": "Bun lockfile",
  "pnpm-lock.yaml": "pnpm lockfile",
  "package-lock.json": "npm lockfile",
  "pyproject.toml": "Python project",
  "requirements.txt": "Python requirements",
  "Cargo.toml": "Rust package",
  "go.mod": "Go module",
  "pom.xml": "Maven project",
  "build.gradle": "Gradle project",
  "CMakeLists.txt": "CMake project",
  Makefile: "Make build",
  justfile: "Just build",
};

const extensionLanguages: Record<string, string> = {
  ".ts": "TypeScript",
  ".tsx": "TypeScript",
  ".js": "JavaScript",
  ".jsx": "JavaScript",
  ".mjs": "JavaScript",
  ".py": "Python",
  ".rs": "Rust",
  ".go": "Go",
  ".java": "Java",
  ".cs": "C#",
  ".cpp": "C++",
  ".cc": "C++",
  ".c": "C",
  ".h": "C/C++",
  ".ps1": "PowerShell",
};

const ignoredDirectories = new Set([
  ".git",
  "node_modules",
  ".localcode",
  "dist",
  ".next",
  ".agents",
  "target",
  ".venv",
]);

async function walkFiles(
  root: string,
  directory = ".",
  depth = 0,
): Promise<string[]> {
  if (depth > 6) return [];
  const absolute = path.join(root, directory);
  const entries = await readdir(absolute, { withFileTypes: true }).catch(
    () => [],
  );
  const files: string[] = [];
  for (const entry of entries) {
    if (ignoredDirectories.has(entry.name)) continue;
    const relative = path
      .join(directory, entry.name)
      .replaceAll("\\", "/")
      .replace(/^\.\//, "");
    if (entry.isDirectory())
      files.push(...(await walkFiles(root, relative, depth + 1)));
    else files.push(relative);
  }
  return files;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function readPackageScripts(
  root: string,
  relative: string,
): Promise<string[]> {
  try {
    const parsed: unknown = JSON.parse(
      await readFile(path.join(root, relative), "utf8"),
    );
    const scripts = record(parsed)?.scripts;
    const values = record(scripts);
    return values ? Object.keys(values).sort() : [];
  } catch {
    return [];
  }
}

async function gitValue(
  root: string,
  args: string[],
  logger?: LocalCodeLogger,
): Promise<string | undefined> {
  const result = await runCommand("git", args, {
    cwd: root,
    timeoutMs: 5_000,
    logger,
  });
  if (result.exitCode !== 0) return undefined;
  const value = result.stdout.trim();
  return value || undefined;
}

export async function inspectRepositorySnapshot(
  root: string,
  signal?: AbortSignal,
  logger?: LocalCodeLogger,
): Promise<RepositorySnapshot> {
  const absoluteRoot = path.resolve(root);
  const topLevelEntries = (await readdir(absoluteRoot, { withFileTypes: true }))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
  const files = await walkFiles(absoluteRoot);
  const rootFiles = new Set(topLevelEntries);
  const manifests: ProjectManifest[] = [];
  for (const [name, kind] of Object.entries(manifestKinds)) {
    if (!rootFiles.has(name)) continue;
    manifests.push({
      path: name,
      kind,
      scripts:
        name === "package.json"
          ? await readPackageScripts(absoluteRoot, name)
          : [],
    });
  }

  const counts = new Map<string, { extensions: Set<string>; files: number }>();
  for (const relative of files) {
    const extension = path.extname(relative).toLowerCase();
    const language = extensionLanguages[extension];
    if (!language) continue;
    const current = counts.get(language) ?? { extensions: new Set(), files: 0 };
    current.extensions.add(extension);
    current.files += 1;
    counts.set(language, current);
  }
  const languages = [...counts.entries()]
    .map(([language, value]) => ({
      language,
      extensions: [...value.extensions].sort(),
      files: value.files,
    }))
    .sort(
      (left, right) =>
        right.files - left.files || left.language.localeCompare(right.language),
    );

  const sourceRoots = topLevelEntries.filter((entry) =>
    ["src", "app", "lib", "packages"].includes(entry),
  );
  const testRoots = topLevelEntries.filter((entry) =>
    ["test", "tests", "__tests__", "spec", "specs"].includes(entry),
  );
  const buildNames = new Set([
    "tsconfig.json",
    "vite.config.ts",
    "next.config.js",
    "next.config.mjs",
    "webpack.config.js",
    "CMakeLists.txt",
    "Makefile",
    "justfile",
    "Taskfile.yml",
  ]);
  const buildFiles = files.filter((relative) =>
    buildNames.has(path.basename(relative)),
  );
  const instructionNames = new Set([
    "AGENTS.md",
    "AGENTS.override.md",
    "CLAUDE.md",
  ]);
  const instructionFiles = files
    .filter((relative) => instructionNames.has(path.basename(relative)))
    .map((relative) => ({
      path: relative,
      scope:
        path.posix.dirname(relative) === "."
          ? "."
          : path.posix.dirname(relative),
    }))
    .sort((left, right) => left.path.localeCompare(right.path));

  if (signal?.aborted)
    throw new DOMException("Repository snapshot aborted", "AbortError");
  const gitRoot = await gitValue(
    absoluteRoot,
    ["rev-parse", "--show-toplevel"],
    logger,
  );
  const revision = await gitValue(absoluteRoot, ["rev-parse", "HEAD"], logger);
  const branch = await gitValue(
    absoluteRoot,
    ["branch", "--show-current"],
    logger,
  );
  const gitStatus = await gitValue(absoluteRoot, ["status", "--short"], logger);
  return {
    cwd: absoluteRoot,
    ...(gitRoot ? { gitRoot } : {}),
    ...(revision ? { revision } : {}),
    ...(branch ? { branch } : {}),
    topLevelEntries,
    manifests,
    languages,
    sourceRoots,
    testRoots,
    buildFiles,
    instructionFiles,
    ...(gitStatus ? { gitStatus } : {}),
  };
}
