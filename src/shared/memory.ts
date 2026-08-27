export type MemoryKind = "semantic" | "episodic" | "procedural";
export type MemoryProvenance = "observed" | "user_confirmed" | "inferred";

export interface MemoryEvidence {
  source: string;
  contentHash?: string;
  revision?: string;
  lineRange?: [number, number];
}

/**
 * Durable project knowledge is deliberately weaker than fresh repository
 * evidence. It is a hint for context selection, never an authorization to
 * mutate and never a replacement for reading a required file again.
 */
export interface MemoryFact {
  id: string;
  repository: string;
  kind: MemoryKind;
  fact: string;
  evidence: MemoryEvidence[];
  provenance: MemoryProvenance;
  confidence: number;
  scope: string[];
  tags: string[];
  createdAt: string;
  lastValidatedAt: string;
  expiresAt?: string;
}

export interface TaskEpisodeMemoryInput {
  repository: string;
  taskId: string;
  objective: string;
  status: "completed" | "blocked" | "failed" | "cancelled";
  phase: string;
  verified: boolean;
  filesChanged: readonly string[];
  verification: readonly {
    command: string;
    status: string;
  }[];
}

function terms(value: string): string[] {
  return [
    ...new Set(
      value
        .toLowerCase()
        .normalize("NFD")
        .replace(/\p{Diacritic}/gu, "")
        .split(/[^a-z0-9_/-]+/u)
        .filter((term) => term.length >= 4),
    ),
  ];
}

function isFresh(fact: MemoryFact, revision?: string): boolean {
  if (fact.expiresAt && new Date(fact.expiresAt).getTime() <= Date.now())
    return false;
  if (!revision) return true;
  // Observed semantic facts describe repository structure. Without a matching
  // revision they are not safe to present as current knowledge; historical
  // episodic/user-confirmed facts may still be useful as explicitly labelled
  // hints and are rechecked by the host before mutation.
  if (fact.kind === "semantic" && fact.provenance === "observed")
    return (
      fact.evidence.length > 0 &&
      fact.evidence.every((evidence) => evidence.revision === revision)
    );
  return fact.evidence.some(
    (evidence) => !evidence.revision || evidence.revision === revision,
  );
}

/** Select a small, relevance-ranked memory view for a repository objective. */
export function selectRelevantMemory(
  facts: readonly MemoryFact[],
  objective: string,
  revision?: string,
  limit = 6,
  pinnedIds: readonly string[] = [],
): MemoryFact[] {
  const objectiveTerms = terms(objective);
  const freshFacts = facts.filter((fact) => isFresh(fact, revision));
  const pinned = freshFacts.filter((fact) => pinnedIds.includes(fact.id));
  const ranked = freshFacts
    .map((fact) => {
      const searchable = terms(
        `${fact.fact} ${fact.scope.join(" ")} ${fact.tags.join(" ")}`,
      );
      const overlap = objectiveTerms.filter((term) =>
        searchable.includes(term),
      ).length;
      const relevance =
        overlap +
        (fact.provenance === "user_confirmed" ? 0.2 : 0) +
        Math.max(0, Math.min(1, fact.confidence)) * 0.1;
      return { fact, relevance };
    })
    .filter(({ relevance }) => relevance > 0)
    .sort((left, right) => right.relevance - left.relevance)
    .map(({ fact }) => fact);
  const selected = [
    ...pinned,
    ...ranked.filter((fact) => !pinned.some((item) => item.id === fact.id)),
  ];
  return selected.slice(0, Math.max(0, limit));
}

export function memoryFactId(
  repository: string,
  kind: MemoryKind,
  key: string,
): string {
  return `${kind}:${repository}:${key}`
    .replaceAll("\\", "/")
    .replace(/[^a-zA-Z0-9:._/-]+/gu, "-");
}

function redactMemoryText(value: string): string {
  return value
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
      "[REDACTED PRIVATE KEY]",
    )
    .replace(/\b(?:sk-|gh[pousr]_)[A-Za-z0-9_-]{12,}/g, "[REDACTED TOKEN]")
    .replace(/\bBearer\s+[A-Za-z0-9._-]{12,}/gi, "Bearer [REDACTED]")
    .replace(
      /\b(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*[^\s,;]+/gi,
      "[REDACTED SECRET ASSIGNMENT]",
    )
    .slice(0, 320);
}

function safeMemoryPath(value: string): boolean {
  const normalized = value.replaceAll("\\", "/");
  return (
    !/(^|\/)(?:\.env(?:\.|$)|credentials?(?:\.|$)|secrets?(?:\.|$)|id_rsa[^/]*$)/i.test(
      normalized,
    ) && !/\.(?:pem|key|p12|pfx)$/i.test(normalized)
  );
}

/**
 * Store only a compact, non-authoritative outcome of a task. Raw transcripts,
 * shell output and model prose deliberately never enter durable memory.
 */
export function createTaskEpisodeMemoryFact(
  input: TaskEpisodeMemoryInput,
  now = new Date().toISOString(),
): MemoryFact {
  const changedFiles = input.filesChanged.filter(safeMemoryPath).slice(0, 12);
  const verification = input.verification
    .slice(-6)
    .map((run) => `${run.command.slice(0, 120)}=${run.status}`)
    .join(", ");
  const objective = redactMemoryText(input.objective).replace(/\s+/gu, " ");
  const evidence = changedFiles.map((source) => ({ source }));
  return {
    id: memoryFactId(input.repository, "episodic", input.taskId),
    repository: input.repository,
    kind: "episodic",
    fact: `Task ${input.status} (verified=${input.verified}) in phase ${input.phase}: ${objective}. Changed: ${changedFiles.join(", ") || "none"}. Verification: ${verification || "none recorded"}.`,
    evidence,
    provenance: "observed",
    confidence: input.status === "completed" && input.verified ? 1 : 0.5,
    scope: ["task", input.phase],
    tags: [input.status, ...(input.verified ? ["verified"] : [])],
    createdAt: now,
    lastValidatedAt: now,
  };
}
