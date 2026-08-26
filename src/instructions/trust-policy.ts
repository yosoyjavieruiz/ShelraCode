/**
 * Trust is a host-side classification, not a claim that repository text is
 * safe.  Lower-trust text may be useful evidence, but it cannot change the
 * permission, network, or completion policy assembled by the host.
 */
export type InstructionTrust =
  "system" | "project" | "user" | "memory" | "repository";

export type InstructionKind =
  | "system"
  | "agents"
  | "claude"
  | "skill"
  | "user"
  | "memory"
  | "repository"
  | "tool-output";

export interface InstructionSource {
  source: string;
  text: string;
  trust?: InstructionTrust;
  kind?: InstructionKind;
  scope?: string;
  precedence?: number;
  relevance?: number;
}

export interface TrustedInstruction extends Omit<InstructionSource, "trust"> {
  sourceId: string;
  trust: Exclude<InstructionTrust, "repository">;
  precedence: number;
}

const TRUST_PRECEDENCE: Record<InstructionTrust, number> = {
  system: 500,
  project: 400,
  user: 300,
  memory: 200,
  repository: 100,
};

/**
 * Project scope specificity is deliberately a small adjustment.  It lets a
 * nested instruction be more specific than its parent without allowing it to
 * outrank system policy or turn ordinary repository text into policy.
 */
export function instructionPrecedence(
  trust: InstructionTrust,
  scopeDepth = 0,
  specificity = 0,
): number {
  const depth = trust === "project" ? Math.max(0, Math.min(99, scopeDepth)) : 0;
  return TRUST_PRECEDENCE[trust] + depth + specificity;
}

export function isPrivilegedInstructionName(name: string): boolean {
  const normalized = name.replaceAll("\\", "/").replace(/^\.\//u, "");
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
  return new Set(["AGENTS.md", "AGENTS.override.md", "CLAUDE.md"]).has(
    basename,
  );
}

export function isTrustedPolicySource(
  source: InstructionSource,
): source is InstructionSource & {
  trust: Exclude<InstructionTrust, "repository">;
} {
  return source.trust !== "repository" && source.trust !== undefined;
}

export function compareInstructionPrecedence(
  left: Pick<TrustedInstruction, "precedence" | "sourceId">,
  right: Pick<TrustedInstruction, "precedence" | "sourceId">,
): number {
  return (
    left.precedence - right.precedence ||
    left.sourceId.localeCompare(right.sourceId)
  );
}
