import type { ToolApprovalRequest, ToolRisk } from "./types.js";
import { scanSecrets } from "../privacy/policy.js";

/** The two durable approval scopes exposed by the ASK dialog. */
export type PermissionGrantScope = "session" | "project";

/**
 * Safe workspace operation families used by session/project approvals.
 *
 * File mutations are deliberately grouped together so a user who allows an
 * edit is not prompted again when the model creates or writes the next file.
 * Process commands remain exact-command grants below; this is not a shell
 * wildcard or a destructive-operation bypass.
 */
export type PermissionGrantFamily = "workspace-read" | "workspace-write";

/** A user's answer to an interactive approval request. */
export type ApprovalDecision =
  "once" | "session" | "project" | "deny" | "cancel";

export const MAX_PERMISSION_GRANTS = 128;

const TOOL_RISKS: readonly ToolRisk[] = [
  "read",
  "write",
  "execute",
  "destructive",
];

export interface PermissionGrant {
  /** Stable, non-sensitive identity used by the permissions center. */
  id: string;
  scope: PermissionGrantScope;
  tool: string;
  risk: ToolRisk;
  /** Logical safe operation family for grants created by the current app. */
  family?: PermissionGrantFamily;
  /** Safe workspace grants are family-wide so a session/project rule does not ask per file. */
  path?: string;
  /** Process grants stay exact-command to avoid turning approval into a shell allowlist. */
  command?: string;
  createdAt: string;
}

function normalizeResource(value: string | undefined): string | undefined {
  const normalized = value
    ?.trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "")
    .replace(/\s+/gu, " ");
  return normalized || undefined;
}

/** Persisted rules are configuration, not a safe place to retain credentials. */
export function isPermissionGrantPersistable(grant: PermissionGrant): boolean {
  return grant.command === undefined || scanSecrets(grant.command).length === 0;
}

/** Never echo a secret-shaped command in the permissions center. */
export function redactPermissionCommand(command: string): string {
  if (scanSecrets(command).length > 0)
    return "[redacted secret-shaped command]";
  return command.slice(0, 76);
}

function normalizeTool(value: string | undefined): string {
  return value?.trim() || "workspace-action";
}

function normalizeRisk(value: string | undefined): ToolRisk | undefined {
  return TOOL_RISKS.includes(value as ToolRisk)
    ? (value as ToolRisk)
    : undefined;
}

const WORKSPACE_READ_TOOLS = new Set([
  "ReadFile",
  "GlobFiles",
  "ListFiles",
  "SearchText",
  "GitStatus",
  "GitDiff",
]);
const WORKSPACE_WRITE_TOOLS = new Set(["WriteFile", "CreateFile", "EditFile"]);

/** Return the narrow operation family a saved approval may cover. */
export function permissionGrantFamily(
  request: Pick<ToolApprovalRequest, "tool" | "risk">,
): PermissionGrantFamily | undefined {
  const tool = normalizeTool(request.tool);
  if (request.risk === "read" && WORKSPACE_READ_TOOLS.has(tool))
    return "workspace-read";
  if (request.risk === "write" && WORKSPACE_WRITE_TOOLS.has(tool))
    return "workspace-write";
  return undefined;
}

/** Human-readable scope shown beside the session/project approval choices. */
export function permissionGrantScopeDescription(
  request: Pick<ToolApprovalRequest, "tool" | "risk" | "command">,
): string {
  if (normalizeResource(request.command) !== undefined)
    return "this exact command";
  const family = permissionGrantFamily(request);
  if (family === "workspace-read") return "workspace reads";
  if (family === "workspace-write") return "workspace file writes";
  return `${normalizeTool(request.tool)} ${request.risk} actions`;
}

function identityFor(
  scope: PermissionGrantScope,
  request: Pick<ToolApprovalRequest, "tool" | "risk" | "path" | "command">,
): string {
  const tool = normalizeTool(request.tool);
  const command = normalizeResource(request.command);
  const family = permissionGrantFamily(request);
  // Safe file approvals use the operation family as their identity so
  // CreateFile, WriteFile and EditFile do not create three independent rules.
  // Process approvals remain exact-command grants. Avoid putting a path into
  // the identity when it is not retained in the grant itself.
  return JSON.stringify([scope, family ?? tool, request.risk, command ?? null]);
}

