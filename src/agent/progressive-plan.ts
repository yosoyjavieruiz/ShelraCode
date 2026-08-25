import path from "node:path";

const CODE_FILE_PATTERN =
  /\.(?:c|cc|cpp|cs|go|h|java|js|jsx|mjs|py|rs|ts|tsx|vue|svelte)$/iu;
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
 * host search evidence. This is only used by the guarded low-capability route;
 * a strict advanced route leaves discovery to the model and its tools.
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
