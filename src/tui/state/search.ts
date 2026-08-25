import type { ModelCandidate } from "../../shared/types.js";

function modelSearchText(model: ModelCandidate): string {
  return [model.id, model.displayName, model.providerId, model.local?.runtime]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function rankModels(
  models: readonly ModelCandidate[],
  query: string,
): ModelCandidate[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...models];
  return models
    .map((model, index) => {
      const haystack = modelSearchText(model);
      const terms = normalized.split(/\s+/).filter(Boolean);
      const score = terms.reduce((total, term) => {
        if (haystack.startsWith(term)) return total + 10;
        if (haystack.includes(term)) return total + 5;
        return total - 100;
      }, 0);
      return { model, score, index };
    })
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.model);
}

export function orderModelsForPicker(
  models: readonly ModelCandidate[],
  query: string,
): ModelCandidate[] {
  const ranked = rankModels(models, query);
  return [
    ...ranked.filter((model) => model.source === "local"),
    ...ranked.filter((model) => model.source === "free_cloud"),
  ];
}

function fuzzyScore(value: string, query: string): number | undefined {
  if (!query) return 0;
  let cursor = 0;
  let previous = -2;
  let score = 0;
  for (const character of query) {
    const index = value.indexOf(character, cursor);
    if (index < 0) return undefined;
    score += index === 0 ? 12 : 1;
    if (index === previous + 1) score += 4;
    if (index === cursor) score += 2;
    previous = index;
    cursor = index + 1;
  }
  return score - value.length * 0.01;
}

export function rankFileReferences(
  files: readonly string[],
  query: string,
): string[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [...files];
  return files
    .map((file, index) => ({
      file,
      index,
      score: fuzzyScore(file.toLowerCase(), normalized),
    }))
    .filter(
      (entry): entry is { file: string; index: number; score: number } =>
        entry.score !== undefined,
    )
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map((entry) => entry.file);
}
