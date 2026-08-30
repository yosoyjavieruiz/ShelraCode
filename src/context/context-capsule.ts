import { createHash } from "node:crypto";

export type CapabilityLevel = "C0" | "C1" | "C2" | "C3" | "C4" | "C5" | "C6";

export type CapsuleTaskStatus =
  "ready" | "running" | "completed" | "blocked" | "failed" | "cancelled";

export type ObligationStatus = "pending" | "satisfied" | "failed" | "blocked";

export interface AcceptanceObligationView {
  id: string;
  statement: string;
  required: boolean;
  status: ObligationStatus;
}

export interface CapsuleTask {
  id: string;
  objective: string;
  currentSubtask?: string;
  capabilityLevel: CapabilityLevel;
  executionProfile: string;
}

export interface CapsuleRequirements {
  acceptanceObligations: AcceptanceObligationView[];
  constraints: string[];
  nonGoals: string[];
}

export type VerificationStateValue =
  string | number | boolean | null | readonly string[];

export type VerificationState = Readonly<
  Record<string, VerificationStateValue>
>;

export interface CapsuleState {
  completedWork: string[];
  currentFailure: string | null;
  forbiddenRepeats: string[];
  unresolvedQuestions: string[];
  verificationState: VerificationState;
}

export interface CapsuleSymbolReference {
  name: string;
  path: string;
  line?: number;
  kind?: string;
}

export interface CapsuleRepositoryRelationship {
  from: string;
  to: string;
  kind: string;
}

export interface CapsuleDiagnostic {
  file: string;
  message: string;
  severity?: "error" | "warning" | "info";
}

export interface CapsuleRepository {
  relevantFiles: string[];
  relevantSymbols: CapsuleSymbolReference[];
  relationships: CapsuleRepositoryRelationship[];
  diagnostics: CapsuleDiagnostic[];
  changedFiles: string[];
  repositoryDigest: string;
}

export interface TrustedProjectInstruction {
  source: string;
  text: string;
}

export interface ActiveSkillReference {
  id: string;
  version: string;
  summary: string;
}

export interface CapsuleInstructions {
  trustedProjectInstructions: TrustedProjectInstruction[];
  activeSkills: ActiveSkillReference[];
}

export type SymbolOperation =
  | "definition"
  | "references"
  | "implementations"
  | "callers"
  | "dependencies"
  | "dependents"
  | "related_tests";

export interface StructuredPatchOperation {
  start: number;
  end: number;
  replacement: string;
}

export interface StructuredPatch {
  path: string;
  expectedBeforeDigest: string;
  operations: StructuredPatchOperation[];
}

export type LegalAction =
  | { kind: "repo.search"; query: string; scope?: string }
  | {
      kind: "repo.read";
      path: string;
      startLine?: number;
      endLine?: number;
    }
  | { kind: "repo.symbol"; operation: SymbolOperation; symbol: string }
  | { kind: "edit.apply"; patch: StructuredPatch }
  | { kind: "verify.run"; verifierId: string; target?: string }
  | { kind: "expert.ask"; question: string; evidenceRefs: string[] }
  | { kind: "task.blocked"; reason: string; evidenceRefs?: string[] }
  | { kind: "task.complete"; evidenceRefs: string[] };

export type LegalActionKind = LegalAction["kind"];

export type ActionRisk = "read" | "write" | "execute" | "control";

export interface LegalActionScope {
  paths?: string[];
  verifierIds?: string[];
  symbolOperations?: SymbolOperation[];
}

export interface ActionSchemaProperty {
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  enum?: readonly string[];
}

export interface ActionArgumentSchema {
  type: "object";
  properties: Record<string, ActionSchemaProperty>;
  required?: string[];
  additionalProperties: false;
}

export interface LegalActionDescriptor {
  kind: LegalActionKind;
  description: string;
  risk: ActionRisk;
  schema?: ActionArgumentSchema;
  scope?: LegalActionScope;
}

export interface LegalActionCompilationState {
  taskStatus: CapsuleTaskStatus;
  capabilityLevel: CapabilityLevel;
  remainingActions: number;
  writesAllowed: boolean;
  executionAllowed: boolean;
  completionAllowed: boolean;
  expertAllowed?: boolean;
}

export interface CapsuleActionsInput {
  legalActions?: readonly LegalActionDescriptor[];
  state: LegalActionCompilationState;
  maxActions?: number;
}

export interface CapsuleActions {
  legalActions: LegalActionDescriptor[];
  state: LegalActionCompilationState;
}

export interface CapsuleOutput {
  driverSelectedProtocol: string;
  schema: CapsuleOutputSchema;
}

export interface CapsuleOutputSchema {
  type: "object";
  properties: Record<string, ActionSchemaProperty>;
  required: string[];
  additionalProperties: false;
}

export interface CapsuleBudget {
  /** Maximum model-input tokens permitted for the rendered capsule. */
  inputTokens: number;
  outputTokens: number;
  remainingActions: number;
  wallClockBudgetMs: number;
}

export interface ContextCapsule {
  task: CapsuleTask;
  requirements: CapsuleRequirements;
  state: CapsuleState;
  repository: CapsuleRepository;
  instructions: CapsuleInstructions;
  actions: CapsuleActions;
  output: CapsuleOutput;
  budget: CapsuleBudget;
  text: string;
  estimatedInputTokens: number;
  omittedSections: string[];
  digest: string;
}

