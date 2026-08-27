import { expect, test } from "bun:test";
import {
  compileTaskContract,
  isGreenfieldObjective,
} from "../../src/agent/task-contract.js";

test("compiles explicit facts without inventing a task-specific plan", () => {
  const contract = compileTaskContract({
    id: "contract-1",
    originalRequest:
      "Change the session API in src/session.ts and preserve callers.",
    mode: "coding",
    explicitPaths: ["src/session.ts"],
    constraints: ["Preserve backwards compatibility."],
  });

  expect(contract.id).toBe("contract-1");
  expect(contract.originalRequest).toContain("session API");
  expect(contract.repositoryScope.explicitPaths).toEqual(["src/session.ts"]);
  expect(contract.constraints.map((item) => item.description)).toContain(
    "Preserve backwards compatibility.",
  );
  expect(contract.deliverables).toEqual([
    expect.objectContaining({
      kind: "repository_artifact",
      description: expect.stringContaining("src/session.ts"),
    }),
  ]);
  expect(contract.acceptanceCriteria[0]).toEqual(
    expect.objectContaining({
      id: "criterion-objective",
      description: expect.stringContaining("original objective"),
    }),
  );
  expect(contract.verificationIntent.projectChecks).toBe("not_required");
  expect(
    contract.deliverables.some((item) =>
      /website|html|clock/iu.test(item.description),
    ),
  ).toBe(false);
});

test("keeps explicit verification commands as requirements", () => {
  const contract = compileTaskContract({
    originalRequest: "Run the focused check and repair the failure.",
    mode: "coding",
    verificationCommands: [{ stage: "test", command: "bun test test/auth.ts" }],
  });

  expect(contract.verificationIntent.projectChecks).toBe("required");
  expect(contract.evidenceRequirements).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "verification", required: true }),
    ]),
  );
});

test("preserves an explicit API compatibility constraint from the request", () => {
  const contract = compileTaskContract({
    originalRequest:
      "Add reset, update the tests, and maintain the existing API.",
    mode: "coding",
  });

  expect(contract.constraints).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        source: "user",
        description: "Preserve the existing public API and behavior.",
      }),
    ]),
  );
});

test("classifies generic greenfield intent without naming a domain", () => {
  expect(isGreenfieldObjective("Create a web page")).toBe(true);
  expect(isGreenfieldObjective("Build a new CLI")).toBe(true);
  expect(isGreenfieldObjective("Fix the existing authentication bug")).toBe(
    false,
  );
  expect(isGreenfieldObjective("Update src/auth.ts")).toBe(false);
});

test("compiles explicit artifact content expectations without guessing a plan", () => {
  const contract = compileTaskContract({
    originalRequest:
      "Create a new file named approval-test.txt containing exactly the word approved.",
    mode: "coding",
    explicitPaths: ["approval-test.txt"],
  });

  expect(contract.deliverables[0]?.artifactExpectations).toEqual([
    { type: "exact_text", value: "approved" },
  ]);
});

test("compiles an explicit exported symbol expectation for one source target", () => {
  const contract = compileTaskContract({
    id: "symbol-contract",
    originalRequest:
      "Create src/parser.ts with export function parse and preserve the public API.",
    mode: "coding",
    explicitPaths: ["src/parser.ts"],
  });

  expect(contract.deliverables[0]?.artifactExpectations).toEqual([
    { type: "exported_symbol", value: "parse" },
  ]);
});
