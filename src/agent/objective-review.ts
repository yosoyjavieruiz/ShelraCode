import { readFile } from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../shared/process.js";
import { normalizeWorkspacePath } from "../shared/workspace-paths.js";
import { describesMutation } from "./mutation-intent.js";
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
  return /(?:file|path|route|document|archivo|ruta|fichero|documento)\s*(?:named|called|llamado|llamada|de|del|:)?\s*[`"']?\s*$/iu.test(
    before,
  );
}

// A path-prefixed occurrence ("docs/testing.md") or a hyphenated/dotted
// filename continuation ("test-helpers.ts") is a filename mention, not a
// request that tests be written or run — exclude both instead of matching
// "test"/"testing" as a bare word anywhere in the objective.
const TEST_PATTERN =
  /(?<![/\\])\b(?:test|tests|testing|prueba|pruebas)\b(?![-\w]*\.[a-z]{1,4}\b)/iu;
const EXPORT_PATTERN = /\b(?:export|exports|exportar|exporta)\b/iu;
const UNRESOLVED_PLACEHOLDER_PATTERN =
  /\[(?:add|insert|replace|todo|your|required|project[- ]?directory|tooling|license|if\s+applicable|fill\s+in|describe|enter)[^\]\r\n]{0,160}\]|<(?:your[- ]?[^>\r\n]*|project[- ]?(?:directory|name|path)|repository[- ]?(?:url|name|path)|repo[- ]?(?:url|name|path)|required[- ]?[^>\r\n]*)>|\b(?:project|repository|repo)[-_](?:name|url|directory|path)\b|\b(?:adjust|fill in|replace this|your default command)\b|(?:\/path\/to\/|\\path\\to\\)|\b(?:TODO|TBD|FIXME)\b|\b(?:placeholder|template)\b/iu;

const HTML_SCRIPT_SOURCE_PATTERN =
  /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["'][^>]*>/giu;
const HTML_STYLESHEET_SOURCE_PATTERN =
  /<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/giu;
const JAVASCRIPT_ID_LOOKUP_PATTERN =
  /\bgetElementById\s*\(\s*["']([^"']+)["']/giu;
const JAVASCRIPT_SELECTOR_LOOKUP_PATTERN =
  /\b(?:querySelector|querySelectorAll)\s*\(\s*["']([^"']+)["']/giu;
const JAVASCRIPT_CLASS_LOOKUP_PATTERN =
  /\bgetElementsByClassName\s*\(\s*["']([^"']+)["']/giu;
const HTML_ID_PATTERN = /\bid\s*=\s*["']([^"']+)["']/giu;
const HTML_CLASS_PATTERN = /\bclass\s*=\s*["']([^"']+)["']/giu;

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

function objectiveAllowsPlaceholders(objective: string): boolean {
  return /\b(?:template|placeholder|skeleton|sample|example)\b/iu.test(
    objective,
  );
}

interface ArtifactEntry {
  path: string;
  content: string;
}

async function readArtifactEntries(
  root: string,
  paths: readonly string[],
  signal?: AbortSignal,
): Promise<ArtifactEntry[]> {
  if (signal?.aborted) return [];
  const absoluteRoot = path.resolve(root);
  return (
    await Promise.all(
      paths.slice(0, 16).map(async (relativePath) => {
        if (signal?.aborted) return "";
        const absolutePath = path.resolve(root, relativePath);
        const relativeToRoot = path.relative(absoluteRoot, absolutePath);
        if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot))
          return "";
        try {
          return {
            path: normalizeWorkspacePath(relativePath),
            content: (await readFile(absolutePath, "utf8")).slice(0, 64_000),
          } satisfies ArtifactEntry;
        } catch {
          return "";
        }
      }),
    )
  ).filter((entry): entry is ArtifactEntry => entry !== "");
}

function resetAndCollect(pattern: RegExp, content: string): string[] {
  pattern.lastIndex = 0;
  const values: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const value = match[1]?.trim();
    if (value) values.push(value);
  }
  return [...new Set(values)];
}

function isLocalArtifactReference(value: string): boolean {
  const normalized = value.trim().replaceAll("\\", "/");
  return (
    normalized.length > 0 &&
    !normalized.startsWith("#") &&
    !normalized.startsWith("/") &&
    !/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(normalized) &&
    !normalized.startsWith("//")
  );
}

function resolveArtifactReference(
  fromPath: string,
  reference: string,
): string | undefined {
  if (!isLocalArtifactReference(reference)) return undefined;
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(fromPath), reference),
  );
  if (resolved === "." || resolved.startsWith("../")) return undefined;
  return resolved.replace(/^\.\//u, "");
}

function hasHtmlId(content: string, id: string): boolean {
  return resetAndCollect(HTML_ID_PATTERN, content).some(
    (candidate) => candidate === id,
  );
}

function hasHtmlClass(content: string, className: string): boolean {
  return resetAndCollect(HTML_CLASS_PATTERN, content).some((candidate) =>
    candidate.split(/\s+/u).includes(className),
  );
}

function selectorMissingFromHtml(selector: string, html: string): boolean {
  const trimmed = selector.trim();
  if (trimmed.startsWith("#")) return !hasHtmlId(html, trimmed.slice(1));
  if (trimmed.startsWith("."))
    return !hasHtmlClass(html, trimmed.slice(1).split(/[.:#[\s]/u)[0] ?? "");
  return false;
}

async function reviewChangedArtifactReferences(
  root: string,
  entries: readonly ArtifactEntry[],
  signal?: AbortSignal,
): Promise<
  Pick<ObjectiveReviewResult, "issues" | "nextPaths" | "nextActions">
> {
  const issues: string[] = [];
  const nextPaths: string[] = [];
  const nextActions: string[] = [];
  const htmlEntries = entries.filter((entry) => /\.html?$/iu.test(entry.path));

  for (const html of htmlEntries) {
    const references = [
      ...resetAndCollect(HTML_SCRIPT_SOURCE_PATTERN, html.content),
      ...resetAndCollect(HTML_STYLESHEET_SOURCE_PATTERN, html.content),
    ];
    for (const reference of references) {
      const resolved = resolveArtifactReference(html.path, reference);
      if (!resolved) continue;
      const absolute = path.resolve(root, resolved);
      const rootRelative = path.relative(path.resolve(root), absolute);
      if (rootRelative.startsWith("..") || path.isAbsolute(rootRelative))
        continue;
      try {
        await readFile(absolute, "utf8");
      } catch {
        issues.push(
          `The HTML artifact ${html.path} references a local resource that does not exist: ${resolved}.`,
        );
        nextPaths.push(html.path, resolved);
        nextActions.push(
          `Resolve the local resource reference ${resolved} from ${html.path} before completion.`,
        );
      }
    }

    const htmlForSelectors = html.content;
    const scriptPaths = resetAndCollect(
      HTML_SCRIPT_SOURCE_PATTERN,
      html.content,
    )
      .map((reference) => resolveArtifactReference(html.path, reference))
      .filter((value): value is string => value !== undefined);
    const scriptEntries = [
      ...entries.filter((entry) => scriptPaths.includes(entry.path)),
    ];
    for (const scriptPath of scriptPaths) {
      if (scriptEntries.some((entry) => entry.path === scriptPath)) continue;
      try {
        scriptEntries.push({
          path: scriptPath,
          content: await readFile(path.resolve(root, scriptPath), "utf8"),
        });
      } catch {
        continue;
      }
    }

    for (const script of scriptEntries) {
      const idLookups = resetAndCollect(
        JAVASCRIPT_ID_LOOKUP_PATTERN,
        script.content,
      );
      const selectorLookups = resetAndCollect(
        JAVASCRIPT_SELECTOR_LOOKUP_PATTERN,
        script.content,
      );
      const classLookups = resetAndCollect(
        JAVASCRIPT_CLASS_LOOKUP_PATTERN,
        script.content,
      );
      for (const id of idLookups) {
        if (hasHtmlId(htmlForSelectors, id)) continue;
        const normalizedSelector = `#${id}`;
        issues.push(
          `JavaScript ${script.path} queries ${normalizedSelector}, but the HTML artifact ${html.path} does not define that selector.`,
        );
        nextPaths.push(html.path, script.path);
        nextActions.push(
          `Align the cross-artifact selector ${normalizedSelector} between ${script.path} and ${html.path}, then verify again.`,
        );
      }
      for (const selector of selectorLookups) {
        if (!selectorMissingFromHtml(selector, htmlForSelectors)) continue;
        issues.push(
          `JavaScript ${script.path} queries ${selector}, but the HTML artifact ${html.path} does not define that selector.`,
        );
        nextPaths.push(html.path, script.path);
        nextActions.push(
          `Align the cross-artifact selector ${selector} between ${script.path} and ${html.path}, then verify again.`,
        );
      }
      for (const className of classLookups) {
        if (!className || hasHtmlClass(htmlForSelectors, className)) continue;
        issues.push(
          `JavaScript ${script.path} queries the class .${className}, but the HTML artifact ${html.path} does not define that class.`,
        );
        nextPaths.push(html.path, script.path);
        nextActions.push(
          `Align the cross-artifact class .${className} between ${script.path} and ${html.path}, then verify again.`,
        );
      }
    }
  }

  return {
    issues: [...new Set(issues)],
    nextPaths: [...new Set(nextPaths)],
    nextActions: [...new Set(nextActions)],
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
  const mutationRequested = describesMutation(objective);
  const modelPlan =
    ledger.taskGraph?.planSource === "model" ? ledger.taskGraph : undefined;
  // For an LLM-authored plan, semantic relevance is established by the
  // plan's own bounded scopes and verification/acceptance declarations. The
  // host still requires every plan node to reach a terminal verified state,
  // and every agent-changed path to be covered by an accepted plan scope. This
  // keeps the core generic: it does not guess that a particular filename
  // represents a website, backend, migration, or any other domain.
  const modelPlanCoversChangedPaths =
    modelPlan !== undefined &&
    changedPaths.length > 0 &&
    changedPaths.every((changedPath) =>
      modelPlan.nodes.some((node) =>
        node.scope.candidateFiles.some(
          (candidate) => normalizeWorkspacePath(candidate) === changedPath,
        ),
      ),
    );
  const modelPlanProvidesObjectiveEvidence =
    modelPlan !== undefined &&
    modelPlan.nodes.length > 0 &&
    modelPlanCoversChangedPaths &&
    modelPlan.nodes.every(
      (node) => node.status === "passed" || node.status === "superseded",
    ) &&
    modelPlan.nodes.some(
      (node) =>
        node.status === "passed" &&
        ((node.verification?.length ?? 0) > 0 || node.acceptance.length > 0),
    );

  // The LLM-authored plan is the semantic source of truth while it is still
  // executing. A controller-side lexical check must not reject an otherwise
  // valid mutation merely because repository names and user language differ
  // (for example, a translated domain term versus its implementation name).
  // Keep the check for uncovered paths and for plan-free/finished fallbacks;
  // defer only the relationship heuristic until the plan has reached a
  // terminal state and can be judged by its accumulated evidence.
  const modelPlanHasUnfinishedWork =
    modelPlan?.nodes.some(
      (node) =>
        node.status !== "passed" &&
        node.status !== "superseded" &&
        node.status !== "blocked" &&
        node.status !== "failed",
    ) ?? false;
  const deferLexicalRelationshipCheck =
    modelPlanCoversChangedPaths && modelPlanHasUnfinishedWork;

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
    if (
      !related &&
      !modelPlanProvidesObjectiveEvidence &&
      !deferLexicalRelationshipCheck
    ) {
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
    if (
      !related &&
      !modelPlanProvidesObjectiveEvidence &&
      !deferLexicalRelationshipCheck
    ) {
      issues.push(
        "The final mutation does not touch a file named by, or related to, the objective.",
      );
      nextPaths.push(...namedPaths);
      nextActions.push(
        "Inspect the named files and apply the requested change there or in their direct implementation path.",
      );
    }
  }

  if (
    mutationRequested &&
    changedPaths.length > 0 &&
    !objectiveAllowsPlaceholders(objective)
  ) {
    const changedEntries = await readArtifactEntries(
      root,
      changedPaths,
      signal,
    );
    const changedContents = changedEntries
      .map((entry) => entry.content)
      .join("\n");
    if (UNRESOLVED_PLACEHOLDER_PATTERN.test(changedContents)) {
      issues.push(
        "The changed artifact still contains an unresolved placeholder or example value.",
      );
      nextActions.push(
        "Inspect the changed artifact and replace unresolved placeholders with repository-grounded values, or report the missing decision instead of presenting a template as complete.",
      );
    }
    const referenceReview = await reviewChangedArtifactReferences(
      root,
      changedEntries,
      signal,
    );
    issues.push(...referenceReview.issues);
    nextPaths.push(...referenceReview.nextPaths);
    nextActions.push(...referenceReview.nextActions);
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
        { intent: "read", cwd: root, signal, timeoutMs: 10_000 },
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
