import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { classifyRepositoryPrivacy } from "../privacy/policy.js";
import type {
  PermissionMode,
  RepositoryPrivacy,
  RoutingMode,
} from "../shared/types.js";

export interface LocalCodeSettings {
  privacy: RepositoryPrivacy;
  routingMode: RoutingMode;
  permissionMode: PermissionMode;
}

export type PersistedRepositorySettings = Partial<
  Pick<LocalCodeSettings, "privacy" | "routingMode" | "permissionMode">
>;

export function readSettings(
  env: Record<string, string | undefined> = process.env,
): LocalCodeSettings {
  const routingMode: RoutingMode =
    env.LOCALCODE_ROUTING_MODE === "ask-before-paid"
      ? "ask-before-paid"
      : "strict-zero";
  const permissionMode: PermissionMode =
    env.LOCALCODE_PERMISSION === "PLAN" || env.LOCALCODE_PERMISSION === "AUTO"
      ? env.LOCALCODE_PERMISSION
      : "EDIT";
  return {
    privacy: classifyRepositoryPrivacy(env.LOCALCODE_PRIVACY),
    routingMode,
    permissionMode,
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
    ["PLAN", "EDIT", "AUTO"].includes(record.permissionMode)
  )
    result.permissionMode =
      record.permissionMode as LocalCodeSettings["permissionMode"];
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
 * The first interactive launch should be onboarding, not an empty workspace.
 * A repository is considered configured once both policy decisions have been
 * persisted. Explicit `localcode setup` can still reopen the wizard later.
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
  await writeFile(
    path.join(directory, "config.json"),
    `${JSON.stringify(validSettings(settings), null, 2)}\n`,
    "utf8",
  );
}
