import { open, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import {
  instructionPrecedence,
  type InstructionTrust,
} from "./trust-policy.js";

const DEFAULT_SKILL_ROOTS = [
  ".agents/skills",
  ".claude/skills",
  ".codex/skills",
];
const DEFAULT_METADATA_CHARS = 8_192;
const DEFAULT_BODY_CHARS = 12_000;

export interface SkillMetadata {
  id: string;
  name: string;
  description: string;
  path: string;
  sourceId: string;
  scope: ".";
  trust: Extract<InstructionTrust, "project">;
  precedence: number;
  keywords: string[];
}

export interface LoadedSkill extends SkillMetadata {
  body: string;
}

export interface SkillCatalogOptions {
  roots?: readonly string[];
  maxSkills?: number;
  metadataChars?: number;
  signal?: AbortSignal;
}

export interface SkillBodyOptions {
  maxChars?: number;
  signal?: AbortSignal;
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
  return absolute.startsWith(rootWithSeparator) ? absolute : undefined;
}

async function readPrefix(file: string, maxChars: number): Promise<string> {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(Math.max(1, maxChars));
    const result = await handle.read(buffer, 0, buffer.length, 0);
    return buffer.subarray(0, result.bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

function frontMatterValue(
  frontMatter: string,
  key: string,
): string | undefined {
  const match = frontMatter.match(new RegExp(`^${key}:\\s*(.+)$`, "imu"));
  return match?.[1]?.trim().replace(/^['"]|['"]$/gu, "");
}

function parseMetadata(
  prefix: string,
  directoryName: string,
): {
  name: string;
  description: string;
} {
  const match = prefix.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/u);
  const frontMatter = match?.[1] ?? "";
  const heading = prefix.match(/^#\s+(.+)$/mu)?.[1]?.trim();
  return {
    name: frontMatterValue(frontMatter, "name") || heading || directoryName,
    description:
      frontMatterValue(frontMatter, "description") ||
      `Project skill ${directoryName}`,
  };
}

function terms(value: string): string[] {
  return [
    ...new Set(
      value
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .split(/[^a-z0-9_/-]+/u)
        .filter((term) => term.length >= 3),
    ),
  ];
}

function skillId(relativePath: string): string {
  return `skill:${relativePath}`;
}

export async function discoverSkillMetadata(
  root: string,
  options: SkillCatalogOptions = {},
): Promise<SkillMetadata[]> {
  const maxSkills = Math.max(1, Math.min(128, options.maxSkills ?? 64));
  const metadataChars = Math.max(
    512,
    Math.min(
      DEFAULT_METADATA_CHARS,
      options.metadataChars ?? DEFAULT_METADATA_CHARS,
    ),
  );
  const canonicalRoot = await realpath(root).catch(() => path.resolve(root));
  const discovered: SkillMetadata[] = [];
  for (const skillRoot of options.roots ?? DEFAULT_SKILL_ROOTS) {
    if (options.signal?.aborted)
      throw new DOMException("Skill discovery aborted", "AbortError");
    const relativeRoot = normalizeRelativePath(skillRoot);
    const absoluteRoot = relativeRoot
      ? safeAbsolutePath(canonicalRoot, relativeRoot)
      : undefined;
    if (!absoluteRoot) continue;
    const entries = await readdir(absoluteRoot, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      if (discovered.length >= maxSkills) break;
      if (options.signal?.aborted)
        throw new DOMException("Skill discovery aborted", "AbortError");
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const relative = `${relativeRoot}/${entry.name}/SKILL.md`;
      const absolute = safeAbsolutePath(canonicalRoot, relative);
      if (!absolute) continue;
      try {
        const canonicalFile = await realpath(absolute);
        const rootWithSeparator = `${canonicalRoot}${path.sep}`;
        if (!canonicalFile.startsWith(rootWithSeparator)) continue;
        const parsed = parseMetadata(
          await readPrefix(canonicalFile, metadataChars),
          entry.name,
        );
        const normalizedPath = normalizeRelativePath(relative);
        if (!normalizedPath) continue;
        discovered.push({
          id: skillId(normalizedPath),
          name: parsed.name.slice(0, 160),
          description: parsed.description.slice(0, 500),
          path: normalizedPath,
          sourceId: normalizedPath,
          scope: ".",
          trust: "project",
          precedence: instructionPrecedence("project", 0, 20),
          keywords: terms(`${parsed.name} ${parsed.description}`).slice(0, 32),
        });
      } catch {
        // Missing or unreadable skills are omitted from the model catalog.
      }
    }
  }
  return discovered.sort((left, right) => left.path.localeCompare(right.path));
}

export function selectRelevantSkills(
  metadata: readonly SkillMetadata[],
  objective: string,
  limit = 2,
): SkillMetadata[] {
  const objectiveTerms = terms(objective);
  return metadata
    .map((skill, index) => {
      const haystack = `${skill.name} ${skill.description}`.toLowerCase();
      const score = objectiveTerms.reduce(
        (total, term) => total + (haystack.includes(term) ? 1 : 0),
        0,
      );
      return { skill, index, score };
    })
    .filter((item) => item.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.skill.path.localeCompare(right.skill.path),
    )
    .slice(0, Math.max(0, Math.min(8, limit)))
    .map((item) => item.skill);
}

export async function loadSkillBodies(
  root: string,
  selected: readonly SkillMetadata[],
  options: SkillBodyOptions = {},
): Promise<LoadedSkill[]> {
  const maxChars = Math.max(
    512,
    Math.min(DEFAULT_BODY_CHARS, options.maxChars ?? DEFAULT_BODY_CHARS),
  );
  const canonicalRoot = await realpath(root).catch(() => path.resolve(root));
  const loaded: LoadedSkill[] = [];
  for (const skill of selected) {
    if (options.signal?.aborted)
      throw new DOMException("Skill loading aborted", "AbortError");
    const absolute = safeAbsolutePath(canonicalRoot, skill.path);
    if (!absolute) continue;
    try {
      const canonicalFile = await realpath(absolute);
      const rootWithSeparator = `${canonicalRoot}${path.sep}`;
      if (!canonicalFile.startsWith(rootWithSeparator)) continue;
      const raw = await readPrefix(
        canonicalFile,
        maxChars + DEFAULT_METADATA_CHARS,
      );
      const body = raw
        .replace(/^---\s*\r?\n[\s\S]*?\r?\n---\s*/u, "")
        .slice(0, maxChars);
      loaded.push({ ...skill, body });
    } catch {
      // Skills are optional expertise; a stale body must not be substituted.
    }
  }
  return loaded;
}

export async function buildSkillContext(
  root: string,
  objective: string,
  options: SkillCatalogOptions & SkillBodyOptions = {},
): Promise<{
  metadata: SkillMetadata[];
  selected: SkillMetadata[];
  loaded: LoadedSkill[];
}> {
  const metadata = await discoverSkillMetadata(root, options);
  const selected = selectRelevantSkills(metadata, objective, 2);
  const loaded = await loadSkillBodies(root, selected, options);
  return { metadata, selected, loaded };
}
