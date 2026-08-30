import { createHash } from "node:crypto";

export const MODEL_DRIVER_PROFILE_SCHEMA_VERSION = 1 as const;

export type DriverJsonValue =
  | string
  | number
  | boolean
  | null
  | DriverJsonValue[]
  | { [key: string]: DriverJsonValue };

export type DriverConfig = { [key: string]: DriverJsonValue };

/**
 * Identity of the model/runtime/configuration combination whose behavior was
 * measured. Nullable fields are deliberately explicit unknowns; they are not
 * synthesized from a display name or a nearby runtime setting.
 */
export interface ExactModelIdentity {
  providerFamily: string;
  modelId: string;
  artifactId: string | null;
  artifactSha256: string | null;
  parameterClass: string | null;
  quantization: string | null;
  runtime: string;
  runtimeVersion: string | null;
  endpointProtocol: string;
  chatTemplate: string | null;
  toolTemplate: string | null;
  structuredOutputMode: string | null;
  reasoningMode: string | null;
  tokenizerId: string | null;
  contextConfiguration: DriverConfig;
  samplingConfiguration: DriverConfig;
  operatingSystem: string;
  hardwareFingerprint: string | null;
  createdAt: string;
}

export interface ExactModelIdentityInput extends Omit<
  ExactModelIdentity,
  | "artifactId"
  | "artifactSha256"
  | "parameterClass"
  | "quantization"
  | "runtimeVersion"
  | "chatTemplate"
  | "toolTemplate"
  | "structuredOutputMode"
  | "reasoningMode"
  | "tokenizerId"
  | "hardwareFingerprint"
  | "createdAt"
> {
  artifactId?: string | null;
  artifactSha256?: string | null;
  parameterClass?: string | null;
  quantization?: string | null;
  runtimeVersion?: string | null;
  chatTemplate?: string | null;
  toolTemplate?: string | null;
  structuredOutputMode?: string | null;
  reasoningMode?: string | null;
  tokenizerId?: string | null;
  hardwareFingerprint?: string | null;
  createdAt?: string;
}

export type DriverStatus =
  "uncalibrated" | "calibrating" | "certified" | "degraded" | "invalidated";

export type CapabilityLevel = "C0" | "C1" | "C2" | "C3" | "C4" | "C5" | "C6";

export type ActionProtocol =
  | "native_function"
  | "constrained_json"
  | "xml_system_tools"
  | "text_action_grammar"
  | "unselected";

export type EditCodec =
  | "whole_file"
  | "search_replace"
  | "unified_diff"
  | "structured_patch"
  | "unselected";

export type WriteAuthority = "none" | "bounded" | "autonomous";
export type NetworkAuthority = "none" | "loopback" | "policy_bound";

export type ReasoningMode =
  "off" | "runtime_native" | "bounded_budget" | "model_supported";

export interface ContextBudgetProfile {
  minimum: number;
  preferred: number;
  maximum: number;
}

export interface ReasoningProfile {
  mode: ReasoningMode;
  budget: number | null;
}

export interface DriverEvidenceRef {
  id: string;
  digest?: string;
}

export interface ModelDriverProfile {
  schemaVersion: typeof MODEL_DRIVER_PROFILE_SCHEMA_VERSION;
  id: string;
  identityDigest: string;
  identity: ExactModelIdentity;
  status: DriverStatus;
  capabilityLevel: CapabilityLevel;
  protocol: ActionProtocol;
  editCodec: EditCodec;
  maxCertifiedToolSurface: number;
  preferredToolStages: string[][];
  contextBudget: ContextBudgetProfile;
  outputBudget: number;
  reasoning: ReasoningProfile;
  maxCertifiedActionHorizon: number;
  recoveryPolicyId: string;
  writeAuthority: WriteAuthority;
  networkAuthority: NetworkAuthority;
  benchmarkEvidence: DriverEvidenceRef[];
  createdAt: string;
  expiresAt?: string;
}

