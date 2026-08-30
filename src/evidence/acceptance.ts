import { redactEvaluationValue } from "../evals/redaction.js";
import type {
  AcceptanceCriterion,
  CriterionStatus,
  Deliverable,
  EvidenceRequirement,
  TaskContract,
} from "../agent/task-contract.js";
import { isGreenfieldObjective } from "../agent/task-contract.js";
import type {
  AgentAction,
  AgentTaskLedger,
  ContextEvidence,
} from "../agent/task-state.js";
import type { ObjectiveProofAssessment } from "../agent/objective-proof.js";

/** The host-owned obligation categories used by proof-backed completion. */
export type AcceptanceObligationType =
  | "behavioral"
  | "test"
  | "build"
  | "type"
  | "security"
  | "performance"
  | "documentation"
  | "manual";

export type AcceptanceObligationStatus =
  "pending" | "satisfied" | "failed" | "blocked";

export type EvidenceSource =
  | "command"
  | "file"
  | "diagnostic"
  | "test"
  | "diff"
  | "runtime"
  | "human"
  | "external";

export type VerifierKind = "command" | "artifact" | "manual" | "host";

export interface VerifierRef {
  id: string;
  kind: VerifierKind;
  command?: string;
}

export interface AcceptanceObligation {
  id: string;
  statement: string;
  type: AcceptanceObligationType;
  verifier?: VerifierRef;
  required: boolean;
  status: AcceptanceObligationStatus;
}

export interface EvidenceRecord {
  id: string;
  obligationId?: string;
  source: EvidenceSource;
  command?: string;
  artifactRef?: string;
  exitCode?: number;
  summary: string;
  digest?: string;
  createdAt: string;
}

export interface AcceptanceProofAssessment {
  canComplete: boolean;
  /** True only when a caller claimed completion without sufficient proof. */
  falseSuccess: boolean;
  reasons: string[];
  obligations: AcceptanceObligation[];
  /** Evidence IDs that directly support at least one required obligation. */
  evidenceRefs: string[];
}

export interface EvaluateAcceptanceProofInput {
  obligations: readonly AcceptanceObligation[];
  evidence: readonly EvidenceRecord[];
  /** A model/controller completion declaration is never proof by itself. */
  declaredComplete?: boolean;
  /** Empty obligation sets are rejected by default for a completion claim. */
  requireObligations?: boolean;
}

export interface EvidenceStoreSnapshot {
  schemaVersion: 1;
  tasks: Record<string, EvidenceRecord[]>;
}

export interface EvidenceStore {
  record(taskId: string, evidence: EvidenceRecord): EvidenceRecord;
  recordMany(
    taskId: string,
    evidence: readonly EvidenceRecord[],
  ): EvidenceRecord[];
  list(taskId: string): EvidenceRecord[];
  get(taskId: string, evidenceId: string): EvidenceRecord | undefined;
  snapshot(): EvidenceStoreSnapshot;
  restore(snapshot: EvidenceStoreSnapshot | unknown): void;
  clear(taskId?: string): void;
}

export interface DeriveTaskEvidenceInput {
  taskId: string;
  contract: TaskContract;
  ledger: AgentTaskLedger;
  objectiveProof?: ObjectiveProofAssessment;
}

const COMPLETION_EVIDENCE_SOURCES = new Set<EvidenceSource>([
  "command",
  "file",
  "diagnostic",
  "test",
  "diff",
  "runtime",
]);

const MAX_ID_LENGTH = 256;
const MAX_STATEMENT_LENGTH = 8_000;
const MAX_SUMMARY_LENGTH = 8_000;
const MAX_COMMAND_LENGTH = 8_000;
const MAX_ARTIFACT_REF_LENGTH = 2_000;
const MAX_DIGEST_LENGTH = 256;
const MAX_EVIDENCE_PER_TASK = 512;
const MAX_TASKS = 2_048;
const MAX_REASONS = 32;