export interface ContextCapsuleInput {
  task: {
    id: string;
    objective: string;
    currentSubtask?: string;
    capabilityLevel: CapabilityLevel;
    executionProfile: string;
  };
  requirements: {
    acceptanceObligations: readonly AcceptanceObligationView[];
    constraints?: readonly string[];
    nonGoals?: readonly string[];
  };
  state: {
    completedWork?: readonly string[];
    currentFailure?: string | null;
    forbiddenRepeats?: readonly string[];
    unresolvedQuestions?: readonly string[];
    verificationState?: VerificationState;
  };
  repository?: {
    relevantFiles?: readonly string[];
    relevantSymbols?: readonly CapsuleSymbolReference[];
    relationships?: readonly CapsuleRepositoryRelationship[];
    diagnostics?: readonly CapsuleDiagnostic[];
    changedFiles?: readonly string[];
    repositoryDigest?: string;
  };
  instructions?: {
    trustedProjectInstructions?: readonly TrustedProjectInstruction[];
    activeSkills?: readonly ActiveSkillReference[];
  };
  actions: CapsuleActionsInput;
  output?: { driverSelectedProtocol?: string };
  budget: {
    inputTokens: number;
    outputTokens: number;
    remainingActions: number;
    wallClockBudgetMs: number;
  };
}

export interface ContextCapsuleInspection {
  digest: string;
  estimatedInputTokens: number;
  legalActionKinds: LegalActionKind[];
  requiredObligationIds: string[];
  forbiddenRepeats: string[];
  omittedSections: string[];
}

export interface LegalActionValidationResult {
  valid: boolean;
  reason?: string;
}

export class ContextCapsuleInputError extends Error {
  readonly code = "INVALID_CONTEXT_CAPSULE" as const;

  constructor(message: string) {
    super(message);
    this.name = "ContextCapsuleInputError";
  }
}

export class ContextCapsuleBudgetError extends Error {
  readonly code = "CONTEXT_CAPSULE_BUDGET_EXCEEDED" as const;

  constructor(message: string) {
    super(message);
    this.name = "ContextCapsuleBudgetError";
  }
}

export class ContextCapsuleIntegrityError extends Error {
  readonly code = "CONTEXT_CAPSULE_INTEGRITY_FAILURE" as const;

  constructor(message: string) {
    super(message);
    this.name = "ContextCapsuleIntegrityError";
  }
}

const MIN_INPUT_TOKENS = 256;
const MAX_OBJECTIVE_CHARS = 2_000;
const MAX_TASK_FIELD_CHARS = 500;
const MAX_LIST_ITEM_CHARS = 800;
const MAX_OBLIGATIONS = 64;
const MAX_LIST_ITEMS = 64;
const MAX_SYMBOLS = 128;
const MAX_RELATIONSHIPS = 128;
const MAX_DIAGNOSTICS = 128;
const MAX_ACTIONS = 16;
const MAX_PATCH_OPERATIONS = 128;
const MAX_EVIDENCE_REFS = 32;

const ACTION_ORDER: readonly LegalActionKind[] = [
  "repo.search",
  "repo.read",
  "repo.symbol",
  "edit.apply",
  "verify.run",
  "expert.ask",
  "task.blocked",
  "task.complete",
];

const SYMBOL_OPERATIONS: readonly SymbolOperation[] = [
  "definition",
  "references",
  "implementations",
  "callers",
  "dependencies",
  "dependents",
  "related_tests",
];

function clip(value: string, maxChars: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

function uniqueStrings(
  values: readonly string[] | undefined,
  maxItems = MAX_LIST_ITEMS,
  maxChars = MAX_LIST_ITEM_CHARS,
): string[] {
  return [
    ...new Set(
      (values ?? [])
        .filter((value): value is string => typeof value === "string")
        .map((value) => clip(value, maxChars))
        .filter(Boolean),
    ),
  ].slice(0, maxItems);
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) &&
    value.every((entry): entry is string => typeof entry === "string")
  );
}

function requiredString(
  value: string,
  field: string,
  maxChars: number,
): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new ContextCapsuleInputError(`${field} is required.`);
  return clip(value, maxChars);
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value <= 0)
    throw new ContextCapsuleInputError(`${field} must be a positive integer.`);
  return value;
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isInteger(value) || value < 0)
    throw new ContextCapsuleInputError(
      `${field} must be a non-negative integer.`,
    );
  return value;
}

function isCapabilityLevel(value: string): value is CapabilityLevel {
  return /^C[0-6]$/u.test(value);
}

function capabilityRank(level: CapabilityLevel): number {
  return Number(level.slice(1));
}

function isTaskTerminal(status: CapsuleTaskStatus): boolean {
  return !["ready", "running"].includes(status);
}

function normalizeObligations(
  values: readonly AcceptanceObligationView[],
): AcceptanceObligationView[] {
  if (!Array.isArray(values) || values.length > MAX_OBLIGATIONS)
    throw new ContextCapsuleInputError(
      `acceptanceObligations must contain at most ${MAX_OBLIGATIONS} items.`,
    );
  return values.map((obligation, index) => {
    const id = requiredString(
      obligation.id,
      `acceptanceObligations[${index}].id`,
      200,
    );
    const statement = requiredString(
      obligation.statement,
      `acceptanceObligations[${index}].statement`,
      MAX_LIST_ITEM_CHARS,
    );
    if (typeof obligation.required !== "boolean")
      throw new ContextCapsuleInputError(
        `acceptanceObligations[${index}].required must be boolean.`,
      );
    if (
      !["pending", "satisfied", "failed", "blocked"].includes(obligation.status)
    )
      throw new ContextCapsuleInputError(
        `acceptanceObligations[${index}].status is invalid.`,
      );
    return {
      id,
      statement,
      required: obligation.required,
      status: obligation.status,
    };
  });
}

function normalizeVerificationState(
  value: VerificationState | undefined,
): VerificationState {
  if (!value) return {};
  if (!isRecord(value))
    throw new ContextCapsuleInputError("verificationState must be an object.");
  const entries = Object.entries(value).map(([key, entry]) => {
    if (
      typeof entry !== "string" &&
      typeof entry !== "number" &&
      typeof entry !== "boolean" &&
      entry !== null &&
      !(
        Array.isArray(entry) &&
        entry.every((item): item is string => typeof item === "string")
      )
    )
      throw new ContextCapsuleInputError(
        `verificationState.${key} contains an unsupported value.`,
      );
    return [
      clip(key, 120),
      Array.isArray(entry) ? uniqueStrings(entry) : entry,
    ];
  });
  return Object.fromEntries(entries);
}

