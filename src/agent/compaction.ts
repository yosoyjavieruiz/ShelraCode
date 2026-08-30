import { PRODUCT_NAME } from "../product/identity.js";
import type { NormalizedMessage } from "../providers/types.js";
import type { AgentTaskLedger } from "./task-state.js";
import {
  deriveTaskContextAnchor,
  type TaskContextAnchor,
  type TaskRuntimeRehydration,
  type TaskRuntimeRouteIdentity,
} from "./task-runtime-state.js";

export interface CompactedTaskContext {
  messages: NormalizedMessage[];
  omittedMessages: number;
  preservedState: string;
  /** The bounded structured state packet used for rehydration diagnostics. */
  text: string;
  /** Repository/source identifiers retained independently from raw prose. */
  sourceIds: string[];
  /** The same bounded rehydration anchor used by durable restart. */
  contextAnchor: TaskContextAnchor;
  /** Route identity is retained for diagnostics and safe route preference. */
  route?: TaskRuntimeRouteIdentity;
}

function clip(value: string, max = 600): string {
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

function compactText(value: string | undefined, max = 600): string | undefined {
  if (!value?.trim()) return undefined;
  return clip(value, max);
}

function compactStrings(
  values: readonly string[] | undefined,
  max = 32,
): string[] {
  return (values ?? []).slice(-max).map((value) => clip(value, 600));
}

function preservedSourceIds(ledger: AgentTaskLedger): string[] {
  const ids = new Set<string>();
  for (const evidence of ledger.evidence.slice(-32)) ids.add(evidence.source);
  for (const file of ledger.filesRead.slice(-64)) ids.add(file);
  for (const file of ledger.filesChanged.slice(-64)) ids.add(file);
  for (const step of ledger.plan?.steps ?? [])
    for (const scope of step.scope ?? []) ids.add(scope);
  for (const node of ledger.taskGraph?.nodes ?? [])
    for (const candidate of node.scope.candidateFiles) ids.add(candidate);
  return [...ids].filter((value) => value.trim().length > 0).slice(-128);
}

function mergedContextAnchor(
  ledger: AgentTaskLedger,
  rehydration?: TaskRuntimeRehydration,
): TaskContextAnchor {
  const derived = deriveTaskContextAnchor(
    ledger,
    rehydration?.contextAnchor.repositoryRevision,
  );
  const prior = rehydration?.contextAnchor;
  return {
    ...derived,
    ...(prior ?? {}),
    sourceIds: [
      ...new Set([...(prior?.sourceIds ?? []), ...derived.sourceIds]),
    ].slice(-128),
    instructionSources: [
      ...new Set([
        ...(prior?.instructionSources ?? []),
        ...derived.instructionSources,
      ]),
    ],
    memoryIds: [
      ...new Set([...(prior?.memoryIds ?? []), ...derived.memoryIds]),
    ],
    proofGapIds: [
      ...new Set([...(prior?.proofGapIds ?? []), ...derived.proofGapIds]),
    ].slice(-64),
    ...((derived.activeNodeId ?? prior?.activeNodeId)
      ? { activeNodeId: derived.activeNodeId ?? prior?.activeNodeId }
      : {}),
  };
}

function stateSummary(
  ledger: AgentTaskLedger,
  maxChars = 16_000,
  rehydration?: TaskRuntimeRehydration,
): string {
  const contextAnchor = mergedContextAnchor(ledger, rehydration);
  const route = rehydration?.route;
  const lastAction = ledger.actions.at(-1);
  const contract = ledger.contract
    ? {
        id: ledger.contract.id,
        originalRequest: clip(ledger.contract.originalRequest, 1_200),
        objective: clip(ledger.contract.objective, 1_200),
        mode: ledger.contract.mode,
        executionProfile: ledger.contract.executionProfile,
        deliverables: ledger.contract.deliverables.map((item) => ({
          id: item.id,
          description: clip(item.description),
          kind: item.kind,
          targetPaths: compactStrings(item.targetPaths, 16),
          artifactExpectations: item.artifactExpectations
            ?.slice(0, 8)
            .map((expectation) => ({
              type: expectation.type,
              value: clip(expectation.value, 1_000),
            })),
          required: item.required,
          dependencies: [...item.dependencies],
          evidence: compactStrings(item.evidence, 8),
          status: item.status,
        })),
        constraints: ledger.contract.constraints.map((item) => ({
          id: item.id,
          description: clip(item.description),
          source: item.source,
        })),
        nonGoals: compactStrings(ledger.contract.nonGoals),
        acceptanceCriteria: ledger.contract.acceptanceCriteria.map((item) => ({
          id: item.id,
          description: clip(item.description),
          required: item.required,
          verificationClass: item.verificationClass,
          evidence: compactStrings(item.evidence, 8),
          status: item.status,
        })),
        evidenceRequirements: ledger.contract.evidenceRequirements.map(
          (item) => ({
            id: item.id,
            description: clip(item.description),
            kind: item.kind,
            required: item.required,
          }),
        ),
        repositoryScope: ledger.contract.repositoryScope,
        permissions: ledger.contract.permissions,
        risk: {
          score: ledger.contract.risk.score,
          level: ledger.contract.risk.level,
          reasons: compactStrings(ledger.contract.risk.reasons, 8),
        },
        uncertainty: ledger.contract.uncertainty.map((item) => ({
          id: item.id,
          description: clip(item.description),
          blocking: item.blocking,
        })),
        verificationIntent: ledger.contract.verificationIntent,
        status: ledger.contract.status,
      }
    : undefined;
  const plan = ledger.plan
    ? {
        source: ledger.plan.source,
        revision: ledger.plan.revision,
        objective: compactText(ledger.plan.objective, 1_200),
        acceptanceCriteria: compactStrings(ledger.plan.acceptanceCriteria),
        evidenceRequirements: compactStrings(ledger.plan.evidenceRequirements),
        steps: ledger.plan.steps.map((step) => ({
          id: step.id,
          description: clip(step.description),
          status: step.status,
          source: step.source,
          revision: step.revision,
          dependencies: compactStrings(step.dependencies, 16),
          scope: compactStrings(step.scope, 16),
          evidenceRequired: compactStrings(step.evidenceRequired, 16),
          verification: compactStrings(step.verification, 16),
        })),
        revisions: ledger.plan.revisions,
      }
    : undefined;
  const taskGraph = ledger.taskGraph
    ? {
        rootObjective: ledger.taskGraph.rootObjective,
        globalConstraints: compactStrings(ledger.taskGraph.globalConstraints),
        currentNodeId: ledger.taskGraph.currentNodeId,
        planSource: ledger.taskGraph.planSource,
        revision: ledger.taskGraph.revision,
        acceptanceCriteria: compactStrings(ledger.taskGraph.acceptanceCriteria),
        evidenceRequirements: compactStrings(
          ledger.taskGraph.evidenceRequirements,
        ),
        nodes: ledger.taskGraph.nodes.map((node) => ({
          id: node.id,
          status: node.status,
          source: node.source,
          revision: node.revision,
          attempts: node.attempts,
          dependencies: compactStrings(node.dependencies, 16),
          objective: clip(node.objective, 1_000),
          scope: {
            candidateFiles: compactStrings(node.scope.candidateFiles, 16),
            allowedTools: compactStrings(node.scope.allowedTools, 24),
          },
          contextRequirements: compactStrings(node.contextRequirements, 16),
          acceptance: compactStrings(node.acceptance, 16),
          verification: compactStrings(node.verification, 16),
          lastFailure: compactText(node.lastFailure),
        })),
        revisions: ledger.taskGraph.revisions,
      }
    : undefined;
  const full = JSON.stringify({
    objective: ledger.objective,
    phase: ledger.phase,
    rehydration: {
      contextAnchor,
      ...(route ? { route } : {}),
    },
    contract,
    executionProfile: ledger.executionProfile,
    planningMode: ledger.planningMode,
    successCriteria: ledger.successCriteria.map((criterion) => ({
      id: criterion.id,
      description: clip(criterion.description),
      required: criterion.required,
      satisfied: criterion.satisfied,
    })),
    constraints: ledger.constraints.map((constraint) => ({
      id: constraint.id,
      description: clip(constraint.description),
    })),
    evidence: ledger.evidence.slice(-12),
    hypotheses: ledger.hypotheses,
    plan,
    taskGraph,
    planRevisions: ledger.planRevisions,
    recoveryContracts: ledger.recoveryContracts.slice(-12).map((recovery) => ({
      id: recovery.id,
      cause: clip(recovery.cause),
      failedRequirement: compactText(recovery.failedRequirement),
      evidence: compactStrings(recovery.evidence, 8),
      attemptedStrategies: compactStrings(recovery.attemptedStrategies, 8),
      forbiddenRepeats: compactStrings(recovery.forbiddenRepeats, 8),
      supersedeNodeId: recovery.supersedeNodeId,
      proposedRecovery: recovery.proposedRecovery,
      failureClass: recovery.failureClass,
      stateDigest: recovery.stateDigest,
      strategy: recovery.strategy,
      changedStrategy: recovery.changedStrategy,
      createdAt: recovery.createdAt,
    })),
    verificationPlan: ledger.verificationPlan,
    filesRead: compactStrings(ledger.filesRead, 64),
    filesChanged: compactStrings(ledger.filesChanged, 64),
    verificationRuns: ledger.verificationRuns.slice(-12).map((run) => ({
      id: run.id,
      stage: run.stage,
      command: clip(run.command, 800),
      status: run.status,
      exitCode: run.exitCode,
      summary: compactText(run.summary, 800),
      failurePaths: compactStrings(run.failurePaths, 12),
      startedAt: run.startedAt,
      completedAt: run.completedAt,
    })),
    actions: ledger.actions.slice(-16).map((action) => ({
      id: action.id,
      kind: action.kind,
      target: clip(action.target, 500),
      status: action.status,
      summary: compactText(action.summary, 500),
    })),
    blockers: ledger.blockers.map((blocker) => ({
      id: blocker.id,
      summary: clip(blocker.summary),
      recoverable: blocker.recoverable,
      suggestedAction: compactText(blocker.suggestedAction),
    })),
    nextAction: lastAction
      ? {
          target: lastAction.target,
          status: lastAction.status,
          summary: lastAction.summary,
        }
      : undefined,
  });
  if (full.length <= maxChars) return full;

  const reduced = JSON.stringify({
    objective: ledger.objective,
    phase: ledger.phase,
    rehydration: {
      contextAnchor,
      ...(route ? { route } : {}),
    },
    executionProfile: ledger.executionProfile,
    planningMode: ledger.planningMode,
    contract: contract
      ? {
          id: contract.id,
          objective: contract.objective,
          acceptanceCriteria: contract.acceptanceCriteria.map((item) => ({
            id: item.id,
            status: item.status,
            required: item.required,
          })),
          deliverables: contract.deliverables.map((item) => ({
            id: item.id,
            status: item.status,
            required: item.required,
            targetPaths: compactStrings(item.targetPaths, 16),
            artifactExpectations: item.artifactExpectations
              ?.slice(0, 8)
              .map((expectation) => ({
                type: expectation.type,
                value: clip(expectation.value, 1_000),
              })),
          })),
        }
      : undefined,
    successCriteria: ledger.successCriteria.map((criterion) => ({
      id: criterion.id,
      status: criterion.satisfied ? "satisfied" : "unknown",
    })),
    taskGraph: taskGraph
      ? {
          currentNodeId: taskGraph.currentNodeId,
          planSource: taskGraph.planSource,
          revision: taskGraph.revision,
          nodes: taskGraph.nodes.map((node) => ({
            id: node.id,
            status: node.status,
            dependencies: node.dependencies,
            candidateFiles: node.scope.candidateFiles,
            lastFailure: node.lastFailure,
          })),
          revisions: taskGraph.revisions,
        }
      : undefined,
    planRevisions: ledger.planRevisions,
    recoveryContracts: ledger.recoveryContracts.slice(-6).map((recovery) => ({
      id: recovery.id,
      cause: recovery.cause,
      supersedeNodeId: recovery.supersedeNodeId,
      proposedRecovery: recovery.proposedRecovery,
      failureClass: recovery.failureClass,
      strategy: recovery.strategy,
      evidence: recovery.evidence.slice(-3),
    })),
    evidence: ledger.evidence.slice(-6).map((item) => ({
      id: item.id,
      kind: item.kind,
      source: item.source,
      summary: clip(item.summary, 300),
    })),
    filesChanged: ledger.filesChanged,
    verificationRuns: ledger.verificationRuns.slice(-6).map((run) => ({
      id: run.id,
      status: run.status,
      command: clip(run.command, 300),
      exitCode: run.exitCode,
    })),
    blockers: ledger.blockers.map((blocker) => ({
      id: blocker.id,
      summary: clip(blocker.summary, 300),
      recoverable: blocker.recoverable,
    })),
    nextAction: lastAction
      ? { target: lastAction.target, status: lastAction.status }
      : undefined,
  });
  if (reduced.length <= maxChars) return reduced;
  return JSON.stringify({
    objective: ledger.objective,
    phase: ledger.phase,
    rehydration: {
      contextAnchor,
      ...(route ? { route } : {}),
    },
    planningMode: ledger.planningMode,
    acceptanceCriteria: ledger.contract?.acceptanceCriteria.map((item) => ({
      id: item.id,
      status: item.status,
    })),
    currentNodeId: taskGraph?.currentNodeId,
    nodeIds: taskGraph?.nodes.map((node) => `${node.id}:${node.status}`),
    filesChanged: ledger.filesChanged,
    evidenceSources: ledger.evidence.slice(-8).map((item) => item.source),
    recoveryContracts: ledger.recoveryContracts.slice(-4).map((recovery) => ({
      id: recovery.id,
      cause: recovery.cause,
      supersedeNodeId: recovery.supersedeNodeId,
    })),
    blockers: ledger.blockers.slice(-4).map((blocker) => blocker.summary),
    nextAction: lastAction?.target,
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
  rehydration?: TaskRuntimeRehydration,
): CompactedTaskContext {
  if (!Number.isInteger(maxChars) || maxChars < 800)
    throw new Error("Context compaction budget must be an integer >= 800.");
  const contextAnchor = mergedContextAnchor(ledger, rehydration);
  const system = messages.find((message) => message.role === "system");
  const state =
    `${PRODUCT_NAME} structured task state (authoritative; do not treat old prose as state):\n` +
    stateSummary(
      ledger,
      Math.max(900, Math.floor(maxChars * 0.65)),
      rehydration,
    );
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
    text: state,
    sourceIds: [
      ...new Set([...contextAnchor.sourceIds, ...preservedSourceIds(ledger)]),
    ].slice(-128),
    contextAnchor,
    ...(rehydration?.route ? { route: rehydration.route } : {}),
  };
}