const obligationTypes = new Set<AcceptanceObligationType>([
  "behavioral",
  "test",
  "build",
  "type",
  "security",
  "performance",
  "documentation",
  "manual",
]);
const obligationStatuses = new Set<AcceptanceObligationStatus>([
  "pending",
  "satisfied",
  "failed",
  "blocked",
]);
const evidenceSources = new Set<EvidenceSource>([
  "command",
  "file",
  "diagnostic",
  "test",
  "diff",
  "runtime",
  "human",
  "external",
]);
const verifierKinds = new Set<VerifierKind>([
  "command",
  "artifact",
  "manual",
  "host",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(
  value: unknown,
  field: string,
  maxLength: number,
  required = true,
  allowLineBreaks = false,
): string | undefined {
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string.`);
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} must not be empty.`);
  if (normalized.length > maxLength)
    throw new Error(`${field} exceeds the ${maxLength}-character limit.`);
  const controlCheck = allowLineBreaks
    ? normalized.replace(/[\r\n\t]/gu, "")
    : normalized;
  if (/\p{Cc}/u.test(controlCheck))
    throw new Error(`${field} contains control characters.`);
  return normalized;
}

function finiteTimestamp(value: unknown): string {
  const timestamp = boundedText(value, "createdAt", 128);
  if (Number.isNaN(Date.parse(timestamp!)))
    throw new Error("createdAt must be a valid timestamp.");
  return timestamp!;
}

function integerExitCode(value: unknown): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isInteger(value))
    throw new Error("exitCode must be an integer when provided.");
  if (value < -32_768 || value > 32_767)
    throw new Error("exitCode is outside the supported range.");
  return value;
}

function normalizedStatus(value: unknown): AcceptanceObligationStatus {
  if (
    typeof value !== "string" ||
    !obligationStatuses.has(value as AcceptanceObligationStatus)
  )
    throw new Error("status is not a valid acceptance-obligation status.");
  return value as AcceptanceObligationStatus;
}

function normalizedVerifier(value: unknown): VerifierRef | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error("verifier must be an object.");
  const id = boundedText(value.id, "verifier.id", MAX_ID_LENGTH);
  const kind = value.kind;
  if (typeof kind !== "string" || !verifierKinds.has(kind as VerifierKind))
    throw new Error("verifier.kind is not supported.");
  const command = boundedText(
    value.command,
    "verifier.command",
    MAX_COMMAND_LENGTH,
    false,
  );
  if (kind === "command" && !command)
    throw new Error("command verifiers require verifier.command.");
  return {
    id: id!,
    kind: kind as VerifierKind,
    ...(command ? { command } : {}),
  };
}

function normalizeForRedaction(value: unknown): unknown {
  return redactEvaluationValue(value);
}

/** Validate and secret-scrub one canonical obligation before it is persisted. */
export function normalizeAcceptanceObligation(
  input: AcceptanceObligation | unknown,
): AcceptanceObligation {
  if (!isRecord(input))
    throw new Error("Acceptance obligation must be an object.");
  const redacted = normalizeForRedaction(input);
  if (!isRecord(redacted)) throw new Error("Acceptance obligation is invalid.");
  const id = boundedText(redacted.id, "id", MAX_ID_LENGTH);
  const statement = boundedText(
    redacted.statement,
    "statement",
    MAX_STATEMENT_LENGTH,
    true,
    true,
  );
  const type = redacted.type;
  if (
    typeof type !== "string" ||
    !obligationTypes.has(type as AcceptanceObligationType)
  )
    throw new Error("type is not a valid acceptance-obligation type.");
  if (typeof redacted.required !== "boolean")
    throw new Error("required must be a boolean.");
  return {
    id: id!,
    statement: statement!,
    type: type as AcceptanceObligationType,
    ...(redacted.verifier !== undefined
      ? { verifier: normalizedVerifier(redacted.verifier) }
      : {}),
    required: redacted.required,
    status: normalizedStatus(redacted.status),
  };
}