function normalizeTask(input: ContextCapsuleInput["task"]): CapsuleTask {
  if (!input || typeof input !== "object")
    throw new ContextCapsuleInputError("task is required.");
  const id = requiredString(input.id, "task.id", 200);
  const objective = requiredString(
    input.objective,
    "task.objective",
    MAX_OBJECTIVE_CHARS,
  );
  if (!isCapabilityLevel(input.capabilityLevel))
    throw new ContextCapsuleInputError("task.capabilityLevel is invalid.");
  const executionProfile = requiredString(
    input.executionProfile,
    "task.executionProfile",
    MAX_TASK_FIELD_CHARS,
  );
  return {
    id,
    objective,
    ...(input.currentSubtask?.trim()
      ? { currentSubtask: clip(input.currentSubtask, MAX_TASK_FIELD_CHARS) }
      : {}),
    capabilityLevel: input.capabilityLevel,
    executionProfile,
  };
}

function normalizeRepository(
  input: ContextCapsuleInput["repository"],
): CapsuleRepository {
  const symbols = (input?.relevantSymbols ?? [])
    .slice(0, MAX_SYMBOLS)
    .map((symbol, index) => {
      const name = requiredString(
        symbol.name,
        `repository.relevantSymbols[${index}].name`,
        240,
      );
      const path = requiredString(
        symbol.path,
        `repository.relevantSymbols[${index}].path`,
        500,
      );
      if (
        symbol.line !== undefined &&
        (!Number.isInteger(symbol.line) || symbol.line <= 0)
      )
        throw new ContextCapsuleInputError(
          `repository.relevantSymbols[${index}].line is invalid.`,
        );
      return {
        name,
        path,
        ...(symbol.line === undefined ? {} : { line: symbol.line }),
        ...(symbol.kind?.trim() ? { kind: clip(symbol.kind, 120) } : {}),
      };
    });
  const relationships = (input?.relationships ?? [])
    .slice(0, MAX_RELATIONSHIPS)
    .map((relationship, index) => ({
      from: requiredString(
        relationship.from,
        `repository.relationships[${index}].from`,
        500,
      ),
      to: requiredString(
        relationship.to,
        `repository.relationships[${index}].to`,
        500,
      ),
      kind: requiredString(
        relationship.kind,
        `repository.relationships[${index}].kind`,
        120,
      ),
    }));
  const diagnostics = (input?.diagnostics ?? [])
    .slice(0, MAX_DIAGNOSTICS)
    .map((diagnostic, index) => {
      if (
        diagnostic.severity !== undefined &&
        !["error", "warning", "info"].includes(diagnostic.severity)
      )
        throw new ContextCapsuleInputError(
          `repository.diagnostics[${index}].severity is invalid.`,
        );
      return {
        file: requiredString(
          diagnostic.file,
          `repository.diagnostics[${index}].file`,
          500,
        ),
        message: requiredString(
          diagnostic.message,
          `repository.diagnostics[${index}].message`,
          MAX_LIST_ITEM_CHARS,
        ),
        ...(diagnostic.severity === undefined
          ? {}
          : { severity: diagnostic.severity }),
      };
    });
  return {
    relevantFiles: uniqueStrings(input?.relevantFiles, MAX_LIST_ITEMS, 500),
    relevantSymbols: symbols,
    relationships,
    diagnostics,
    changedFiles: uniqueStrings(input?.changedFiles, MAX_LIST_ITEMS, 500),
    repositoryDigest: clip(input?.repositoryDigest?.trim() || "unknown", 200),
  };
}

function normalizeInstructions(
  input: ContextCapsuleInput["instructions"],
): CapsuleInstructions {
  const trustedProjectInstructions = (input?.trustedProjectInstructions ?? [])
    .slice(0, MAX_LIST_ITEMS)
    .map((instruction, index) => ({
      source: requiredString(
        instruction.source,
        `instructions.trustedProjectInstructions[${index}].source`,
        300,
      ),
      text: requiredString(
        instruction.text,
        `instructions.trustedProjectInstructions[${index}].text`,
        MAX_LIST_ITEM_CHARS,
      ),
    }));
  const activeSkills = (input?.activeSkills ?? [])
    .slice(0, MAX_LIST_ITEMS)
    .map((skill, index) => ({
      id: requiredString(
        skill.id,
        `instructions.activeSkills[${index}].id`,
        200,
      ),
      version: requiredString(
        skill.version,
        `instructions.activeSkills[${index}].version`,
        80,
      ),
      summary: requiredString(
        skill.summary,
        `instructions.activeSkills[${index}].summary`,
        MAX_LIST_ITEM_CHARS,
      ),
    }));
  return { trustedProjectInstructions, activeSkills };
}

function defaultSchema(kind: LegalActionKind): ActionArgumentSchema {
  const property = (
    type: ActionSchemaProperty["type"],
    description: string,
  ): ActionSchemaProperty => ({ type, description });
  switch (kind) {
    case "repo.search":
      return {
        type: "object",
        properties: {
          query: property("string", "Bounded search query."),
          scope: property("string", "Optional repository-relative scope."),
        },
        required: ["query"],
        additionalProperties: false,
      };
    case "repo.read":
      return {
        type: "object",
        properties: {
          path: property("string", "Repository-relative path."),
          startLine: property("number", "Optional one-based start line."),
          endLine: property("number", "Optional one-based end line."),
        },
        required: ["path"],
        additionalProperties: false,
      };
    case "repo.symbol":
      return {
        type: "object",
        properties: {
          operation: {
            type: "string",
            enum: [...SYMBOL_OPERATIONS],
          },
          symbol: property("string", "Symbol name."),
        },
        required: ["operation", "symbol"],
        additionalProperties: false,
      };
    case "edit.apply":
      return {
        type: "object",
        properties: {
          patch: property("object", "One structured stale-guarded patch."),
        },
        required: ["patch"],
        additionalProperties: false,
      };
    case "verify.run":
      return {
        type: "object",
        properties: {
          verifierId: property("string", "Host-registered verifier ID."),
          target: property("string", "Optional repository-relative target."),
        },
        required: ["verifierId"],
        additionalProperties: false,
      };
    case "expert.ask":
      return {
        type: "object",
        properties: {
          question: property("string", "Bounded question."),
          evidenceRefs: property("array", "Host evidence references."),
        },
        required: ["question", "evidenceRefs"],
        additionalProperties: false,
      };
    case "task.blocked":
      return {
        type: "object",
        properties: {
          reason: property("string", "Typed blocked reason."),
          evidenceRefs: property("array", "Host evidence references."),
        },
        required: ["reason"],
        additionalProperties: false,
      };
    case "task.complete":
      return {
        type: "object",
        properties: {
          evidenceRefs: property("array", "Host proof references."),
        },
        required: ["evidenceRefs"],
        additionalProperties: false,
      };
  }
}

