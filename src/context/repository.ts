import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  isNeverRemotePath,
  normalizePath,
  scanSecrets,
} from "../privacy/policy.js";
import { runCommand } from "../shared/process.js";
import type {
  RepositoryContext,
  RepositoryContextOptions,
} from "./context-builder.js";
import { inspectRepositorySnapshot } from "./repository-snapshot.js";
import { loadScopedInstructions } from "./instructions.js";
import { isDirectRepositoryFactQuestion } from "../shared/repository-facts.js";
import type { LocalCodeLogger } from "../shared/logging.js";
import { selectRelevantMemory } from "../shared/memory.js";

const priorityNames = new Set([
  "README",
  "README.md",
  "AGENTS.md",
  "package.json",
  "tsconfig.json",
  "bun.lock",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
]);

function isIgnoredContextFile(relative: string): boolean {
  const normalized = relative.replaceAll("\\", "/");
  return (
    // The CLI may be configured to write its JSONL trace at the workspace
    // root. That is LocalCode runtime state, not project evidence. Counting
    // it as a project file makes a genuinely empty workspace look non-empty
    // and deadlocks the first user-approved creation.
    normalized === "agent.jsonl" ||
    normalized.startsWith(".agents/") ||
    normalized.startsWith(".localcode/")
  );
}

