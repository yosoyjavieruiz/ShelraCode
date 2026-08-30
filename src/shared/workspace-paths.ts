/**
 * Canonicalize a workspace-relative path for comparison. A model (especially
 * a small local one) commonly spells "the whole project" as "/" or
 * "/src/foo" rather than "." or "src/foo" (see resolveWorkspacePath in
 * paths.ts), and can emit redundant "./" or ".." segments. Two spellings of
 * the same file must normalize identically or every set-based comparison
 * against git-reported paths (resume checks, evidence tracking, staged-path
 * matching) silently drifts apart.
 */
export function normalizeWorkspacePath(value: string): string {
  const parts: string[] = [];
  const raw = value.trim().replaceAll("\\", "/").replace(/^\/+/, "");
  for (const part of raw.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      const previous = parts.at(-1);
      if (previous && previous !== "..") parts.pop();
      else parts.push(part);
      continue;
    }
    parts.push(part);
  }
  return parts.join("/");
}

/** True on platforms whose default filesystem does not distinguish case (NTFS, default APFS). Linux's common filesystems (ext4, etc.) are case-sensitive. */
function hasCaseInsensitiveDefaultFilesystem(): boolean {
  return process.platform === "win32" || process.platform === "darwin";
}

/** Comparison key for a workspace-relative path: normalized, and case-folded only where the platform's default filesystem would treat case as insignificant. */
export function workspacePathComparisonKey(value: string): string {
  const normalized = normalizeWorkspacePath(value);
  return hasCaseInsensitiveDefaultFilesystem()
    ? normalized.toLowerCase()
    : normalized;
}

/** Compare two absolute repository roots for identity (not workspace-relative paths: no leading-slash stripping or ".." collapsing applies). */
export function workspaceRootsMatch(left: string, right: string): boolean {
  const normalize = (value: string): string => {
    const trimmed = value.replaceAll("\\", "/").replace(/\/+$/, "");
    return hasCaseInsensitiveDefaultFilesystem()
      ? trimmed.toLowerCase()
      : trimmed;
  };
  return normalize(left) === normalize(right);
}