function normalizeScope(
  scope: LegalActionScope | undefined,
): LegalActionScope | undefined {
  if (!scope) return undefined;
  if (!isRecord(scope))
    throw new ContextCapsuleInputError("Action scope must be an object.");
  const rawPaths = scope.paths as unknown;
  const rawVerifierIds = scope.verifierIds as unknown;
  const rawSymbolOperations = scope.symbolOperations as unknown;
  if (
    (rawPaths !== undefined && !isStringArray(rawPaths)) ||
    (rawVerifierIds !== undefined && !isStringArray(rawVerifierIds)) ||
    (rawSymbolOperations !== undefined && !isStringArray(rawSymbolOperations))
  )
    throw new ContextCapsuleInputError("Action scope arrays are invalid.");
  const symbolOperations = rawSymbolOperations
    ? [
        ...new Set(
          rawSymbolOperations.filter(
            (operation): operation is SymbolOperation =>
              SYMBOL_OPERATIONS.includes(operation as SymbolOperation),
          ),
        ),
      ]
    : undefined;
  if (
    rawSymbolOperations !== undefined &&
    symbolOperations !== undefined &&
    symbolOperations.length !== rawSymbolOperations.length
  )
    throw new ContextCapsuleInputError(
      "Action scope has an invalid symbol operation.",
    );
  return {
    ...(rawPaths
      ? { paths: uniqueStrings(rawPaths, MAX_LIST_ITEMS, 500) }
      : {}),
    ...(rawVerifierIds
      ? {
          verifierIds: uniqueStrings(rawVerifierIds, MAX_LIST_ITEMS, 200),
        }
      : {}),
    ...(symbolOperations ? { symbolOperations } : {}),
  };
}

function normalizeSchema(
  schema: ActionArgumentSchema | undefined,
  kind: LegalActionKind,
): ActionArgumentSchema {
  const value = schema ?? defaultSchema(kind);
  if (
    !value ||
    value.type !== "object" ||
    !isRecord(value.properties) ||
    value.additionalProperties !== false
  )
    throw new ContextCapsuleInputError(
      `${kind}.schema is not a closed object schema.`,
    );
  const properties = Object.fromEntries(
    Object.entries(value.properties).map(([name, property]) => {
      if (
        !isRecord(property) ||
        typeof property.type !== "string" ||
        !["string", "number", "boolean", "object", "array"].includes(
          property.type,
        )
      )
        throw new ContextCapsuleInputError(
          `${kind}.schema has an invalid property.`,
        );
      if (property.enum !== undefined && !isStringArray(property.enum))
        throw new ContextCapsuleInputError(
          `${kind}.schema has an invalid enum.`,
        );
      return [
        clip(name, 120),
        {
          type: property.type,
          ...(typeof property.description === "string"
            ? { description: clip(property.description, 300) }
            : {}),
          ...(property.enum === undefined
            ? {}
            : {
                enum: uniqueStrings(
                  property.enum as readonly string[],
                  32,
                  120,
                ),
              }),
        },
      ];
    }),
  );
  if (value.required !== undefined && !isStringArray(value.required))
    throw new ContextCapsuleInputError(`${kind}.schema.required is invalid.`);
  return {
    type: "object",
    properties,
    ...(value.required === undefined
      ? {}
      : {
          required: uniqueStrings(value.required as readonly string[], 32, 120),
        }),
    additionalProperties: false,
  };
}

function normalizeDescriptor(
  descriptor: LegalActionDescriptor,
): LegalActionDescriptor {
  if (!descriptor || typeof descriptor !== "object")
    throw new ContextCapsuleInputError(
      "A legal action descriptor is required.",
    );
  if (!ACTION_ORDER.includes(descriptor.kind))
    throw new ContextCapsuleInputError(
      `Unknown legal action kind: ${String(descriptor.kind)}.`,
    );
  if (!["read", "write", "execute", "control"].includes(descriptor.risk))
    throw new ContextCapsuleInputError(`${descriptor.kind}.risk is invalid.`);
  const scope = normalizeScope(descriptor.scope);
  return {
    kind: descriptor.kind,
    description: requiredString(
      descriptor.description,
      `${descriptor.kind}.description`,
      400,
    ),
    risk: descriptor.risk,
    schema: normalizeSchema(descriptor.schema, descriptor.kind),
    ...(scope ? { scope } : {}),
  };
}

function allowedActionKinds(
  state: LegalActionCompilationState,
  requiredSatisfied: boolean,
): LegalActionKind[] {
  if (isTaskTerminal(state.taskStatus)) return [];
  if (state.remainingActions <= 0) return ["task.blocked"];

  const allowed: LegalActionKind[] = [];
  const rank = capabilityRank(state.capabilityLevel);
  if (rank >= 1) allowed.push("repo.search", "repo.read", "repo.symbol");
  if (rank >= 2 && state.writesAllowed) allowed.push("edit.apply");
  if (rank >= 2 && state.executionAllowed) allowed.push("verify.run");
  if (rank >= 2 && state.expertAllowed) allowed.push("expert.ask");
  if (state.completionAllowed && requiredSatisfied)
    allowed.push("task.complete");
  allowed.push("task.blocked");
  return allowed;
}

