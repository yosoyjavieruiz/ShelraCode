import type { ActionProtocol, DriverJsonValue } from "./profile.js";

export type CalibratableProtocol = Exclude<ActionProtocol, "unselected">;

export interface ProtocolAction {
  name: string;
  arguments: Record<string, DriverJsonValue>;
}

export type ArgumentType =
  "string" | "number" | "boolean" | "object" | "array" | "null";

export type ArgumentSchemaField =
  ArgumentType | { type: ArgumentType; optional?: boolean };

export type ArgumentSchema = Record<string, ArgumentSchemaField>;

interface ProtocolObservation {
  environmentSuccess?: boolean;
  progressMade?: boolean;
  verificationSuccess?: boolean;
  claimedCompletion?: boolean;
  loopDetected?: boolean;
}

export interface NativeProtocolResponse extends ProtocolObservation {
  kind: "native";
  toolCalls: Array<{
    name: string;
    arguments: string | Record<string, DriverJsonValue>;
  }>;
}

export interface TextProtocolResponse extends ProtocolObservation {
  kind: "text";
  text: string;
}

export interface ProtocolFailureResponse extends ProtocolObservation {
  kind: "failure";
  failureClass: string;
  message?: string;
}

export type ProtocolResponse =
  NativeProtocolResponse | TextProtocolResponse | ProtocolFailureResponse;
export type ProtocolResponseInput = ProtocolResponse | string;

export interface ProtocolProbeCase {
  id: string;
  legalActions: string[];
  expected: ProtocolAction;
  argumentSchemas?: Record<string, ArgumentSchema>;
  responses: Partial<Record<CalibratableProtocol, ProtocolResponse>>;
}

export interface ParsedProtocolAction {
  parseValid: boolean;
  schemaValid: boolean;
  legalAction: boolean;
  argumentsValid?: boolean;
  action?: ProtocolAction;
  error?: string;
  /** Semantic comparison is performed by evaluateProtocolProbeCase. */
  semanticActionCorrect?: boolean;
}

export interface ProtocolProbeScore {
  caseId: string;
  protocol: CalibratableProtocol;
  parseValid: boolean;
  schemaValid: boolean;
  legalAction: boolean;
  argumentsValid: boolean;
  semanticActionCorrect: boolean;
  environmentSuccess: boolean;
  progressMade: boolean;
  verificationSuccess: boolean;
  falseSuccess: boolean;
  loopDetected: boolean;
  score: number;
}

export interface ProtocolCalibrationResult {
  protocol: CalibratableProtocol;
  status: "measured" | "unsupported";
  caseCount: number;
  pairedCaseCount: number;
  parseValidityRate: number;
  schemaValidityRate: number;
  legalActionRate: number;
  semanticActionAccuracy: number;
  environmentSuccessRate: number;
  verificationSuccessRate: number;
  falseSuccessRate: number;
  loopRate: number;
  score: number;
  pairedScore: number;
  pairedSemanticActionAccuracy: number;
  pairedParseValidityRate: number;
  pairedFalseSuccessRate: number;
  cases: ProtocolProbeScore[];
  pairedCases: ProtocolProbeScore[];
}

export interface ProtocolCalibrationReport {
  schemaVersion: 1;
  comparedProtocolCount: number;
  pairedCaseCount: number;
  selectionStatus:
    "winner_selected" | "insufficient_comparison" | "no_supported_protocol";
  winner?: CalibratableProtocol;
  results: ProtocolCalibrationResult[];
}

const PROTOCOLS: readonly CalibratableProtocol[] = [
  "native_function",
  "constrained_json",
  "xml_system_tools",
  "text_action_grammar",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDriverJsonValue(value: unknown): value is DriverJsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isDriverJsonValue);
  return isRecord(value) && Object.values(value).every(isDriverJsonValue);
}

function isArguments(value: unknown): value is Record<string, DriverJsonValue> {
  return isRecord(value) && Object.values(value).every(isDriverJsonValue);
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

function actionsEqual(left: ProtocolAction, right: ProtocolAction): boolean {
  return (
    left.name === right.name &&
    canonicalJson(left.arguments) === canonicalJson(right.arguments)
  );
}

function argumentType(value: DriverJsonValue): ArgumentType {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "object") return "object";
  return typeof value as "string" | "number" | "boolean";
}

function inferArgumentSchema(action: ProtocolAction): ArgumentSchema {
  return Object.fromEntries(
    Object.entries(action.arguments).map(([key, value]) => [
      key,
      argumentType(value),
    ]),
  );
}

function argumentMatchesType(value: unknown, type: ArgumentType): boolean {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isRecord(value);
  return typeof value === type && (type !== "number" || Number.isFinite(value));
}

