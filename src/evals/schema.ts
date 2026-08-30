import { createHash } from "node:crypto";

export const EVALUATION_SCHEMA_VERSION = 1 as const;

export type EvaluationCaseFamily =
  | "host"
  | "protocol"
  | "edit"
  | "micro"
  | "multi_file"
  | "long_horizon"
  | "security"
  | "durability"
  | "false_success";

export type EvaluationCapabilityLevel =
  "C0" | "C1" | "C2" | "C3" | "C4" | "C5" | "C6";

export interface PublicAcceptanceObligation {
  id: string;
  statement: string;
  type:
    | "behavioral"
    | "test"
    | "build"
    | "type"
    | "security"
    | "performance"
    | "documentation"
    | "manual";
  required: boolean;
}

export interface PublicEvaluationCase {
  schemaVersion: typeof EVALUATION_SCHEMA_VERSION;
  caseId: string;
  revision: string;
  title: string;
  family: EvaluationCaseFamily;
  capabilityTarget: EvaluationCapabilityLevel;
  origin: "scripted_fake" | "local_real";
  workspaceFixture: {
    source: string;
    digest: string;
  };
  objective: string;
  policy: {
    writeAuthority: "none" | "bounded";
    networkAuthority: "none" | "loopback";
    commandPolicy: string;
  };
  budgets: {
    actions: number;
    inputTokens: number | null;
    outputTokens: number | null;
    wallClockMs: number;
  };
  visibleAcceptance: PublicAcceptanceObligation[];
  protectedAcceptanceRef: {
    id: string;
    sha256: string;
  } | null;
  tags: string[];
}

export interface ModelVisibleEvaluationInput {
  caseId: string;
  revision: string;
  objective: string;
  policy: PublicEvaluationCase["policy"];
  budgets: PublicEvaluationCase["budgets"];
  visibleAcceptance: PublicAcceptanceObligation[];
}

export type EvaluationUnknownReason =
  "not_exposed" | "not_collected" | "not_applicable";

export type EvaluationObservationValue<T> =
  | { state: "observed"; value: T }
  | { state: "unknown"; value: null; reason: EvaluationUnknownReason };

export interface EvaluationArtifactIdentity {
  path: string;
  exists: boolean;
  sizeBytes?: number;
  sha256?: string;
}

export interface EvaluationRunManifest {
  schemaVersion: typeof EVALUATION_SCHEMA_VERSION;
  runId: string;
  createdAt: string;
  status: "invocation_pending";
  evidenceClass: "scripted_fake" | "real_local_model";
  case: {
    caseId: string;
    revision: string;
    publicCaseDigest: string;
    fixtureDigest: string;
    protectedAcceptanceRef: PublicEvaluationCase["protectedAcceptanceRef"];
  };
  source: {
    head: EvaluationObservationValue<string>;
    dirtyStateDigest: EvaluationObservationValue<string>;
    executedSource: EvaluationObservationValue<{
      kind: "source" | "bundle" | "executable";
      path: string;
      sha256: string;
    }>;
    packageVersion: string;
    artifacts: EvaluationArtifactIdentity[];
  };
  model: {
    providerFamily: string;
    providerId: string;
    modelId: string;
    displayName: string;
    artifactId: EvaluationObservationValue<string>;
    artifactSha256: EvaluationObservationValue<string>;
    revision: EvaluationObservationValue<string>;
    parameterClass: EvaluationObservationValue<string>;
    quantization: EvaluationObservationValue<string>;
    architecture: EvaluationObservationValue<string>;
    sizeBytes: EvaluationObservationValue<number>;
  };
  runtime: {
    id: string;
    version: EvaluationObservationValue<string>;
    endpointProtocol: EvaluationObservationValue<string>;
    endpoint: EvaluationObservationValue<{
      origin: string;
      pathname: string;
    }>;
    chatTemplate: EvaluationObservationValue<string>;
    toolTemplate: EvaluationObservationValue<string>;
    structuredOutputMode: EvaluationObservationValue<string>;
    reasoningMode: EvaluationObservationValue<string>;
    tokenizerId: EvaluationObservationValue<string>;
    toolParser: EvaluationObservationValue<string>;
    contextConfiguration: Record<string, string | number | boolean | null>;
  };
  request: {
    temperature: number;
    maxOutputTokens: number;
    seed: EvaluationObservationValue<number>;
    reasoningEffort: EvaluationObservationValue<string>;
    toolSurfaceDigest: string;
  };
  environment: {
    bun: string;
    node: string;
    os: string;
    platform: string;
    arch: string;
    hardwareFingerprint: EvaluationObservationValue<string>;
  };
  driverProfile: EvaluationObservationValue<{ id: string; version: string }>;
  policy: {
    network: "none" | "loopback";
    downloads: false;
    paidInference: false;
  };
  command: {
    argv: string[];
    environmentNames: string[];
  };
  reproduction: {
    argv: string[];
  };
  parentRunId?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class EvaluationSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvaluationSchemaError";
  }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value))
    throw new EvaluationSchemaError(`${label} must be an object.`);
  return value;
}

function strictFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const allowedFields = new Set(allowed);
  for (const key of Object.keys(value).sort())
    if (!allowedFields.has(key))
      throw new EvaluationSchemaError(`Unexpected ${label} field: ${key}`);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new EvaluationSchemaError(`${label} must be a non-empty string.`);
  return value;
}

function oneOf<T extends string>(
  value: unknown,
  choices: readonly T[],
  label: string,
): T {
  if (typeof value !== "string" || !choices.includes(value as T))
    throw new EvaluationSchemaError(
      `${label} must be one of: ${choices.join(", ")}.`,
    );
  return value as T;
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isInteger(value) || (value as number) <= 0)
    throw new EvaluationSchemaError(`${label} must be a positive integer.`);
  return value as number;
}

function nullablePositiveInteger(value: unknown, label: string): number | null {
  return value === null ? null : positiveInteger(value, label);
}

function sha256(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))
    throw new EvaluationSchemaError(
      `${label} must be a lowercase SHA-256 digest.`,
    );
  return value;
}

function safeId(value: unknown, label: string): string {
  const id = text(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/u.test(id))
    throw new EvaluationSchemaError(
      `${label} must be a safe opaque identifier.`,
    );
  return id;
}

function finiteNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value))
    throw new EvaluationSchemaError(`${label} must be a finite number.`);
  return value;
}

function isoTimestamp(value: unknown, label: string): string {
  const timestamp = text(value, label);
  if (Number.isNaN(Date.parse(timestamp)))
    throw new EvaluationSchemaError(`${label} must be an ISO timestamp.`);
  return timestamp;
}

function stringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value))
    throw new EvaluationSchemaError(`${label} must be an array.`);
  return value.map((item, index) => text(item, `${label}[${index}]`));
}

function parseObservation<T>(
  value: unknown,
  label: string,
  parseValue: (input: unknown, valueLabel: string) => T,
): EvaluationObservationValue<T> {
  const observation = record(value, label);
  if (observation.state === "observed") {
    strictFields(observation, ["state", "value"], label);
    return {
      state: "observed",
      value: parseValue(observation.value, `${label}.value`),
    };
  }
  if (observation.state === "unknown") {
    strictFields(observation, ["state", "value", "reason"], label);
    if (observation.value !== null)
      throw new EvaluationSchemaError(
        `${label}.value must be null when state is unknown.`,
      );
    return {
      state: "unknown",
      value: null,
      reason: oneOf(
        observation.reason,
        ["not_exposed", "not_collected", "not_applicable"] as const,
        `${label}.reason`,
      ),
    };
  }
  throw new EvaluationSchemaError(
    `${label}.state must be observed or unknown.`,
  );
}

function scalarRecord(
  value: unknown,
  label: string,
): Record<string, string | number | boolean | null> {
  const input = record(value, label);
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, entry] of Object.entries(input)) {
    if (!/^[A-Za-z][A-Za-z0-9._-]{0,127}$/u.test(key))
      throw new EvaluationSchemaError(`${label} has an invalid key: ${key}`);
    if (
      entry !== null &&
      typeof entry !== "string" &&
      typeof entry !== "number" &&
      typeof entry !== "boolean"
    )
      throw new EvaluationSchemaError(
        `${label}.${key} must be a scalar JSON value.`,
      );
    if (typeof entry === "number" && !Number.isFinite(entry))
      throw new EvaluationSchemaError(
        `${label}.${key} must be a finite number.`,
      );
    result[key] = entry;
  }
  return result;
}

