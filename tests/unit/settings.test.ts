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