export type ParsedModelDriverProfile =
  { ok: true; value: ModelDriverProfile } | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isDriverJsonValue(value: unknown): value is DriverJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (isFiniteNumber(value)) return true;
  if (Array.isArray(value)) return value.every(isDriverJsonValue);
  return (
    isRecord(value) &&
    Object.values(value).every((item) => isDriverJsonValue(item))
  );
}

function canonicalJson(value: DriverJsonValue): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key]!)}`)
    .join(",")}}`;
}

function identityMaterial(identity: ExactModelIdentity): DriverJsonValue {
  const { createdAt: _createdAt, ...material } =
    identity as ExactModelIdentity & Record<string, DriverJsonValue>;
  return material;
}

function nonEmpty(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requiredText(value: string, label: string): string {
  const normalized = nonEmpty(value);
  if (normalized === null)
    throw new Error(`${label} must be a non-empty string.`);
  return normalized;
}

function nullableText(value: string | null | undefined): string | null {
  return nonEmpty(value);
}

function validateIdentity(identity: ExactModelIdentity): void {
  requiredText(identity.providerFamily, "identity.providerFamily");
  requiredText(identity.modelId, "identity.modelId");
  requiredText(identity.runtime, "identity.runtime");
  requiredText(identity.endpointProtocol, "identity.endpointProtocol");
  requiredText(identity.operatingSystem, "identity.operatingSystem");
  if (!isRecord(identity.contextConfiguration))
    throw new Error("identity.contextConfiguration must be an object.");
  if (!isDriverJsonValue(identity.contextConfiguration))
    throw new Error("identity.contextConfiguration contains an invalid value.");
  if (!isRecord(identity.samplingConfiguration))
    throw new Error("identity.samplingConfiguration must be an object.");
  if (!isDriverJsonValue(identity.samplingConfiguration))
    throw new Error(
      "identity.samplingConfiguration contains an invalid value.",
    );
  if (Number.isNaN(Date.parse(identity.createdAt)))
    throw new Error("identity.createdAt must be an ISO timestamp.");
}

export function createExactModelIdentity(
  input: ExactModelIdentityInput,
): ExactModelIdentity {
  const identity: ExactModelIdentity = {
    providerFamily: requiredText(input.providerFamily, "providerFamily"),
    modelId: requiredText(input.modelId, "modelId"),
    artifactId: nullableText(input.artifactId),
    artifactSha256: nullableText(input.artifactSha256),
    parameterClass: nullableText(input.parameterClass),
    quantization: nullableText(input.quantization),
    runtime: requiredText(input.runtime, "runtime"),
    runtimeVersion: nullableText(input.runtimeVersion),
    endpointProtocol: requiredText(input.endpointProtocol, "endpointProtocol"),
    chatTemplate: nullableText(input.chatTemplate),
    toolTemplate: nullableText(input.toolTemplate),
    structuredOutputMode: nullableText(input.structuredOutputMode),
    reasoningMode: nullableText(input.reasoningMode),
    tokenizerId: nullableText(input.tokenizerId),
    contextConfiguration: input.contextConfiguration,
    samplingConfiguration: input.samplingConfiguration,
    operatingSystem: requiredText(input.operatingSystem, "operatingSystem"),
    hardwareFingerprint: nullableText(input.hardwareFingerprint),
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
  validateIdentity(identity);
  return identity;
}

export function exactModelIdentityDigest(identity: ExactModelIdentity): string {
  validateIdentity(identity);
  return createHash("sha256")
    .update(canonicalJson(identityMaterial(identity)))
    .digest("hex");
}

export function createUncalibratedDriverProfile(
  identity: ExactModelIdentity,
): ModelDriverProfile {
  const identityDigest = exactModelIdentityDigest(identity);
  return {
    schemaVersion: MODEL_DRIVER_PROFILE_SCHEMA_VERSION,
    id: `driver-${identityDigest.slice(0, 24)}`,
    identityDigest,
    identity,
    status: "uncalibrated",
    capabilityLevel: "C0",
    protocol: "unselected",
    editCodec: "unselected",
    maxCertifiedToolSurface: 0,
    preferredToolStages: [],
    contextBudget: { minimum: 0, preferred: 0, maximum: 0 },
    outputBudget: 0,
    reasoning: { mode: "off", budget: null },
    maxCertifiedActionHorizon: 0,
    recoveryPolicyId: "none",
    writeAuthority: "none",
    networkAuthority: "none",
    benchmarkEvidence: [],
    createdAt: identity.createdAt,
  };
}

export function invalidateModelDriverProfile(
  profile: ModelDriverProfile,
): ModelDriverProfile {
  return {
    ...profile,
    status: "invalidated",
    writeAuthority: "none",
    networkAuthority: "none",
  };
}

export function driverProfileCanWrite(
  profile: ModelDriverProfile | undefined,
  identity?: ExactModelIdentity,
  now = new Date(),
): boolean {
  if (
    !profile ||
    profile.status !== "certified" ||
    profile.writeAuthority === "none"
  )
    return false;
  try {
    if (profile.identityDigest !== exactModelIdentityDigest(profile.identity))
      return false;
    if (
      identity &&
      profile.identityDigest !== exactModelIdentityDigest(identity)
    )
      return false;
  } catch {
    return false;
  }
  return !profile.expiresAt || Date.parse(profile.expiresAt) > now.getTime();
}

function strictFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): string | null {
  const allowedSet = new Set(allowed);
  const unexpected = Object.keys(value).find((key) => !allowedSet.has(key));
  return unexpected ? `Unexpected ${label} field: ${unexpected}` : null;
}

function parseNullableText(
  value: unknown,
  label: string,
): string | null | Error {
  if (value === null) return null;
  if (typeof value !== "string" || value.trim().length === 0)
    return new Error(`${label} must be a non-empty string or null.`);
  return value;
}

function parseIdentity(
  value: unknown,
): { ok: true; value: ExactModelIdentity } | { ok: false; error: string } {
  if (!isRecord(value))
    return { ok: false, error: "identity must be an object." };
  const fields = [
    "providerFamily",
    "modelId",
    "artifactId",
    "artifactSha256",
    "parameterClass",
    "quantization",
    "runtime",
    "runtimeVersion",
    "endpointProtocol",
    "chatTemplate",
    "toolTemplate",
    "structuredOutputMode",
    "reasoningMode",
    "tokenizerId",
    "contextConfiguration",
    "samplingConfiguration",
    "operatingSystem",
    "hardwareFingerprint",
    "createdAt",
  ] as const;
  const unexpected = strictFields(value, fields, "identity");
  if (unexpected) return { ok: false, error: unexpected };
  const requiredFields = [
    "providerFamily",
    "modelId",
    "artifactId",
    "artifactSha256",
    "parameterClass",
    "quantization",
    "runtime",
    "runtimeVersion",
    "endpointProtocol",
    "chatTemplate",
    "toolTemplate",
    "structuredOutputMode",
    "reasoningMode",
    "tokenizerId",
    "contextConfiguration",
    "samplingConfiguration",
    "operatingSystem",
    "hardwareFingerprint",
    "createdAt",
  ] as const;
  for (const field of requiredFields)
    if (!(field in value))
      return { ok: false, error: `identity.${field} is required.` };
  const texts = new Map<string, string>();
  for (const field of [
    "providerFamily",
    "modelId",
    "runtime",
    "endpointProtocol",
    "operatingSystem",
    "createdAt",
  ]) {
    const raw = value[field];
    if (typeof raw !== "string" || raw.trim().length === 0)
      return {
        ok: false,
        error: `identity.${field} must be a non-empty string.`,
      };
    texts.set(field, raw);
  }
  if (Number.isNaN(Date.parse(texts.get("createdAt")!)))
    return { ok: false, error: "identity.createdAt must be an ISO timestamp." };
  const nullable: Record<string, string | null> = {};
  for (const field of [
    "artifactId",
    "artifactSha256",
    "parameterClass",
    "quantization",
    "runtimeVersion",
    "chatTemplate",
    "toolTemplate",
    "structuredOutputMode",
    "reasoningMode",
    "tokenizerId",
    "hardwareFingerprint",
  ]) {
    const parsed = parseNullableText(value[field], `identity.${field}`);
    if (parsed instanceof Error) return { ok: false, error: parsed.message };
    nullable[field] = parsed;
  }
  if (
    !isRecord(value.contextConfiguration) ||
    !isDriverJsonValue(value.contextConfiguration)
  )
    return {
      ok: false,
      error: "identity.contextConfiguration contains an invalid value.",
    };
  if (
    !isRecord(value.samplingConfiguration) ||
    !isDriverJsonValue(value.samplingConfiguration)
  )
    return {
      ok: false,
      error: "identity.samplingConfiguration contains an invalid value.",
    };
  return {
    ok: true,
    value: {
      providerFamily: texts.get("providerFamily")!,
      modelId: texts.get("modelId")!,
      artifactId: nullable.artifactId!,
      artifactSha256: nullable.artifactSha256!,
      parameterClass: nullable.parameterClass!,
      quantization: nullable.quantization!,
      runtime: texts.get("runtime")!,
      runtimeVersion: nullable.runtimeVersion!,
      endpointProtocol: texts.get("endpointProtocol")!,
      chatTemplate: nullable.chatTemplate!,
      toolTemplate: nullable.toolTemplate!,
      structuredOutputMode: nullable.structuredOutputMode!,
      reasoningMode: nullable.reasoningMode!,
      tokenizerId: nullable.tokenizerId!,
      contextConfiguration: value.contextConfiguration as DriverConfig,
      samplingConfiguration: value.samplingConfiguration as DriverConfig,
      operatingSystem: texts.get("operatingSystem")!,
      hardwareFingerprint: nullable.hardwareFingerprint!,
      createdAt: texts.get("createdAt")!,
    },
  };
}

function parseEnum<T extends string>(
  value: unknown,
  choices: readonly T[],
  label: string,
): T | Error {
  return typeof value === "string" && choices.includes(value as T)
    ? (value as T)
    : new Error(`${label} must be one of: ${choices.join(", ")}.`);
}

function parseNonNegativeInteger(
  value: unknown,
  label: string,
): number | Error {
  return Number.isInteger(value) && (value as number) >= 0
    ? (value as number)
    : new Error(`${label} must be a non-negative integer.`);
}

function parseEvidence(value: unknown): DriverEvidenceRef[] | Error {
  if (!Array.isArray(value))
    return new Error("benchmarkEvidence must be an array.");
  const result: DriverEvidenceRef[] = [];
  for (const item of value) {
    if (!isRecord(item))
      return new Error("benchmarkEvidence entries must be objects.");
    const unexpected = strictFields(
      item,
      ["id", "digest"],
      "benchmarkEvidence entry",
    );
    if (unexpected) return new Error(unexpected);
    if (typeof item.id !== "string" || item.id.trim().length === 0)
      return new Error("benchmarkEvidence.id must be a non-empty string.");
    if (
      item.digest !== undefined &&
      (typeof item.digest !== "string" || item.digest.trim().length === 0)
    )
      return new Error("benchmarkEvidence.digest must be a non-empty string.");
    result.push({
      id: item.id,
      ...(item.digest === undefined ? {} : { digest: item.digest }),
    });
  }
  return result;
}

export function parseModelDriverProfile(
  value: unknown,
): ParsedModelDriverProfile {
  if (!isRecord(value))
    return { ok: false, error: "profile must be an object." };
  const fields = [
    "schemaVersion",
    "id",
    "identityDigest",
    "identity",
    "status",
    "capabilityLevel",
    "protocol",
    "editCodec",
    "maxCertifiedToolSurface",
    "preferredToolStages",
    "contextBudget",
    "outputBudget",
    "reasoning",
    "maxCertifiedActionHorizon",
    "recoveryPolicyId",
    "writeAuthority",
    "networkAuthority",
    "benchmarkEvidence",
    "createdAt",
    "expiresAt",
  ] as const;
  const unexpected = strictFields(value, fields, "profile");
  if (unexpected) return { ok: false, error: unexpected };
  if (value.schemaVersion !== MODEL_DRIVER_PROFILE_SCHEMA_VERSION)
    return { ok: false, error: "profile.schemaVersion is unsupported." };
  for (const field of [
    "id",
    "identityDigest",
    "recoveryPolicyId",
    "createdAt",
  ]) {
    if (typeof value[field] !== "string" || value[field].trim().length === 0)
      return {
        ok: false,
        error: `profile.${field} must be a non-empty string.`,
      };
  }
  if (Number.isNaN(Date.parse(value.createdAt as string)))
    return { ok: false, error: "profile.createdAt must be an ISO timestamp." };
  if (value.expiresAt !== undefined) {
    if (
      typeof value.expiresAt !== "string" ||
      Number.isNaN(Date.parse(value.expiresAt))
    )
      return {
        ok: false,
        error: "profile.expiresAt must be an ISO timestamp.",
      };
  }
  const identity = parseIdentity(value.identity);
  if (!identity.ok) return identity;
  let computedDigest: string;
  try {
    computedDigest = exactModelIdentityDigest(identity.value);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "identity is invalid.",
    };
  }
  if (value.identityDigest !== computedDigest)
    return {
      ok: false,
      error: "profile.identityDigest does not match identity.",
    };
  const status = parseEnum(
    value.status,
    [
      "uncalibrated",
      "calibrating",
      "certified",
      "degraded",
      "invalidated",
    ] as const,
    "profile.status",
  );
  if (status instanceof Error) return { ok: false, error: status.message };
  const capabilityLevel = parseEnum(
    value.capabilityLevel,
    ["C0", "C1", "C2", "C3", "C4", "C5", "C6"] as const,
    "profile.capabilityLevel",
  );
  if (capabilityLevel instanceof Error)
    return { ok: false, error: capabilityLevel.message };
  const protocol = parseEnum(
    value.protocol,
    [
      "native_function",
      "constrained_json",
      "xml_system_tools",
      "text_action_grammar",
      "unselected",
    ] as const,
    "profile.protocol",
  );
  if (protocol instanceof Error) return { ok: false, error: protocol.message };
  const editCodec = parseEnum(
    value.editCodec,
    [
      "whole_file",
      "search_replace",
      "unified_diff",
      "structured_patch",
      "unselected",
    ] as const,
    "profile.editCodec",
  );
  if (editCodec instanceof Error)
    return { ok: false, error: editCodec.message };
  const writeAuthority = parseEnum(
    value.writeAuthority,
    ["none", "bounded", "autonomous"] as const,
    "profile.writeAuthority",
  );
  if (writeAuthority instanceof Error)
    return { ok: false, error: writeAuthority.message };
  const networkAuthority = parseEnum(
    value.networkAuthority,
    ["none", "loopback", "policy_bound"] as const,
    "profile.networkAuthority",
  );
  if (networkAuthority instanceof Error)
    return { ok: false, error: networkAuthority.message };
  const maxToolSurface = parseNonNegativeInteger(
    value.maxCertifiedToolSurface,
    "profile.maxCertifiedToolSurface",
  );
  if (maxToolSurface instanceof Error)
    return { ok: false, error: maxToolSurface.message };
  const actionHorizon = parseNonNegativeInteger(
    value.maxCertifiedActionHorizon,
    "profile.maxCertifiedActionHorizon",
  );
  if (actionHorizon instanceof Error)
    return { ok: false, error: actionHorizon.message };
  const outputBudget = parseNonNegativeInteger(
    value.outputBudget,
    "profile.outputBudget",
  );
  if (outputBudget instanceof Error)
    return { ok: false, error: outputBudget.message };
  if (
    !Array.isArray(value.preferredToolStages) ||
    !value.preferredToolStages.every(
      (stage) =>
        Array.isArray(stage) &&
        stage.every(
          (item) => typeof item === "string" && item.trim().length > 0,
        ),
    )
  )
    return {
      ok: false,
      error: "profile.preferredToolStages must contain string arrays.",
    };
  if (!isRecord(value.contextBudget))
    return { ok: false, error: "profile.contextBudget must be an object." };
  const contextFields = strictFields(
    value.contextBudget,
    ["minimum", "preferred", "maximum"],
    "profile.contextBudget",
  );
  if (contextFields) return { ok: false, error: contextFields };
  const minimum = parseNonNegativeInteger(
    value.contextBudget.minimum,
    "profile.contextBudget.minimum",
  );
  const preferred = parseNonNegativeInteger(
    value.contextBudget.preferred,
    "profile.contextBudget.preferred",
  );
  const maximum = parseNonNegativeInteger(
    value.contextBudget.maximum,
    "profile.contextBudget.maximum",
  );
  if (minimum instanceof Error) return { ok: false, error: minimum.message };
  if (preferred instanceof Error)
    return { ok: false, error: preferred.message };
  if (maximum instanceof Error) return { ok: false, error: maximum.message };
  if (!(minimum <= preferred && preferred <= maximum))
    return {
      ok: false,
      error:
        "profile.contextBudget must be ordered minimum <= preferred <= maximum.",
    };
  if (!isRecord(value.reasoning))
    return { ok: false, error: "profile.reasoning must be an object." };
  const reasoningFields = strictFields(
    value.reasoning,
    ["mode", "budget"],
    "profile.reasoning",
  );
  if (reasoningFields) return { ok: false, error: reasoningFields };
  if (!("mode" in value.reasoning) || !("budget" in value.reasoning))
    return {
      ok: false,
      error: "profile.reasoning.mode and budget are required.",
    };
  const reasoningMode = parseEnum(
    value.reasoning.mode,
    ["off", "runtime_native", "bounded_budget", "model_supported"] as const,
    "profile.reasoning.mode",
  );
  if (reasoningMode instanceof Error)
    return { ok: false, error: reasoningMode.message };
  if (
    value.reasoning.budget !== null &&
    value.reasoning.budget !== undefined &&
    (!Number.isInteger(value.reasoning.budget) ||
      (value.reasoning.budget as number) < 0)
  )
    return {
      ok: false,
      error: "profile.reasoning.budget must be a non-negative integer or null.",
    };
  const evidence = parseEvidence(value.benchmarkEvidence);
  if (evidence instanceof Error) return { ok: false, error: evidence.message };
  if (
    ["uncalibrated", "calibrating", "invalidated"].includes(status) &&
    (writeAuthority !== "none" || networkAuthority !== "none")
  )
    return {
      ok: false,
      error:
        "uncalibrated, calibrating, and invalidated profiles must have no authority.",
    };
  const profile: ModelDriverProfile = {
    schemaVersion: MODEL_DRIVER_PROFILE_SCHEMA_VERSION,
    id: value.id as string,
    identityDigest: value.identityDigest as string,
    identity: identity.value,
    status,
    capabilityLevel,
    protocol,
    editCodec,
    maxCertifiedToolSurface: maxToolSurface,
    preferredToolStages: value.preferredToolStages as string[][],
    contextBudget: { minimum, preferred, maximum },
    outputBudget,
    reasoning: {
      mode: reasoningMode,
      budget: value.reasoning.budget as number | null,
    },
    maxCertifiedActionHorizon: actionHorizon,
    recoveryPolicyId: value.recoveryPolicyId as string,
    writeAuthority,
    networkAuthority,
    benchmarkEvidence: evidence,
    createdAt: value.createdAt as string,
    ...(value.expiresAt === undefined
      ? {}
      : { expiresAt: value.expiresAt as string }),
  };
  return { ok: true, value: profile };
}

export function assertModelDriverProfile(value: unknown): ModelDriverProfile {
  const parsed = parseModelDriverProfile(value);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.value;
}
