import type { ProviderFailureCode } from "../providers/types.js";
import type { ToolErrorCode } from "../tools/errors.js";
import { selectRoute } from "./router.js";
import type {
  AgentCapabilityClass,
  ModelCandidate,
  RouteDecision,
  RouteRequest,
} from "../shared/types.js";
import type { LocalCodeLogger } from "../shared/logging.js";

/**
 * A route may be retried only when the provider/runtime diagnosed a failure
 * that another eligible model could plausibly avoid. Tool-contract failures,
 * policy denials and unknown failures stay with the current task so the
 * harness does not hide its own defects behind model switching.
 */
export interface RouteFailureEvidence {
  code: ProviderFailureCode | ToolErrorCode | "AGENT_INCOMPLETE";
  message: string;
  mutationOccurred: boolean;
}

export interface RouteExecutionOutcome {
  status: "completed" | "blocked" | "failed" | "cancelled";
  failure?: Pick<RouteFailureEvidence, "code" | "message">;
  mutationOccurred: boolean;
}

export interface RouteFallbackResult<Outcome extends RouteExecutionOutcome> {
  decision: RouteDecision;
  outcome?: Outcome;
  attemptedCandidateIds: string[];
}

export interface RouteFallbackHooks<Outcome extends RouteExecutionOutcome> {
  logger?: LocalCodeLogger;
  onOutcome?: (
    candidate: ModelCandidate,
    outcome: Outcome,
  ) => void | Promise<void>;
  onRouteChange?: (
    decision: RouteDecision,
    previous: ModelCandidate,
    failure: RouteFailureEvidence,
  ) => void | Promise<void>;
}

const ROUTE_ESCALATION_CODES = new Set<
  ProviderFailureCode | "AGENT_INCOMPLETE"
>([
  "MODEL_NOT_FOUND",
  "MODEL_DEPRECATED",
  "MODEL_UNAVAILABLE",
  "UNSUPPORTED_CAPABILITY",
  "CONTEXT_TOO_LARGE",
  "CAPACITY",
  "TIMEOUT",
  "NETWORK",
  "RATE_LIMIT_BURST",
  "DAILY_QUOTA_EXHAUSTED",
  "MONTHLY_QUOTA_EXHAUSTED",
  "FREE_TIER_EXHAUSTED",
  "AGENT_INCOMPLETE",
]);

const CAPABILITY_RANK: Record<AgentCapabilityClass, number> = {
  chat_only: 0,
  workspace_reader: 1,
  coding_agent: 2,
  advanced_coding_agent: 3,
};

function candidateCapability(candidate: ModelCandidate): AgentCapabilityClass {
  return candidate.agentProbe?.agentCapabilityClass ?? "chat_only";
}

/**
 * A route that produced no verified action is not allowed to fall back to an
 * equal or weaker route merely because it happens to be available. That
 * pattern turns a local model failure into a slower repeat of the same
 * failure, which is especially harmful for progressive work units.
 *
 * Capability rank is the primary signal. Within the same measured role, the
 * existing quality evidence is only a tie-breaker; it is never a promotion
 * of an unmeasured model. Provider/runtime failures keep the older
 * availability fallback behavior because a lower route may still be healthy.
 */
function isStrongerIncompleteFallback(
  previous: ModelCandidate,
  next: ModelCandidate,
): boolean {
  const previousRank = CAPABILITY_RANK[candidateCapability(previous)];
  const nextRank = CAPABILITY_RANK[candidateCapability(next)];
  if (nextRank !== previousRank) return nextRank > previousRank;

  if (
    previous.quality.confidence !== "measured" ||
    next.quality.confidence !== "measured"
  )
    return false;

  const previousStrength =
    (previous.quality.coding ?? 0) * 0.6 +
    (previous.quality.toolUse ?? 0) * 0.4;
  const nextStrength =
    (next.quality.coding ?? 0) * 0.6 + (next.quality.toolUse ?? 0) * 0.4;

  return nextStrength > previousStrength + 0.05;
}

