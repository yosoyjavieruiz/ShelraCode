import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { classifyRepositoryPrivacy } from "../privacy/policy.js";
import {
  LEGACY_PRODUCT_STATE_DIR_NAME,
  PRODUCT_STATE_DIR_NAME,
  readProductEnv,
} from "../product/identity.js";
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
  const routingSetting = readProductEnv(env, "ROUTING_MODE");
  const permissionSetting = readProductEnv(env, "PERMISSION");
  const privacySetting = readProductEnv(env, "PRIVACY");
  const routingMode: RoutingMode =
    routingSetting === "ask-before-paid"
      ? "ask-before-paid"
      : "strict-zero";
  const permissionMode: PermissionMode =
    permissionSetting === "ASK" ||
    permissionSetting === "PLAN" ||
    permissionSetting === "EDIT" ||
    permissionSetting === "AUTO"
      ? permissionSetting
      : "ASK";
  return {
    privacy: classifyRepositoryPrivacy(privacySetting),
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

async function readSettingsFile(
  filePath: string,
): Promise<PersistedRepositorySettings | undefined> {
  try {
    const content = await readFile(filePath, "utf8");
    return validSettings(JSON.parse(content) as unknown);
  } catch {
    return undefined;
  }
}

export async function readRepositorySettings(
  root: string,
): Promise<PersistedRepositorySettings> {
  for (const directoryName of [
    PRODUCT_STATE_DIR_NAME,
    LEGACY_PRODUCT_STATE_DIR_NAME,
  ]) {
    const settings = await readSettingsFile(
      path.join(root, directoryName, "config.json"),
    );
    if (settings !== undefined) return settings;
  }
  return {};
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
  const directory = path.join(root, PRODUCT_STATE_DIR_NAME);
  await mkdir(directory, { recursive: true });
  const existing = await readRepositorySettings(root);
  await writeFile(
    path.join(directory, "config.json"),
    `${JSON.stringify(validSettings({ ...existing, ...settings }), null, 2)}\n`,
    "utf8",
  );
}