/** Validate and secret-scrub one host-produced evidence record. */
export function normalizeEvidenceRecord(
  input: EvidenceRecord | unknown,
): EvidenceRecord {
  if (!isRecord(input)) throw new Error("Evidence record must be an object.");
  const redacted = normalizeForRedaction(input);
  if (!isRecord(redacted)) throw new Error("Evidence record is invalid.");
  const id = boundedText(redacted.id, "id", MAX_ID_LENGTH);
  const obligationId = boundedText(
    redacted.obligationId,
    "obligationId",
    MAX_ID_LENGTH,
    false,
  );
  const source = redacted.source;
  if (
    typeof source !== "string" ||
    !evidenceSources.has(source as EvidenceSource)
  )
    throw new Error("source is not a valid evidence source.");
  const command = boundedText(
    redacted.command,
    "command",
    MAX_COMMAND_LENGTH,
    false,
  );
  const artifactRef = boundedText(
    redacted.artifactRef,
    "artifactRef",
    MAX_ARTIFACT_REF_LENGTH,
    false,
  );
  const summary = boundedText(
    redacted.summary,
    "summary",
    MAX_SUMMARY_LENGTH,
    true,
    true,
  );
  const digest = boundedText(
    redacted.digest,
    "digest",
    MAX_DIGEST_LENGTH,
    false,
  );
  if (source === "command" && !command)
    throw new Error("command evidence requires command.");
  const exitCode = integerExitCode(redacted.exitCode);
  return {
    id: id!,
    ...(obligationId ? { obligationId } : {}),
    source: source as EvidenceSource,
    ...(command ? { command } : {}),
    ...(artifactRef ? { artifactRef } : {}),
    ...(exitCode === undefined ? {} : { exitCode }),
    summary: summary!,
    ...(digest ? { digest } : {}),
    createdAt: finiteTimestamp(redacted.createdAt),
  };
}

function criterionType(
  criterion: AcceptanceCriterion,
): AcceptanceObligationType {
  const verificationClass = criterion.verificationClass?.trim().toLowerCase();
  if (verificationClass === "project" || verificationClass === "test")
    return "test";
  if (verificationClass === "build") return "build";
  if (verificationClass === "type" || verificationClass === "typecheck")
    return "type";
  if (verificationClass === "security") return "security";
  if (verificationClass === "performance") return "performance";
  if (verificationClass === "review" || verificationClass === "manual")
    return "manual";
  if (verificationClass === "documentation" || verificationClass === "docs")
    return "documentation";
  return "behavioral";
}

function deliverableType(deliverable: Deliverable): AcceptanceObligationType {
  const kind = deliverable.kind.toLowerCase();
  if (kind.includes("doc")) return "documentation";
  if (kind.includes("test")) return "test";
  if (kind.includes("build")) return "build";
  return "behavioral";
}

function evidenceRequirementType(
  requirement: EvidenceRequirement,
): AcceptanceObligationType {
  if (requirement.kind === "verification") return "test";
  if (requirement.kind === "review") return "manual";
  if (requirement.kind === "artifact") return "documentation";
  return "behavioral";
}

function mapCriterionStatus(
  status: CriterionStatus,
): AcceptanceObligationStatus {
  if (status === "satisfied" || status === "not_applicable") return "satisfied";
  if (status === "failed") return "failed";
  return "pending";
}

function pushUnique(
  output: AcceptanceObligation[],
  item: AcceptanceObligation,
): void {
  if (output.some((existing) => existing.id === item.id))
    throw new Error(`Duplicate acceptance obligation id: ${item.id}`);
  output.push(normalizeAcceptanceObligation(item));
}

/**
 * Convert the existing controller TaskContract into the canonical proof
 * surface. Namespaces keep deliverables, criteria, and evidence requirements
 * distinct even when their source IDs happen to be equal.
 */
export function compileAcceptanceObligations(
  contract: TaskContract,
): AcceptanceObligation[] {
  const output: AcceptanceObligation[] = [];
  for (const deliverable of contract.deliverables)
    pushUnique(output, {
      id: `deliverable:${deliverable.id}`,
      statement: deliverable.description,
      type: deliverableType(deliverable),
      required: deliverable.required,
      status: mapCriterionStatus(deliverable.status),
    });
  for (const criterion of contract.acceptanceCriteria)
    pushUnique(output, {
      id: `criterion:${criterion.id}`,
      statement: criterion.description,
      type: criterionType(criterion),
      ...(criterion.verificationClass
        ? {
            verifier: {
              id: `criterion:${criterion.id}`,
              kind:
                criterion.verificationClass === "review" ? "manual" : "host",
            },
          }
        : {}),
      required: criterion.required,
      status: mapCriterionStatus(criterion.status),
    });
  for (const requirement of contract.evidenceRequirements)
    pushUnique(output, {
      id: `evidence:${requirement.id}`,
      statement: requirement.description,
      type: evidenceRequirementType(requirement),
      verifier:
        requirement.kind === "review"
          ? { id: `evidence:${requirement.id}`, kind: "manual" }
          : { id: `evidence:${requirement.id}`, kind: "host" },
      required: requirement.required,
      status: "pending",
    });
  return output;
}

