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
  kind: string;
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
      kind: clip(item.kind, 120),
      summary: clip(item.summary, MAX_EVIDENCE_CHARS),
      relevance:
        item.relevance === undefined || !Number.isFinite(item.relevance)
          ? undefined
          : Math.max(0, Math.min(1, item.relevance)),
    }))
    .filter((item) => item.source.length > 0 && item.summary.length > 0)
    .sort((left, right) => (right.relevance ?? 0) - (left.relevance ?? 0));
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
      ? [block("Constraints", packet.constraints.map((item) => `- ${item}`).join("\n"))]
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
              .map(
                (item) =>
                  `- [${item.kind}] ${item.source}: ${item.summary}`,
              )
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
