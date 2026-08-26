/** Commands that can create network egress when executed by a child process. */
const NETWORK_COMMAND_PATTERNS = [
  /\b(?:curl|wget|irm|invoke-webrequest)\b/iu,
  /\bgit\s+(?:clone|fetch|pull|submodule\s+(?:add|update))\b/iu,
  /\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|update|remove|publish|link|dlx|x)\b/iu,
  /\b(?:pip|poetry|cargo)\s+(?:install|add|update|fetch)\b/iu,
];

export function commandRequiresNetwork(command: string): boolean {
  return NETWORK_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

export type ProcessNetworkPolicy = "allow" | "deny";

export class ProcessPolicyError extends Error {
  readonly code = "NETWORK_DISABLED" as const;

  constructor(command: string) {
    super(`Network-capable process execution is disabled: ${command}`);
    this.name = "ProcessPolicyError";
  }
}