/** Stable namespacing helper for adapters that need to link host evidence. */
export function acceptanceObligationId(
  namespace: "deliverable" | "criterion" | "evidence",
  id: string,
): string {
  const normalized = boundedText(id, "id", MAX_ID_LENGTH);
  return `${namespace}:${normalized}`;
}

function verifierMatches(
  evidence: EvidenceRecord,
  verifier: VerifierRef | undefined,
): boolean {
  if (!verifier) return true;
  if (verifier.kind === "command")
    return evidence.source === "command" || evidence.source === "test"
      ? evidence.command === verifier.command
      : false;
  if (verifier.kind === "artifact") return evidence.artifactRef === verifier.id;
  if (verifier.kind === "manual")
    return evidence.source === "human" || evidence.source === "diff";
  // A host verifier explicitly excludes model prose because that is not a
  // canonical EvidenceSource. It accepts only observations produced by the
  // runtime or its deterministic repository/verification boundaries.
  return evidence.source !== "human" && evidence.source !== "external";
}

function sourceCanProve(
  obligation: AcceptanceObligation,
  evidence: EvidenceRecord,
): boolean {
  if (evidence.obligationId !== obligation.id) return false;
  if (!verifierMatches(evidence, obligation.verifier)) return false;
  if (evidence.exitCode !== undefined && evidence.exitCode !== 0) return false;
  switch (obligation.type) {
    case "test":
    case "build":
    case "type":
    case "security":
    case "performance":
      return (
        (evidence.source === "test" ||
          evidence.source === "command" ||
          evidence.source === "runtime") &&
        evidence.exitCode === 0
      );
    case "manual":
      // A deterministic host diff review is the proof for the controller's
      // existing `review` contract. Human evidence remains valid for truly
      // manual acceptance obligations.
      return evidence.source === "human" || evidence.source === "diff";
    case "documentation":
      return (
        (evidence.source === "file" ||
          evidence.source === "diff" ||
          evidence.source === "runtime") &&
        Boolean(evidence.artifactRef)
      );
    case "behavioral":
      return COMPLETION_EVIDENCE_SOURCES.has(evidence.source);
  }
}

function contextEvidenceSource(kind: ContextEvidence["kind"]): EvidenceSource {
  if (kind === "test") return "test";
  if (kind === "git") return "diff";
  if (kind === "file" || kind === "manifest" || kind === "search")
    return "file";
  return "runtime";
}

function actionEvidenceSource(action: AgentAction): EvidenceSource | undefined {
  if (action.kind === "read") return "file";
  if (action.kind === "write" || action.kind === "review") return "diff";
  if (action.kind === "execute" || action.kind === "verify") return "command";
  return undefined;
}

function nonEmptySummary(value: string | undefined, fallback: string): string {
  return value?.trim() ? value : fallback;
}

function normalizedPath(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "").toLowerCase();
}

function obligationExists(
  obligations: readonly AcceptanceObligation[],
  id: string,
): boolean {
  return obligations.some((obligation) => obligation.id === id);
}

/**
 * Project the existing host ledger into canonical EvidenceRecords for a
 * completion decision. Model semantic prose and `decision` evidence are
 * intentionally excluded. This adapter is deliberately ephemeral; durable
 * persistence of the records belongs to the task-state/resume phase.
 */
