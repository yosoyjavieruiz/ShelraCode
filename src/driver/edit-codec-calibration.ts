import { createHash } from "node:crypto";
import type { EditCodec } from "./profile.js";

export type CalibratableEditCodec = Exclude<EditCodec, "unselected">;

export interface EditChange {
  path: string;
  before: string;
  after: string;
}

export interface SearchReplaceSpec {
  search: string;
  replace: string;
  replaceAll?: boolean;
}

export interface StructuredPatchOperation {
  start: number;
  end: number;
  replacement: string;
}

export interface EditCodecPayloadResponse {
  kind?: "payload";
  codec: CalibratableEditCodec;
  path: string;
  payload: string;
  expectedBeforeDigest?: string;
}

export interface EditCodecFailureResponse {
  kind: "failure";
  codec: CalibratableEditCodec;
  path: string;
  failureClass: string;
  message?: string;
  payload?: string;
  expectedBeforeDigest?: string;
}

export type EditCodecResponse =
  EditCodecPayloadResponse | EditCodecFailureResponse;

export interface EditProbeCase {
  id: string;
  path: string;
  before: string;
  currentContent?: string;
  expectedAfter: string;
  searchReplace?: SearchReplaceSpec;
  responses: Partial<Record<CalibratableEditCodec, EditCodecResponse>>;
}

export interface EditCodecApplyResult {
  parseValid: boolean;
  schemaValid: boolean;
  applied: boolean;
  content?: string;
  replacements: number;
  staleEdit: boolean;
  attemptedFailure?: boolean;
  errorClass?:
    | "INVALID_EDIT"
    | "STALE_EDIT"
    | "NOT_FOUND"
    | "AMBIGUOUS_EDIT"
    | "NO_PROGRESS"
    | "ATTEMPTED_FAILURE";
  error?: string;
  tokenCount: number;
}

export interface EditCodecScore {
  caseId: string;
  codec: CalibratableEditCodec;
  parseValid: boolean;
  schemaValid: boolean;
  argumentsValid: boolean;
  applySuccess: boolean;
  semanticCorrect: boolean;
  staleRejected: boolean;
  staleEdit: boolean;
  noProgress: boolean;
  attemptedFailure: boolean;
  tokenCount: number;
  errorClass?: EditCodecApplyResult["errorClass"];
  score: number;
}

export interface EditCodecCalibrationResult {
  codec: CalibratableEditCodec;
  status: "measured" | "unsupported";
  caseCount: number;
  pairedCaseCount: number;
  parseValidityRate: number;
  schemaValidityRate: number;
  applySuccessRate: number;
  semanticSuccessRate: number;
  staleRejectionRate: number;
  noProgressRate: number;
  staleExpectedCaseCount: number;
  meanTokenCount: number;
  score: number;
  pairedScore: number;
  pairedParseValidityRate: number;
  pairedSchemaValidityRate: number;
  pairedSemanticSuccessRate: number;
  pairedApplySuccessRate: number;
  pairedMeanTokenCount: number;
  cases: EditCodecScore[];
  pairedCases: EditCodecScore[];
}

export interface EditCodecCalibrationReport {
  schemaVersion: 1;
  comparedCodecCount: number;
  pairedCaseCount: number;
  selectionStatus:
    "winner_selected" | "insufficient_comparison" | "no_supported_codec";
  winner?: CalibratableEditCodec;
  results: EditCodecCalibrationResult[];
}

const CODECS: readonly CalibratableEditCodec[] = [
  "whole_file",
  "search_replace",
  "unified_diff",
  "structured_patch",
];

function isEditCodec(value: unknown): value is CalibratableEditCodec {
  return (
    typeof value === "string" && CODECS.includes(value as CalibratableEditCodec)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  const normalized = value.replaceAll("\\", "/");
  return (
    !/[\u0000-\u001f\u007f]/.test(value) &&
    !normalized.includes(":") &&
    !normalized.startsWith("/") &&
    !/^[A-Za-z]:\//.test(normalized) &&
    !normalized.split("/").includes("..")
  );
}

function digest(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function tokenCount(payload: string): number {
  return Math.max(1, Math.ceil(payload.length / 4));
}

function splitLines(content: string): string[] {
  return content.split("\n");
}

function encodeUnifiedDiff(change: EditChange): string {
  const oldLines = splitLines(change.before);
  const newLines = splitLines(change.after);
  return [
    `--- a/${change.path}`,
    `+++ b/${change.path}`,
    `@@ -1,${oldLines.length} +1,${newLines.length} @@`,
    ...oldLines.map((line) => `-${line}`),
    ...newLines.map((line) => `+${line}`),
    "",
  ].join("\n");
}

function structuredOperations(
  before: string,
  after: string,
): StructuredPatchOperation[] {
  let prefix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  )
    prefix += 1;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  )
    suffix += 1;
  return [
    {
      start: prefix,
      end: before.length - suffix,
      replacement: after.slice(prefix, after.length - suffix),
    },
  ];
}

