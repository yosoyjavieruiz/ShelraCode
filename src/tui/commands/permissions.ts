import type { PermissionGrantFamily, PermissionGrantScope } from "../../tools/permission-grants.js";

export type PermissionsCommand =
  | { kind: "open" }
  | {
      kind: "authorize";
      scope: PermissionGrantScope;
      family: PermissionGrantFamily;
    }
  | { kind: "revoke"; id: string }
  | { kind: "clear" }
  | { kind: "usage" };

const AUTHORIZATION_ACTIONS = new Set([
  "allow",
  "approve",
  "authorize",
  "grant",
]);

function permissionFamily(value: string): PermissionGrantFamily | undefined {
  if (["read", "reads", "workspace-read", "workspace-reads"].includes(value))
    return "workspace-read";
  if (
    ["write", "writes", "workspace-write", "workspace-writes"].includes(
      value,
    )
  )
    return "workspace-write";
  return undefined;
}

/**
 * Parse only safe, explicit permission-center operations. Shell commands are
 * intentionally not accepted here: they must be approved as exact commands
 * from the ASK dialog so a slash command cannot become a hidden shell
 * wildcard.
 */
export function parsePermissionsCommand(
  input: string,
): PermissionsCommand | undefined {
  const tokens = input.trim().split(/\s+/u).filter(Boolean);
  if (tokens.length === 0 || tokens[0]?.toLowerCase() !== "/permissions")
    return undefined;
  if (tokens.length === 1) return { kind: "open" };

  const action = tokens[1]?.toLowerCase();
  if (action === "clear" && tokens.length === 2) return { kind: "clear" };
  if (action === "revoke" && tokens.length === 3 && tokens[2])
    return { kind: "revoke", id: tokens[2] };
  if (!AUTHORIZATION_ACTIONS.has(action ?? "")) return { kind: "usage" };

  const scope = tokens
    .slice(2)
    .map((token) => token.toLowerCase())
    .find((token): token is PermissionGrantScope =>
      token === "session" || token === "project",
    );
  const family = tokens
    .slice(2)
    .map((token) => token.toLowerCase())
    .map(permissionFamily)
    .find((value): value is PermissionGrantFamily => value !== undefined);
  if (!scope || !family || tokens.length !== 4) return { kind: "usage" };
  return { kind: "authorize", scope, family };
}

export const PERMISSIONS_COMMAND_USAGE =
  "/permissions | /permissions authorize <session|project> <reads|writes> | /permissions revoke <grant-id> | /permissions clear";