function parseProtectedReference(
  value: unknown,
  label: string,
): PublicEvaluationCase["protectedAcceptanceRef"] {
  if (value === null) return null;
  const reference = record(value, label);
  strictFields(reference, ["id", "sha256"], label);
  return {
    id: safeId(reference.id, `${label}.id`),
    sha256: sha256(reference.sha256, `${label}.sha256`),
  };
}

function parseEndpoint(
  value: unknown,
  label: string,
): { origin: string; pathname: string } {
  const endpoint = record(value, label);
  strictFields(endpoint, ["origin", "pathname"], label);
  const origin = text(endpoint.origin, `${label}.origin`);
  const pathname = text(endpoint.pathname, `${label}.pathname`);
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    throw new EvaluationSchemaError(
      `${label}.origin must be a valid URL origin.`,
    );
  }
  if (
    parsed.origin !== origin ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  )
    throw new EvaluationSchemaError(
      `${label}.origin must not contain credentials, query, path, or fragment.`,
    );
  if (!pathname.startsWith("/"))
    throw new EvaluationSchemaError(`${label}.pathname must be absolute.`);
  return { origin, pathname };
}

function parseExecutedSource(
  value: unknown,
  label: string,
): { kind: "source" | "bundle" | "executable"; path: string; sha256: string } {
  const source = record(value, label);
  strictFields(source, ["kind", "path", "sha256"], label);
  return {
    kind: oneOf(
      source.kind,
      ["source", "bundle", "executable"] as const,
      `${label}.kind`,
    ),
    path: text(source.path, `${label}.path`),
    sha256: sha256(source.sha256, `${label}.sha256`),
  };
}

function parseDriverProfile(
  value: unknown,
  label: string,
): { id: string; version: string } {
  const profile = record(value, label);
  strictFields(profile, ["id", "version"], label);
  return {
    id: safeId(profile.id, `${label}.id`),
    version: safeId(profile.version, `${label}.version`),
  };
}

function parseArtifact(
  value: unknown,
  index: number,
): EvaluationArtifactIdentity {
  const label = `source.artifacts[${index}]`;
  const artifact = record(value, label);
  strictFields(artifact, ["path", "exists", "sizeBytes", "sha256"], label);
  if (typeof artifact.exists !== "boolean")
    throw new EvaluationSchemaError(`${label}.exists must be a boolean.`);
  const result: EvaluationArtifactIdentity = {
    path: text(artifact.path, `${label}.path`),
    exists: artifact.exists,
  };
  if (artifact.sizeBytes !== undefined)
    result.sizeBytes = positiveInteger(
      artifact.sizeBytes,
      `${label}.sizeBytes`,
    );
  if (artifact.sha256 !== undefined)
    result.sha256 = sha256(artifact.sha256, `${label}.sha256`);
  if (!artifact.exists && (result.sizeBytes !== undefined || result.sha256))
    throw new EvaluationSchemaError(
      `${label} cannot include size/hash when exists is false.`,
    );
  return result;
}