function validateArguments(
  value: Record<string, DriverJsonValue>,
  schema: ArgumentSchema,
): boolean {
  for (const [key, field] of Object.entries(schema)) {
    const descriptor = typeof field === "string" ? { type: field } : field;
    if (!(key in value)) {
      if (!descriptor.optional) return false;
      continue;
    }
    if (!argumentMatchesType(value[key], descriptor.type)) return false;
  }
  return Object.keys(value).every((key) => key in schema);
}

function actionFromObject(
  value: unknown,
): { ok: true; action: ProtocolAction } | { ok: false; error: string } {
  if (!isRecord(value))
    return { ok: false, error: "action must be an object." };
  const keys = Object.keys(value).sort();
  if (keys.length !== 2 || keys[0] !== "arguments" || keys[1] !== "name")
    return { ok: false, error: "action must contain only name and arguments." };
  if (typeof value.name !== "string" || value.name.trim().length === 0)
    return { ok: false, error: "action.name must be a non-empty string." };
  if (!isArguments(value.arguments))
    return { ok: false, error: "action.arguments must be a JSON object." };
  return {
    ok: true,
    action: { name: value.name, arguments: value.arguments },
  };
}

function decodeJsonValue(
  value: string,
): { ok: true; value: unknown } | { ok: false; error: string } {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    return { ok: false, error: "action JSON could not be parsed." };
  }
  return { ok: true, value: decoded };
}

interface PayloadParseResult {
  parseValid: boolean;
  schemaValid: boolean;
  action?: ProtocolAction;
  error?: string;
}

function parseTextAction(
  protocol: CalibratableProtocol,
  text: string,
): PayloadParseResult {
  if (protocol === "constrained_json") {
    const decoded = decodeJsonValue(text);
    if (!decoded.ok)
      return { parseValid: false, schemaValid: false, error: decoded.error };
    const action = actionFromObject(decoded.value);
    return action.ok
      ? { parseValid: true, schemaValid: true, action: action.action }
      : { parseValid: true, schemaValid: false, error: action.error };
  }
  if (protocol === "xml_system_tools") {
    const match = /^<tool_call>([\s\S]*)<\/tool_call>$/.exec(text);
    if (!match)
      return {
        parseValid: false,
        schemaValid: false,
        error: "XML tool call envelope is invalid.",
      };
    const decoded = decodeJsonValue(match[1]!);
    if (!decoded.ok)
      return { parseValid: true, schemaValid: false, error: decoded.error };
    const action = actionFromObject(decoded.value);
    return action.ok
      ? { parseValid: true, schemaValid: true, action: action.action }
      : { parseValid: true, schemaValid: false, error: action.error };
  }
  const match = /^ACTION ([A-Za-z0-9_.-]+) (\{[\s\S]*\})$/.exec(text);
  if (!match)
    return {
      parseValid: false,
      schemaValid: false,
      error: "text action grammar is invalid.",
    };
  let decodedArguments: unknown;
  try {
    decodedArguments = JSON.parse(match[2]!);
  } catch {
    return {
      parseValid: true,
      schemaValid: false,
      error: "text action arguments could not be parsed.",
    };
  }
  if (!isArguments(decodedArguments))
    return {
      parseValid: true,
      schemaValid: false,
      error: "text action arguments must be a JSON object.",
    };
  return {
    parseValid: true,
    schemaValid: true,
    action: { name: match[1]!, arguments: decodedArguments },
  };
}

function parseProtocolPayload(
  protocol: CalibratableProtocol,
  response: ProtocolResponse,
): PayloadParseResult {
  if (protocol === "native_function") {
    if (response.kind !== "native")
      return {
        parseValid: false,
        schemaValid: false,
        error: "native protocol requires native tool calls.",
      };
    if (!Array.isArray(response.toolCalls))
      return {
        parseValid: true,
        schemaValid: false,
        error: "native tool calls must be an array.",
      };
    if (response.toolCalls.length !== 1)
      return {
        parseValid: true,
        schemaValid: false,
        error: "native protocol requires exactly one tool call.",
      };
    const call = response.toolCalls[0]!;
    if (typeof call.name !== "string" || call.name.trim().length === 0)
      return {
        parseValid: true,
        schemaValid: false,
        error: "native tool name must be non-empty.",
      };
    let decodedArguments: unknown = call.arguments;
    if (typeof call.arguments === "string") {
      try {
        decodedArguments = JSON.parse(call.arguments);
      } catch {
        return {
          parseValid: true,
          schemaValid: false,
          error: "native arguments JSON could not be parsed.",
        };
      }
    }
    if (!isArguments(decodedArguments))
      return {
        parseValid: true,
        schemaValid: false,
        error: "native arguments must be a JSON object.",
      };
    return {
      parseValid: true,
      schemaValid: true,
      action: { name: call.name, arguments: decodedArguments },
    };
  }
  if (response.kind === "failure")
    return {
      parseValid: false,
      schemaValid: false,
      error: `${response.failureClass}${response.message ? `: ${response.message}` : ""}`,
    };
  if (response.kind !== "text")
    return {
      parseValid: false,
      schemaValid: false,
      error: "text protocol requires textual output.",
    };
  return parseTextAction(protocol, response.text);
}

