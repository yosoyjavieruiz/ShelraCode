import type { PermissionMode } from "../shared/types.js";

export { commandRequiresNetwork } from "../shared/process-policy.js";

export type ShellRisk = "read" | "execute" | "destructive";
export type ToolRisk = "read" | "write" | "execute" | "destructive";

const workspaceEscapePatterns = [
  /(?:^|[;&|])\s*(?:cd|pushd|push-location|set-location|sl)\s+(?:(?:-path|-literalpath)\s+)?["']?(?:\.\.|[a-z]:[\\/]|[\\/])/i,
  /(?:>|>>|2>|2>>)\s*["']?(?:\.\.[\\/]|[a-z]:[\\/]|[\\/])/i,
  /(?:[\s"'=])(?:\.\.[\\/]|[a-z]:[\\/])/i,
];

export function shellCommandEscapesWorkspace(command: string): boolean {
  return workspaceEscapePatterns.some((pattern) => pattern.test(command));
}

const destructivePatterns = [
  /\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f|push\b[^;&|\r\n]*(?:--force\b|-f\b))/i,
  /\b(?:rm|rmdir|del|remove-item)\b[^;&|\r\n]*(?:-rf|-recurse|-force|\/s|\/q)/i,
  /\b(?:sudo|runas)\b/i,
  /\b(?:curl|wget|irm|invoke-webrequest)\b[^\r\n]*\|\s*(?:sh|bash|pwsh|powershell|iex|invoke-expression)\b/i,
  /\b(?:npm|pnpm|yarn|bun)\s+publish\b/i,
  /\b(?:drop|truncate)\s+(?:table|database)\b/i,
];

const readPatterns = [
  /^(?:git\s+(?:status|diff|log|show|branch|rev-parse|ls-files)|(?:ls|dir|pwd|cat|type|get-content|rg|grep)\b)/i,
];
const safeExecutePatterns = [
  /^(?:bun|npm|pnpm|yarn)\s+(?:test|run\s+(?:typecheck|lint|format:check)|x\s+tsc)\b/i,
  /^git\s+(?:status|diff|log|show)\b/i,
];

export function classifyShellCommand(command: string): ShellRisk {
  const normalized = command.trim();
  if (destructivePatterns.some((pattern) => pattern.test(normalized)))
    return "destructive";
  if (readPatterns.some((pattern) => pattern.test(normalized))) return "read";
  if (safeExecutePatterns.some((pattern) => pattern.test(normalized)))
    return "execute";
  return "execute";
}

/**
 * True only when the command matches an explicit safe read/execute
 * pattern. Unlike `classifyShellCommand`, which falls back to `"execute"`
 * for any unrecognized command, this never returns true for one -- it's
 * the single source of truth `src/security/execution-broker.ts`'s
 * strict-zero local process allowlist builds on, instead of maintaining a
 * second, independently-drifting "safe command" pattern set.
 */
export function isKnownSafeShellCommand(command: string): boolean {
  const normalized = command.trim();
  if (destructivePatterns.some((pattern) => pattern.test(normalized)))
    return false;
  return (
    readPatterns.some((pattern) => pattern.test(normalized)) ||
    safeExecutePatterns.some((pattern) => pattern.test(normalized))
  );
}

export interface PermissionCheckInput {
  mode: PermissionMode;
  risk: ToolRisk;
  command?: string;
}

export interface PermissionDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
}

export function checkPermission(
  input: PermissionCheckInput,
): PermissionDecision {
  if (input.mode === "ASK") {
    return {
      allowed: false,
      requiresApproval: true,
      reason: "interactive permission is required for every workspace action",
    };
  }

  const shellRisk = input.command
    ? classifyShellCommand(input.command)
    : undefined;
  if (shellRisk === "destructive" || input.risk === "destructive") {
    return {
      allowed: false,
      requiresApproval: true,
      reason: "destructive action requires explicit approval",
    };
  }

  if (
    input.mode === "PLAN" &&
    (input.risk === "write" || input.risk === "execute")
  ) {
    return {
      allowed: false,
      requiresApproval: true,
      reason: "PLAN mode requires approval before this workspace action",
    };
  }

  return {
    allowed: true,
    requiresApproval: false,
    reason: "allowed by current permission mode",
  };
}
