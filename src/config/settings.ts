import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { classifyRepositoryPrivacy } from "../privacy/policy.js";
import type {
  PermissionMode,
  RepositoryPrivacy,
  RoutingMode,
} from "../shared/types.js";
import {
  parsePermissionGrants,
  type PermissionGrant,
} from "../tools/permission-grants.js";

export interface LocalCodeSettings {
  privacy: RepositoryPrivacy;
  routingMode: RoutingMode;
  permissionMode: PermissionMode;
  permissionRules: PermissionGrant[];
}

export type PersistedRepositorySettings = Partial<
  Pick<
    LocalCodeSettings,
    "privacy" | "routingMode" | "permissionMode" | "permissionRules"
  >
>;

export function readSettings(
  env: Record<string, string | undefined> = process.env,
): LocalCodeSettings {
  const routingMode: RoutingMode =
    env.LOCALCODE_ROUTING_MODE === "ask-before-paid"
      ? "ask-before-paid"
      : "strict-zero";
  const permissionMode: PermissionMode =
    env.LOCALCODE_PERMISSION === "ASK" ||
    env.LOCALCODE_PERMISSION === "PLAN" ||
    env.LOCALCODE_PERMISSION === "EDIT" ||
    env.LOCALCODE_PERMISSION === "AUTO"
      ? env.LOCALCODE_PERMISSION
      : "ASK";
  return {
    privacy: classifyRepositoryPrivacy(env.LOCALCODE_PRIVACY),
    routingMode,
    permissionMode,
    permissionRules: [],
  };
}

function validSettings(value: unknown): PersistedRepositorySettings {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return {};
  const record = value as Record<string, unknown>;
  const result: PersistedRepositorySettings = {};
  if (
    typeof record.privacy === "string" &&
    [
      "local_only",
      "private_zdr_only",
      "private",
      "trusted_cloud",
      "public_free",
    ].includes(record.privacy)
  )
    result.privacy = record.privacy as LocalCodeSettings["privacy"];
  if (
    typeof record.routingMode === "string" &&
    ["strict-zero", "ask-before-paid"].includes(record.routingMode)
  )
    result.routingMode = record.routingMode as LocalCodeSettings["routingMode"];
  if (
    typeof record.permissionMode === "string" &&
    ["ASK", "PLAN", "EDIT", "AUTO"].includes(record.permissionMode)
  )
    result.permissionMode =
      record.permissionMode as LocalCodeSettings["permissionMode"];
  if (record.permissionRules !== undefined)
    result.permissionRules = parsePermissionGrants(
      record.permissionRules,
    ).filter((grant) => grant.scope === "project");
  return result;
}

export async function readRepositorySettings(
  root: string,
): Promise<PersistedRepositorySettings> {
  try {
    const content = await readFile(
      path.join(root, ".localcode", "config.json"),
      "utf8",
    );
    return validSettings(JSON.parse(content) as unknown);
  } catch {
    return {};
  }
}

/**
 * Reports whether a workspace has persisted policy decisions. The CLI uses
 * this state for configuration services, while the main no-argument launch
 * remains stable and always opens the conversation surface.
 */
export async function hasRepositorySetup(root: string): Promise<boolean> {
  const settings = await readRepositorySettings(root);
  return settings.privacy !== undefined && settings.routingMode !== undefined;
}

export async function persistRepositorySettings(
  root: string,
  settings: PersistedRepositorySettings,
): Promise<void> {
  const directory = path.join(root, ".localcode");
  await mkdir(directory, { recursive: true });
  const existing = await readRepositorySettings(root);
  await writeFile(
    path.join(directory, "config.json"),
    `${JSON.stringify(validSettings({ ...existing, ...settings }), null, 2)}\n`,
    "utf8",
  );
}