function normalizeActionState(
  input: LegalActionCompilationState,
  budgetRemainingActions: number,
): LegalActionCompilationState {
  if (!ACTION_ORDER.length)
    throw new ContextCapsuleInputError("No actions configured.");
  if (
    ![
      "ready",
      "running",
      "completed",
      "blocked",
      "failed",
      "cancelled",
    ].includes(input.taskStatus)
  )
    throw new ContextCapsuleInputError("actions.state.taskStatus is invalid.");
  if (!isCapabilityLevel(input.capabilityLevel))
    throw new ContextCapsuleInputError(
      "actions.state.capabilityLevel is invalid.",
    );
  if (input.remainingActions < 0)
    throw new ContextCapsuleInputError(
      "actions.state.remainingActions must be non-negative.",
    );
  if (typeof input.writesAllowed !== "boolean")
    throw new ContextCapsuleInputError(
      "actions.state.writesAllowed must be boolean.",
    );
  if (typeof input.executionAllowed !== "boolean")
    throw new ContextCapsuleInputError(
      "actions.state.executionAllowed must be boolean.",
    );
  if (typeof input.completionAllowed !== "boolean")
    throw new ContextCapsuleInputError(
      "actions.state.completionAllowed must be boolean.",
    );
  if (
    input.expertAllowed !== undefined &&
    typeof input.expertAllowed !== "boolean"
  )
    throw new ContextCapsuleInputError(
      "actions.state.expertAllowed must be boolean.",
    );
  return {
    taskStatus: input.taskStatus,
    capabilityLevel: input.capabilityLevel,
    remainingActions: Math.min(input.remainingActions, budgetRemainingActions),
    writesAllowed: input.writesAllowed,
    executionAllowed: input.executionAllowed,
    completionAllowed: input.completionAllowed,
    ...(input.expertAllowed === undefined
      ? {}
      : { expertAllowed: input.expertAllowed }),
  };
}

function compileActions(
  input: CapsuleActionsInput,
  requiredSatisfied: boolean,
  budgetRemainingActions: number,
  taskCapabilityLevel: CapabilityLevel,
): CapsuleActions {
  const state = normalizeActionState(input.state, budgetRemainingActions);
  if (state.capabilityLevel !== taskCapabilityLevel)
    throw new ContextCapsuleInputError(
      "task.capabilityLevel and actions.state.capabilityLevel must match.",
    );
  const allowed = new Set(allowedActionKinds(state, requiredSatisfied));
  const descriptors = (
    input.legalActions ??
    ACTION_ORDER.map((kind) => ({
      kind,
      description: `Host-validated ${kind} action.`,
      risk:
        kind === "edit.apply"
          ? "write"
          : kind === "verify.run"
            ? "execute"
            : kind === "task.blocked" ||
                kind === "task.complete" ||
                kind === "expert.ask"
              ? "control"
              : "read",
    }))
  )
    .map(normalizeDescriptor)
    .filter((descriptor) => allowed.has(descriptor.kind));
  const maxActions = input.maxActions ?? MAX_ACTIONS;
  if (
    !Number.isInteger(maxActions) ||
    maxActions <= 0 ||
    maxActions > MAX_ACTIONS
  )
    throw new ContextCapsuleInputError(
      `actions.maxActions must be an integer between 1 and ${MAX_ACTIONS}.`,
    );
  const firstIndex = new Map<LegalActionKind, number>();
  descriptors.forEach((descriptor, index) => {
    if (!firstIndex.has(descriptor.kind))
      firstIndex.set(descriptor.kind, index);
  });
  const legalActions = [
    ...new Map(
      descriptors.map((descriptor) => [descriptor.kind, descriptor]),
    ).values(),
  ]
    .sort(
      (left, right) =>
        ACTION_ORDER.indexOf(left.kind) - ACTION_ORDER.indexOf(right.kind) ||
        (firstIndex.get(left.kind) ?? 0) - (firstIndex.get(right.kind) ?? 0),
    )
    .slice(0, maxActions);
  return { legalActions, state };
}

function normalizeBudget(input: ContextCapsuleInput["budget"]): CapsuleBudget {
  const inputTokens = positiveInteger(input.inputTokens, "budget.inputTokens");
  if (inputTokens < MIN_INPUT_TOKENS)
    throw new ContextCapsuleInputError(
      `budget.inputTokens must be an integer >= ${MIN_INPUT_TOKENS}.`,
    );
  const outputTokens = positiveInteger(
    input.outputTokens,
    "budget.outputTokens",
  );
  const remainingActions = nonNegativeInteger(
    input.remainingActions,
    "budget.remainingActions",
  );
  const wallClockBudgetMs = positiveInteger(
    input.wallClockBudgetMs,
    "budget.wallClockBudgetMs",
  );
  return { inputTokens, outputTokens, remainingActions, wallClockBudgetMs };
}

function normalizeState(input: ContextCapsuleInput["state"]): CapsuleState {
  if (!input || typeof input !== "object")
    throw new ContextCapsuleInputError("state is required.");
  if (
    input.currentFailure !== undefined &&
    input.currentFailure !== null &&
    typeof input.currentFailure !== "string"
  )
    throw new ContextCapsuleInputError(
      "state.currentFailure must be a string or null.",
    );
  return {
    completedWork: uniqueStrings(input.completedWork),
    currentFailure:
      input.currentFailure === null || input.currentFailure === undefined
        ? null
        : clip(input.currentFailure, MAX_LIST_ITEM_CHARS),
    forbiddenRepeats: uniqueStrings(input.forbiddenRepeats),
    unresolvedQuestions: uniqueStrings(input.unresolvedQuestions),
    verificationState: normalizeVerificationState(input.verificationState),
  };
}

function requiredSatisfied(
  state: CapsuleState,
  requirements: CapsuleRequirements,
): boolean {
  const required = requirements.acceptanceObligations.filter(
    (obligation) => obligation.required,
  );
  return (
    required.length > 0 &&
    required.every((obligation) => obligation.status === "satisfied") &&
    state.verificationState.requiredSatisfied === true
  );
}

