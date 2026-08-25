import { allowsCandidate } from "../privacy/policy.js";
import type {
  AgentCapabilityClass,
  ModelCandidate,
  RouteDecision,
  RouteRejection,
  RouteRequest,
  RouteScoreBreakdown,
} from "../shared/types.js";
import type { LocalCodeLogger } from "../shared/logging.js";

const CAPABILITY_RANK: Record<AgentCapabilityClass, number> = {
  chat_only: 0,
  workspace_reader: 1,
  coding_agent: 2,
  advanced_coding_agent: 3,
};

function candidateCapability(candidate: ModelCandidate): AgentCapabilityClass {
  return candidate.agentProbe?.agentCapabilityClass ?? "chat_only";
}

function isStale(candidate: ModelCandidate, now: Date): boolean {
  if (candidate.source === "local") return false;
  if (candidate.free.status === "stale") return true;
  if (
    candidate.free.status !== "verified_free" &&
    candidate.free.status !== "free_quota"
  )
    return true;
  if (!candidate.free.verifiedAt || !candidate.free.expiresAt) return true;
  const verifiedAt = new Date(candidate.free.verifiedAt).getTime();
  const expiresAt = new Date(candidate.free.expiresAt).getTime();
  if (!Number.isFinite(verifiedAt) || !Number.isFinite(expiresAt)) return true;
  return verifiedAt > now.getTime() || expiresAt <= now.getTime();
}

function quotaHeadroom(
  candidate: ModelCandidate,
  request: RouteRequest,
): number {
  const quota = request.quotas?.[candidate.providerId];
  if (!quota) return candidate.source === "local" ? 1 : 0.5;
  if (quota.tokensRemaining !== undefined && quota.tokensLimit !== undefined) {
    if (quota.tokensLimit <= 0) return 0;
    return Math.max(0, Math.min(1, quota.tokensRemaining / quota.tokensLimit));
  }
  if (
    quota.requestsRemaining !== undefined &&
    quota.requestsLimit !== undefined
  ) {
    if (quota.requestsLimit <= 0) return 0;
    return Math.max(
      0,
      Math.min(1, quota.requestsRemaining / quota.requestsLimit),
    );
  }
  if (quota.tokensRemaining !== undefined && quota.tokensRemaining <= 0)
    return 0;
  if (quota.requestsRemaining !== undefined && quota.requestsRemaining <= 0)
    return 0;
  return quota.confidence === "unknown" ? 0 : 0.5;
}

function scoreCandidate(
  candidate: ModelCandidate,
  request: RouteRequest,
): RouteScoreBreakdown {
  const taskFit = Math.max(0, Math.min(1, candidate.quality.coding ?? 0.5));
  const predictedSuccess = Math.max(
    0,
    Math.min(1, (taskFit + (candidate.quality.toolUse ?? 0.5)) / 2),
  );
  const headroom = quotaHeadroom(candidate, request);
  const reliability =
    candidate.health.state === "healthy"
      ? 1
      : candidate.health.state === "degraded"
        ? 0.55
        : 0;
  const latency =
    candidate.health.latencyMs === undefined
      ? 0.5
      : Math.max(0, Math.min(1, 1 - candidate.health.latencyMs / 2_000));
  const maxContext = candidate.capabilities.maxContext ?? 0;
  const contextHeadroom =
    maxContext > 0
      ? Math.max(
          0,
          Math.min(1, (maxContext - request.contextTokens) / maxContext),
        )
      : 0;
  const toolReliability = candidate.capabilities.tools
    ? (candidate.quality.toolUse ?? 0.5)
    : 0;
  const quotaOpportunityCost =
    candidate.source === "local"
      ? 0
      : request.task.opportunityCost === "low_value"
        ? 0.45
        : request.task.opportunityCost === "critical"
          ? 0
          : 0.08;
  const total =
    0.3 * taskFit +
    0.2 * predictedSuccess +
    0.15 * headroom +
    0.12 * reliability +
    0.1 * latency +
    0.08 * contextHeadroom +
    0.05 * toolReliability -
    quotaOpportunityCost;

  return {
    taskFit,
    predictedSuccess,
    quotaHeadroom: headroom,
    reliability,
    latency,
    contextHeadroom,
    toolReliability,
    quotaOpportunityCost,
    total,
  };
}

function reject(
  rejections: RouteRejection[],
  candidate: ModelCandidate,
  reason: string,
): void {
  const existing = rejections.find((item) => item.candidateId === candidate.id);
  if (existing) existing.reasons.push(reason);
  else
    rejections.push({
      candidateId: candidate.id,
      providerId: candidate.providerId,
      reasons: [reason],
    });
}

