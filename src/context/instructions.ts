import { readFile } from "node:fs/promises";
import path from "node:path";
import type { InstructionFile } from "./repository-snapshot.js";

export interface LoadedInstruction extends InstructionFile {
  content: string;
}

function inScope(scope: string, target: string): boolean {
  const normalizedScope =
    scope === "." ? "" : `${scope.replaceAll("\\", "/")}/`;
  const normalizedTarget = target.replaceAll("\\", "/");
  return (
    normalizedTarget === scope || normalizedTarget.startsWith(normalizedScope)
  );
}

function instructionOrder(
  left: InstructionFile,
  right: InstructionFile,
): number {
  const leftDepth = left.scope === "." ? 0 : left.scope.split("/").length;
  const rightDepth = right.scope === "." ? 0 : right.scope.split("/").length;
  return leftDepth - rightDepth || left.path.localeCompare(right.path);
}

export async function loadScopedInstructions(
  root: string,
  files: readonly InstructionFile[],
  targetPaths: readonly string[],
  signal?: AbortSignal,
): Promise<LoadedInstruction[]> {
  const applicable = files
    .filter(
      (file) =>
        file.scope === "." ||
        targetPaths.some((target) => inScope(file.scope, target)),
    )
    .sort(instructionOrder);
  const loaded: LoadedInstruction[] = [];
  for (const file of applicable) {
    if (signal?.aborted)
      throw new DOMException("Instruction loading aborted", "AbortError");
    try {
      loaded.push({
        ...file,
        content: await readFile(path.join(root, file.path), "utf8"),
      });
    } catch {
      // Instructions may be removed between snapshot and load; stale entries
      // are ignored rather than treated as privileged content.
    }
  }
  return loaded;
}
