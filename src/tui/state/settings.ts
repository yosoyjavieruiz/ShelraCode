const SETTING_LABELS = [
  "Theme appearance",
  "Accent Violet appearance",
  "Interface density appearance",
  "Motion appearance",
  "Repository privacy private local policy",
  "Routing mode strict zero ask before paid policy",
  "Permission mode plan edit auto policy",
  "Secondary chrome layout",
  "Tool activity interaction",
  "Keybindings interaction",
  "Telemetry privacy",
] as const;

export function filterSettingIndices(query: string): number[] {
  const normalized = query.trim().toLowerCase();
  return SETTING_LABELS.map((label, index) => ({
    index,
    label: label.toLowerCase(),
  }))
    .filter((entry) => !normalized || entry.label.includes(normalized))
    .map((entry) => entry.index);
}

export function moveSettingIndex(
  current: number,
  direction: 1 | -1,
  query = "",
): number {
  const indices = filterSettingIndices(query);
  if (indices.length === 0) return current;
  const existingPosition = indices.indexOf(current);
  if (existingPosition < 0) {
    return direction === 1
      ? (indices[0] ?? current)
      : (indices[indices.length - 1] ?? current);
  }
  const position = existingPosition;
  return (
    indices[(position + direction + indices.length) % indices.length] ?? current
  );
}