export function encodeEditCodec(
  codec: CalibratableEditCodec,
  change: EditChange & { searchReplace?: SearchReplaceSpec },
): EditCodecResponse {
  const expectedBeforeDigest = digest(change.before);
  if (codec === "whole_file")
    return {
      codec,
      path: change.path,
      payload: change.after,
      expectedBeforeDigest,
    };
  if (codec === "search_replace") {
    const replacement = change.searchReplace ?? {
      search: change.before,
      replace: change.after,
    };
    return {
      codec,
      path: change.path,
      payload: JSON.stringify({
        path: change.path,
        search: replacement.search,
        replace: replacement.replace,
        replaceAll: replacement.replaceAll ?? false,
      }),
      expectedBeforeDigest,
    };
  }
  if (codec === "unified_diff")
    return {
      codec,
      path: change.path,
      payload: encodeUnifiedDiff(change),
      expectedBeforeDigest,
    };
  return {
    codec,
    path: change.path,
    payload: JSON.stringify({
      path: change.path,
      expectedBeforeDigest,
      operations: structuredOperations(change.before, change.after),
    }),
    expectedBeforeDigest,
  };
}

function invalidResult(
  payload: string,
  error: string,
  parseValid = false,
): EditCodecApplyResult {
  return {
    parseValid,
    schemaValid: false,
    applied: false,
    replacements: 0,
    staleEdit: false,
    errorClass: "INVALID_EDIT",
    error,
    tokenCount: tokenCount(payload),
  };
}

function decodeJson(
  payload: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(payload) };
  } catch {
    return { ok: false, error: "edit JSON could not be parsed." };
  }
}

function validObjectKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return (
    required.every((key) => key in value) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}

function applySearchReplace(
  response: EditCodecPayloadResponse,
  current: string,
): EditCodecApplyResult {
  const decoded = decodeJson(response.payload);
  if (!decoded.ok) return invalidResult(response.payload, decoded.error);
  if (!isRecord(decoded.value))
    return invalidResult(
      response.payload,
      "search-replace payload must be an object.",
      true,
    );
  if (
    !validObjectKeys(
      decoded.value,
      ["path", "search", "replace"],
      ["replaceAll"],
    )
  )
    return invalidResult(
      response.payload,
      "search-replace payload has an invalid schema.",
      true,
    );
  if (
    decoded.value.path !== response.path ||
    typeof decoded.value.search !== "string" ||
    decoded.value.search.length === 0 ||
    typeof decoded.value.replace !== "string" ||
    (decoded.value.replaceAll !== undefined &&
      typeof decoded.value.replaceAll !== "boolean")
  )
    return invalidResult(
      response.payload,
      "search-replace arguments are invalid.",
      true,
    );
  const search = decoded.value.search;
  const replace = decoded.value.replace;
  const replaceAll = decoded.value.replaceAll === true;
  const occurrences = current.split(search).length - 1;
  if (occurrences === 0)
    return {
      parseValid: true,
      schemaValid: true,
      applied: false,
      replacements: 0,
      staleEdit: false,
      errorClass: "NOT_FOUND",
      error: "search text was not found.",
      tokenCount: tokenCount(response.payload),
    };
  if (occurrences > 1 && !replaceAll)
    return {
      parseValid: true,
      schemaValid: true,
      applied: false,
      replacements: 0,
      staleEdit: false,
      errorClass: "AMBIGUOUS_EDIT",
      error: "search text matched more than once.",
      tokenCount: tokenCount(response.payload),
    };
  const content = replaceAll
    ? current.replaceAll(search, replace)
    : current.replace(search, replace);
  if (content === current)
    return {
      parseValid: true,
      schemaValid: true,
      applied: false,
      replacements: 0,
      staleEdit: false,
      errorClass: "NO_PROGRESS",
      error: "edit would make no change.",
      tokenCount: tokenCount(response.payload),
    };
  return {
    parseValid: true,
    schemaValid: true,
    applied: true,
    content,
    replacements: replaceAll ? occurrences : 1,
    staleEdit: false,
    tokenCount: tokenCount(response.payload),
  };
}