export function selectRoute(
  request: RouteRequest,
  logger?: LocalCodeLogger,
): RouteDecision {
  logger?.debug("route.selection.started", {
    candidateCount: request.candidates.length,
    taskClass: request.task.class,
    complexity: request.task.complexity,
    requiredCapability: request.task.requiredCapability,
    repositoryPolicy: request.repositoryPolicy,
    routingMode: request.routingMode,
  });
  const rejections: RouteRejection[] = [];
  const eligible: Array<{
    candidate: ModelCandidate;
    breakdown: RouteScoreBreakdown;
  }> = [];

  for (const candidate of request.candidates) {
    if (
      candidate.source !== "local" &&
      request.containsHighConfidenceSecret === true
    ) {
      reject(
        rejections,
        candidate,
        "high-confidence secret blocks cloud route",
      );
      continue;
    }

    const privacy = allowsCandidate(request.repositoryPolicy, candidate);
    if (!privacy.allowed) {
      reject(
        rejections,
        candidate,
        privacy.reason ?? "privacy policy blocked route",
      );
      continue;
    }

    if (request.routingMode === "strict-zero") {
      if (
        candidate.source === "paid_cloud" ||
        candidate.free.status === "paid" ||
        candidate.free.status === "paid_required"
      ) {
        reject(rejections, candidate, "paid route excluded by strict-zero");
        continue;
      }
      if (
        candidate.source === "free_cloud" &&
        candidate.free.status === "unknown"
      ) {
        reject(rejections, candidate, "free billing is unverified");
        continue;
      }
      if (isStale(candidate, request.now)) {
        reject(rejections, candidate, "free metadata is stale");
        continue;
      }
    } else if (
      candidate.source === "paid_cloud" &&
      request.paidApproved !== true
    ) {
      reject(rejections, candidate, "paid route requires explicit approval");
      continue;
    }

    if (request.task.toolNeed && !candidate.capabilities.tools) {
      reject(rejections, candidate, "required tool capability is unavailable");
      continue;
    }

    const requiredCapability =
      request.task.requiredCapability ??
      (request.task.toolNeed ? "workspace_reader" : "chat_only");
    if (
      CAPABILITY_RANK[candidateCapability(candidate)] <
      CAPABILITY_RANK[requiredCapability]
    ) {
      reject(
        rejections,
        candidate,
        candidate.agentProbe
          ? `capability ${candidateCapability(candidate)} is below required ${requiredCapability}`
          : `capability probe required for ${requiredCapability}`,
      );
      continue;
    }

    if (
      candidate.capabilities.maxContext !== undefined &&
      candidate.capabilities.maxContext < request.contextTokens
    ) {
      reject(rejections, candidate, "usable context is insufficient");
      continue;
    }

    if (candidate.health.state === "down") {
      reject(rejections, candidate, "provider or runtime is down");
      continue;
    }
    if (candidate.source !== "local" && candidate.health.state === "unknown") {
      reject(rejections, candidate, "provider health is unverified");
      continue;
    }

    if (
      candidate.source !== "local" &&
      request.circuitBreaker &&
      !request.circuitBreaker.canRequest(candidate.providerId, candidate.id)
    ) {
      reject(rejections, candidate, "circuit breaker is open");
      continue;
    }

    const quota = request.quotas?.[candidate.providerId];
    if (candidate.source !== "local" && quota) {
      const observedAt = new Date(quota.observedAt).getTime();
      const maxAge = request.quotaMaxAgeMs ?? 15 * 60 * 1_000;
      if (
        !Number.isFinite(observedAt) ||
        request.now.getTime() - observedAt > maxAge
      ) {
        reject(rejections, candidate, "quota snapshot is stale");
        continue;
      }
    }

    const headroom = quotaHeadroom(candidate, request);
    if (candidate.source !== "local" && headroom <= 0) {
      reject(rejections, candidate, "remaining quota is exhausted");
      continue;
    }

    eligible.push({ candidate, breakdown: scoreCandidate(candidate, request) });
  }

  for (const rejection of rejections)
    logger?.debug("route.candidate.rejected", {
      candidateId: rejection.candidateId,
      providerId: rejection.providerId,
      reasons: rejection.reasons,
    });

  eligible.sort((left, right) => right.breakdown.total - left.breakdown.total);
  const selected = eligible[0];
  const generatedAt = request.now.toISOString();
  if (!selected) {
    const reasons = rejections
      .flatMap((item) => item.reasons)
      .slice(0, 3)
      .join("; ");
    logger?.warn("route.none", {
      rejectionCount: rejections.length,
      reasonCount: rejections.flatMap((item) => item.reasons).length,
      reasonSummary: reasons.slice(0, 500),
    });
    return {
      rejections,
      generatedAt,
      task: request.task,
      repositoryPolicy: request.repositoryPolicy,
      routingMode: request.routingMode,
      explanation: `No eligible route. ${reasons || "All candidates were rejected by policy."}`,
    };
  }

  const decision: RouteDecision = {
    selected: {
      candidate: selected.candidate,
      score: selected.breakdown.total,
      breakdown: selected.breakdown,
    },
    rejections,
    generatedAt,
    task: request.task,
    repositoryPolicy: request.repositoryPolicy,
    routingMode: request.routingMode,
    explanation: [
      `Selected ${selected.candidate.providerId} / ${selected.candidate.displayName}.`,
      "Privacy gate passed.",
      request.routingMode === "strict-zero"
        ? "Cost gate passed: no paid route was evaluated."
        : "Cost policy allows an explicit paid confirmation.",
      `Score ${selected.breakdown.total.toFixed(2)} from task fit ${selected.breakdown.taskFit.toFixed(2)}, reliability ${selected.breakdown.reliability.toFixed(2)}, quota headroom ${selected.breakdown.quotaHeadroom.toFixed(2)}, latency ${selected.breakdown.latency.toFixed(2)}, context ${selected.breakdown.contextHeadroom.toFixed(2)} and tool use ${selected.breakdown.toolReliability.toFixed(2)}.`,
    ].join(" "),
  };

  logger?.info("route.selected", {
    candidateId: selected.candidate.id,
    providerId: selected.candidate.providerId,
    modelId: selected.candidate.modelId,
    score: selected.breakdown.total,
    rejectionCount: rejections.length,
  });

  return decision;
}
