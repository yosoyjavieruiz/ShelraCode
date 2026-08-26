export type RecoveryStrategy =
  | "retry"
  | "retrieve_more"
  | "repair"
  | "replan"
  | "decompose"
  | "switch_model"
  | "ask_user"
  | "stop";

export interface RecoveryContract {
  id: string;
  cause: string;
  failedRequirement?: string;
  evidence: string[];
  attemptedStrategies: string[];
  forbiddenRepeats: string[];
  /** For plan-boundary failures, the replacement must supersede this node. */
  supersedeNodeId?: string;
  proposedRecovery: RecoveryStrategy;
  createdAt: string;
}

export interface CreateRecoveryContractInput {
  id?: string;
  cause: string;
  failedRequirement?: string;
  evidence?: readonly string[];
  attemptedStrategies?: readonly string[];
  forbiddenRepeats?: readonly string[];
  supersedeNodeId?: string;
  proposedRecovery: RecoveryStrategy;
  createdAt?: string;
}

function unique(values: readonly string[] | undefined): string[] {
  return [...new Set((values ?? []).map((value) => value.trim()).filter(Boolean))];
}

export function createRecoveryContract(
  input: CreateRecoveryContractInput,
): RecoveryContract {
  return {
    id: input.id ?? crypto.randomUUID(),
    cause: input.cause.trim(),
    ...(input.failedRequirement?.trim()
      ? { failedRequirement: input.failedRequirement.trim() }
      : {}),
    evidence: unique(input.evidence),
    attemptedStrategies: unique(input.attemptedStrategies),
    forbiddenRepeats: unique(input.forbiddenRepeats),
    ...(input.supersedeNodeId?.trim()
      ? { supersedeNodeId: input.supersedeNodeId.trim() }
      : {}),
    proposedRecovery: input.proposedRecovery,
    createdAt: input.createdAt ?? new Date().toISOString(),
  };
}

export function hasRepeatedRecoveryStrategy(
  recovery: RecoveryContract,
  strategy: string,
): boolean {
  const normalized = strategy.trim();
  return recovery.forbiddenRepeats.includes(normalized);
}
