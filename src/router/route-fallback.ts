import type { ProviderFailureCode } from "../providers/types.js";
import type { ToolErrorCode } from "../tools/errors.js";
import { selectRoute } from "./router.js";
import type {
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
  code: ProviderFailureCode | ToolErrorCode;
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

const ROUTE_ESCALATION_CODES = new Set<ProviderFailureCode>([
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
]);

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
  return selectRoute(
    {
      ...request,
      candidates: request.candidates.filter(
        (candidate) => !attempted.has(candidate.id),
      ),
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

    if (outcome.status === "failed" && outcome.failure) {
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
