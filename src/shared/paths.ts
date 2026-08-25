import { lstat, realpath } from "node:fs/promises";
import path from "node:path";
import { ToolError } from "../tools/errors.js";

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

export function resolveWorkspacePath(
  root: string,
  relativePath: string,
): string {
  const resolvedRoot = path.resolve(root);
  // A model (especially a small local one) commonly spells "the whole
  // project" as "/" or "/src/foo" rather than "." or "src/foo". Treat a
  // leading slash as workspace-relative instead of an OS-absolute path —
  // this can only ever resolve further *inside* resolvedRoot, never
  // outside it, so it does not weaken the escape check below.
  const normalized = relativePath.replace(/^[/\\]+/, "");
  const resolved = path.resolve(resolvedRoot, normalized);
  if (!isInside(resolvedRoot, resolved))
    throw new ToolError(
      "OUTSIDE_WORKSPACE",
      `Path escapes workspace: ${relativePath}`,
      {
        path: relativePath,
        recoverable: false,
        suggestedAction: "Use a workspace-relative path inside the repository.",
      },
    );
  return resolved;
}

export async function assertWorkspacePath(
  root: string,
  relativePath: string,
): Promise<string> {
  const absolute = resolveWorkspacePath(root, relativePath);
  const rootReal = await realpath(root);
  let current = absolute;
  while (true) {
    try {
      const stat = await lstat(current);
      if (stat.isSymbolicLink()) {
        const target = await realpath(current);
        if (!isInside(rootReal, target))
          throw new ToolError(
            "OUTSIDE_WORKSPACE",
            `Symlink escapes workspace: ${relativePath}`,
            {
              path: relativePath,
              recoverable: false,
              suggestedAction:
                "Use a path whose resolved target stays inside the workspace.",
            },
          );
      }
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        (error as NodeJS.ErrnoException).code === "ENOENT"
      ))
        throw error;
    }
    const parent = path.dirname(current);
    if (parent === current || current === path.resolve(root)) break;
    current = parent;
  }
  return absolute;
}
