/** Commands that can create network egress when executed by a child process. */
const NETWORK_COMMAND_PATTERNS = [
  /\b(?:curl|wget|irm|iwr|invoke-webrequest|invoke-restmethod)\b/iu,
  /\b(?:bitsadmin|start-bitstransfer|certutil)\b/iu,
  /\bgit\s+(?:clone|fetch|pull|submodule\s+(?:add|update))\b/iu,
  /\b(?:npm|pnpm|yarn|bun)\s+(?:install|add|update|remove|publish|link|dlx|x)\b/iu,
  /\b(?:pip|poetry|cargo)\s+(?:install|add|update|fetch)\b/iu,
  /\b(?:python|python3|node|deno|bun)\b[^\r\n]*(?:https?:\/\/|\b(?:fetch|requests?\.|axios|urllib|http\.request)\b)/iu,
];

const DESTRUCTIVE_COMMAND_PATTERNS = [
  /\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f|push\s+--force)\b/iu,
  /\b(?:rm|rmdir|del|remove-item)\b[^\r\n]*(?:-rf|-recurse|-force|\/s|\/q)/iu,
  /\b(?:sudo|runas)\b/iu,
  /\b(?:curl|wget|irm|invoke-webrequest)\b[^\r\n]*\|\s*(?:sh|bash|pwsh|powershell|iex|invoke-expression)\b/iu,
  /\b(?:npm|pnpm|yarn|bun)\s+publish\b/iu,
  /\b(?:drop|truncate)\s+(?:table|database)\b/iu,
];

export function commandRequiresNetwork(command: string): boolean {
  return NETWORK_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

export function commandIsDestructive(command: string): boolean {
  return DESTRUCTIVE_COMMAND_PATTERNS.some((pattern) => pattern.test(command));
}

export type ProcessNetworkPolicy = "allow" | "deny";

/** The intent is an auditable operation class, not a model-provided label. */
export type ProcessIntent =
  "read" | "test" | "build" | "package" | "execute" | "network" | "destructive";

export const SAFE_PROCESS_ENV_NAMES = new Set([
  "PATH",
  "PATHEXT",
  "COMSPEC",
  "SYSTEMROOT",
  "WINDIR",
  "TEMP",
  "TMP",
  "TMPDIR",
  "HOME",
  "USERPROFILE",
  "HOMEDRIVE",
  "HOMEPATH",
  "LOCALAPPDATA",
  "APPDATA",
  "PROGRAMFILES",
  "PROGRAMFILES(X86)",
  "PROGRAMW6432",
  "BUN_INSTALL",
  "NODE_PATH",
  "CI",
  "TERM",
  "TERM_PROGRAM",
  "NO_COLOR",
  "FORCE_COLOR",
  "LANG",
  "LC_ALL",
  "TZ",
  "LOCALCODE_STATE_DIR",
  "SHELRACODE_STATE_DIR",
]);

export function safeProcessEnvironment(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && SAFE_PROCESS_ENV_NAMES.has(key.toUpperCase()))
      safe[key] = value;
  }
  return safe;
}

export interface ProcessPolicyRequest {
  command: string;
  intent: ProcessIntent;
  network?: ProcessNetworkPolicy;
  allowDestructive?: boolean;
}

export function assertProcessPolicy(input: ProcessPolicyRequest): void {
  if (
    (input.intent === "destructive" || commandIsDestructive(input.command)) &&
    input.allowDestructive !== true
  )
    throw new ProcessPolicyError(
      "DESTRUCTIVE_PROCESS_DISABLED",
      "Destructive process execution is disabled by the host policy.",
      input.command,
    );
  if (
    input.network === "deny" &&
    (input.intent === "network" || commandRequiresNetwork(input.command))
  )
    throw new ProcessPolicyError(
      "NETWORK_DISABLED",
      `Network-capable process execution is disabled: ${input.command}`,
      input.command,
    );
}

export class ProcessPolicyError extends Error {
  readonly code: "NETWORK_DISABLED" | "DESTRUCTIVE_PROCESS_DISABLED";

  constructor(
    code: "NETWORK_DISABLED" | "DESTRUCTIVE_PROCESS_DISABLED",
    message: string,
    readonly command: string,
  ) {
    super(message);
    this.code = code;
    this.name = "ProcessPolicyError";
  }
}