export function encodeProtocolAction(
  protocol: CalibratableProtocol,
  action: ProtocolAction,
): ProtocolResponse {
  const serialized = JSON.stringify({
    name: action.name,
    arguments: action.arguments,
  });
  if (protocol === "native_function")
    return {
      kind: "native",
      toolCalls: [
        { name: action.name, arguments: JSON.stringify(action.arguments) },
      ],
    };
  if (protocol === "constrained_json")
    return { kind: "text", text: serialized };
  if (protocol === "xml_system_tools")
    return { kind: "text", text: `<tool_call>${serialized}</tool_call>` };
  return {
    kind: "text",
    text: `ACTION ${action.name} ${JSON.stringify(action.arguments)}`,
  };
}

export function parseProtocolAction(
  protocol: CalibratableProtocol,
  response: ProtocolResponseInput,
  legalActions: readonly string[],
  argumentSchemas?: Record<string, ArgumentSchema>,
): ParsedProtocolAction {
  const normalizedResponse: ProtocolResponse =
    typeof response === "string" ? { kind: "text", text: response } : response;
  const parsed = parseProtocolPayload(protocol, normalizedResponse);
  if (!parsed.parseValid || !parsed.schemaValid)
    return {
      parseValid: parsed.parseValid,
      schemaValid: parsed.schemaValid,
      legalAction: false,
      ...(parsed.error ? { error: parsed.error } : {}),
    };
  const action = parsed.action;
  if (!action)
    return {
      parseValid: true,
      schemaValid: false,
      legalAction: false,
      error: "parsed action is missing.",
    };
  const argumentsValid = argumentSchemas?.[action.name]
    ? validateArguments(action.arguments, argumentSchemas[action.name]!)
    : undefined;
  return {
    parseValid: true,
    schemaValid: true,
    legalAction: legalActions.includes(action.name),
    action,
    ...(argumentsValid === undefined ? {} : { argumentsValid }),
  };
}

export function evaluateProtocolProbeCase(
  probe: ProtocolProbeCase,
  protocol: CalibratableProtocol,
): ProtocolProbeScore {
  const response = probe.responses[protocol];
  const parsed = response
    ? parseProtocolAction(
        protocol,
        response,
        probe.legalActions,
        probe.argumentSchemas,
      )
    : ({
        parseValid: false,
        schemaValid: false,
        legalAction: false,
      } satisfies ParsedProtocolAction);
  const inferredSchema =
    parsed.action?.name === probe.expected.name
      ? inferArgumentSchema(probe.expected)
      : undefined;
  const argumentsValid =
    parsed.schemaValid &&
    parsed.action !== undefined &&
    (parsed.argumentsValid ??
      (inferredSchema
        ? validateArguments(parsed.action.arguments, inferredSchema)
        : false));
  const semanticActionCorrect =
    argumentsValid && parsed.legalAction
      ? actionsEqual(parsed.action!, probe.expected)
      : false;
  const environmentSuccess = response?.environmentSuccess === true;
  const progressMade = response?.progressMade ?? environmentSuccess;
  const verificationSuccess = response?.verificationSuccess === true;
  const falseSuccess =
    response?.claimedCompletion === true && !verificationSuccess;
  const loopDetected = response?.loopDetected === true;
  const score =
    (parsed.parseValid ? 0.1 : 0) +
    (parsed.schemaValid ? 0.15 : 0) +
    (parsed.legalAction ? 0.15 : 0) +
    (argumentsValid ? 0.1 : 0) +
    (semanticActionCorrect ? 0.25 : 0) +
    (environmentSuccess ? 0.1 : 0) +
    (progressMade ? 0.05 : 0) +
    (verificationSuccess ? 0.1 : 0) -
    (falseSuccess ? 0.4 : 0) -
    (loopDetected ? 0.2 : 0);
  return {
    caseId: probe.id,
    protocol,
    parseValid: parsed.parseValid,
    schemaValid: parsed.schemaValid,
    legalAction: parsed.legalAction,
    argumentsValid,
    semanticActionCorrect,
    environmentSuccess,
    progressMade,
    verificationSuccess,
    falseSuccess,
    loopDetected,
    score: Math.max(0, Math.min(1, score)),
  };
}

function rate(values: boolean[]): number {
  return values.length === 0
    ? 0
    : values.filter(Boolean).length / values.length;
}

