import type { InstructionTrust } from "../instructions/trust-policy.js";

/**
 * A bounded, decision-specific view of repository/task state.
 *
 * The repository and event log remain the source of truth. This packet is a
 * deliberately lossy model view: it keeps high-signal evidence close to the
 * next decision and prevents small models from receiving an ever-growing
 * transcript by default.
 */
export interface ContextPacketEvidence {
  source: string;
  kind?: string;
  summary: string;
  relevance?: number;
}

export interface ContextPacketCodeSlice {
  path: string;
  content: string;
  startLine?: number;
  endLine?: number;
}

export interface ContextPacket {
  objective: string;
  currentSubtask?: string;
  constraints: string[];
  applicableInstructions: string[];
  evidence: ContextPacketEvidence[];
  relevantCode: ContextPacketCodeSlice[];
  recentObservations: string[];
  unresolvedProblem?: string;
  legalActions: string[];
  expectedOutput?: string;
  tokenBudget: number;
}

export interface ContextPacketInput {
  objective: string;
  currentSubtask?: string;
  constraints?: readonly string[];
  applicableInstructions?: readonly string[];
  evidence?: readonly ContextPacketEvidence[];
  relevantCode?: readonly ContextPacketCodeSlice[];
  recentObservations?: readonly string[];
  unresolvedProblem?: string;
  legalActions?: readonly string[];
  expectedOutput?: string;
  tokenBudget: number;
}

export interface DecisionContextInstruction {
  source: string;
  text: string;
  trust?: InstructionTrust;
  precedence?: number;
  scope?: string;
  relevance?: number;
}

export interface DecisionContextMemory {
  source: string;
  text: string;
  relevance?: number;
}

export interface DecisionContextObservation {
  source: string;
  text: string;
  relevance?: number;
}

/**
 * Inputs for one model decision. These are deliberately separate from the
 * provider transcript: the host can select a small, current view without
 * losing the full event history kept by the agent loop.
 */
export interface ContextDecisionInput {
  turn?: number;
  nodeId?: string;
  objective: string;
  subtask?: string;
  constraints?: readonly string[];
  instructions?: readonly DecisionContextInstruction[];
  memory?: readonly DecisionContextMemory[];
  evidence?: readonly ContextPacketEvidence[];
  code?: readonly ContextPacketCodeSlice[];
  observations?: readonly DecisionContextObservation[];
  unresolvedProblem?: string;
  legalActions?: readonly string[];
  expectedOutput?: string;
  tokenBudget: number;
}

export interface DecisionContextPacket extends ContextPacket {
  text: string;
  sourceIds: string[];
  omittedSections: string[];
}

const APPROX_CHARS_PER_TOKEN = 4;
const MAX_OBJECTIVE_CHARS = 2_000;
const MAX_LIST_ITEM_CHARS = 800;
const MAX_EVIDENCE_CHARS = 3_000;
const MAX_CODE_SLICE_CHARS = 8_000;

