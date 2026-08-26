import type { VerificationCommand } from "./verification-plan.js";
import type { TurnMode } from "./turn-policy.js";
import { extractObjectivePaths } from "./objective-review.js";
import type { AdaptiveExecutionProfile } from "./execution-profile.js";

export type ContractStatus = "compiled" | "clarification_required";
export type CriterionStatus =
  "unknown" | "satisfied" | "failed" | "not_applicable";

export interface ContractConstraint {
  id: string;
  description: string;
  source: "user" | "controller";
}

export interface Deliverable {
  id: string;
  description: string;
  kind: string;
  required: boolean;
  dependencies: string[];
  evidence: string[];
  status: CriterionStatus;
}

export interface AcceptanceCriterion {
  id: string;
  description: string;
  required: boolean;
  verificationClass?: string;
  evidence: string[];
  status: CriterionStatus;
}

export interface EvidenceRequirement {
  id: string;
  description: string;
  kind: "repository" | "scope" | "artifact" | "verification" | "review";
  required: boolean;
}

export interface ContractRiskProfile {
  score: number;
  level: "low" | "medium" | "high" | "critical";
  reasons: string[];
}

export interface ContractUncertainty {
  id: string;
  description: string;
  blocking: boolean;
}

export interface RepositoryScope {
  explicitPaths: string[];
  explicitCommands: string[];
}

export interface ContractPermissions {
  repositoryRead: boolean;
  repositoryWrite: boolean;
  execute: boolean;
  network: boolean;
}

export interface VerificationIntent {
  projectChecks: "required" | "optional" | "not_required";
  objectiveEvidence: "required" | "optional";
  finalReview: "required" | "optional";
}

export interface TaskContract {
  id: string;
  originalRequest: string;
  objective: string;
  mode: TurnMode;
  executionProfile?: AdaptiveExecutionProfile;
  deliverables: Deliverable[];
  constraints: ContractConstraint[];
  nonGoals: string[];
  acceptanceCriteria: AcceptanceCriterion[];
  evidenceRequirements: EvidenceRequirement[];
  risk: ContractRiskProfile;
  repositoryScope: RepositoryScope;
  permissions: ContractPermissions;
  uncertainty: ContractUncertainty[];
  verificationIntent: VerificationIntent;
  status: ContractStatus;
}

export interface CompileTaskContractInput {
  id?: string;
  originalRequest: string;
  mode: TurnMode;
  executionProfile?: AdaptiveExecutionProfile;
  explicitPaths?: readonly string[];
  verificationCommands?: readonly VerificationCommand[];
  constraints?: readonly string[];
  riskScore?: number;
}

/**
 * A generic intent signal used only when the host knows that the workspace is
 * empty. It prevents an empty repository from being mistaken for missing
 * context while still refusing to treat an empty workspace as a valid target
 * for requests such as fixing or migrating existing behavior.
 */
export function isGreenfieldObjective(objective: string): boolean {
  const normalized = objective
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  if (!normalized) return false;
  if (
    /\b(?:fix|repair|debug|update|modify|change|refactor|migrate|remove|delete|rename|correct|arregla|corrige|actualiza|modifica|cambia|refactoriza|migra|elimina|renombra)\b/iu.test(
      normalized,
    )
  )
    return false;
  return /\b(?:create|build|make|start|scaffold|bootstrap|generate|implement|write|add|crea|construye|inicia|genera|implementa|escribe|agrega|anade)\b/iu.test(
    normalized,
  );
}