export function calibrateActionProtocols(
  probes: readonly ProtocolProbeCase[],
  protocols: readonly ActionProtocol[] = PROTOCOLS,
): ProtocolCalibrationReport {
  const selectedProtocols = PROTOCOLS.filter((protocol) =>
    protocols.includes(protocol),
  );
  const supportedProtocols = selectedProtocols.filter((protocol) =>
    probes.some((probe) => probe.responses[protocol] !== undefined),
  );
  const commonProbes =
    supportedProtocols.length >= 2
      ? probes.filter((probe) =>
          supportedProtocols.every(
            (protocol) => probe.responses[protocol] !== undefined,
          ),
        )
      : [];
  const results = selectedProtocols.map(
    (protocol): ProtocolCalibrationResult => {
      if (!supportedProtocols.includes(protocol))
        return {
          protocol,
          status: "unsupported",
          caseCount: 0,
          pairedCaseCount: 0,
          parseValidityRate: 0,
          schemaValidityRate: 0,
          legalActionRate: 0,
          semanticActionAccuracy: 0,
          environmentSuccessRate: 0,
          verificationSuccessRate: 0,
          falseSuccessRate: 0,
          loopRate: 0,
          score: 0,
          pairedScore: 0,
          pairedSemanticActionAccuracy: 0,
          pairedParseValidityRate: 0,
          pairedFalseSuccessRate: 0,
          cases: [],
          pairedCases: [],
        };
      const available = probes.filter(
        (probe) => probe.responses[protocol] !== undefined,
      );
      const cases = available.map((probe) =>
        evaluateProtocolProbeCase(probe, protocol),
      );
      const pairedCases = commonProbes.map((probe) =>
        evaluateProtocolProbeCase(probe, protocol),
      );
      return {
        protocol,
        status: "measured",
        caseCount: cases.length,
        pairedCaseCount: pairedCases.length,
        parseValidityRate: rate(cases.map((item) => item.parseValid)),
        schemaValidityRate: rate(cases.map((item) => item.schemaValid)),
        legalActionRate: rate(cases.map((item) => item.legalAction)),
        semanticActionAccuracy: rate(
          cases.map((item) => item.semanticActionCorrect),
        ),
        environmentSuccessRate: rate(
          cases.map((item) => item.environmentSuccess),
        ),
        verificationSuccessRate: rate(
          cases.map((item) => item.verificationSuccess),
        ),
        falseSuccessRate: rate(cases.map((item) => item.falseSuccess)),
        loopRate: rate(cases.map((item) => item.loopDetected)),
        score: cases.length
          ? cases.reduce((sum, item) => sum + item.score, 0) / cases.length
          : 0,
        pairedScore: pairedCases.length
          ? pairedCases.reduce((sum, item) => sum + item.score, 0) /
            pairedCases.length
          : 0,
        pairedSemanticActionAccuracy: rate(
          pairedCases.map((item) => item.semanticActionCorrect),
        ),
        pairedParseValidityRate: rate(
          pairedCases.map((item) => item.parseValid),
        ),
        pairedFalseSuccessRate: rate(
          pairedCases.map((item) => item.falseSuccess),
        ),
        cases,
        pairedCases,
      };
    },
  );
  const measured = results.filter((result) => result.status === "measured");
  if (measured.length < 2 || commonProbes.length === 0)
    return {
      schemaVersion: 1,
      comparedProtocolCount: measured.length,
      pairedCaseCount: commonProbes.length,
      selectionStatus:
        measured.length === 0
          ? "no_supported_protocol"
          : "insufficient_comparison",
      results,
    };
  const comparePaired = (
    left: ProtocolCalibrationResult,
    right: ProtocolCalibrationResult,
  ): number => {
    const compare = (leftValue: number, rightValue: number): number => {
      const delta = leftValue - rightValue;
      return Math.abs(delta) < 1e-12 ? 0 : delta > 0 ? 1 : -1;
    };
    return (
      compare(left.pairedScore, right.pairedScore) ||
      compare(
        left.pairedSemanticActionAccuracy,
        right.pairedSemanticActionAccuracy,
      ) ||
      compare(left.pairedParseValidityRate, right.pairedParseValidityRate) ||
      compare(right.pairedFalseSuccessRate, left.pairedFalseSuccessRate)
    );
  };
  const ordered = [...measured].sort(
    (left, right) =>
      comparePaired(right, left) || left.protocol.localeCompare(right.protocol),
  );
  if (comparePaired(ordered[0]!, ordered[1]!) === 0)
    return {
      schemaVersion: 1,
      comparedProtocolCount: measured.length,
      pairedCaseCount: commonProbes.length,
      selectionStatus: "insufficient_comparison",
      results,
    };
  const winner = ordered[0]!;
  return {
    schemaVersion: 1,
    comparedProtocolCount: measured.length,
    pairedCaseCount: commonProbes.length,
    selectionStatus: "winner_selected",
    winner: winner.protocol,
    results,
  };
}