export function parsePublicEvaluationCase(
  value: unknown,
): PublicEvaluationCase {
  const input = record(value, "public evaluation case");
  strictFields(
    input,
    [
      "schemaVersion",
      "caseId",
      "revision",
      "title",
      "family",
      "capabilityTarget",
      "origin",
      "workspaceFixture",
      "objective",
      "policy",
      "budgets",
      "visibleAcceptance",
      "protectedAcceptanceRef",
      "tags",
    ],
    "public evaluation case",
  );
  if (input.schemaVersion !== EVALUATION_SCHEMA_VERSION)
    throw new EvaluationSchemaError(
      "Invalid public evaluation case schema version.",
    );

  const workspaceFixture = record(input.workspaceFixture, "workspaceFixture");
  strictFields(workspaceFixture, ["source", "digest"], "workspaceFixture");

  const policy = record(input.policy, "policy");
  strictFields(
    policy,
    ["writeAuthority", "networkAuthority", "commandPolicy"],
    "policy",
  );

  const budgets = record(input.budgets, "budgets");
  strictFields(
    budgets,
    ["actions", "inputTokens", "outputTokens", "wallClockMs"],
    "budgets",
  );

  if (!Array.isArray(input.visibleAcceptance))
    throw new EvaluationSchemaError("visibleAcceptance must be an array.");
  const visibleAcceptance = input.visibleAcceptance.map((item, index) => {
    const obligation = record(item, `visibleAcceptance[${index}]`);
    strictFields(
      obligation,
      ["id", "statement", "type", "required"],
      `visibleAcceptance[${index}]`,
    );
    if (typeof obligation.required !== "boolean")
      throw new EvaluationSchemaError(
        `visibleAcceptance[${index}].required must be a boolean.`,
      );
    return {
      id: safeId(obligation.id, `visibleAcceptance[${index}].id`),
      statement: text(
        obligation.statement,
        `visibleAcceptance[${index}].statement`,
      ),
      type: oneOf(
        obligation.type,
        [
          "behavioral",
          "test",
          "build",
          "type",
          "security",
          "performance",
          "documentation",
          "manual",
        ] as const,
        `visibleAcceptance[${index}].type`,
      ),
      required: obligation.required,
    };
  });

  let protectedAcceptanceRef: PublicEvaluationCase["protectedAcceptanceRef"] =
    null;
  if (input.protectedAcceptanceRef !== null) {
    const protectedRef = record(
      input.protectedAcceptanceRef,
      "protectedAcceptanceRef",
    );
    strictFields(protectedRef, ["id", "sha256"], "protectedAcceptanceRef");
    protectedAcceptanceRef = {
      id: safeId(protectedRef.id, "protectedAcceptanceRef.id"),
      sha256: sha256(protectedRef.sha256, "protectedAcceptanceRef.sha256"),
    };
  }

  if (!Array.isArray(input.tags))
    throw new EvaluationSchemaError("tags must be an array.");

  return {
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    caseId: safeId(input.caseId, "caseId"),
    revision: safeId(input.revision, "revision"),
    title: text(input.title, "title"),
    family: oneOf(
      input.family,
      [
        "host",
        "protocol",
        "edit",
        "micro",
        "multi_file",
        "long_horizon",
        "security",
        "durability",
        "false_success",
      ] as const,
      "family",
    ),
    capabilityTarget: oneOf(
      input.capabilityTarget,
      ["C0", "C1", "C2", "C3", "C4", "C5", "C6"] as const,
      "capabilityTarget",
    ),
    origin: oneOf(
      input.origin,
      ["scripted_fake", "local_real"] as const,
      "origin",
    ),
    workspaceFixture: {
      source: text(workspaceFixture.source, "workspaceFixture.source"),
      digest: sha256(workspaceFixture.digest, "workspaceFixture.digest"),
    },
    objective: text(input.objective, "objective"),
    policy: {
      writeAuthority: oneOf(
        policy.writeAuthority,
        ["none", "bounded"] as const,
        "policy.writeAuthority",
      ),
      networkAuthority: oneOf(
        policy.networkAuthority,
        ["none", "loopback"] as const,
        "policy.networkAuthority",
      ),
      commandPolicy: text(policy.commandPolicy, "policy.commandPolicy"),
    },
    budgets: {
      actions: positiveInteger(budgets.actions, "budgets.actions"),
      inputTokens: nullablePositiveInteger(
        budgets.inputTokens,
        "budgets.inputTokens",
      ),
      outputTokens: nullablePositiveInteger(
        budgets.outputTokens,
        "budgets.outputTokens",
      ),
      wallClockMs: positiveInteger(budgets.wallClockMs, "budgets.wallClockMs"),
    },
    visibleAcceptance,
    protectedAcceptanceRef,
    tags: input.tags.map((tag, index) => text(tag, `tags[${index}]`)),
  };
}

export function toModelVisibleEvaluationInput(
  evaluationCase: PublicEvaluationCase,
): ModelVisibleEvaluationInput {
  return {
    caseId: evaluationCase.caseId,
    revision: evaluationCase.revision,
    objective: evaluationCase.objective,
    policy: evaluationCase.policy,
    budgets: evaluationCase.budgets,
    visibleAcceptance: evaluationCase.visibleAcceptance,
  };
}

export function digestPublicEvaluationCase(
  evaluationCase: PublicEvaluationCase,
): string {
  return createHash("sha256")
    .update(JSON.stringify(evaluationCase))
    .digest("hex");
}