/** Copy caller-owned contract state before the controller adds runtime facts. */
export function cloneTaskContract(contract: TaskContract): TaskContract {
  return {
    ...contract,
    deliverables: contract.deliverables.map((item) => ({
      ...item,
      dependencies: [...item.dependencies],
      evidence: [...item.evidence],
    })),
    constraints: contract.constraints.map((item) => ({ ...item })),
    nonGoals: [...contract.nonGoals],
    acceptanceCriteria: contract.acceptanceCriteria.map((item) => ({
      ...item,
      evidence: [...item.evidence],
    })),
    evidenceRequirements: contract.evidenceRequirements.map((item) => ({
      ...item,
    })),
    risk: { ...contract.risk, reasons: [...contract.risk.reasons] },
    repositoryScope: {
      explicitPaths: [...contract.repositoryScope.explicitPaths],
      explicitCommands: [...contract.repositoryScope.explicitCommands],
    },
    permissions: { ...contract.permissions },
    uncertainty: contract.uncertainty.map((item) => ({ ...item })),
    verificationIntent: { ...contract.verificationIntent },
  };
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizePath(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/^\.\//u, "");
}

function riskLevel(score: number): ContractRiskProfile["level"] {
  if (score >= 0.85) return "critical";
  if (score >= 0.6) return "high";
  if (score >= 0.3) return "medium";
  return "low";
}

function explicitReadOnly(request: string): boolean {
  return /\b(?:read[- ]only|no changes?|do not (?:modify|edit|write)|sin (?:modificar|editar|cambiar))\b/iu.test(
    request,
  );
}

function hasExplicitTests(request: string): boolean {
  return /\b(?:test|tests|testing|spec|coverage|prueba|pruebas)\b/iu.test(
    request,
  );
}

/**
 * Preserve high-signal constraints stated in the user's natural-language
 * request.  These are deliberately generic intent facts, not a task-specific
 * workflow: semantic decomposition and implementation order remain owned by
 * the LLM planner.
 */
function explicitUserConstraints(request: string): string[] {
  const constraints: string[] = [];
  const preserveExistingContract =
    /\b(?:preserve|keep|maintain|leave)\s+(?:the\s+)?(?:existing|current|public)\s+(?:api|interface|contract|behavior)\b/iu.test(
      request,
    ) ||
    /\b(?:preserve|keep|maintain)\s+(?:backward|backwards)\s+compatibility\b/iu.test(
      request,
    ) ||
    /\b(?:mant[eé]n|conserva|mantener|conservar)\s+(?:la\s+)?(?:api|interfaz|contrato|comportamiento)\s+(?:existente|actual)\b/iu.test(
      request,
    ) ||
    /\b(?:sin\s+cambiar|sin\s+romper)\s+(?:la\s+)?(?:api|interfaz|contrato|comportamiento)\s+(?:existente|actual)\b/iu.test(
      request,
    );
  if (preserveExistingContract)
    constraints.push("Preserve the existing public API and behavior.");

  if (
    /\b(?:without|while)\s+(?:breaking|changing)\s+(?:the\s+)?(?:existing|current|public)\s+(?:api|interface|contract|behavior)\b/iu.test(
      request,
    )
  )
    constraints.push(
      "Do not break or change the existing public API and behavior.",
    );

  return constraints;
}

function defaultRisk(
  input: CompileTaskContractInput,
  pathCount: number,
): number {
  if (input.riskScore !== undefined)
    return Math.min(1, Math.max(0, input.riskScore));
  const base = input.mode === "coding" ? 0.3 : 0.1;
  const scopeRisk = pathCount >= 6 ? 0.3 : pathCount >= 2 ? 0.12 : 0;
  const explicitTestRisk = hasExplicitTests(input.originalRequest) ? 0.08 : 0;
  return Math.min(1, base + scopeRisk + explicitTestRisk);
}

/**
 * Compile only facts that are safe to derive without semantic guessing. The
 * LLM planner remains responsible for the semantic decomposition and may
 * enrich the accepted plan with domain-specific deliverables.
 */
export function compileTaskContract(
  input: CompileTaskContractInput,
): TaskContract {
  const request = input.originalRequest.trim();
  const explicitPaths = unique(
    (input.explicitPaths?.length
      ? input.explicitPaths
      : extractObjectivePaths(request)
    ).map(normalizePath),
  );
  const verificationCommands = unique(
    (input.verificationCommands ?? []).map((item) => item.command),
  );
  const readOnly =
    explicitReadOnly(request) ||
    input.mode === "plan" ||
    input.mode === "review";
  const coding = input.mode === "coding";
  const score = defaultRisk(input, explicitPaths.length);
  const constraints: ContractConstraint[] = unique([
    ...(input.constraints ?? []),
    ...explicitUserConstraints(request),
  ]).map((description, index) => ({
    id: `constraint-user-${index + 1}`,
    description,
    source: "user",
  }));
  const addConstraint = (description: string): void => {
    if (!constraints.some((item) => item.description === description))
      constraints.push({
        id: `constraint-controller-${constraints.length + 1}`,
        description,
        source: "controller",
      });
  };
  if (readOnly) addConstraint("Do not modify the workspace for this task.");
  if (coding) addConstraint("Preserve pre-existing user work.");

  const deliverables: Deliverable[] = explicitPaths.length
    ? explicitPaths.map((pathValue, index) => ({
        id: `deliverable-path-${index + 1}`,
        description: `The requested outcome is reflected in the approved path ${pathValue}.`,
        kind: "repository_artifact",
        required: true,
        dependencies: [],
        evidence: [`scope:${pathValue}`],
        status: "unknown",
      }))
    : [
        {
          id: "deliverable-objective",
          description:
            "The outcome described by the original request is produced within the approved workspace.",
          kind: coding ? "requested_change" : "requested_outcome",
          required: true,
          dependencies: [],
          evidence: ["objective evidence"],
          status: "unknown" as const,
        },
      ];

  const acceptanceCriteria: AcceptanceCriterion[] = [
    {
      id: "criterion-objective",
      description:
        "The original objective is satisfied with observable evidence.",
      required: true,
      verificationClass: "objective",
      evidence: ["objective evidence"],
      status: "unknown",
    },
  ];
  if (coding) {
    acceptanceCriteria.push(
      {
        id: "criterion-verification",
        description:
          "Applicable project verification is satisfied, or the repository has no applicable project check.",
        required: true,
        verificationClass: "project",
        evidence: verificationCommands.length
          ? verificationCommands.map((command) => `verification:${command}`)
          : ["verification:not_required"],
        status: "unknown",
      },
      {
        id: "criterion-review",
        description:
          "The final change scope is reviewed and pre-existing user work is preserved.",
        required: true,
        verificationClass: "review",
        evidence: ["final diff", "user-work preservation"],
        status: "unknown",
      },
    );
  }

  const evidenceRequirements: EvidenceRequirement[] = [];
  if (input.mode !== "conversation" && input.mode !== "knowledge")
    evidenceRequirements.push({
      id: "evidence-repository",
      description:
        "Fresh repository evidence relevant to the current objective.",
      kind: "repository",
      required: true,
    });
  if (explicitPaths.length > 0)
    evidenceRequirements.push({
      id: "evidence-scope",
      description: "Each explicit path is observed before dependent mutation.",
      kind: "scope",
      required: coding,
    });
  if (verificationCommands.length > 0)
    evidenceRequirements.push({
      id: "evidence-verification",
      description:
        "The configured project verification commands complete successfully.",
      kind: "verification",
      required: true,
    });
  if (coding)
    evidenceRequirements.push({
      id: "evidence-review",
      description: "The final diff and user-work preservation are checked.",
      kind: "review",
      required: true,
    });

  const uncertainty: ContractUncertainty[] = [];
  if (coding && explicitPaths.length === 0)
    uncertainty.push({
      id: "uncertainty-scope",
      description:
        "The mutation scope must be localized from repository evidence.",
      blocking: false,
    });

  return {
    id: input.id ?? crypto.randomUUID(),
    originalRequest: request,
    objective: request,
    mode: input.mode,
    executionProfile: input.executionProfile ?? "linear",
    deliverables,
    constraints,
    nonGoals: [],
    acceptanceCriteria,
    evidenceRequirements,
    risk: {
      score,
      level: riskLevel(score),
      reasons: [
        ...(coding ? ["the task can mutate repository state"] : []),
        ...(explicitPaths.length >= 2 ? ["multiple explicit paths"] : []),
        ...(verificationCommands.length > 0
          ? ["project verification is requested"]
          : []),
      ],
    },
    repositoryScope: {
      explicitPaths,
      explicitCommands: verificationCommands,
    },
    permissions: {
      repositoryRead:
        input.mode !== "conversation" && input.mode !== "knowledge",
      repositoryWrite: coding && !readOnly,
      execute: coding || input.mode === "command",
      network: false,
    },
    uncertainty,
    verificationIntent: {
      projectChecks:
        verificationCommands.length > 0 ? "required" : "not_required",
      objectiveEvidence:
        input.mode === "conversation" ? "optional" : "required",
      finalReview: coding ? "required" : "optional",
    },
    status: "compiled",
  };
}
