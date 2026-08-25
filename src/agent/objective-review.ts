import { readFile } from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../shared/process.js";
import type { AgentTask } from "./types.js";
import type { AgentTaskLedger } from "./task-state.js";

export interface ObjectiveReviewResult {
  pass: boolean;
  issues: string[];
  nextPaths: string[];
  nextActions: string[];
}

const STOP_WORDS = new Set([
  "about",
  "after",
  "also",
  "and",
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
  "implement",
  "implementa",
  "modifica",
  "prueba",
  "pruebas",
  "revisa",
  "actualiza",
]);

const PATH_PATTERN =
  /(?:^|[\s("'`])((?:\.\/)?(?:[\w.-]+[\\/])*[\w.-]+\.[A-Za-z][A-Za-z0-9]{0,11})(?=$|[\s)"'`,.;:])/gu;

// A dependency name such as `Moment.js` is not automatically a workspace
// path. Treating every dotted token as a file made the host stage a phantom
// target and then reject valid edits against it. Basenames remain eligible
// when they are canonical repository files or the user explicitly describes
// them as a file/path/document; nested paths are unambiguous.
const COMMON_REPOSITORY_BASENAMES = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "README.md",
  "LICENSE.md",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "tsconfig.json",
  "pyproject.toml",
  "Cargo.toml",
  "go.mod",
  "Makefile",
  "Dockerfile",
  "index.html",
]);

function isExplicitFileReference(
  objective: string,
  candidate: string,
  candidateStart: number,
): boolean {
  if (candidate.includes("/") || candidate.includes("\\")) return true;
  if (COMMON_REPOSITORY_BASENAMES.has(candidate)) return true;
  if (/(?:\.(?:test|spec)\.)[A-Za-z0-9]+$/iu.test(candidate)) return true;
  const before = objective.slice(
    Math.max(0, candidateStart - 72),
    candidateStart,
  );
  return /(?:file|path|route|document|archivo|ruta|fichero|documento)\s*(?:named|called|de|del|:)?\s*[`"']?\s*$/iu.test(
    before,
  );
}

const CHANGE_PATTERN =
  /\b(?:add|added|change|changed|correct|corrected|fix|fixed|implement|implemented|modify|modified|refactor|rename|remove|update|write|create|agrega|anade|arregla|cambia|corrige|crea|implementa|modifica|renombra|elimina|actualiza)\b/iu;

const TEST_PATTERN = /\b(?:test|tests|testing|test(s)?|prueba|pruebas)\b/iu;
const EXPORT_PATTERN = /\b(?:export|exports|exportar|exporta)\b/iu;

function normalizeWorkspacePath(value: string): string {
  return path.posix
    .normalize(value.replaceAll("\\", "/").replace(/^\.\//u, ""))
    .replace(/^\.\//u, "");
}

export function extractObjectivePaths(objective: string): string[] {
  const paths = new Set<string>();
  PATH_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PATH_PATTERN.exec(objective)) !== null) {
    const candidate = normalizeWorkspacePath(match[1]!);
    const candidateOffset = match[0]!.indexOf(match[1]!);
    const candidateStart = (match.index ?? 0) + Math.max(0, candidateOffset);
    if (
      candidate &&
      candidate !== "." &&
      !candidate.startsWith("../") &&
      !candidate.includes("/../") &&
      !/^\d+(?:\.\d+)?$/u.test(candidate) &&
      isExplicitFileReference(objective, candidate, candidateStart)
    )
      paths.add(candidate);
  }
  return [...paths].slice(0, 12);
}

function objectiveTerms(objective: string): string[] {
  return objective
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .split(/[^a-z0-9_$-]+/u)
    .filter(
      (term) =>
        term.length >= 4 && !STOP_WORDS.has(term) && !/^\d+$/u.test(term),
    )
    .slice(0, 24);
}

function pathsEqual(left: string, right: string): boolean {
  return (
    normalizeWorkspacePath(left).toLowerCase() ===
    normalizeWorkspacePath(right).toLowerCase()
  );
}

function hasPath(paths: readonly string[], expected: string): boolean {
  return paths.some((candidate) => pathsEqual(candidate, expected));
}

function relatedPath(pathValue: string, objective: string): boolean {
  const normalized = normalizeWorkspacePath(pathValue).toLowerCase();
  const base = path.posix.basename(normalized);
  const stem = base.replace(/\.[^.]+$/u, "");
  return objectiveTerms(objective).some(
    (term) => normalized.includes(term) || stem.includes(term),
  );
}

function result(
  issues: string[],
  nextPaths: string[],
  nextActions: string[],
): ObjectiveReviewResult {
  return {
    pass: issues.length === 0,
    issues: [...new Set(issues)],
    nextPaths: [...new Set(nextPaths)].slice(0, 8),
    nextActions: [...new Set(nextActions)].slice(0, 8),
  };
}

/**
 * Host-side semantic-adjacency review for the TUI's generic coding path.
 *
 * This is deliberately conservative. It does not pretend to understand
 * arbitrary program semantics; it proves the parts that can be checked
 * without asking the model to grade itself: explicit files were inspected,
 * the final mutation is related to the requested objective, and explicit
 * test/export requests leave corresponding evidence. A task-specific caller
 * can still supply a stronger verifier (as the disposable live fixture does).
 */
export async function reviewCodingObjective(
  task: AgentTask,
  ledger: AgentTaskLedger,
  root: string,
  signal?: AbortSignal,
): Promise<ObjectiveReviewResult> {
  const objective = task.objective.trim();
  const issues: string[] = [];
  const nextPaths: string[] = [];
  const nextActions: string[] = [];
  const explicitPaths = extractObjectivePaths(objective);
  const stagedPaths = (task.stagedPaths ?? []).map(normalizeWorkspacePath);
  const namedPaths = [...new Set([...explicitPaths, ...stagedPaths])];
  const readPaths = ledger.filesRead.map(normalizeWorkspacePath);
  const changedPaths = ledger.filesChanged.map(normalizeWorkspacePath);
  const mutationRequested = CHANGE_PATTERN.test(objective);

  const missingReads = namedPaths.filter(
    (candidate) => !hasPath(readPaths, candidate),
  );
  if (missingReads.length > 0) {
    issues.push(
      `The objective names files that were not inspected: ${missingReads.join(", ")}.`,
    );
    // Advance one explicit path at a time. This is the host-side
    // decomposition small models need: the remaining paths stay visible in
    // the issue, but only the first missing path becomes the next mutation
    // target.
    nextPaths.push(missingReads[0]!);
    nextActions.push(
      `Read ${missingReads[0]} before editing; the remaining objective files will be staged after this one is verified.`,
    );
  }

  if (mutationRequested && changedPaths.length === 0) {
    issues.push(
      "The objective requests a change, but no changed file is recorded.",
    );
    nextActions.push(
      "Apply the smallest objective-related mutation, then verify it.",
    );
  }

  if (
    mutationRequested &&
    changedPaths.length > 0 &&
    explicitPaths.length === 0
  ) {
    const related = changedPaths.some((candidate) =>
      relatedPath(candidate, objective),
    );
    if (!related) {
      issues.push(
        "The final mutation has no detectable relationship to the objective terms.",
      );
      nextActions.push(
        "Review the objective and final diff; change only files that implement the requested behavior.",
      );
    }
  }

  if (namedPaths.length > 0 && changedPaths.length > 0) {
    const related = changedPaths.some(
      (candidate) =>
        namedPaths.some((expected) => pathsEqual(candidate, expected)) ||
        relatedPath(candidate, objective),
    );
    if (!related) {
      issues.push(
        "The final mutation does not touch a file named by, or related to, the objective.",
      );
      nextPaths.push(...namedPaths);
      nextActions.push(
        "Inspect the named files and apply the requested change there or in their direct implementation path.",
      );
    }
  }

  if (TEST_PATTERN.test(objective)) {
    const latestTest = [...ledger.verificationRuns]
      .reverse()
      .find((run) => run.stage === "test");
    const testPassed =
      latestTest?.status === "passed" && latestTest.exitCode === 0;
    const testChanged = changedPaths.some((candidate) =>
      /(?:^|\/)(?:test|tests|__tests__|spec|specs)(?:\/|\.|$)/iu.test(
        candidate,
      ),
    );
    if (!testPassed && !testChanged) {
      issues.push(
        "The objective mentions tests, but no passing test evidence is recorded.",
      );
      nextActions.push(
        "Run the relevant test command and repair any failure before completion.",
      );
    }
  }

  if (EXPORT_PATTERN.test(objective) && changedPaths.length > 0) {
    let diff = "";
    if (!signal?.aborted) {
      const diffResult = await runCommand(
        "git",
        ["diff", "--no-ext-diff", "--unified=0", "HEAD", "--"],
        { cwd: root, signal, timeoutMs: 10_000 },
      );
      diff = `${diffResult.stdout}\n${diffResult.stderr}`;
      const absoluteRoot = path.resolve(root);
      const changedContents = await Promise.all(
        changedPaths.map(async (relativePath) => {
          const absolutePath = path.resolve(root, relativePath);
          const relativeToRoot = path.relative(absoluteRoot, absolutePath);
          if (
            relativeToRoot.startsWith("..") ||
            path.isAbsolute(relativeToRoot)
          )
            return "";
          try {
            return await readFile(absolutePath, "utf8");
          } catch {
            return "";
          }
        }),
      );
      diff += `\n${changedContents.join("\n")}`;
    }
    if (!/\bexport\b/iu.test(diff)) {
      issues.push(
        "The objective requests an export, but the final diff has no export evidence.",
      );
      nextActions.push(
        "Review the public entry point and add the requested export before verifying again.",
      );
    }
  }

  return result(issues, nextPaths, nextActions);
}
