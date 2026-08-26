import { expect, test } from "bun:test";
import {
  addPermissionGrant,
  createPermissionGrant,
  isPermissionGrantPersistable,
  matchesPermissionGrant,
  parsePermissionGrants,
  redactPermissionCommand,
  removePermissionGrant,
  serializePermissionGrants,
  type PermissionGrant,
} from "../../src/tools/permission-grants.js";

const editFile = {
  description: "Edit workspace file: src/app.ts",
  risk: "write" as const,
  tool: "EditFile",
  path: "src\\app.ts",
};

test("project grants match the selected tool and preserve a safe scope", () => {
  const grant = createPermissionGrant(
    "project",
    editFile,
    "2026-08-26T00:00:00.000Z",
  );

  expect(grant).toMatchObject({
    scope: "project",
    tool: "EditFile",
    risk: "write",
  });
  expect(grant.path).toBeUndefined();
  expect(
    matchesPermissionGrant(grant, {
      ...editFile,
      path: "src/other.ts",
    }),
  ).toBe(true);
  expect(
    addPermissionGrant(
      [grant],
      createPermissionGrant("project", {
        ...editFile,
        path: "src/another.ts",
      }),
    ),
  ).toHaveLength(1);
  expect(
    matchesPermissionGrant(grant, {
      ...editFile,
      tool: "DeleteFile",
      risk: "destructive",
    }),
  ).toBe(false);
});

test("shell grants remain exact-command grants", () => {
  const grant = createPermissionGrant("session", {
    risk: "execute",
    tool: "Shell",
    command: "  bun   test tests/unit/foo.test.ts  ",
  });

  expect(grant.command).toBe("bun test tests/unit/foo.test.ts");
  expect(
    matchesPermissionGrant(grant, {
      risk: "execute",
      tool: "Shell",
      command: "bun test tests/unit/foo.test.ts",
    }),
  ).toBe(true);
  expect(
    matchesPermissionGrant(grant, {
      risk: "execute",
      tool: "Shell",
      command: "bun test tests/unit/other.test.ts",
    }),
  ).toBe(false);
});

test("grant storage is bounded, deduplicated and rejects malformed rules", () => {
  const first = createPermissionGrant(
    "project",
    editFile,
    "2026-08-26T00:00:00.000Z",
  );
  const duplicate = createPermissionGrant(
    "project",
    editFile,
    "2026-08-27T00:00:00.000Z",
  );
  const stored = addPermissionGrant(addPermissionGrant([], first), duplicate);

  expect(stored).toHaveLength(1);
  const decoded = parsePermissionGrants(serializePermissionGrants(stored));
  expect(decoded).toEqual(stored);
  expect(parsePermissionGrants('{"not":"a rule list"}')).toEqual([]);
  expect(
    parsePermissionGrants(
      JSON.stringify([
        { id: "bad", scope: "project", tool: "EditFile", risk: "unknown" },
        first,
      ]),
    ),
  ).toEqual([first]);
});

test("removing a persisted grant does not affect the original collection", () => {
  const grant: PermissionGrant = createPermissionGrant("project", editFile);
  const grants = [grant];

  expect(removePermissionGrant(grants, grant.id)).toEqual([]);
  expect(grants).toEqual([grant]);
});

test("secret-shaped commands are never serialized as persistent rules", () => {
  const grant = createPermissionGrant("project", {
    tool: "Shell",
    risk: "execute",
    command: "node -e \"const api_key='12345678901234567890'\"",
  });

  expect(isPermissionGrantPersistable(grant)).toBe(false);
  expect(addPermissionGrant([], grant)).toEqual([]);
  expect(parsePermissionGrants([grant])).toEqual([]);
  expect(serializePermissionGrants([grant])).toBe("[]");
  expect(redactPermissionCommand(grant.command ?? "")).toBe(
    "[redacted secret-shaped command]",
  );
});
