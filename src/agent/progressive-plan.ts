import { stat } from "node:fs/promises";
import path from "node:path";

const CODE_FILE_PATTERN =
  /\.(?:c|cc|cpp|cs|go|h|java|js|jsx|mjs|py|rs|ts|tsx|vue|svelte)$/iu;
const CREATABLE_ARTIFACT_PATTERN =
  /\.(?:c|cc|cpp|cs|css|go|h|html|java|js|json|jsx|less|md|mjs|py|rs|scss|svelte|toml|ts|tsx|vue|xml|ya?ml)$/iu;
const CREATION_INTENT_PATTERN =
  /\b(?:add|build|create|generate|implement|scaffold|write|agrega|anade|construye|crea|genera|implementa|escribe)\b/iu;
const GREENFIELD_WEB_PATTERN =
  /\b(?:browser|html|web\s+(?:app|application|page|site)|website)\b/iu;
const CONTEXT_ONLY_BASENAMES = new Set([
  "agents.md",
  "package.json",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "tsconfig.json",
  "readme.md",
]);
const TEST_PATH_PATTERN =
  /(?:^|[\\/])(?:test|tests|spec|specs|__tests__)(?:[\\/]|\.)/iu;
const TEST_TERM_PATTERN = /\b(?:test|tests|testing|spec|coverage|prueba)/iu;

const STOP_WORDS = new Set([
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
  "the",
  "this",
  "with",
  "add",
  "and",
  "for",
  "that",
  "una",
  "este",
  "esta",
  "con",
  "para",
]);

function terms(objective: string): string[] {
  return objective
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .split(/[^a-z0-9_$-]+/u)
    .filter(
      (term) =>
        term.length >= 4 && !STOP_WORDS.has(term) && !/^\d+$/u.test(term),
    )
    .slice(0, 16);
}

function normalize(value: string): string {
  return path.posix
    .normalize(value.replaceAll("\\", "/"))
    .replace(/^\.\//u, "");
}

/**
 * Select a small, deterministic set of likely implementation targets from
 * host search evidence. These are bounded work-unit scope hints. They do not
 * downgrade the parent task's capability requirement or authorize a model
 * that has not passed the required role gate.
 */
export function inferProgressiveTargets(
  objective: string,
  matches: readonly string[],
  limit = 4,
): string[] {
  const objectiveTerms = terms(objective);
  const wantsTests = TEST_TERM_PATTERN.test(objective);
  const ranked = [...new Set(matches.map(normalize))]
    .filter((candidate) => CODE_FILE_PATTERN.test(candidate))
    .map((candidate) => {
      const lower = candidate.toLowerCase();
      const base = path.posix.basename(lower);
      let score = 0;
      for (const term of objectiveTerms) {
        if (lower.includes(term)) score += 4;
        if (base.includes(term)) score += 3;
      }
      if (lower.startsWith("src/")) score += 8;
      if (wantsTests && TEST_PATH_PATTERN.test(candidate)) score += 3;
      if (!wantsTests && TEST_PATH_PATTERN.test(candidate)) score -= 2;
      return { candidate, score };
    })
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.candidate.localeCompare(right.candidate),
    );
  return ranked.slice(0, Math.max(1, limit)).map((entry) => entry.candidate);
}

/**
 * Choose the controller-owned mutation scope. Explicit paths in the user's
 * objective are authoritative; search matches are only a fallback when the
 * user did not name a path. A repository match is evidence for discovery, not
 * permission to expand an already explicit edit scope.
 */
export function selectProgressiveTargets(
  objective: string,
  explicitPaths: readonly string[],
  matches: readonly string[],
  limit = 8,
): string[] {
  const explicit = [...new Set(explicitPaths.map(normalize).filter(Boolean))];
  if (explicit.length > 0) return explicit.slice(0, Math.max(1, limit));
  return inferProgressiveTargets(objective, matches, limit);
}

/**
 * Resolve a model/host preparation proposal into a bounded mutation scope.
 * Existing files remain valid edit targets. Missing files are accepted only
 * for an explicit creation objective, when the proposed artifact is a normal
 * source/document path whose parent already exists inside the workspace.
 */
export async function verifiedPreparationTargets(
  root: string,
  objective: string,
  candidates: readonly string[],
  limit = 8,
): Promise<string[]> {
  const rootPath = path.resolve(root);
  const creationRequested = CREATION_INTENT_PATTERN.test(objective);
  const defaultCreationTargets =
    creationRequested && GREENFIELD_WEB_PATTERN.test(objective)
      ? ["index.html"]
      : [];
  const objectiveLower = objective.toLowerCase();
  const eligible: string[] = [];

  for (const candidate of [...candidates, ...defaultCreationTargets]) {
    const normalized = normalize(candidate);
    if (
      !normalized ||
      normalized === "." ||
      normalized.startsWith("../") ||
      normalized.includes("/../") ||
      !CREATABLE_ARTIFACT_PATTERN.test(normalized)
    )
      continue;
    if (
      CONTEXT_ONLY_BASENAMES.has(path.posix.basename(normalized).toLowerCase()) &&
      !objectiveLower.includes(normalized.toLowerCase())
    )
      continue;

    const absolute = path.resolve(rootPath, normalized);
    const relative = path.relative(rootPath, absolute);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
      continue;

    try {
      if ((await stat(absolute)).isFile())
        eligible.push(relative.replaceAll("\\", "/"));
      continue;
    } catch {
      if (!creationRequested) continue;
    }

    try {
      if ((await stat(path.dirname(absolute))).isDirectory())
        eligible.push(relative.replaceAll("\\", "/"));
    } catch {
      // A missing parent is not a bounded file-creation scope. The agent may
      // discover an existing parent or report the genuine blocker instead.
    }
  }

  const uniqueEligible = [...new Set(eligible)];
  const explicit = selectProgressiveTargets(
    objective,
    uniqueEligible.filter((candidate) =>
      objectiveLower.includes(candidate.toLowerCase()),
    ),
    [],
    limit,
  );
  if (explicit.length > 0) return explicit;
  if (creationRequested) {
    const primaryDefault = defaultCreationTargets.find((candidate) =>
      uniqueEligible.includes(candidate),
    );
    if (primaryDefault) return [primaryDefault];
    return uniqueEligible.slice(0, Math.max(1, limit));
  }
  return selectProgressiveTargets(objective, [], uniqueEligible, limit);
}