function applyUnifiedDiff(
  response: EditCodecPayloadResponse,
  current: string,
): EditCodecApplyResult {
  const lines = response.payload.split("\n");
  if (
    lines.length < 4 ||
    !lines[0]?.startsWith("--- a/") ||
    !lines[1]?.startsWith("+++ b/")
  )
    return invalidResult(response.payload, "unified diff headers are invalid.");
  const pathLine = lines[1].slice("+++ b/".length);
  const hunk = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@$/.exec(lines[2] ?? "");
  if (!hunk)
    return invalidResult(
      response.payload,
      "unified diff hunk header is invalid.",
      true,
    );
  if (
    pathLine !== response.path ||
    lines[0].slice("--- a/".length) !== response.path
  )
    return invalidResult(
      response.payload,
      "unified diff path does not match target.",
      true,
    );
  const oldCount = Number(hunk[2]);
  const newCount = Number(hunk[4]);
  const body = lines
    .slice(3)
    .filter(
      (line, index, array) => !(index === array.length - 1 && line === ""),
    );
  const oldLines: string[] = [];
  const newLines: string[] = [];
  for (const line of body) {
    if (line.startsWith("-")) oldLines.push(line.slice(1));
    else if (line.startsWith("+")) newLines.push(line.slice(1));
    else if (line.startsWith(" ")) {
      oldLines.push(line.slice(1));
      newLines.push(line.slice(1));
    } else
      return invalidResult(
        response.payload,
        "unified diff body is invalid.",
        true,
      );
  }
  if (oldLines.length !== oldCount || newLines.length !== newCount)
    return invalidResult(
      response.payload,
      "unified diff line counts are invalid.",
      true,
    );
  const currentLines = splitLines(current);
  const start = Number(hunk[1]) - 1;
  if (start < 0 || start + oldLines.length > currentLines.length)
    return {
      parseValid: true,
      schemaValid: true,
      applied: false,
      replacements: 0,
      staleEdit: true,
      errorClass: "STALE_EDIT",
      error: "unified diff range is stale.",
      tokenCount: tokenCount(response.payload),
    };
  const observed = currentLines.slice(start, start + oldLines.length);
  if (observed.join("\n") !== oldLines.join("\n"))
    return {
      parseValid: true,
      schemaValid: true,
      applied: false,
      replacements: 0,
      staleEdit: true,
      errorClass: "STALE_EDIT",
      error: "unified diff context is stale.",
      tokenCount: tokenCount(response.payload),
    };
  const updatedLines = [
    ...currentLines.slice(0, start),
    ...newLines,
    ...currentLines.slice(start + oldLines.length),
  ];
  const content = updatedLines.join("\n");
  if (content === current)
    return {
      parseValid: true,
      schemaValid: true,
      applied: false,
      replacements: 0,
      staleEdit: false,
      errorClass: "NO_PROGRESS",
      error: "diff would make no change.",
      tokenCount: tokenCount(response.payload),
    };
  return {
    parseValid: true,
    schemaValid: true,
    applied: true,
    content,
    replacements: 1,
    staleEdit: false,
    tokenCount: tokenCount(response.payload),
  };
}