export function deriveEvidenceRecordsFromTaskState(
  input: DeriveTaskEvidenceInput,
): EvidenceRecord[] {
  const obligations = compileAcceptanceObligations(input.contract);
  const records: EvidenceRecord[] = [];
  const timestamp = input.ledger.updatedAt;
  const add = (
    id: string,
    obligationId: string,
    details: Omit<EvidenceRecord, "id" | "obligationId" | "createdAt">,
    createdAt = timestamp,
  ): void => {
    if (!obligationExists(obligations, obligationId)) return;
    records.push({ id, obligationId, createdAt, ...details });
  };

  const repositoryId = "evidence:evidence-repository";
  if (obligationExists(obligations, repositoryId))
    for (const item of input.ledger.evidence) {
      // A semantic model decision is not host repository evidence. All other
      // context kinds are host-produced observations and may support the
      // repository-evidence obligation.
      if (item.kind === "decision") continue;
      add(`${input.taskId}:context:${item.id}:${repositoryId}`, repositoryId, {
        source: contextEvidenceSource(item.kind),
        summary: item.summary,
      });
    }

  const scopeId = "evidence:evidence-scope";
  for (const action of input.ledger.actions) {
    if (action.status !== "succeeded") continue;
    const source = actionEvidenceSource(action);
    if (!source) continue;
    const artifactRef = action.target.trim() || undefined;
    if (
      (action.kind === "read" ||
        (action.kind === "write" &&
          (isGreenfieldObjective(input.contract.objective) ||
            input.contract.repositoryScope.explicitPaths.some(
              (candidate) =>
                normalizedPath(candidate) === normalizedPath(artifactRef ?? ""),
            )))) &&
      artifactRef &&
      obligationExists(obligations, scopeId)
    )
      add(`${input.taskId}:scope:${action.id}`, scopeId, {
        source: action.kind === "read" ? "file" : "diff",
        artifactRef,
        summary: nonEmptySummary(
          action.summary,
          action.kind === "read"
            ? `The host read ${artifactRef}.`
            : `The host verified the approved mutation target ${artifactRef}.`,
        ),
      });

    if (action.kind === "write" && artifactRef) {
      for (const deliverable of input.contract.deliverables) {
        const target = deliverable.targetPaths?.some(
          (candidate) =>
            normalizedPath(candidate) === normalizedPath(artifactRef),
        );
        if (!target) continue;
        const deliverableId = `deliverable:${deliverable.id}`;
        add(
          `${input.taskId}:deliverable:${action.id}:${deliverableId}`,
          deliverableId,
          {
            source: "diff",
            artifactRef,
            summary: nonEmptySummary(
              action.summary,
              `The host recorded a mutation in ${artifactRef}.`,
            ),
          },
          action.completedAt ?? action.startedAt ?? timestamp,
        );
      }
      if (
        input.contract.permissions.repositoryWrite &&
        input.contract.deliverables.some(
          (deliverable) =>
            deliverable.required &&
            (!deliverable.targetPaths || deliverable.targetPaths.length === 0),
        )
      ) {
        for (const deliverable of input.contract.deliverables.filter(
          (candidate) =>
            candidate.required &&
            (!candidate.targetPaths || candidate.targetPaths.length === 0),
        )) {
          const deliverableId = `deliverable:${deliverable.id}`;
          add(
            `${input.taskId}:deliverable:${action.id}:${deliverableId}`,
            deliverableId,
            {
              source: "diff",
              artifactRef,
              summary: nonEmptySummary(
                action.summary,
                `The host recorded a mutation for the requested outcome in ${artifactRef}.`,
              ),
            },
            action.completedAt ?? action.startedAt ?? timestamp,
          );
        }
      }
    }

    if (
      action.kind === "read" &&
      artifactRef &&
      !input.contract.permissions.repositoryWrite
    ) {
      for (const deliverable of input.contract.deliverables) {
        if (
          !deliverable.targetPaths?.some(
            (candidate) =>
              normalizedPath(candidate) === normalizedPath(artifactRef),
          )
        )
          continue;
        const deliverableId = `deliverable:${deliverable.id}`;
        add(
          `${input.taskId}:read-deliverable:${action.id}:${deliverableId}`,
          deliverableId,
          {
            source: "file",
            artifactRef,
            summary: nonEmptySummary(
              action.summary,
              `The host read the requested artifact ${artifactRef}.`,
            ),
          },
          action.completedAt ?? action.startedAt ?? timestamp,
        );
      }
    }

    if (action.kind === "review") {
      for (const obligation of obligations.filter(
        (candidate) =>
          candidate.id === "criterion:criterion-review" ||
          candidate.id === "evidence:evidence-review",
      ))
        add(
          `${input.taskId}:review:${action.id}:${obligation.id}`,
          obligation.id,
          {
            source: "diff",
            artifactRef,
            summary: nonEmptySummary(
              action.summary,
              "The host performed the final diff review.",
            ),
          },
          action.completedAt ?? action.startedAt ?? timestamp,
        );
    }
  }

  for (const run of input.ledger.verificationRuns) {
    const source: EvidenceSource =
      run.stage === "test" || /\b(?:test|spec|check)\b/iu.test(run.command)
        ? "test"
        : "command";
    const exitCode =
      run.exitCode ??
      (run.status === "passed" ? 0 : run.status === "failed" ? 1 : undefined);
    const details = {
      source,
      command: run.command,
      ...(exitCode === undefined ? {} : { exitCode }),
      summary:
        run.summary?.trim() || `Verification ${run.status}: ${run.command}`,
    } satisfies Omit<EvidenceRecord, "id" | "obligationId" | "createdAt">;
    for (const obligation of obligations.filter(
      (candidate) =>
        candidate.id === "criterion:criterion-verification" ||
        candidate.id === "evidence:evidence-verification",
    ))
      add(
        `${input.taskId}:verification:${run.id}:${obligation.id}`,
        obligation.id,
        details,
        run.completedAt ?? run.startedAt,
      );
  }

  for (const proof of input.objectiveProof?.proofs ?? []) {
    if (proof.status !== "proven" && proof.status !== "not_applicable")
      continue;
    const obligationId = `${proof.kind}:${proof.requirementId}`;
    const obligation = obligations.find(
      (candidate) => candidate.id === obligationId,
    );
    if (!obligation) continue;
    let source: EvidenceSource = "runtime";
    const details: Omit<EvidenceRecord, "id" | "obligationId" | "createdAt"> = {
      source,
      summary: proof.summary,
      ...(proof.source && !proof.source.startsWith("host")
        ? { artifactRef: proof.source }
        : {}),
    };
    if (obligation.type === "test") {
      source = "command";
      details.source = source;
      details.command =
        proof.source === "contract"
          ? "contract:no-check-required"
          : proof.source;
      details.exitCode = 0;
    } else if (obligation.type === "manual") {
      source = "diff";
      details.source = source;
    }
    add(
      `${input.taskId}:objective-proof:${proof.id}`,
      obligationId,
      details,
      proof.observedAt,
    );
  }

  if (!input.contract.permissions.repositoryWrite) {
    for (const deliverable of requiredDeliverablesForContract(input.contract)) {
      if (!deliverable.targetPaths || deliverable.targetPaths.length === 0)
        continue;
      const targetRead = deliverable.targetPaths.find((target) =>
        input.ledger.filesRead.some(
          (path) => normalizedPath(path) === normalizedPath(target),
        ),
      );
      if (!targetRead) continue;
      const deliverableId = `deliverable:${deliverable.id}`;
      add(`${input.taskId}:persisted-read:${deliverable.id}`, deliverableId, {
        source: "file",
        artifactRef: targetRead,
        summary: `The persisted ledger records a host read of ${targetRead}.`,
      });
    }
  }

  // The generic coding path does not enable the legacy success-criteria
  // callback, but it still needs a canonical objective obligation. A
  // successful host mutation for every required deliverable is the minimum
  // observable signal here; contract-enabled tasks additionally receive the
  // stronger objective-proof records above.
  const requiredDeliverables = input.contract.deliverables.filter(
    (deliverable) => deliverable.required,
  );
  const hostObservedOutcome = input.contract.permissions.repositoryWrite
    ? input.ledger.actions.some(
        (action) => action.kind === "write" && action.status === "succeeded",
      )
    : input.ledger.evidence.some((item) => item.kind !== "decision");
  if (!input.contract.permissions.repositoryWrite && hostObservedOutcome)
    for (const deliverable of requiredDeliverables) {
      if (deliverable.targetPaths && deliverable.targetPaths.length > 0)
        continue;
      const deliverableId = `deliverable:${deliverable.id}`;
      add(
        `${input.taskId}:derived-deliverable:${deliverable.id}`,
        deliverableId,
        {
          source: "runtime",
          summary:
            "The host observed repository evidence for the requested read-only outcome.",
        },
      );
    }
  const deliverablesObserved = requiredDeliverables.every((deliverable) => {
    const obligationId = `deliverable:${deliverable.id}`;
    return records.some(
      (record) =>
        record.obligationId === obligationId &&
        COMPLETION_EVIDENCE_SOURCES.has(record.source),
    );
  });
  if (
    deliverablesObserved &&
    hostObservedOutcome &&
    obligationExists(obligations, "criterion:criterion-objective")
  )
    add(
      `${input.taskId}:derived-objective-criterion`,
      "criterion:criterion-objective",
      {
        source: "runtime",
        summary:
          "The host observed evidence for every required deliverable and the requested outcome.",
      },
    );

  // A contract with no applicable project command is a host decision, not a
  // missing test. Represent that decision explicitly so the canonical test
  // obligation cannot be satisfied by an unverified mutation alone.
  if (
    input.contract.verificationIntent.projectChecks === "not_required" &&
    input.contract.repositoryScope.explicitCommands.length === 0
  )
    add(
      `${input.taskId}:verification:not-required`,
      "criterion:criterion-verification",
      {
        source: "runtime",
        exitCode: 0,
        summary:
          "The host contract marks project verification as not required.",
      },
    );
  return records.map(normalizeEvidenceRecord);
}