function actionSchemaForOutput(
  actions: readonly LegalActionDescriptor[],
): CapsuleOutputSchema {
  const legalKinds = actions.map((action) => action.kind);
  const hasAction = legalKinds.some(
    (kind) => kind !== "task.complete" && kind !== "task.blocked",
  );
  const typeEnum = [
    ...(hasAction ? (["action"] as const) : []),
    ...(legalKinds.includes("task.complete") ? (["complete"] as const) : []),
    ...(legalKinds.includes("task.blocked") ? (["blocked"] as const) : []),
  ];
  return {
    type: "object",
    properties: {
      type: {
        type: "string",
        enum: typeEnum,
      },
      actionKind: {
        type: "string",
        enum: actions.map((action) => action.kind),
      },
      arguments: { type: "object" },
      reason: { type: "string" },
      evidenceRefs: { type: "array" },
    },
    required: ["type"],
    additionalProperties: false,
  };
}

function compactActionSchema(schema: ActionArgumentSchema): string {
  const properties = Object.keys(schema.properties).join(",") || "none";
  const required = schema.required?.join(",") || "none";
  return `{required:${required}; properties:${properties}}`;
}

interface CapsuleSection {
  id: string;
  required: boolean;
  text: string;
}

function renderSections(
  capsule: Omit<
    ContextCapsule,
    "text" | "estimatedInputTokens" | "omittedSections" | "digest"
  >,
): {
  text: string;
  estimatedInputTokens: number;
  omittedSections: string[];
} {
  const sections: CapsuleSection[] = [
    {
      id: "task",
      required: true,
      text: [
        `Task ${capsule.task.id}`,
        `Objective: ${capsule.task.objective}`,
        ...(capsule.task.currentSubtask
          ? [`Current subtask: ${capsule.task.currentSubtask}`]
          : []),
        `Capability: ${capsule.task.capabilityLevel}`,
        `Execution profile: ${capsule.task.executionProfile}`,
      ].join("\n"),
    },
    {
      id: "requirements",
      required: true,
      text: [
        "Acceptance obligations:",
        ...capsule.requirements.acceptanceObligations.map(
          (obligation) =>
            `- ${obligation.id} [${obligation.required ? "required" : "optional"}; ${obligation.status}] ${obligation.statement}`,
        ),
        ...(capsule.requirements.constraints.length > 0
          ? [
              "Constraints:",
              ...capsule.requirements.constraints.map((value) => `- ${value}`),
            ]
          : []),
        ...(capsule.requirements.nonGoals.length > 0
          ? [
              "Non-goals:",
              ...capsule.requirements.nonGoals.map((value) => `- ${value}`),
            ]
          : []),
      ].join("\n"),
    },
    {
      id: "state",
      required: true,
      text: [
        "Authoritative state:",
        `Completed work: ${capsule.state.completedWork.join(" | ") || "none"}`,
        `Current failure: ${capsule.state.currentFailure ?? "none"}`,
        `Forbidden repeats: ${capsule.state.forbiddenRepeats.join(" | ") || "none"}`,
        `Unresolved questions: ${capsule.state.unresolvedQuestions.join(" | ") || "none"}`,
        `Verification state: ${clip(JSON.stringify(capsule.state.verificationState), MAX_LIST_ITEM_CHARS)}`,
      ].join("\n"),
    },
    {
      id: "actions",
      required: true,
      text: [
        "Legal actions for this decision:",
        ...capsule.actions.legalActions.map(
          (action) =>
            `- ${action.kind} [risk=${action.risk}] ${action.description} schema=${compactActionSchema(action.schema ?? defaultSchema(action.kind))}${action.scope ? ` scope=${JSON.stringify(action.scope)}` : ""}`,
        ),
      ].join("\n"),
    },
    {
      id: "output",
      required: true,
      text: [
        `Output protocol: ${capsule.output.driverSelectedProtocol}`,
        `Output action kinds: ${capsule.output.schema.properties.actionKind?.enum?.join(",") || "none"}`,
      ].join("\n"),
    },
    {
      id: "budget",
      required: true,
      text: `Budget: input<=${capsule.budget.inputTokens} tokens; output<=${capsule.budget.outputTokens} tokens; remaining actions=${capsule.budget.remainingActions}; wall clock=${capsule.budget.wallClockBudgetMs}ms`,
    },
    {
      id: "repository",
      required: false,
      text: [
        `Repository digest: ${capsule.repository.repositoryDigest}`,
        `Relevant files: ${capsule.repository.relevantFiles.join(" | ") || "none"}`,
        ...(capsule.repository.relevantSymbols.length > 0
          ? [
              "Relevant symbols:",
              ...capsule.repository.relevantSymbols.map(
                (symbol) =>
                  `- ${symbol.name} (${symbol.kind ?? "symbol"}) ${symbol.path}${symbol.line === undefined ? "" : `:${symbol.line}`}`,
              ),
            ]
          : []),
        ...(capsule.repository.relationships.length > 0
          ? [
              "Relationships:",
              ...capsule.repository.relationships.map(
                (relationship) =>
                  `- ${relationship.from} -> ${relationship.to} [${relationship.kind}]`,
              ),
            ]
          : []),
        ...(capsule.repository.diagnostics.length > 0
          ? [
              "Diagnostics:",
              ...capsule.repository.diagnostics.map(
                (diagnostic) =>
                  `- ${diagnostic.file} [${diagnostic.severity ?? "info"}] ${diagnostic.message}`,
              ),
            ]
          : []),
        `Changed files: ${capsule.repository.changedFiles.join(" | ") || "none"}`,
      ].join("\n"),
    },
    {
      id: "instructions",
      required: false,
      text: [
        ...(capsule.instructions.trustedProjectInstructions.length > 0
          ? [
              "Trusted project instructions:",
              ...capsule.instructions.trustedProjectInstructions.map(
                (instruction) =>
                  `- [${instruction.source}] ${instruction.text}`,
              ),
            ]
          : []),
        ...(capsule.instructions.activeSkills.length > 0
          ? [
              "Active Skills:",
              ...capsule.instructions.activeSkills.map(
                (skill) => `- ${skill.id}@${skill.version}: ${skill.summary}`,
              ),
            ]
          : []),
      ].join("\n"),
    },
  ].filter((section) => section.text.length > 0);
  const maxChars = capsule.budget.inputTokens * 4;
  const requiredSections = sections.filter((section) => section.required);
  const requiredText = requiredSections
    .map((section) => section.text)
    .join("\n\n");
  if (requiredText.length > maxChars)
    throw new ContextCapsuleBudgetError(
      `Required Context Capsule sections need ${Math.ceil(requiredText.length / 4)} tokens, budget allows ${capsule.budget.inputTokens}.`,
    );
  let text = requiredText;
  const omittedSections: string[] = [];
  for (const section of sections.filter((candidate) => !candidate.required)) {
    const candidate = text ? `${text}\n\n${section.text}` : section.text;
    if (candidate.length <= maxChars) text = candidate;
    else omittedSections.push(section.id);
  }
  return {
    text,
    estimatedInputTokens: Math.max(1, Math.ceil(text.length / 4)),
    omittedSections,
  };
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

function capsuleCore(
  capsule: Omit<
    ContextCapsule,
    "text" | "estimatedInputTokens" | "omittedSections" | "digest"
  >,
): unknown {
  return {
    task: capsule.task,
    requirements: capsule.requirements,
    state: capsule.state,
    repository: capsule.repository,
    instructions: capsule.instructions,
    actions: capsule.actions,
    output: capsule.output,
    budget: capsule.budget,
  };
}

function digestFor(
  capsule: Omit<
    ContextCapsule,
    "text" | "estimatedInputTokens" | "omittedSections" | "digest"
  >,
): string {
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(capsuleCore(capsule))), "utf8")
    .digest("hex");
}