function stableId(identity: string): string {
  // A small deterministic hash keeps commands and paths out of rendered IDs and
  // avoids a duplicate rule when a user authorizes the same operation twice.
  let hash = 2_166_136_261;
  for (const character of identity) {
    hash ^= character.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16_777_619);
  }
  return `grant-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function createPermissionGrant(
  scope: PermissionGrantScope,
  request: Pick<ToolApprovalRequest, "tool" | "risk" | "path" | "command">,
  createdAt = new Date().toISOString(),
): PermissionGrant {
  const command = normalizeResource(request.command);
  const identity = identityFor(scope, request);
  const family = permissionGrantFamily(request);
  return {
    id: stableId(identity),
    scope,
    tool: normalizeTool(request.tool),
    risk: request.risk,
    ...(family ? { family } : {}),
    ...(command ? { command } : {}),
    createdAt,
  };
}

export function matchesPermissionGrant(
  grant: PermissionGrant,
  request: Pick<ToolApprovalRequest, "tool" | "risk" | "path" | "command">,
): boolean {
  if (grant.risk !== request.risk) return false;
  // Grants written before family scopes existed had only a safe file tool and
  // no exact path/command. Treat those legacy records as the same narrow
  // family so an already-approved project does not start prompting again
  // after the app learns to create/write/edit different files.
  const grantFamily =
    grant.family ??
    (!grant.command && !grant.path ? permissionGrantFamily(grant) : undefined);
  if (grantFamily !== undefined) {
    if (grantFamily !== permissionGrantFamily(request)) return false;
  } else if (grant.tool !== normalizeTool(request.tool)) return false;
  if (grant.command !== undefined)
    return normalizeResource(request.command) === grant.command;
  if (grant.path !== undefined)
    return normalizeResource(request.path) === grant.path;
  // A grant without a resource is a deliberate tool/risk grant. It is used by
  // the ASK dialog for file/search tools; process tools always carry command.
  return request.command === undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseGrant(value: unknown): PermissionGrant | undefined {
  if (!isRecord(value)) return undefined;
  const scope =
    value.scope === "session" || value.scope === "project"
      ? value.scope
      : undefined;
  const risk = normalizeRisk(
    typeof value.risk === "string" ? value.risk : undefined,
  );
  const tool = typeof value.tool === "string" ? value.tool.trim() : "";
  const id = typeof value.id === "string" ? value.id.trim() : "";
  const createdAt =
    typeof value.createdAt === "string" ? value.createdAt.trim() : "";
  if (!scope || !risk || !tool || !id || !createdAt) return undefined;
  const path =
    typeof value.path === "string" ? normalizeResource(value.path) : undefined;
  const command =
    typeof value.command === "string"
      ? normalizeResource(value.command)
      : undefined;
  if (path && command) return undefined;
  const family =
    value.family === "workspace-read" || value.family === "workspace-write"
      ? value.family
      : undefined;
  return {
    id,
    scope,
    tool,
    risk,
    ...(family ? { family } : {}),
    ...(path ? { path } : {}),
    ...(command ? { command } : {}),
    createdAt,
  };
}

/** Parse persisted JSON without allowing malformed configuration into policy. */
export function parsePermissionGrants(raw: unknown): PermissionGrant[] {
  let value: unknown = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(value)) return [];
  const grants: PermissionGrant[] = [];
  for (const candidate of value) {
    const grant = parseGrant(candidate);
    if (
      !grant ||
      !isPermissionGrantPersistable(grant) ||
      grants.some((existing) => existing.id === grant.id)
    )
      continue;
    grants.push(grant);
    if (grants.length >= MAX_PERMISSION_GRANTS) break;
  }
  return grants;
}

export function serializePermissionGrants(
  grants: readonly PermissionGrant[],
): string {
  return JSON.stringify(
    parsePermissionGrants(grants).filter(isPermissionGrantPersistable),
  );
}

export function addPermissionGrant(
  grants: readonly PermissionGrant[],
  grant: PermissionGrant,
): PermissionGrant[] {
  const current = parsePermissionGrants(grants);
  if (!isPermissionGrantPersistable(grant)) return current;
  if (current.some((candidate) => candidate.id === grant.id)) return current;
  return [...current, grant].slice(0, MAX_PERMISSION_GRANTS);
}

export function removePermissionGrant(
  grants: readonly PermissionGrant[],
  id: string,
): PermissionGrant[] {
  return parsePermissionGrants(grants).filter((grant) => grant.id !== id);
}
