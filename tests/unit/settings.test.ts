import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  hasRepositorySetup,
  persistRepositorySettings,
  readRepositorySettings,
} from "../../src/config/settings.js";
import { readSettings } from "../../src/config/settings.js";
import { createPermissionGrant } from "../../src/tools/permission-grants.js";

test("interactive ASK is the default and explicit modes remain selectable", () => {
  expect(readSettings({}).permissionMode).toBe("ASK");
  expect(readSettings({ LOCALCODE_PERMISSION: "EDIT" }).permissionMode).toBe(
    "EDIT",
  );
  expect(readSettings({ LOCALCODE_PERMISSION: "PLAN" }).permissionMode).toBe(
    "PLAN",
  );
});

test("repository settings are validated and persisted separately from global state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-settings-"));
  await persistRepositorySettings(root, {
    privacy: "local_only",
    routingMode: "strict-zero",
    permissionMode: "EDIT",
  });
  expect(await readRepositorySettings(root)).toEqual({
    privacy: "local_only",
    routingMode: "strict-zero",
    permissionMode: "EDIT",
  });
});

test("permission rules survive later settings updates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-permissions-"));
  const grant = createPermissionGrant("project", {
    tool: "Shell",
    risk: "execute",
    command: "bun test tests/unit/foo.test.ts",
  });

  await persistRepositorySettings(root, {
    permissionRules: [grant],
  });
  await persistRepositorySettings(root, { permissionMode: "EDIT" });

  expect(await readRepositorySettings(root)).toMatchObject({
    permissionMode: "EDIT",
    permissionRules: [grant],
  });
});

test("project settings discard session-scoped and secret-shaped grants", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-rule-scope-"));
  const sessionGrant = createPermissionGrant("session", {
    tool: "EditFile",
    risk: "write",
    path: "src/app.ts",
  });
  const secretGrant = createPermissionGrant("project", {
    tool: "Shell",
    risk: "execute",
    command: "node -e \"const api_key='12345678901234567890'\"",
  });

  await persistRepositorySettings(root, {
    permissionRules: [sessionGrant, secretGrant],
  });

  expect((await readRepositorySettings(root)).permissionRules).toEqual([]);
});

test("workspace setup is complete only after both policies exist", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-onboarding-"));
  expect(await hasRepositorySetup(root)).toBe(false);

  await persistRepositorySettings(root, { privacy: "private" });
  expect(await hasRepositorySetup(root)).toBe(false);

  await persistRepositorySettings(root, {
    privacy: "private",
    routingMode: "strict-zero",
  });
  expect(await hasRepositorySetup(root)).toBe(true);
});