function clip(value: string, maxChars: number): string {
  const normalized = value.trim();
  return normalized.length <= maxChars
    ? normalized
    : `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

function unique(values: readonly string[] | undefined): string[] {
  return [
    ...new Set(
      (values ?? [])
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  ];
}

function boundedList(values: readonly string[] | undefined): string[] {
  return unique(values).map((value) => clip(value, MAX_LIST_ITEM_CHARS));
}

function boundedEvidence(
  values: readonly ContextPacketEvidence[] | undefined,
): ContextPacketEvidence[] {
  return [...(values ?? [])]
    .map((item) => ({
      source: clip(item.source, 300),
      kind: clip(item.kind ?? "evidence", 120),
      summary: clip(item.summary, MAX_EVIDENCE_CHARS),
      relevance:
        item.relevance === undefined || !Number.isFinite(item.relevance)
          ? undefined
          : Math.max(0, Math.min(1, item.relevance)),
    }))
    .filter((item) => item.source.length > 0 && item.summary.length > 0)
    .sort((left, right) => (right.relevance ?? 0) - (left.relevance ?? 0));
}

function textTerms(value: string): Set<string> {
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9_/-]+/u)
      .filter((term) => term.length >= 4),
  );
}

function relevanceForText(
  text: string,
  objective: string,
  explicit?: number,
): number {
  const terms = textTerms(objective);
  if (terms.size === 0) return explicit ?? 0;
  const lower = text.toLowerCase();
  const overlap = [...terms].filter((term) => lower.includes(term)).length;
  return (explicit ?? 0) + overlap / terms.size;
}

function boundedDecisionText<
  T extends { source: string; text: string; relevance?: number },
>(
  values: readonly T[] | undefined,
  objective: string,
  maxItems: number,
  maxChars: number,
  omitted: string[],
): T[] {
  const normalized = (values ?? [])
    .map((item, index) => ({
      item: {
        ...item,
        source: clip(item.source, 300),
        text: clip(item.text, maxChars),
      },
      index,
      score: relevanceForText(item.text, objective, item.relevance),
    }))
    .filter(({ item }) => item.source.length > 0 && item.text.length > 0)
    .sort(
      (left, right) => right.score - left.score || right.index - left.index,
    );
  const selected: T[] = [];
  let usedChars = 0;
  for (const { item } of normalized) {
    if (selected.length >= maxItems) {
      omitted.push("observations:count");
      break;
    }
    const cost = item.source.length + item.text.length + 24;
    if (usedChars + cost > maxChars) {
      omitted.push("observations:budget");
      continue;
    }
    selected.push(item);
    usedChars += cost;
  }
  return selected;
}

function boundedCode(
  values: readonly ContextPacketCodeSlice[] | undefined,
): ContextPacketCodeSlice[] {
  return (values ?? [])
    .map((item) => ({
      path: clip(item.path, 500),
      content: clip(item.content, MAX_CODE_SLICE_CHARS),
      ...(item.startLine === undefined ? {} : { startLine: item.startLine }),
      ...(item.endLine === undefined ? {} : { endLine: item.endLine }),
    }))
    .filter((item) => item.path.length > 0 && item.content.length > 0);
}

export function compileContextPacket(input: ContextPacketInput): ContextPacket {
  if (!Number.isInteger(input.tokenBudget) || input.tokenBudget < 256)
    throw new Error("Context packet tokenBudget must be an integer >= 256.");
  const objective = clip(input.objective, MAX_OBJECTIVE_CHARS);
  if (!objective) throw new Error("Context packet objective is required.");
  return {
    objective,
    ...(input.currentSubtask?.trim()
      ? { currentSubtask: clip(input.currentSubtask, MAX_LIST_ITEM_CHARS) }
      : {}),
    constraints: boundedList(input.constraints),
    applicableInstructions: boundedList(input.applicableInstructions),
    evidence: boundedEvidence(input.evidence),
    relevantCode: boundedCode(input.relevantCode),
    recentObservations: boundedList(input.recentObservations),
    ...(input.unresolvedProblem?.trim()
      ? { unresolvedProblem: clip(input.unresolvedProblem, MAX_EVIDENCE_CHARS) }
      : {}),
    legalActions: boundedList(input.legalActions),
    ...(input.expectedOutput?.trim()
      ? { expectedOutput: clip(input.expectedOutput, MAX_LIST_ITEM_CHARS) }
      : {}),
    tokenBudget: input.tokenBudget,
  };
}

function instructionLines(
  values: readonly DecisionContextInstruction[] | undefined,
  objective: string,
  omitted: string[],
): string[] {
  return boundedDecisionText(values, objective, 16, 4_000, omitted)
    .sort(
      (left, right) =>
        (left.precedence ?? 0) - (right.precedence ?? 0) ||
        left.source.localeCompare(right.source),
    )
    .map(
      (item) =>
        `[${item.source}] [trust=${item.trust ?? "project"}] ${item.text}`,
    );
}

function memoryLines(
  values: readonly DecisionContextMemory[] | undefined,
  objective: string,
  omitted: string[],
): string[] {
  return boundedDecisionText(values, objective, 8, 3_000, omitted).map(
    (item) => `[${item.source}] ${item.text}`,
  );
}

function observationLines(
  values: readonly DecisionContextObservation[] | undefined,
  objective: string,
  omitted: string[],
): string[] {
  const selected = boundedDecisionText(values, objective, 8, 4_000, omitted);
  if ((values?.length ?? 0) > 0 && selected.length === 0)
    omitted.push("observations:irrelevant");
  return selected.map((item) => `[${item.source}] ${item.text}`);
}

/**
 * Compile a fresh, bounded packet for the current model decision. The full
 * transcript remains available to the host for persistence and protocol
 * continuity, but old low-signal observations are not automatically sent to
 * the next model request.
 */
export function compileDecisionContext(
  input: ContextDecisionInput,
): DecisionContextPacket {
  const omittedSections: string[] = [];
  const instructions = instructionLines(
    input.instructions,
    input.objective,
    omittedSections,
  );
  const memory = memoryLines(input.memory, input.objective, omittedSections);
  const observations = observationLines(
    input.observations,
    input.objective,
    omittedSections,
  );
  const evidence = boundedEvidence(input.evidence);
  const code = boundedCode(input.code);
  const sourceIds = [
    ...instructions
      .map((value) => value.match(/^\[([^\]]+)\]/u)?.[1])
      .filter((value): value is string => Boolean(value)),
    ...memory
      .map((value) => value.match(/^\[([^\]]+)\]/u)?.[1])
      .filter((value): value is string => Boolean(value)),
    ...evidence.map((item) => item.source),
    ...code.map((item) => item.path),
    ...observations
      .map((value) => value.match(/^\[([^\]]+)\]/u)?.[1])
      .filter((value): value is string => Boolean(value)),
  ];
  const packet = compileContextPacket({
    objective: input.objective,
    currentSubtask: input.subtask,
    constraints: input.constraints,
    applicableInstructions: instructions,
    evidence: [
      ...evidence,
      ...memory.map((value) => ({
        source: value.match(/^\[([^\]]+)\]/u)?.[1] ?? "memory",
        kind: "memory",
        summary: value.replace(/^\[[^\]]+\]\s*/u, ""),
        relevance: 0.5,
      })),
    ],
    relevantCode: code,
    recentObservations: observations,
    unresolvedProblem: input.unresolvedProblem,
    legalActions: input.legalActions,
    expectedOutput: input.expectedOutput,
    tokenBudget: input.tokenBudget,
  });
  const text = renderContextPacket(packet);
  if (text.length >= input.tokenBudget * APPROX_CHARS_PER_TOKEN)
    omittedSections.push("packet:render-budget");
  return {
    ...packet,
    text,
    sourceIds: [...new Set(sourceIds)],
    omittedSections: [...new Set(omittedSections)],
  };
}

function block(label: string, value: string): string {
  return `${label}:\n${value}`;
}

/** Render a packet without exceeding its approximate token budget. */
export function renderContextPacket(packet: ContextPacket): string {
  const maxChars = packet.tokenBudget * APPROX_CHARS_PER_TOKEN;
  const sections: string[] = [
    block("Objective", packet.objective),
    ...(packet.currentSubtask
      ? [block("Current subtask", packet.currentSubtask)]
      : []),
    ...(packet.constraints.length > 0
      ? [
          block(
            "Constraints",
            packet.constraints.map((item) => `- ${item}`).join("\n"),
          ),
        ]
      : []),
    ...(packet.applicableInstructions.length > 0
      ? [
          block(
            "Applicable instructions",
            packet.applicableInstructions.map((item) => `- ${item}`).join("\n"),
          ),
        ]
      : []),
    ...(packet.evidence.length > 0
      ? [
          block(
            "Evidence",
            packet.evidence
              .map((item) => `- [${item.kind}] ${item.source}: ${item.summary}`)
              .join("\n"),
          ),
        ]
      : []),
    ...(packet.relevantCode.length > 0
      ? [
          block(
            "Relevant code",
            packet.relevantCode
              .map((item) => {
                const range =
                  item.startLine === undefined
                    ? ""
                    : `:${item.startLine}${item.endLine === undefined ? "" : `-${item.endLine}`}`;
                return `### ${item.path}${range}\n${item.content}`;
              })
              .join("\n\n"),
          ),
        ]
      : []),
    ...(packet.recentObservations.length > 0
      ? [
          block(
            "Recent observations",
            packet.recentObservations.map((item) => `- ${item}`).join("\n"),
          ),
        ]
      : []),
    ...(packet.unresolvedProblem
      ? [block("Unresolved problem", packet.unresolvedProblem)]
      : []),
    ...(packet.legalActions.length > 0
      ? [block("Legal actions", packet.legalActions.join(", "))]
      : []),
    ...(packet.expectedOutput
      ? [block("Expected output", packet.expectedOutput)]
      : []),
  ];
  let rendered = "";
  for (const section of sections) {
    const separator = rendered ? "\n\n" : "";
    const remaining = maxChars - rendered.length - separator.length;
    if (remaining <= 0) break;
    rendered += separator + clip(section, remaining);
  }
  return rendered;
}