function applyStructuredPatch(
  response: EditCodecPayloadResponse,
  current: string,
): EditCodecApplyResult {
  const decoded = decodeJson(response.payload);
  if (!decoded.ok) return invalidResult(response.payload, decoded.error);
  if (!isRecord(decoded.value))
    return invalidResult(
      response.payload,
      "structured patch must be an object.",
      true,
    );
  if (
    !validObjectKeys(decoded.value, [
      "path",
      "expectedBeforeDigest",
      "operations",
    ])
  )
    return invalidResult(
      response.payload,
      "structured patch schema is invalid.",
      true,
    );
  if (
    decoded.value.path !== response.path ||
    typeof decoded.value.expectedBeforeDigest !== "string" ||
    !/^[0-9a-f]{64}$/i.test(decoded.value.expectedBeforeDigest) ||
    decoded.value.expectedBeforeDigest !== response.expectedBeforeDigest ||
    !Array.isArray(decoded.value.operations) ||
    decoded.value.operations.length === 0
  )
    return invalidResult(
      response.payload,
      "structured patch arguments are invalid.",
      true,
    );
  if (decoded.value.expectedBeforeDigest !== digest(current))
    return {
      parseValid: true,
      schemaValid: true,
      applied: false,
      replacements: 0,
      staleEdit: true,
      errorClass: "STALE_EDIT",
      error: "structured patch digest is stale.",
      tokenCount: tokenCount(response.payload),
    };
  const operations: StructuredPatchOperation[] = [];
  for (const operation of decoded.value.operations) {
    if (!isRecord(operation))
      return invalidResult(
        response.payload,
        "structured patch operation is invalid.",
        true,
      );
    if (!validObjectKeys(operation, ["start", "end", "replacement"]))
      return invalidResult(
        response.payload,
        "structured patch operation is invalid.",
        true,
      );
    const start =
      typeof operation.start === "number" ? operation.start : undefined;
    const end = typeof operation.end === "number" ? operation.end : undefined;
    const replacement =
      typeof operation.replacement === "string"
        ? operation.replacement
        : undefined;
    if (
      start === undefined ||
      end === undefined ||
      replacement === undefined ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      end > current.length
    )
      return invalidResult(
        response.payload,
        "structured patch operation is invalid.",
        true,
      );
    operations.push({
      start,
      end,
      replacement,
    });
  }
  const ordered = [...operations].sort(
    (left, right) => right.start - left.start,
  );
  for (let index = 1; index < ordered.length; index += 1)
    if (ordered[index]!.end > ordered[index - 1]!.start)
      return invalidResult(
        response.payload,
        "structured patch operations overlap.",
        true,
      );
  let content = current;
  for (const operation of ordered)
    content =
      content.slice(0, operation.start) +
      operation.replacement +
      content.slice(operation.end);
  if (content === current)
    return {
      parseValid: true,
      schemaValid: true,
      applied: false,
      replacements: 0,
      staleEdit: false,
      errorClass: "NO_PROGRESS",
      error: "structured patch would make no change.",
      tokenCount: tokenCount(response.payload),
    };
  return {
    parseValid: true,
    schemaValid: true,
    applied: true,
    content,
    replacements: operations.length,
    staleEdit: false,
    tokenCount: tokenCount(response.payload),
  };
}

export function applyEditCodec(
  response: EditCodecResponse,
  currentContent: string,
): EditCodecApplyResult {
  if (!isRecord(response))
    return invalidResult("", "edit response must be an object.");
  const codec = response.codec;
  const pathValue = response.path;
  const payloadValue = response.payload;
  if (!isEditCodec(codec))
    return invalidResult(
      typeof payloadValue === "string" ? payloadValue : "",
      "edit codec is unsupported.",
      true,
    );
  if (!isSafeRelativePath(pathValue))
    return invalidResult(
      typeof payloadValue === "string" ? payloadValue : "",
      "edit path is outside the workspace.",
    );
  if (response.kind === "failure") {
    const failureClass = response.failureClass;
    if (typeof failureClass !== "string" || failureClass.trim().length === 0)
      return invalidResult(
        typeof payloadValue === "string" ? payloadValue : "",
        "attempted failure response must name a failure class.",
        true,
      );
    const failurePayload = typeof payloadValue === "string" ? payloadValue : "";
    return {
      parseValid: false,
      schemaValid: false,
      applied: false,
      replacements: 0,
      staleEdit: false,
      attemptedFailure: true,
      errorClass: "ATTEMPTED_FAILURE",
      error: `${failureClass}${typeof response.message === "string" ? `: ${response.message}` : ""}`,
      tokenCount: tokenCount(failurePayload),
    };
  }
  if (response.kind !== undefined && response.kind !== "payload")
    return invalidResult(
      typeof payloadValue === "string" ? payloadValue : "",
      "edit response kind is invalid.",
      true,
    );
  if (typeof payloadValue !== "string")
    return invalidResult("", "edit payload must be a string.");
  if (
    typeof response.expectedBeforeDigest !== "string" ||
    !/^[0-9a-f]{64}$/i.test(response.expectedBeforeDigest)
  )
    return invalidResult(
      payloadValue,
      "edit expected-before digest is required.",
      true,
    );
  const normalizedResponse: EditCodecPayloadResponse = {
    codec,
    path: pathValue,
    payload: payloadValue,
    expectedBeforeDigest: response.expectedBeforeDigest,
  };
  const responseDigest = normalizedResponse.expectedBeforeDigest;
  if (responseDigest !== digest(currentContent))
    return {
      parseValid: true,
      schemaValid: true,
      applied: false,
      replacements: 0,
      staleEdit: true,
      errorClass: "STALE_EDIT",
      error: "edit expected-before digest does not match the current content.",
      tokenCount: tokenCount(payloadValue),
    };
  if (codec === "whole_file") {
    if (payloadValue === currentContent)
      return {
        parseValid: true,
        schemaValid: true,
        applied: false,
        replacements: 0,
        staleEdit: false,
        errorClass: "NO_PROGRESS",
        error: "whole-file edit would make no change.",
        tokenCount: tokenCount(payloadValue),
      };
    return {
      parseValid: true,
      schemaValid: true,
      applied: true,
      content: payloadValue,
      replacements: 1,
      staleEdit: false,
      tokenCount: tokenCount(payloadValue),
    };
  }
  if (codec === "search_replace")
    return applySearchReplace(normalizedResponse, currentContent);
  if (codec === "unified_diff")
    return applyUnifiedDiff(normalizedResponse, currentContent);
  return applyStructuredPatch(normalizedResponse, currentContent);
}

