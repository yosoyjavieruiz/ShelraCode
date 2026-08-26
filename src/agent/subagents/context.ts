import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { compileDecisionContext } from "../../context/context-compiler.js";
import type { ContextPacketCodeSlice } from "../../context/context-compiler.js";
import type { SubagentContextRequest } from "./types.js";

const DEFAULT_MAX_CHARS = 12_000;
const MAX_SOURCE_IDS = 16;
const MAX_FILE_CHARS = 4_000;

export interface SubagentContextPacket {
  text: string;
  sourceIds: string[];
  code: ContextPacketCodeSlice[];
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
  return parts.filter((part) => part && part !== ".").join("/");
}

function safeAbsolute(root: string, relative: string): string | undefined {
  const normalized = normalizeRelativePath(relative);
  if (!normalized) return undefined;
  const absoluteRoot = path.resolve(root);
  const absolute = path.resolve(absoluteRoot, normalized);
  const rootPrefix = `${absoluteRoot}${path.sep}`;
  return absolute.startsWith(rootPrefix) ? absolute : undefined;
}

function clip(value: string, maxChars: number): string {
  const trimmed = value.trim();
  return trimmed.length <= maxChars
    ? trimmed
    : `${trimmed.slice(0, Math.max(0, maxChars - 1))}…`;
}

/**
 * Build child context from explicit source IDs only. The parent's provider
 * transcript, task context and tool outputs are intentionally not copied.
 */
export async function buildSubagentContext(
  root: string,
  objective: string,
  request: SubagentContextRequest,
  signal: AbortSignal,
): Promise<SubagentContextPacket> {
  const maxChars = Math.max(
    2_048,
    Math.min(DEFAULT_MAX_CHARS, request.maxChars ?? DEFAULT_MAX_CHARS),
  );
  const canonicalRoot = await realpath(root).catch(() => path.resolve(root));
  const code: ContextPacketCodeSlice[] = [];
  const sourceIds: string[] = [];
  let usedChars = 0;
  for (const source of [...new Set(request.sourceIds)].slice(
    0,
    MAX_SOURCE_IDS,
  )) {
    if (signal.aborted)
      throw new DOMException("Subagent context aborted", "AbortError");
    const normalized = normalizeRelativePath(source);
    const absolute = normalized
      ? safeAbsolute(canonicalRoot, normalized)
      : undefined;
    if (!normalized || !absolute) continue;
    try {
      const canonicalFile = await realpath(absolute);
      const rootPrefix = `${canonicalRoot}${path.sep}`;
      if (!canonicalFile.startsWith(rootPrefix)) continue;
      const remaining = Math.max(0, maxChars - usedChars);
      if (remaining <= 0) break;
      const content = clip(
        await readFile(canonicalFile, "utf8"),
        Math.min(MAX_FILE_CHARS, remaining),
      );
      if (!content) continue;
      code.push({ path: normalized, content });
      sourceIds.push(normalized);
      usedChars += normalized.length + content.length;
    } catch {
      // A missing source is omitted; the child must use its bounded tools to
      // discover another path rather than receiving guessed repository text.
    }
  }
  const evidence = (request.evidence ?? [])
    .map((item) => ({
      source: clip(item.source, 300),
      kind: "parent-evidence",
      summary: clip(item.summary, 1_000),
      relevance: 0.5,
    }))
    .filter((item) => item.source && item.summary);
  const packet = compileDecisionContext({
    objective,
    subtask: "Perform only the delegated read-only investigation.",
    evidence,
    code,
    legalActions: [],
    expectedOutput: "Return concise findings with source IDs and evidence.",
    tokenBudget: Math.max(512, Math.ceil(maxChars / 4)),
  });
  return { text: packet.text, sourceIds, code };
}
