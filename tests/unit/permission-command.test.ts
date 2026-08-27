import { expect, test } from "bun:test";
import { parsePermissionsCommand } from "../../src/tui/commands/permissions.js";

test("parses the canonical permissions command and safe authorization scopes", () => {
  expect(parsePermissionsCommand("/permissions")).toEqual({
    kind: "open",
  });
  expect(parsePermissionsCommand("/permissions authorize session reads")).toEqual(
    {
      kind: "authorize",
      scope: "session",
      family: "workspace-read",
    },
  );
  expect(parsePermissionsCommand("/permissions allow project writes")).toEqual({
    kind: "authorize",
    scope: "project",
    family: "workspace-write",
  });
});

test("does not turn arbitrary shell text into a broad permission rule", () => {
  expect(parsePermissionsCommand("/permissions authorize project shell")).toEqual(
    {
      kind: "usage",
    },
  );
  expect(parsePermissionsCommand("/permissions authorize project")).toEqual({
    kind: "usage",
  });
  expect(parsePermissionsCommand("/permiss authorize project writes")).toBe(
    undefined,
  );
});

test("parses revocation and clearing operations", () => {
  expect(parsePermissionsCommand("/permissions revoke grant-123")).toEqual({
    kind: "revoke",
    id: "grant-123",
  });
  expect(parsePermissionsCommand("/permissions clear")).toEqual({
    kind: "clear",
  });
});