export class ContextCompiler {
  compile(input: ContextCapsuleInput): ContextCapsule {
    const task = normalizeTask(input.task);
    const requirements: CapsuleRequirements = {
      acceptanceObligations: normalizeObligations(
        input.requirements.acceptanceObligations,
      ),
      constraints: uniqueStrings(input.requirements.constraints),
      nonGoals: uniqueStrings(input.requirements.nonGoals),
    };
    const state = normalizeState(input.state);
    const budget = normalizeBudget(input.budget);
    const actions = compileActions(
      input.actions,
      requiredSatisfied(state, requirements),
      budget.remainingActions,
      task.capabilityLevel,
    );
    const effectiveBudget: CapsuleBudget = {
      ...budget,
      remainingActions: Math.min(
        budget.remainingActions,
        actions.state.remainingActions,
      ),
    };
    const output: CapsuleOutput = {
      driverSelectedProtocol: clip(
        input.output?.driverSelectedProtocol?.trim() || "unselected",
        MAX_TASK_FIELD_CHARS,
      ),
      schema: actionSchemaForOutput(actions.legalActions),
    };
    const core = {
      task,
      requirements,
      state,
      repository: normalizeRepository(input.repository),
      instructions: normalizeInstructions(input.instructions),
      actions,
      output,
      budget: effectiveBudget,
    };
    const rendered = renderSections(core);
    const capsuleWithoutDerived = {
      ...core,
      ...rendered,
    };
    return {
      ...capsuleWithoutDerived,
      digest: digestFor(core),
    };
  }

  inspect(capsule: ContextCapsule): ContextCapsuleInspection {
    return inspectContextCapsule(capsule);
  }
}

export function compileContextCapsule(
  input: ContextCapsuleInput,
): ContextCapsule {
  return new ContextCompiler().compile(input);
}

export function inspectContextCapsule(
  capsule: ContextCapsule,
): ContextCapsuleInspection {
  const {
    text: _text,
    estimatedInputTokens: _tokens,
    omittedSections: _omitted,
    digest,
    ...core
  } = capsule;
  const expected = digestFor(core);
  if (digest !== expected)
    throw new ContextCapsuleIntegrityError(
      `Context Capsule digest ${digest} does not match its host-owned contents.`,
    );
  const rendered = renderSections(core);
  if (
    capsule.text !== rendered.text ||
    capsule.estimatedInputTokens !== rendered.estimatedInputTokens ||
    JSON.stringify(capsule.omittedSections) !==
      JSON.stringify(rendered.omittedSections)
  )
    throw new ContextCapsuleIntegrityError(
      "Context Capsule derived text does not match its host-owned contents.",
    );
  return {
    digest,
    estimatedInputTokens: capsule.estimatedInputTokens,
    legalActionKinds: capsule.actions.legalActions.map((action) => action.kind),
    requiredObligationIds: capsule.requirements.acceptanceObligations
      .filter((obligation) => obligation.required)
      .map((obligation) => obligation.id),
    forbiddenRepeats: [...capsule.state.forbiddenRepeats],
    omittedSections: [...capsule.omittedSections],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function safeRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  const normalized = value.replaceAll("\\", "/");
  return (
    !/[\u0000-\u001f\u007f]/u.test(value) &&
    !normalized.startsWith("/") &&
    !normalized.includes(":") &&
    !normalized.split("/").includes("..")
  );
}

function inScope(
  pathValue: string,
  scope: LegalActionScope | undefined,
): boolean {
  return !scope?.paths || scope.paths.includes(pathValue.replaceAll("\\", "/"));
}

function validEvidenceRefs(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_EVIDENCE_REFS &&
    value.every((entry) => typeof entry === "string" && entry.trim().length > 0)
  );
}

