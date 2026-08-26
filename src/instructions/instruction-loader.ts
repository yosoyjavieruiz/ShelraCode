import { realpath, readFile } from "node:fs/promises";
import path from "node:path";
import type { InstructionFile } from "../context/repository-snapshot.js";
import {
  instructionPrecedence,
  isPrivilegedInstructionName,
  type InstructionKind,
  type InstructionTrust,
} from "./trust-policy.js";

export interface InstructionMetadata extends InstructionFile {
  sourceId: string;
  kind: Extract<InstructionKind, "agents" | "claude">;
  trust: Extract<InstructionTrust, "project">;
  precedence: number;
}

export interface LoadedInstruction extends InstructionMetadata {
  content: string;
}

function normalizeRelativePath(value: string): string | undefined {
  const normalized = value.replaceAll("\\", "/").replace(/^\.\//u, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    /^[A-Za-z]:\//u.test(normalized)
  )
    return undefined;
  const parts = normalized.split("/");
  if (parts.some((part) => part === "..")) return undefined;
  return parts.filter((part) => part.length > 0 && part !== ".").join("/");
}

function safeAbsolutePath(root: string, relative: string): string | undefined {
  const normalized = normalizeRelativePath(relative);
  if (!normalized) return undefined;
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(absoluteRoot, normalized);
  const rootWithSeparator = `${absoluteRoot}${path.sep}`;
  return absolute === absoluteRoot || absolute.startsWith(rootWithSeparator)
    ? absolute
    : undefined;
}

function instructionKind(
  relativePath: string,
): Extract<InstructionKind, "agents" | "claude"> | undefined {
  const basename = path.posix.basename(relativePath);
  if (basename === "CLAUDE.md") return "claude";
  if (basename === "AGENTS.md" || basename === "AGENTS.override.md")
    return "agents";
  return undefined;
}

function scopeDepth(scope: string): number {
  return scope === "." ? 0 : scope.split("/").filter(Boolean).length;
}

function metadataFor(file: InstructionFile): InstructionMetadata | undefined {
  const relative = normalizeRelativePath(file.path);
  const kind = relative ? instructionKind(relative) : undefined;
  if (!relative || !kind || !isPrivilegedInstructionName(relative))
    return undefined;
  const scope =
    file.scope === "."
      ? "."
      : normalizeRelativePath(file.scope)?.replace(/\/$/u, "") || ".";
  return {
    path: relative,
    scope,
    sourceId: relative,
    kind,
    trust: "project",
    precedence: instructionPrecedence(
      "project",
      scopeDepth(scope),
      path.posix.basename(relative) === "AGENTS.override.md" ? 2 : 0,
    ),
  };
}

function inScope(scope: string, target: string): boolean {
  if (scope === ".") return true;
  const normalizedScope = scope.replaceAll("\\", "/").replace(/^\.\//u, "");
  const normalizedTarget = target.replaceAll("\\", "/").replace(/^\.\//u, "");
  return (
    normalizedTarget === normalizedScope ||
    normalizedTarget.startsWith(`${normalizedScope}/`)
  );
}

function orderInstructions(
  left: InstructionMetadata,
  right: InstructionMetadata,
): number {
  // Parent policy is rendered before a more-specific child so the child can
  // explicitly override it in the model view.  The numeric precedence still
  // records which source wins for host-side consumers.
  return (
    scopeDepth(left.scope) - scopeDepth(right.scope) ||
    left.precedence - right.precedence ||
    left.path.localeCompare(right.path)
  );
}

export function selectScopedInstructionMetadata(
  files: readonly InstructionFile[],
  targetPaths: readonly string[],
): InstructionMetadata[] {
  return files
    .map(metadataFor)
    .filter((file): file is InstructionMetadata => Boolean(file))
    .filter(
      (file) =>
        file.scope === "." ||
        targetPaths.some((target) => inScope(file.scope, target)),
    )
    .sort(orderInstructions);
}

export async function loadInstructionBodies(
  root: string,
  metadata: readonly InstructionMetadata[],
  signal?: AbortSignal,
  maxChars = 8_000,
): Promise<LoadedInstruction[]> {
  const canonicalRoot = await realpath(root).catch(() => path.resolve(root));
  const loaded: LoadedInstruction[] = [];
  for (const item of metadata) {
    if (signal?.aborted)
      throw new DOMException("Instruction loading aborted", "AbortError");
    const absolute = safeAbsolutePath(canonicalRoot, item.path);
    if (!absolute) continue;
    try {
      const canonicalFile = await realpath(absolute);
      const rootWithSeparator = `${canonicalRoot}${path.sep}`;
      if (
        canonicalFile !== canonicalRoot &&
        !canonicalFile.startsWith(rootWithSeparator)
      )
        continue;
      const content = (await readFile(canonicalFile, "utf8")).slice(
        0,
        Math.max(1, maxChars),
      );
      loaded.push({ ...item, content });
    } catch {
      // Snapshot entries can disappear between discovery and model execution.
      // A stale instruction is not silently replaced with untrusted content.
    }
  }
  return loaded;
}
