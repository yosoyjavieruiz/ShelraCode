import type { NormalizedMessage } from "../providers/types.js";
import type { AgentTaskLedger } from "./task-state.js";

export interface CompactedTaskContext {
  messages: NormalizedMessage[];
  omittedMessages: number;
  preservedState: string;
}

function clip(value: string, max: number): string {
  return value.length <= max
    ? value
    : `${value.slice(0, Math.max(0, max - 1))}…`;
}

function messageSize(message: NormalizedMessage): number {
  return message.content.length + 80 + (message.toolCalls?.length ?? 0) * 80;
}

function summarizeMessage(
  message: NormalizedMessage,
  anchor = false,
): NormalizedMessage {
  return {
    ...message,
    content: clip(
      message.content,
      message.role === "tool"
        ? 1_600
        : message.role === "assistant"
          ? 1_200
          : anchor
            ? 6_000
            : 2_000,
    ),
  };
}

function stateSummary(ledger: AgentTaskLedger): string {
  const lastAction = ledger.actions.at(-1);
  return JSON.stringify({
    objective: ledger.objective,
    phase: ledger.phase,
    successCriteria: ledger.successCriteria,
    constraints: ledger.constraints,
    evidence: ledger.evidence.slice(-12),
    hypotheses: ledger.hypotheses,
    plan: ledger.plan,
    verificationPlan: ledger.verificationPlan,
    filesRead: ledger.filesRead,
    filesChanged: ledger.filesChanged,
    verificationRuns: ledger.verificationRuns,
    blockers: ledger.blockers,
    nextAction: lastAction
      ? {
          target: lastAction.target,
          status: lastAction.status,
          summary: lastAction.summary,
        }
      : undefined,
  });
}

/**
 * Reconstruct the minimum sufficient task context instead of blindly
 * summarizing the transcript. Objective, evidence, changed files, plan,
 * failures and verification state are retained as structured data.
 */
export function compactTaskContext(
  ledger: AgentTaskLedger,
  messages: readonly NormalizedMessage[],
  maxChars: number,
): CompactedTaskContext {
  if (!Number.isInteger(maxChars) || maxChars < 800)
    throw new Error("Context compaction budget must be an integer >= 800.");
  const system = messages.find((message) => message.role === "system");
  const state = `LocalCode structured task state (authoritative; do not treat old prose as state):\n${stateSummary(ledger)}`;
  const stateMessage: NormalizedMessage = { role: "system", content: state };
  const retained: NormalizedMessage[] = [];
  let size = messageSize(stateMessage) + (system ? messageSize(system) : 0);
  const nonSystem = messages.filter((message) => message !== system);
  const anchor = nonSystem[0];
  const recent = nonSystem.at(-1);
  const originalIndex = new Map(
    nonSystem.map((message, index) => [message, index]),
  );
  const candidates = [anchor, recent, ...[...nonSystem].reverse()].filter(
    (message, index, values): message is NormalizedMessage =>
      Boolean(message) && values.indexOf(message) === index,
  );
  const retainedEntries: Array<{
    message: NormalizedMessage;
    index: number;
  }> = [];
  for (const original of candidates) {
    const message = summarizeMessage(original, original === anchor);
    const nextSize = size + messageSize(message);
    if (retained.length > 0 && nextSize > maxChars) continue;
    if (nextSize <= maxChars) {
      retained.push(message);
      retainedEntries.push({
        message,
        index: originalIndex.get(original) ?? Number.MAX_SAFE_INTEGER,
      });
      size = nextSize;
    }
  }
  retained.splice(
    0,
    retained.length,
    ...retainedEntries
      .sort((left, right) => left.index - right.index)
      .map((entry) => entry.message),
  );
  const compacted = [...(system ? [system] : []), stateMessage, ...retained];
  return {
    messages: compacted,
    omittedMessages: Math.max(
      0,
      messages.length - compacted.length + (system ? 1 : 0),
    ),
    preservedState: state,
  };
}