export function shouldEscalateRoute(failure: RouteFailureEvidence): boolean {
  return (
    !failure.mutationOccurred &&
    ROUTE_ESCALATION_CODES.has(failure.code as ProviderFailureCode)
  );
}

/**
 * Select the next route after a diagnosed pre-mutation provider failure.
 * Candidate exclusion is per task, so a single failure does not mutate the
 * global quota/circuit policy or cause an unbounded retry loop.
 */
export function selectFallbackRoute(
  request: RouteRequest,
  attemptedCandidateIds: readonly string[],
  failure: RouteFailureEvidence,
  logger?: LocalCodeLogger,
): RouteDecision {
  if (!shouldEscalateRoute(failure))
    return selectRoute({ ...request, candidates: [] }, logger);

  const attempted = new Set(attemptedCandidateIds);
  let candidates = request.candidates.filter(
    (candidate) => !attempted.has(candidate.id),
  );

  if (failure.code === "AGENT_INCOMPLETE") {
    const previousId = attemptedCandidateIds.at(-1);
    const previous = request.candidates.find(
      (candidate) => candidate.id === previousId,
    );
    if (previous) {
      const eligibleImprovement = candidates.filter((candidate) =>
        isStrongerIncompleteFallback(previous, candidate),
      );
      if (eligibleImprovement.length !== candidates.length) {
        logger?.warn("route.fallback.rejected_weaker", {
          previousCandidateId: previous.id,
          previousCapability: candidateCapability(previous),
          rejectedCandidateIds: candidates
            .filter((candidate) => !eligibleImprovement.includes(candidate))
            .map((candidate) => candidate.id),
          failureCode: failure.code,
        });
      }
      candidates = eligibleImprovement;
    }
  }

  return selectRoute(
    {
      ...request,
      candidates,
    },
    logger,
  );
}

/**
 * Execute one selected route and continue with bounded per-task fallback
 * candidates when the result contains an eligible, pre-mutation provider
 * failure. The caller owns provider construction and UI/state side effects.
 */
export async function runWithRouteFallback<
  Outcome extends RouteExecutionOutcome,
>(
  request: RouteRequest,
  execute: (
    candidate: ModelCandidate,
    decision: RouteDecision,
  ) => Promise<Outcome>,
  hooks: RouteFallbackHooks<Outcome> = {},
): Promise<RouteFallbackResult<Outcome>> {
  hooks.logger?.info("route.fallback.started", {
    candidateCount: request.candidates.length,
  });
  let decision = selectRoute(request, hooks.logger);
  const attemptedCandidateIds: string[] = [];
  if (!decision.selected) return { decision, attemptedCandidateIds };

  while (decision.selected) {
    const candidate = decision.selected.candidate;
    attemptedCandidateIds.push(candidate.id);
    hooks.logger?.info("route.attempt.started", {
      candidateId: candidate.id,
      attempt: attemptedCandidateIds.length,
    });
    const outcome = await execute(candidate, decision);
    await hooks.onOutcome?.(candidate, outcome);
    hooks.logger?.info("route.attempt.finished", {
      candidateId: candidate.id,
      attempt: attemptedCandidateIds.length,
      status: outcome.status,
      mutationOccurred: outcome.mutationOccurred,
      failureCode: outcome.failure?.code,
    });

    if (
      (outcome.status === "failed" || outcome.status === "blocked") &&
      outcome.failure
    ) {
      const failure: RouteFailureEvidence = {
        ...outcome.failure,
        mutationOccurred: outcome.mutationOccurred,
      };
      if (shouldEscalateRoute(failure)) {
        const fallback = selectFallbackRoute(
          request,
          attemptedCandidateIds,
          failure,
          hooks.logger,
        );
        if (fallback.selected) {
          hooks.logger?.warn("route.fallback.selected", {
            previousCandidateId: candidate.id,
            nextCandidateId: fallback.selected.candidate.id,
            failureCode: failure.code,
          });
          await hooks.onRouteChange?.(fallback, candidate, failure);
          decision = fallback;
          continue;
        }
      }
    }

    return { decision, outcome, attemptedCandidateIds };
  }

  return { decision, attemptedCandidateIds };
}