function requiredDeliverablesForContract(
  contract: TaskContract,
): Deliverable[] {
  return contract.deliverables.filter((deliverable) => deliverable.required);
}

function evidenceIsFailure(
  obligation: AcceptanceObligation,
  evidence: EvidenceRecord,
): boolean {
  if (evidence.obligationId !== obligation.id) return false;
  if (evidence.exitCode !== undefined && evidence.exitCode !== 0) return true;
  return false;
}

/**
 * Recalculate obligation statuses from host evidence and return a completion
 * assessment. Caller-provided `status: satisfied` is deliberately ignored
 * unless a qualifying EvidenceRecord supports it.
 */
export function evaluateProofBackedCompletion(
  input: EvaluateAcceptanceProofInput,
): AcceptanceProofAssessment {
  const obligations = input.obligations.map(normalizeAcceptanceObligation);
  const evidence = input.evidence.map(normalizeEvidenceRecord);
  const obligationIds = new Set<string>();
  for (const obligation of obligations) {
    if (obligationIds.has(obligation.id))
      throw new Error(`Duplicate acceptance obligation id: ${obligation.id}`);
    obligationIds.add(obligation.id);
  }
  const evidenceById = new Map<string, EvidenceRecord>();
  for (const record of evidence) {
    const previous = evidenceById.get(record.id);
    if (previous && !sameEvidence(previous, record))
      throw new Error(`Conflicting evidence id: ${record.id}`);
    evidenceById.set(record.id, record);
  }
  const reasons: string[] = [];
  const evidenceRefs = new Set<string>();
  if (input.requireObligations !== false && obligations.length === 0)
    reasons.push("no acceptance obligations were compiled");

  const assessed = obligations.map((obligation) => {
    const linked = [...evidenceById.values()]
      .filter((candidate) => candidate.obligationId === obligation.id)
      .map((candidate, index) => ({ candidate, index }))
      .sort((left, right) => {
        const leftTime = Date.parse(left.candidate.createdAt);
        const rightTime = Date.parse(right.candidate.createdAt);
        if (leftTime !== rightTime) return leftTime - rightTime;
        return left.index - right.index;
      })
      .map((entry) => entry.candidate);
    const latest = linked.at(-1);
    if (latest && sourceCanProve(obligation, latest)) {
      evidenceRefs.add(latest.id);
      return { ...obligation, status: "satisfied" as const };
    }
    if (latest && evidenceIsFailure(obligation, latest))
      return { ...obligation, status: "failed" as const };
    if (obligation.status === "blocked")
      return { ...obligation, status: "blocked" as const };
    return { ...obligation, status: "pending" as const };
  });

  const missing = assessed.filter(
    (obligation) => obligation.required && obligation.status !== "satisfied",
  );
  for (const obligation of missing.slice(0, MAX_REASONS)) {
    reasons.push(
      `required obligation is ${obligation.status}: ${obligation.id} (${obligation.statement})`,
    );
  }
  const canComplete =
    reasons.length === 0 &&
    assessed.every(
      (obligation) => !obligation.required || obligation.status === "satisfied",
    );
  const falseSuccess = Boolean(input.declaredComplete) && !canComplete;
  if (falseSuccess)
    reasons.unshift(
      "self-declared completion was rejected because required evidence is missing or failed",
    );
  return {
    canComplete,
    falseSuccess,
    reasons: reasons.slice(0, MAX_REASONS),
    obligations: assessed,
    evidenceRefs: [...evidenceRefs],
  };
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function normalizeTaskId(value: string): string {
  const normalized = boundedText(value, "taskId", MAX_ID_LENGTH);
  return normalized!;
}

function sameEvidence(left: EvidenceRecord, right: EvidenceRecord): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function validatedSnapshot(value: unknown): EvidenceStoreSnapshot {
  if (!isRecord(value) || value.schemaVersion !== 1 || !isRecord(value.tasks))
    throw new Error("Evidence store snapshot is invalid.");
  const tasks = Object.create(null) as Record<string, EvidenceRecord[]>;
  const taskEntries = Object.entries(value.tasks);
  if (taskEntries.length > MAX_TASKS)
    throw new Error("Evidence store snapshot exceeds the task limit.");
  for (const [taskId, records] of taskEntries) {
    const normalizedTaskId = normalizeTaskId(taskId);
    if (!Array.isArray(records) || records.length > MAX_EVIDENCE_PER_TASK)
      throw new Error(
        `Evidence store task ${normalizedTaskId} exceeds the record limit.`,
      );
    const byId = new Map<string, EvidenceRecord>();
    for (const record of records) {
      const normalized = normalizeEvidenceRecord(record);
      const previous = byId.get(normalized.id);
      if (previous && !sameEvidence(previous, normalized))
        throw new Error(
          `Conflicting evidence id in snapshot: ${normalized.id}`,
        );
      byId.set(normalized.id, normalized);
    }
    tasks[normalizedTaskId] = [...byId.values()].map(clone);
  }
  return { schemaVersion: 1, tasks };
}

/** A bounded in-memory store suitable for the live task boundary and tests. */
export class InMemoryEvidenceStore implements EvidenceStore {
  private readonly tasks = new Map<string, Map<string, EvidenceRecord>>();

  record(taskId: string, input: EvidenceRecord): EvidenceRecord {
    const normalizedTaskId = normalizeTaskId(taskId);
    const evidence = normalizeEvidenceRecord(input);
    let records = this.tasks.get(normalizedTaskId);
    if (!records) {
      if (this.tasks.size >= MAX_TASKS)
        throw new Error("Evidence store task limit exceeded.");
      records = new Map<string, EvidenceRecord>();
      this.tasks.set(normalizedTaskId, records);
    }
    const previous = records.get(evidence.id);
    if (previous) {
      if (!sameEvidence(previous, evidence))
        throw new Error(
          `Conflicting evidence id for task ${normalizedTaskId}: ${evidence.id}`,
        );
      return clone(previous);
    }
    if (records.size >= MAX_EVIDENCE_PER_TASK)
      throw new Error(
        `Evidence store record limit exceeded for task ${normalizedTaskId}.`,
      );
    records.set(evidence.id, clone(evidence));
    return clone(evidence);
  }

  recordMany(
    taskId: string,
    inputs: readonly EvidenceRecord[],
  ): EvidenceRecord[] {
    const normalized = inputs.map(normalizeEvidenceRecord);
    if (normalized.length > MAX_EVIDENCE_PER_TASK)
      throw new Error("Evidence store batch exceeds the record limit.");
    const existing = this.list(taskId);
    const byId = new Map(existing.map((record) => [record.id, record]));
    for (const evidence of normalized) {
      const previous = byId.get(evidence.id);
      if (previous && !sameEvidence(previous, evidence))
        throw new Error(
          `Conflicting evidence id for task ${taskId}: ${evidence.id}`,
        );
      byId.set(evidence.id, evidence);
    }
    if (byId.size > MAX_EVIDENCE_PER_TASK)
      throw new Error(
        `Evidence store record limit exceeded for task ${taskId}.`,
      );
    return normalized.map((evidence) => this.record(taskId, evidence));
  }

  list(taskId: string): EvidenceRecord[] {
    const records = this.tasks.get(normalizeTaskId(taskId));
    return records ? [...records.values()].map(clone) : [];
  }

  get(taskId: string, evidenceId: string): EvidenceRecord | undefined {
    const records = this.tasks.get(normalizeTaskId(taskId));
    const evidence = records?.get(normalizeTaskId(evidenceId));
    return evidence ? clone(evidence) : undefined;
  }

  snapshot(): EvidenceStoreSnapshot {
    const tasks = Object.create(null) as Record<string, EvidenceRecord[]>;
    for (const [taskId, records] of this.tasks)
      tasks[taskId] = [...records.values()].map(clone);
    return { schemaVersion: 1, tasks };
  }

  restore(snapshot: EvidenceStoreSnapshot | unknown): void {
    const validated = validatedSnapshot(snapshot);
    this.tasks.clear();
    for (const [taskId, records] of Object.entries(validated.tasks)) {
      const map = new Map<string, EvidenceRecord>();
      for (const evidence of records) map.set(evidence.id, clone(evidence));
      this.tasks.set(taskId, map);
    }
  }

  clear(taskId?: string): void {
    if (taskId === undefined) this.tasks.clear();
    else this.tasks.delete(normalizeTaskId(taskId));
  }
}
