import { expect, test } from "bun:test";
import {
  addPermissionGrant,
  createPermissionGrant,
  isPermissionGrantPersistable,
  permissionGrantFamily,
  permissionGrantScopeDescription,
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

test("session and project file permissions cover the whole safe file operation family", () => {
  const grant = createPermissionGrant("session", {
    risk: "write",
    tool: "EditFile",
    path: "src/app.ts",
  });

  expect(permissionGrantFamily({ tool: "EditFile", risk: "write" })).toBe(
    "workspace-write",
  );
  expect(grant.family).toBe("workspace-write");
  expect(
    matchesPermissionGrant(grant, {
      risk: "write",
      tool: "CreateFile",
      path: "src/new.ts",
    }),
  ).toBe(true);
  expect(
    matchesPermissionGrant(grant, {
      risk: "write",
      tool: "WriteFile",
      path: "src/other.ts",
    }),
  ).toBe(true);
  expect(
    matchesPermissionGrant(grant, {
      risk: "destructive",
      tool: "DeleteFile",
      path: "src/other.ts",
    }),
  ).toBe(false);
  expect(
    matchesPermissionGrant(grant, {
      risk: "execute",
      tool: "Shell",
      command: "git status",
    }),
  ).toBe(false);
});

test("file-family grants remain deduplicated across CreateFile, WriteFile and EditFile", () => {
  const grants = [
    createPermissionGrant("project", {
      risk: "write",
      tool: "CreateFile",
      path: "a.ts",
    }),
    createPermissionGrant("project", {
      risk: "write",
      tool: "EditFile",
      path: "b.ts",
    }),
  ];

  expect(addPermissionGrant([], grants[0]!)).toHaveLength(1);
  expect(addPermissionGrant([grants[0]!], grants[1]!)).toHaveLength(1);
});

test("legacy file grants widen to the safe family when they have no exact scope", () => {
  const legacyGrant: PermissionGrant = {
    id: "legacy-edit-grant",
    scope: "project",
    tool: "EditFile",
    risk: "write",
    createdAt: "2026-08-25T00:00:00.000Z",
  };

  expect(
    matchesPermissionGrant(legacyGrant, {
      risk: "write",
      tool: "CreateFile",
      path: "src/new.ts",
    }),
  ).toBe(true);
});

test("approval copy exposes the real persistence scope", () => {
  expect(
    permissionGrantScopeDescription({ tool: "EditFile", risk: "write" }),
  ).toBe("workspace file writes");
  expect(
    permissionGrantScopeDescription({ tool: "ReadFile", risk: "read" }),
  ).toBe("workspace reads");
  expect(
    permissionGrantScopeDescription({
      tool: "Shell",
      risk: "execute",
      command: "bun test",
    }),
  ).toBe("this exact command");
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