async function filesFromGit(
  root: string,
  signal?: AbortSignal,
  logger?: LocalCodeLogger,
): Promise<string[]> {
  const result = await runCommand(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard"],
    { cwd: root, timeoutMs: 5_000, signal, logger },
  );
  if (result.exitCode !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter((value) => Boolean(value) && !isIgnoredContextFile(value));
}

async function filesFromRg(
  root: string,
  signal?: AbortSignal,
  logger?: LocalCodeLogger,
): Promise<string[]> {
  const result = await runCommand(
    "rg",
    [
      "--files",
      "--hidden",
      "-g",
      "!.git/**",
      "-g",
      "!node_modules/**",
      "-g",
      "!.localcode/**",
    ],
    { cwd: root, timeoutMs: 5_000, signal, logger },
  );
  return result.exitCode === 0
    ? result.stdout
        .split(/\r?\n/)
        .filter((value) => Boolean(value) && !isIgnoredContextFile(value))
    : [];
}

const WALK_EXCLUDED_DIRS = new Set([
  ".git",
  "node_modules",
  ".localcode",
  "dist",
  ".next",
  ".agents",
]);

/**
 * Last-resort file discovery when this is neither a Git repository nor has
 * `rg` on PATH. Pure Node `readdir`, no external process — always
 * available, just slower/less gitignore-aware than the two paths above.
 */
async function filesFromWalk(
  root: string,
  directory = ".",
  depth = 0,
): Promise<string[]> {
  if (depth > 8) return [];
  const absolute = path.join(root, directory);
  const entries = await readdir(absolute, { withFileTypes: true }).catch(
    () => [],
  );
  const files: string[] = [];
  for (const entry of entries) {
    if (WALK_EXCLUDED_DIRS.has(entry.name)) continue;
    const relative = path.join(directory, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory())
      files.push(...(await filesFromWalk(root, relative, depth + 1)));
    else files.push(relative);
  }
  return files;
}

async function discoverFiles(
  root: string,
  signal?: AbortSignal,
  logger?: LocalCodeLogger,
): Promise<string[]> {
  const gitFiles = await filesFromGit(root, signal, logger);
  if (gitFiles.length > 0) return gitFiles;
  const rgFiles = await filesFromRg(root, signal, logger);
  if (rgFiles.length > 0) return rgFiles;
  return (await filesFromWalk(root)).filter(
    (file) => !isIgnoredContextFile(file),
  );
}

const OBJECTIVE_STOP_WORDS = new Set([
  "about",
  "after",
  "again",
  "also",
  "before",
  "change",
  "changes",
  "code",
  "complete",
  "correct",
  "create",
  "current",
  "ensure",
  "file",
  "files",
  "fix",
  "from",
  "into",
  "make",
  "modify",
  "only",
  "project",
  "repository",
  "review",
  "run",
  "tests",
  "test",
  "the",
  "this",
  "with",
  "add",
  "agrega",
  "anade",
  "arregla",
  "cambia",
  "corrige",
  "crea",
  "implementa",
  "implement",
  "modifica",
  "prueba",
  "pruebas",
  "revisa",
  "actualiza",
]);

function objectiveTerms(objective: string): string[] {
  return objective
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .split(/[^a-z0-9_/-]+/u)
    .filter(
      (term) =>
        term.length >= 4 &&
        !OBJECTIVE_STOP_WORDS.has(term) &&
        !/^\d+$/u.test(term),
    )
    .slice(0, 10);
}

interface ObjectiveSearchResult {
  matches: string[];
  backend: "rg" | "fallback" | "no_matches" | "unavailable";
}

async function fallbackObjectiveSearch(
  root: string,
  files: readonly string[],
  terms: readonly string[],
  signal?: AbortSignal,
): Promise<ObjectiveSearchResult> {
  const normalizedTerms = terms.map((term) => term.toLowerCase());
  const matches: string[] = [];
  for (const relative of files) {
    if (matches.length >= 32 || signal?.aborted) break;
    if (isNeverRemotePath(relative) || isIgnoredContextFile(relative)) continue;
    try {
      const content = (await readFile(path.join(root, relative), "utf8"))
        .slice(0, 512_000)
        .toLowerCase();
      if (normalizedTerms.some((term) => content.includes(term)))
        matches.push(normalizePath(relative));
    } catch {
      // A disappearing or binary file is not evidence of a match.
    }
  }
  return {
    matches,
    backend: matches.length > 0 ? "fallback" : "no_matches",
  };
}

async function objectiveSearchMatches(
  root: string,
  objective: string,
  files: readonly string[],
  signal?: AbortSignal,
  logger?: LocalCodeLogger,
): Promise<ObjectiveSearchResult> {
  const terms = objectiveTerms(objective);
  if (terms.length === 0) return { matches: [], backend: "no_matches" };
  const args = [
    "--files-with-matches",
    "--hidden",
    "--no-messages",
    "--ignore-case",
    "--fixed-strings",
    "-g",
    "!.git/**",
    "-g",
    "!node_modules/**",
    "-g",
    "!.localcode/**",
    "-g",
    "!dist/**",
    ...terms.flatMap((term) => ["-e", term]),
    "--",
    ".",
  ];
  let result: Awaited<ReturnType<typeof runCommand>>;
  try {
    // Objective search scans the repository contents, not just its file
    // index. Five seconds was below the observed time for this repository,
    // so a normal host variation became a fatal task TimeoutError. Keep the
    // process bounded, but recover to the deterministic file-list fallback
    // when the optional accelerator is slow.
    result = await runCommand("rg", args, {
      cwd: root,
      timeoutMs: 20_000,
      signal,
      logger,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    logger?.warn("context.search.fallback", {
      reason: error instanceof Error ? error.name : "unknown",
    });
    return fallbackObjectiveSearch(root, files, terms, signal);
  }
  if (result.exitCode === 0)
    return {
      matches: result.stdout
        .split(/\r?\n/u)
        .map((value) => normalizePath(value.trim()))
        .filter(
          (value) =>
            value.length > 0 &&
            !isNeverRemotePath(value) &&
            !isIgnoredContextFile(value),
        )
        .slice(0, 32),
      backend: "rg",
    };
  if (result.exitCode === 1) return { matches: [], backend: "no_matches" };
  if (result.exitCode !== 127) return { matches: [], backend: "unavailable" };

  // `rg` is optional. Do not turn its missing-executable status into a false
  // zero-match result: scan the already discovered, bounded file list with a
  // conservative text fallback and expose the backend in the context proof.
  return fallbackObjectiveSearch(root, files, terms, signal);
}

function isRootPath(relative: string): boolean {
  return !relative.replaceAll("\\", "/").includes("/");
}

function rootFactFiles(
  files: string[],
  snapshot: RepositoryContext["snapshot"],
): string[] {
  if (!snapshot) return [];
  const lockfileNames = new Set([
    "bun.lock",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
  ]);
  const primaryManifests = snapshot.manifests
    .map((manifest) => manifest.path)
    .filter((manifest) => !lockfileNames.has(manifest));
  const manifestEvidence =
    primaryManifests.length > 0
      ? primaryManifests
      : snapshot.manifests.map((manifest) => manifest.path);
  const rootEvidence = new Set([
    ...manifestEvidence,
    ...snapshot.buildFiles.filter(isRootPath),
    ...(manifestEvidence.length === 0
      ? snapshot.topLevelEntries.filter((entry) =>
          /^readme(?:\.|$)/i.test(entry),
        )
      : []),
  ]);
  return files.filter(
    (file) => isRootPath(file) && rootEvidence.has(path.basename(file)),
  );
}

function orderFiles(
  files: string[],
  explicit: string[],
  objective: string,
): string[] {
  const terms = objectiveTerms(objective);
  return [...new Set(files)].sort((left, right) => {
    const score = (file: string): number => {
      const base = path.basename(file);
      const normalized = file.toLowerCase();
      return (
        (explicit.includes(file) ? 100 : 0) +
        (priorityNames.has(base) ? 40 : 0) +
        terms.filter((term) => normalized.includes(term)).length * 10
      );
    };
    return score(right) - score(left) || left.localeCompare(right);
  });
}

export async function listRepositoryFiles(
  root: string,
  signal?: AbortSignal,
  logger?: LocalCodeLogger,
): Promise<string[]> {
  const discovered = await discoverFiles(root, signal, logger);
  return orderFiles(
    discovered.map(normalizePath).filter((file) => !isNeverRemotePath(file)),
    [],
    "",
  );
}

function redactSecrets(content: string): string {
  return content
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      "[REDACTED PRIVATE KEY]",
    )
    .replace(
      /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|AIza[A-Za-z0-9_-]{30,}|AKIA[0-9A-Z]{16})\b/g,
      "[REDACTED TOKEN]",
    )
    .replace(
      /(\b(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*["'])[^"']+(?=["'])/gi,
      "$1[REDACTED]",
    );
}

async function buildRepositoryContextInternal(
  options: RepositoryContextOptions,
): Promise<RepositoryContext> {
  const logger = options.logger?.child({ component: "context.repository" });
  const snapshot =
    options.snapshot ??
    (await inspectRepositorySnapshot(options.root, options.signal, logger));
  const files = await discoverFiles(options.root, options.signal, logger);
  const explicit = options.explicitPaths ?? [];
  const factQuestion = isDirectRepositoryFactQuestion(options.objective);
  const objectiveSearch = factQuestion
    ? { matches: [], backend: "not_needed" as const }
    : await objectiveSearchMatches(
        options.root,
        options.objective,
        files,
        options.signal,
        logger,
      );
  const relevantMatches = objectiveSearch.matches;
  const ordered = orderFiles(
    factQuestion ? rootFactFiles(files, snapshot) : files,
    [...explicit, ...relevantMatches],
    options.objective,
  );
  const loadedInstructions = factQuestion
    ? []
    : await loadScopedInstructions(
        options.root,
        snapshot.instructionFiles,
        ordered,
        options.signal,
      );
  const maxChars = options.maxChars ?? 40_000;
  const memoryFacts = selectRelevantMemory(
    options.memoryFacts ?? [],
    options.objective,
    snapshot.revision,
  );
  let usedChars = 0;
  let containsHighConfidenceSecret = false;
  const secretPaths: string[] = [];
  const sections: string[] = [];
  const includedFiles: string[] = [];

  for (const instruction of loadedInstructions) {
    const safeContent = redactSecrets(instruction.content);
    const findings = scanSecrets(instruction.content);
    if (findings.length > 0) {
      containsHighConfidenceSecret = true;
      secretPaths.push(instruction.path);
    }
    const remaining = Math.max(0, maxChars - usedChars);
    const clipped = safeContent.slice(0, Math.min(remaining, 8_000));
    if (!clipped) break;
    sections.push(`### Instruction ${instruction.path}\n${clipped}`);
    usedChars += clipped.length;
  }

  for (const relativePath of ordered) {
    if (options.signal?.aborted)
      throw new DOMException("Context inspection aborted", "AbortError");
    if (isNeverRemotePath(relativePath)) {
      secretPaths.push(relativePath);
      continue;
    }
    if (usedChars >= maxChars) break;
    try {
      const content = await readFile(
        path.join(options.root, relativePath),
        "utf8",
      );
      if (options.signal?.aborted)
        throw new DOMException("Context inspection aborted", "AbortError");
      const findings = scanSecrets(content);
      if (findings.length > 0) {
        containsHighConfidenceSecret = true;
        secretPaths.push(relativePath);
      }
      const safeContent = redactSecrets(content);
      const remaining = Math.max(0, maxChars - usedChars);
      const clipped = safeContent.slice(0, Math.min(remaining, 8_000));
      if (!clipped) continue;
      sections.push(`### ${relativePath}\n${clipped}`);
      includedFiles.push(relativePath);
      usedChars += clipped.length;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError")
        throw error;
      // A file can disappear while the repository is being inspected.
    }
  }

  const hasDirectFactEvidence =
    factQuestion &&
    (snapshot.manifests.length > 0 || snapshot.languages.length > 0) &&
    includedFiles.length > 0;
  const hasExplicitEvidence =
    explicit.length > 0 &&
    explicit.some((candidate) =>
      includedFiles.includes(normalizePath(candidate)),
    );
  const evidenceState: RepositoryContext["evidenceState"] =
    relevantMatches.length > 0 || hasDirectFactEvidence || hasExplicitEvidence
      ? "SUFFICIENT"
      : "INSUFFICIENT";
  const result = {
    files: includedFiles,
    relevantMatches,
    prompt: [
      `Objective: ${options.objective}`,
      "Host-detected repository facts (authoritative for direct factual questions; do not rediscover these with tools):",
      `- Languages: ${snapshot.languages.map((language) => language.language).join(", ") || "unknown"}`,
      `- Source roots: ${snapshot.sourceRoots.join(", ") || "unknown"}`,
      `- Test roots: ${snapshot.testRoots.join(", ") || "unknown"}`,
      `- Repository files: ${files.length}`,
      ...(memoryFacts.length > 0
        ? [
            "Historical project memory (untrusted hints; verify against current files before relying on it):",
            ...memoryFacts.map(
              (fact) =>
                `- [${fact.provenance}; confidence ${fact.confidence.toFixed(2)}] ${fact.fact} (${fact.evidence.map((evidence) => evidence.source).join(", ") || "no source"})`,
            ),
          ]
        : []),
      ...(relevantMatches.length > 0
        ? [
            "Objective search matches (host-discovered evidence; inspect before editing):",
            ...relevantMatches.slice(0, 12).map((file) => `- ${file}`),
          ]
        : []),
      ...(factQuestion
        ? [
            "Context focus: answer this direct repository fact from the host facts and root manifests below.",
          ]
        : []),
      ...sections,
    ].join("\n\n"),
    snapshot,
    instructions: loadedInstructions.map((instruction) => instruction.path),
    containsHighConfidenceSecret,
    secretPaths,
    evidenceState,
    searchBackend: objectiveSearch.backend,
    memoryFacts,
  };
  logger?.info("context.discovery.finished", {
    discoveredFileCount: files.length,
    selectedFileCount: includedFiles.length,
    objectiveMatchCount: relevantMatches.length,
    instructionCount: loadedInstructions.length,
    usedChars,
    maxChars,
    truncated: usedChars >= maxChars,
    // These are safe aggregate facts. Avoid the words `secret`/`token` in
    // log keys because the logger intentionally redacts any key that could
    // contain credential material, which would otherwise hide useful boolean
    // and count diagnostics as `[REDACTED]`.
    sensitiveContentDetected: containsHighConfidenceSecret,
    sensitivePathCount: secretPaths.length,
    directFactQuestion: factQuestion,
    evidenceState,
    searchBackend: objectiveSearch.backend,
  });
  return result;
}

export async function buildRepositoryContext(
  options: RepositoryContextOptions,
): Promise<RepositoryContext> {
  const logger = options.logger?.child({ component: "context.repository" });
  logger?.info("context.discovery.started", {
    objectiveLength: options.objective.length,
    explicitPathCount: options.explicitPaths?.length ?? 0,
    maxChars: options.maxChars ?? 40_000,
    hasSnapshot: Boolean(options.snapshot),
  });
  try {
    return await buildRepositoryContextInternal(options);
  } catch (error) {
    logger?.error("context.discovery.failed", {
      error: error instanceof Error ? error.name : "unknown",
      aborted: options.signal?.aborted ?? false,
    });
    throw error;
  }
}
