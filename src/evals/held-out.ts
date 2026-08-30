import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import type { PublicEvaluationCase } from "./schema.js";
import { EvaluationSchemaError, parsePublicEvaluationCase } from "./schema.js";

export interface ProtectedAcceptanceOracle {
  schemaVersion: 1;
  id: string;
  caseId: string;
  caseRevision: string;
  payload: Record<string, unknown>;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new EvaluationSchemaError(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0)
    throw new EvaluationSchemaError(`${label} must be a non-empty string.`);
  return value;
}

function parseOracle(value: unknown): ProtectedAcceptanceOracle {
  const oracle = record(value, "protected acceptance oracle");
  const allowed = new Set([
    "schemaVersion",
    "id",
    "caseId",
    "caseRevision",
    "payload",
  ]);
  for (const key of Object.keys(oracle))
    if (!allowed.has(key))
      throw new EvaluationSchemaError(
        `Unexpected protected acceptance oracle field: ${key}`,
      );
  if (oracle.schemaVersion !== 1)
    throw new EvaluationSchemaError(
      "Invalid protected acceptance oracle schema version.",
    );
  return {
    schemaVersion: 1,
    id: requiredText(oracle.id, "protected acceptance oracle id"),
    caseId: requiredText(oracle.caseId, "protected acceptance oracle caseId"),
    caseRevision: requiredText(
      oracle.caseRevision,
      "protected acceptance oracle caseRevision",
    ),
    payload: record(oracle.payload, "protected acceptance oracle payload"),
  };
}

export async function loadProtectedAcceptanceOracle(
  evaluationCase: PublicEvaluationCase,
  protectedRoot: string,
): Promise<ProtectedAcceptanceOracle> {
  const safeCase = parsePublicEvaluationCase(evaluationCase);
  const reference = safeCase.protectedAcceptanceRef;
  if (!reference)
    throw new EvaluationSchemaError(
      `Evaluation case ${safeCase.caseId} has no protected acceptance reference.`,
    );
  const rootStat = await lstat(protectedRoot);
  if (rootStat.isSymbolicLink())
    throw new EvaluationSchemaError(
      "The protected acceptance root must not be a symbolic link.",
    );
  if (!rootStat.isDirectory())
    throw new EvaluationSchemaError(
      "The protected acceptance root must be a directory.",
    );
  const resolvedRoot = await realpath(protectedRoot);
  const oraclePath = path.join(protectedRoot, `${reference.id}.json`);
  const oracleStat = await lstat(oraclePath);
  if (oracleStat.isSymbolicLink() || !oracleStat.isFile())
    throw new EvaluationSchemaError(
      "The protected acceptance oracle must be a regular file.",
    );
  const resolvedOracle = await realpath(oraclePath);
  if (path.dirname(resolvedOracle) !== resolvedRoot)
    throw new EvaluationSchemaError(
      "The protected acceptance oracle must remain inside its root.",
    );
  const contents = await readFile(oraclePath, "utf8");
  const digest = createHash("sha256").update(contents).digest("hex");
  if (digest !== reference.sha256)
    throw new EvaluationSchemaError(
      `Protected acceptance digest mismatch for ${reference.id}.`,
    );
  const oracle = parseOracle(JSON.parse(contents) as unknown);
  if (oracle.id !== reference.id)
    throw new EvaluationSchemaError(
      `Protected acceptance id mismatch for ${reference.id}.`,
    );
  if (
    oracle.caseId !== safeCase.caseId ||
    oracle.caseRevision !== safeCase.revision
  )
    throw new EvaluationSchemaError(
      `Protected acceptance case mismatch for ${reference.id}.`,
    );
  return oracle;
}