export function parseEvaluationRunManifest(
  value: unknown,
): EvaluationRunManifest {
  const input = record(value, "evaluation run manifest");
  strictFields(
    input,
    [
      "schemaVersion",
      "runId",
      "createdAt",
      "status",
      "evidenceClass",
      "case",
      "source",
      "model",
      "runtime",
      "request",
      "environment",
      "driverProfile",
      "policy",
      "command",
      "reproduction",
      "parentRunId",
    ],
    "evaluation run manifest",
  );
  if (input.schemaVersion !== EVALUATION_SCHEMA_VERSION)
    throw new EvaluationSchemaError(
      "Invalid evaluation run manifest schema version.",
    );
  if (input.status !== "invocation_pending")
    throw new EvaluationSchemaError(
      "evaluation run manifest status must be invocation_pending.",
    );

  const caseValue = record(input.case, "case");
  strictFields(
    caseValue,
    [
      "caseId",
      "revision",
      "publicCaseDigest",
      "fixtureDigest",
      "protectedAcceptanceRef",
    ],
    "case",
  );

  const source = record(input.source, "source");
  strictFields(
    source,
    [
      "head",
      "dirtyStateDigest",
      "executedSource",
      "packageVersion",
      "artifacts",
    ],
    "source",
  );
  if (!Array.isArray(source.artifacts))
    throw new EvaluationSchemaError("source.artifacts must be an array.");

  const model = record(input.model, "model");
  strictFields(
    model,
    [
      "providerFamily",
      "providerId",
      "modelId",
      "displayName",
      "artifactId",
      "artifactSha256",
      "revision",
      "parameterClass",
      "quantization",
      "architecture",
      "sizeBytes",
    ],
    "model",
  );

  const runtime = record(input.runtime, "runtime");
  strictFields(
    runtime,
    [
      "id",
      "version",
      "endpointProtocol",
      "endpoint",
      "chatTemplate",
      "toolTemplate",
      "structuredOutputMode",
      "reasoningMode",
      "tokenizerId",
      "toolParser",
      "contextConfiguration",
    ],
    "runtime",
  );

  const request = record(input.request, "request");
  strictFields(
    request,
    [
      "temperature",
      "maxOutputTokens",
      "seed",
      "reasoningEffort",
      "toolSurfaceDigest",
    ],
    "request",
  );

  const environment = record(input.environment, "environment");
  strictFields(
    environment,
    ["bun", "node", "os", "platform", "arch", "hardwareFingerprint"],
    "environment",
  );

  const policy = record(input.policy, "policy");
  strictFields(policy, ["network", "downloads", "paidInference"], "policy");
  if (policy.downloads !== false || policy.paidInference !== false)
    throw new EvaluationSchemaError(
      "Phase 1 evaluation manifests must disable downloads and paid inference.",
    );

  const command = record(input.command, "command");
  strictFields(command, ["argv", "environmentNames"], "command");
  const environmentNames = stringArray(
    command.environmentNames,
    "command.environmentNames",
  );
  for (const name of environmentNames)
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name))
      throw new EvaluationSchemaError(
        `command.environmentNames contains an invalid name: ${name}`,
      );

  const reproduction = record(input.reproduction, "reproduction");
  strictFields(reproduction, ["argv"], "reproduction");

  const parsed: EvaluationRunManifest = {
    schemaVersion: EVALUATION_SCHEMA_VERSION,
    runId: safeId(input.runId, "runId"),
    createdAt: isoTimestamp(input.createdAt, "createdAt"),
    status: "invocation_pending",
    evidenceClass: oneOf(
      input.evidenceClass,
      ["scripted_fake", "real_local_model"] as const,
      "evidenceClass",
    ),
    case: {
      caseId: safeId(caseValue.caseId, "case.caseId"),
      revision: safeId(caseValue.revision, "case.revision"),
      publicCaseDigest: sha256(
        caseValue.publicCaseDigest,
        "case.publicCaseDigest",
      ),
      fixtureDigest: sha256(caseValue.fixtureDigest, "case.fixtureDigest"),
      protectedAcceptanceRef: parseProtectedReference(
        caseValue.protectedAcceptanceRef,
        "case.protectedAcceptanceRef",
      ),
    },
    source: {
      head: parseObservation(source.head, "source.head", text),
      dirtyStateDigest: parseObservation(
        source.dirtyStateDigest,
        "source.dirtyStateDigest",
        sha256,
      ),
      executedSource: parseObservation(
        source.executedSource,
        "source.executedSource",
        parseExecutedSource,
      ),
      packageVersion: text(source.packageVersion, "source.packageVersion"),
      artifacts: source.artifacts.map(parseArtifact),
    },
    model: {
      providerFamily: text(model.providerFamily, "model.providerFamily"),
      providerId: text(model.providerId, "model.providerId"),
      modelId: text(model.modelId, "model.modelId"),
      displayName: text(model.displayName, "model.displayName"),
      artifactId: parseObservation(model.artifactId, "model.artifactId", text),
      artifactSha256: parseObservation(
        model.artifactSha256,
        "model.artifactSha256",
        sha256,
      ),
      revision: parseObservation(model.revision, "model.revision", text),
      parameterClass: parseObservation(
        model.parameterClass,
        "model.parameterClass",
        text,
      ),
      quantization: parseObservation(
        model.quantization,
        "model.quantization",
        text,
      ),
      architecture: parseObservation(
        model.architecture,
        "model.architecture",
        text,
      ),
      sizeBytes: parseObservation(
        model.sizeBytes,
        "model.sizeBytes",
        positiveInteger,
      ),
    },
    runtime: {
      id: text(runtime.id, "runtime.id"),
      version: parseObservation(runtime.version, "runtime.version", text),
      endpointProtocol: parseObservation(
        runtime.endpointProtocol,
        "runtime.endpointProtocol",
        text,
      ),
      endpoint: parseObservation(
        runtime.endpoint,
        "runtime.endpoint",
        parseEndpoint,
      ),
      chatTemplate: parseObservation(
        runtime.chatTemplate,
        "runtime.chatTemplate",
        text,
      ),
      toolTemplate: parseObservation(
        runtime.toolTemplate,
        "runtime.toolTemplate",
        text,
      ),
      structuredOutputMode: parseObservation(
        runtime.structuredOutputMode,
        "runtime.structuredOutputMode",
        text,
      ),
      reasoningMode: parseObservation(
        runtime.reasoningMode,
        "runtime.reasoningMode",
        text,
      ),
      tokenizerId: parseObservation(
        runtime.tokenizerId,
        "runtime.tokenizerId",
        text,
      ),
      toolParser: parseObservation(
        runtime.toolParser,
        "runtime.toolParser",
        text,
      ),
      contextConfiguration: scalarRecord(
        runtime.contextConfiguration,
        "runtime.contextConfiguration",
      ),
    },
    request: {
      temperature: finiteNumber(request.temperature, "request.temperature"),
      maxOutputTokens: positiveInteger(
        request.maxOutputTokens,
        "request.maxOutputTokens",
      ),
      seed: parseObservation(request.seed, "request.seed", finiteNumber),
      reasoningEffort: parseObservation(
        request.reasoningEffort,
        "request.reasoningEffort",
        text,
      ),
      toolSurfaceDigest: sha256(
        request.toolSurfaceDigest,
        "request.toolSurfaceDigest",
      ),
    },
    environment: {
      bun: text(environment.bun, "environment.bun"),
      node: text(environment.node, "environment.node"),
      os: text(environment.os, "environment.os"),
      platform: text(environment.platform, "environment.platform"),
      arch: text(environment.arch, "environment.arch"),
      hardwareFingerprint: parseObservation(
        environment.hardwareFingerprint,
        "environment.hardwareFingerprint",
        text,
      ),
    },
    driverProfile: parseObservation(
      input.driverProfile,
      "driverProfile",
      parseDriverProfile,
    ),
    policy: {
      network: oneOf(
        policy.network,
        ["none", "loopback"] as const,
        "policy.network",
      ),
      downloads: false,
      paidInference: false,
    },
    command: {
      argv: stringArray(command.argv, "command.argv"),
      environmentNames,
    },
    reproduction: {
      argv: stringArray(reproduction.argv, "reproduction.argv"),
    },
    ...(input.parentRunId === undefined
      ? {}
      : { parentRunId: safeId(input.parentRunId, "parentRunId") }),
  };
  if (parsed.command.argv.length === 0 || parsed.reproduction.argv.length === 0)
    throw new EvaluationSchemaError(
      "command.argv and reproduction.argv must not be empty.",
    );
  return parsed;
}

export function digestEvaluationRunManifest(
  manifest: EvaluationRunManifest,
): string {
  return createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
}
