const DEFAULT_HISTORY_LIMIT = 50;

export function addPromptToHistory(
  history: readonly string[],
  prompt: string,
  limit = DEFAULT_HISTORY_LIMIT,
): string[] {
  const value = prompt.trim();
  if (!value) return [...history];
  return [value, ...history.filter((entry) => entry !== value)].slice(
    0,
    Math.max(1, limit),
  );
}

export function navigatePromptHistory(
  history: readonly string[],
  index: number,
  direction: -1 | 1,
  draft: string,
): { index: number; value: string; draft: string } {
  if (history.length === 0) {
    return { index: -1, value: draft, draft };
  }
  const next =
    index < 0
      ? direction < 0
        ? history.length - 1
        : -1
      : index + direction;
  if (next < 0) return { index: 0, value: history[0] ?? draft, draft };
  if (next >= history.length) return { index: -1, value: draft, draft };
  return { index: next, value: history[next] ?? draft, draft };
}
