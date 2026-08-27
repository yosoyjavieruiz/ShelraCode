import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
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
  /** Hash of the checked-out branch and current working-tree state. */
  workingTreeRevision?: string;
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
  const revision = snapshot.workingTreeRevision ?? snapshot.revision;
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
    intent: "read",
    cwd: root,
    timeoutMs: 5_000,
    logger,
  });
  if (result.exitCode !== 0) return undefined;
  const value = result.stdout.trim();
  return value || undefined;
}

const MAX_WORKTREE_PATHS = 512;
const MAX_WORKTREE_FILE_BYTES = 16 * 1024 * 1024;

/**
 * Produce a content-aware identity for the current checkout. Git HEAD alone
 * is insufficient for resume safety because staged, unstaged and untracked
 * changes can exist without changing the commit. The digest contains only
 * hashes and metadata, never file contents or secrets.
 */
async function gitWorkingTreeRevision(
  root: string,
  revision: string,
  branch: string | undefined,
  signal?: AbortSignal,
  logger?: LocalCodeLogger,
): Promise<string | undefined> {
  const status = await runCommand(
    "git",
    ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    {
      intent: "read",
      cwd: root,
      timeoutMs: 5_000,
      signal,
      maxOutputChars: 1_000_000,
      logger,
    },
  );
  const changed = await runCommand(
    "git",
    ["diff", "--name-only", "HEAD", "-z"],
    {
      intent: "read",
      cwd: root,
      timeoutMs: 5_000,
      signal,
      maxOutputChars: 1_000_000,
      logger,
    },
  );
  const untracked = await runCommand(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z"],
    {
      intent: "read",
      cwd: root,
      timeoutMs: 5_000,
      signal,
      maxOutputChars: 1_000_000,
      logger,
    },
  );
  if (
    status.exitCode !== 0 ||
    changed.exitCode !== 0 ||
    untracked.exitCode !== 0 ||
    status.stdoutTruncated ||
    changed.stdoutTruncated ||
    untracked.stdoutTruncated
  )
    return undefined;
  const paths = [
    ...new Set(
      `${changed.stdout}\0${untracked.stdout}`
        .split("\0")
        .map((value) => value.trim())
        .filter(Boolean),
    ),
  ].sort();
  if (paths.length > MAX_WORKTREE_PATHS) return undefined;

  const digest = createHash("sha256");
  digest.update(`head:${revision}\nbranch:${branch ?? ""}\n`);
  digest.update(status.stdout);
  for (const relative of paths) {
    if (signal?.aborted)
      throw new DOMException("Working-tree fingerprint aborted", "AbortError");
    const absolute = path.resolve(root, relative);
    const relativeCheck = path.relative(path.resolve(root), absolute);
    if (
      path.isAbsolute(relative) ||
      relativeCheck === ".." ||
      relativeCheck.startsWith(`..${path.sep}`)
    )
      return undefined;
    digest.update(`\npath:${relative}\n`);
    try {
      const information = await stat(absolute);
      if (!information.isFile() || information.size > MAX_WORKTREE_FILE_BYTES)
        return undefined;
      digest.update(await readFile(absolute));
    } catch (error) {
      if (
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        digest.update("<missing>");
        continue;
      }
      return undefined;
    }
  }
  return digest.digest("hex");
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
  const workingTreeRevision =
    gitRoot && revision
      ? await gitWorkingTreeRevision(
          absoluteRoot,
          revision,
          branch,
          signal,
          logger,
        )
      : undefined;
  return {
    cwd: absoluteRoot,
    ...(gitRoot ? { gitRoot } : {}),
    ...(revision ? { revision } : {}),
    ...(workingTreeRevision ? { workingTreeRevision } : {}),
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