function validPatch(
  value: unknown,
  scope: LegalActionScope | undefined,
): boolean {
  if (!isRecord(value)) return false;
  if (
    !hasOnlyKeys(value, ["path", "expectedBeforeDigest", "operations"]) ||
    !safeRelativePath(value.path) ||
    !inScope(value.path, scope) ||
    typeof value.expectedBeforeDigest !== "string" ||
    !/^[a-f0-9]{64}$/iu.test(value.expectedBeforeDigest) ||
    !Array.isArray(value.operations) ||
    value.operations.length === 0 ||
    value.operations.length > MAX_PATCH_OPERATIONS
  )
    return false;
  return value.operations.every((operation) => {
    if (!isRecord(operation)) return false;
    if (!hasOnlyKeys(operation, ["start", "end", "replacement"])) return false;
    return (
      Number.isInteger(operation.start) &&
      Number.isInteger(operation.end) &&
      Number(operation.start) >= 0 &&
      Number(operation.end) >= Number(operation.start) &&
      typeof operation.replacement === "string"
    );
  });
}

function validSchemaValue(
  value: unknown,
  property: ActionSchemaProperty,
): boolean {
  const typeValid =
    (property.type === "string" && typeof value === "string") ||
    (property.type === "number" &&
      typeof value === "number" &&
      Number.isFinite(value)) ||
    (property.type === "boolean" && typeof value === "boolean") ||
    (property.type === "object" && isRecord(value)) ||
    (property.type === "array" && Array.isArray(value));
  if (!typeValid) return false;
  return (
    property.enum === undefined ||
    (typeof value === "string" && property.enum.includes(value))
  );
}

function validDescriptorSchema(
  action: Record<string, unknown>,
  descriptor: LegalActionDescriptor,
): boolean {
  const schema = descriptor.schema ?? defaultSchema(descriptor.kind);
  const argumentsValue = Object.fromEntries(
    Object.entries(action).filter(([key]) => key !== "kind"),
  );
  if (!hasOnlyKeys(argumentsValue, Object.keys(schema.properties)))
    return false;
  for (const required of schema.required ?? []) {
    if (!(required in argumentsValue)) return false;
  }
  return Object.entries(argumentsValue).every(([key, value]) => {
    const property = schema.properties[key];
    return property !== undefined && validSchemaValue(value, property);
  });
}

export function validateLegalAction(
  action: unknown,
  legalActions: readonly LegalActionDescriptor[],
): LegalActionValidationResult {
  if (!isRecord(action) || typeof action.kind !== "string")
    return { valid: false, reason: "Action must be an object with a kind." };
  const descriptor = legalActions.find(
    (candidate) => candidate.kind === action.kind,
  );
  if (!descriptor)
    return {
      valid: false,
      reason: "Action kind is not legal for this decision.",
    };
  if (!validDescriptorSchema(action, descriptor))
    return {
      valid: false,
      reason: `${descriptor.kind} arguments do not satisfy its closed schema.`,
    };
  switch (descriptor.kind) {
    case "repo.search":
      return hasOnlyKeys(action, ["kind", "query", "scope"]) &&
        typeof action.query === "string" &&
        action.query.trim().length > 0
        ? {
            valid:
              action.scope === undefined ||
              (safeRelativePath(action.scope) &&
                inScope(action.scope, descriptor.scope)),
          }
        : { valid: false, reason: "repo.search.query is required." };
    case "repo.read":
      return hasOnlyKeys(action, ["kind", "path", "startLine", "endLine"]) &&
        safeRelativePath(action.path) &&
        inScope(action.path, descriptor.scope) &&
        (action.startLine === undefined ||
          (Number.isInteger(action.startLine) &&
            Number(action.startLine) > 0)) &&
        (action.endLine === undefined ||
          (Number.isInteger(action.endLine) && Number(action.endLine) > 0)) &&
        (action.startLine === undefined ||
          action.endLine === undefined ||
          Number(action.endLine) >= Number(action.startLine))
        ? { valid: true }
        : {
            valid: false,
            reason: "repo.read has an invalid or out-of-scope path/range.",
          };
    case "repo.symbol":
      return hasOnlyKeys(action, ["kind", "operation", "symbol"]) &&
        SYMBOL_OPERATIONS.includes(action.operation as SymbolOperation) &&
        typeof action.symbol === "string" &&
        action.symbol.trim().length > 0 &&
        (!descriptor.scope?.symbolOperations ||
          descriptor.scope.symbolOperations.includes(
            action.operation as SymbolOperation,
          ))
        ? { valid: true }
        : {
            valid: false,
            reason: "repo.symbol has an invalid operation or symbol.",
          };
    case "edit.apply":
      return hasOnlyKeys(action, ["kind", "patch"]) &&
        validPatch(action.patch, descriptor.scope)
        ? { valid: true }
        : {
            valid: false,
            reason: "edit.apply.patch is invalid or out of scope.",
          };
    case "verify.run":
      return hasOnlyKeys(action, ["kind", "verifierId", "target"]) &&
        typeof action.verifierId === "string" &&
        action.verifierId.trim().length > 0 &&
        (!descriptor.scope?.verifierIds ||
          descriptor.scope.verifierIds.includes(action.verifierId)) &&
        (action.target === undefined ||
          (safeRelativePath(action.target) &&
            inScope(action.target, descriptor.scope)))
        ? { valid: true }
        : {
            valid: false,
            reason: "verify.run verifier or target is not legal.",
          };
    case "expert.ask":
      return hasOnlyKeys(action, ["kind", "question", "evidenceRefs"]) &&
        typeof action.question === "string" &&
        action.question.trim().length > 0 &&
        validEvidenceRefs(action.evidenceRefs)
        ? { valid: true }
        : {
            valid: false,
            reason: "expert.ask requires a question and evidence refs.",
          };
    case "task.blocked":
      return hasOnlyKeys(action, ["kind", "reason", "evidenceRefs"]) &&
        typeof action.reason === "string" &&
        action.reason.trim().length > 0 &&
        (action.evidenceRefs === undefined ||
          validEvidenceRefs(action.evidenceRefs))
        ? { valid: true }
        : {
            valid: false,
            reason: "task.blocked requires a reason and valid refs.",
          };
    case "task.complete":
      return hasOnlyKeys(action, ["kind", "evidenceRefs"]) &&
        validEvidenceRefs(action.evidenceRefs)
        ? { valid: true }
        : {
            valid: false,
            reason: "task.complete requires proof evidence refs.",
          };
  }
}