export function evaluateEditCodecCase(
  probe: EditProbeCase,
  codec: CalibratableEditCodec,
): EditCodecScore {
  const response = probe.responses[codec];
  const current = probe.currentContent ?? probe.before;
  const result = response
    ? response.codec !== codec || response.path !== probe.path
      ? invalidResult(
          typeof response.payload === "string" ? response.payload : "",
          "edit response does not match the probe codec or target path.",
          true,
        )
      : applyEditCodec(response, current)
    : invalidResult("", "codec response was not supplied.");
  const staleExpected = current !== probe.before;
  const staleRejected = staleExpected && result.staleEdit && !result.applied;
  const semanticCorrect =
    result.applied && result.content === probe.expectedAfter;
  const argumentsValid =
    result.schemaValid && result.errorClass !== "INVALID_EDIT";
  const noProgress = result.errorClass === "NO_PROGRESS";
  const attemptedFailure = result.attemptedFailure === true;
  const score = Math.max(
    0,
    Math.min(
      1,
      (result.parseValid ? 0.1 : 0) +
        (result.schemaValid ? 0.15 : 0) +
        (argumentsValid ? 0.1 : 0) +
        (result.applied ? 0.2 : 0) +
        (semanticCorrect ? 0.35 : 0) +
        (staleRejected ? 0.1 : 0) +
        (1 / (1 + result.tokenCount)) * 0.05 -
        (noProgress ? 0.1 : 0),
    ),
  );
  return {
    caseId: probe.id,
    codec,
    parseValid: result.parseValid,
    schemaValid: result.schemaValid,
    argumentsValid,
    applySuccess: result.applied,
    semanticCorrect,
    staleRejected,
    staleEdit: result.staleEdit,
    noProgress,
    attemptedFailure,
    tokenCount: result.tokenCount,
    ...(result.errorClass ? { errorClass: result.errorClass } : {}),
    score,
  };
}

function rate(values: boolean[]): number {
  return values.length === 0
    ? 0
    : values.filter(Boolean).length / values.length;
}

function mean(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

function resultFor(
  codec: CalibratableEditCodec,
  probes: readonly EditProbeCase[],
  pairedProbes: readonly EditProbeCase[],
): EditCodecCalibrationResult {
  const available = probes.filter(
    (probe) => probe.responses[codec] !== undefined,
  );
  if (available.length === 0)
    return {
      codec,
      status: "unsupported",
      caseCount: 0,
      pairedCaseCount: 0,
      parseValidityRate: 0,
      schemaValidityRate: 0,
      applySuccessRate: 0,
      semanticSuccessRate: 0,
      staleRejectionRate: 0,
      noProgressRate: 0,
      staleExpectedCaseCount: 0,
      meanTokenCount: 0,
      score: 0,
      pairedScore: 0,
      pairedParseValidityRate: 0,
      pairedSchemaValidityRate: 0,
      pairedSemanticSuccessRate: 0,
      pairedApplySuccessRate: 0,
      pairedMeanTokenCount: 0,
      cases: [],
      pairedCases: [],
    };
  const cases = available.map((probe) => evaluateEditCodecCase(probe, codec));
  const pairedCases = pairedProbes.map((probe) =>
    evaluateEditCodecCase(probe, codec),
  );
  const staleExpected = cases.filter(
    (_item, index) =>
      (available[index]!.currentContent ?? available[index]!.before) !==
      available[index]!.before,
  );
  return {
    codec,
    status: "measured",
    caseCount: cases.length,
    pairedCaseCount: pairedCases.length,
    parseValidityRate: rate(cases.map((item) => item.parseValid)),
    schemaValidityRate: rate(cases.map((item) => item.schemaValid)),
    applySuccessRate: rate(cases.map((item) => item.applySuccess)),
    semanticSuccessRate: rate(cases.map((item) => item.semanticCorrect)),
    staleRejectionRate: rate(staleExpected.map((item) => item.staleRejected)),
    noProgressRate: rate(cases.map((item) => item.noProgress)),
    staleExpectedCaseCount: staleExpected.length,
    meanTokenCount: mean(cases.map((item) => item.tokenCount)),
    score: mean(cases.map((item) => item.score)),
    pairedScore: mean(pairedCases.map((item) => item.score)),
    pairedParseValidityRate: rate(pairedCases.map((item) => item.parseValid)),
    pairedSchemaValidityRate: rate(pairedCases.map((item) => item.schemaValid)),
    pairedSemanticSuccessRate: rate(
      pairedCases.map((item) => item.semanticCorrect),
    ),
    pairedApplySuccessRate: rate(pairedCases.map((item) => item.applySuccess)),
    pairedMeanTokenCount: mean(pairedCases.map((item) => item.tokenCount)),
    cases,
    pairedCases,
  };
}

function comparePaired(
  left: EditCodecCalibrationResult,
  right: EditCodecCalibrationResult,
): number {
  const compare = (a: number, b: number): number => {
    const delta = a - b;
    return Math.abs(delta) < 1e-12 ? 0 : delta > 0 ? 1 : -1;
  };
  return (
    compare(left.pairedScore, right.pairedScore) ||
    compare(left.pairedParseValidityRate, right.pairedParseValidityRate) ||
    compare(left.pairedSchemaValidityRate, right.pairedSchemaValidityRate) ||
    compare(left.pairedSemanticSuccessRate, right.pairedSemanticSuccessRate) ||
    compare(left.pairedApplySuccessRate, right.pairedApplySuccessRate) ||
    compare(right.pairedMeanTokenCount, left.pairedMeanTokenCount)
  );
}

export function calibrateEditCodecs(
  probes: readonly EditProbeCase[],
  codecs: readonly EditCodec[] = CODECS,
): EditCodecCalibrationReport {
  const selected = CODECS.filter((codec) => codecs.includes(codec));
  const supported = selected.filter((codec) =>
    probes.some((probe) => probe.responses[codec] !== undefined),
  );
  const pairedProbes =
    supported.length >= 2
      ? probes.filter((probe) =>
          supported.every((codec) => probe.responses[codec] !== undefined),
        )
      : [];
  const results = selected.map((codec) =>
    resultFor(codec, probes, pairedProbes),
  );
  const measured = results.filter((result) => result.status === "measured");
  if (measured.length < 2 || pairedProbes.length === 0)
    return {
      schemaVersion: 1,
      comparedCodecCount: measured.length,
      pairedCaseCount: pairedProbes.length,
      selectionStatus:
        measured.length === 0
          ? "no_supported_codec"
          : "insufficient_comparison",
      results,
    };
  const ordered = [...measured].sort(
    (left, right) =>
      comparePaired(right, left) || left.codec.localeCompare(right.codec),
  );
  if (comparePaired(ordered[0]!, ordered[1]!) === 0)
    return {
      schemaVersion: 1,
      comparedCodecCount: measured.length,
      pairedCaseCount: pairedProbes.length,
      selectionStatus: "insufficient_comparison",
      results,
    };
  return {
    schemaVersion: 1,
    comparedCodecCount: measured.length,
    pairedCaseCount: pairedProbes.length,
    selectionStatus: "winner_selected",
    winner: ordered[0]!.codec,
    results,
  };
}
