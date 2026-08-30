import { expect, test } from "bun:test";
import {
  ContextCompiler,
  compileContextCapsule,
  inspectContextCapsule,
  validateLegalAction,
  type ContextCapsuleInput,
  type LegalActionDescriptor,
} from "../../src/context/context-capsule.js";

const baseActions: LegalActionDescriptor[] = [
  {
    kind: "repo.search",
    description: "Search the bounded repository scope.",
    risk: "read",
  },
  {
    kind: "repo.read",
    description: "Read one bounded artifact.",
    risk: "read",
  },
  {
    kind: "repo.symbol",
    description: "Inspect one symbol relation.",
    risk: "read",
  },
  {
    kind: "edit.apply",
    description: "Apply one host-validated patch.",
    risk: "write",
    scope: { paths: ["src/parser.ts"] },
  },
  {
    kind: "verify.run",
    description: "Run one selected verifier.",
    risk: "execute",
    scope: { verifierIds: ["focused-tests"] },
  },
  {
    kind: "task.complete",
    description: "Request proof-backed completion.",
    risk: "control",
  },
  {
    kind: "task.blocked",
    description: "Record a typed blocked condition.",
    risk: "control",
  },
];

function input(
  overrides: Partial<ContextCapsuleInput> = {},
): ContextCapsuleInput {
  return {
    task: {
      id: "capsule-task",
      objective: "Fix the parser without changing its public API.",
      currentSubtask: "Inspect parser and focused tests.",
      capabilityLevel: "C2",
      executionProfile: "bounded-coding",
    },
    requirements: {
      acceptanceObligations: [
        {
          id: "parser-fixed",
          statement: "The parser accepts the documented input form.",
          required: true,
          status: "pending",
        },
        {
          id: "focused-green",
          statement: "The focused parser tests pass.",
          required: true,
          status: "pending",
        },
      ],
      constraints: ["Preserve the public API."],
      nonGoals: ["Do not rewrite unrelated modules."],
    },
    state: {
      completedWork: ["Located the parser entry point."],
      currentFailure: null,
      forbiddenRepeats: ["repo.search:parser:src/parser.ts"],
      unresolvedQuestions: ["Which fixture covers escaped input?"],
      verificationState: {
        requiredSatisfied: false,
        passedVerifierIds: [],
        failedVerifierIds: [],
      },
    },
    repository: {
      relevantFiles: ["src/parser.ts", "tests/parser.test.ts"],
      relevantSymbols: [
        { name: "parse", path: "src/parser.ts", line: 12, kind: "function" },
      ],
      relationships: [
        { from: "tests/parser.test.ts", to: "src/parser.ts", kind: "tests" },
      ],
      diagnostics: [],
      changedFiles: [],
      repositoryDigest: "repo-digest-1",
    },
    instructions: {
      trustedProjectInstructions: [
        { source: "AGENTS.md", text: "Run focused tests." },
      ],
      activeSkills: [
        { id: "parser-tests", version: "1", summary: "Parser test workflow." },
      ],
    },
    actions: {
      legalActions: baseActions,
      state: {
        taskStatus: "running",
        capabilityLevel: "C2",
        remainingActions: 4,
        writesAllowed: true,
        executionAllowed: true,
        completionAllowed: false,
      },
    },
    output: { driverSelectedProtocol: "constrained_json" },
    budget: {
      inputTokens: 2_000,
      outputTokens: 300,
      remainingActions: 4,
      wallClockBudgetMs: 10_000,
    },
    ...overrides,
  };
}

test("compiles a deterministic capsule and exposes an inspectable digest", () => {
  const first = compileContextCapsule(input());
  const second = new ContextCompiler().compile(input());

  expect(first).toEqual(second);
  expect(first.digest).toMatch(/^[a-f0-9]{64}$/u);
  expect(first.text).toContain("Fix the parser");
  expect(first.text).toContain("parser-fixed");
  expect(first.text).toContain("repo.search");
  expect(first.text).toContain("constrained_json");
  expect(first.output.schema.properties.type?.enum).toEqual([
    "action",
    "blocked",
  ]);
  expect(inspectContextCapsule(first)).toEqual({
    digest: first.digest,
    estimatedInputTokens: first.estimatedInputTokens,
    legalActionKinds: [
      "repo.search",
      "repo.read",
      "repo.symbol",
      "edit.apply",
      "verify.run",
      "task.blocked",
    ],
    requiredObligationIds: ["parser-fixed", "focused-green"],
    forbiddenRepeats: ["repo.search:parser:src/parser.ts"],
    omittedSections: [],
  });
});

test("rejects tampered derived text or host-owned state", () => {
  const capsule = compileContextCapsule(input());

  expect(() =>
    inspectContextCapsule({ ...capsule, text: `${capsule.text}\nforged` }),
  ).toThrow(/integrity|derived text/i);
  expect(() =>
    inspectContextCapsule({
      ...capsule,
      state: { ...capsule.state, currentFailure: "forged" },
    }),
  ).toThrow(/digest|integrity/i);
});

test("derives legal actions from capability, state and authority", () => {
  const reader = compileContextCapsule(
    input({
      task: { ...input().task, capabilityLevel: "C1" },
      actions: {
        legalActions: baseActions,
        state: {
          taskStatus: "running",
          capabilityLevel: "C1",
          remainingActions: 2,
          writesAllowed: false,
          executionAllowed: false,
          completionAllowed: false,
        },
      },
    }),
  );

  expect(reader.actions.legalActions.map((action) => action.kind)).toEqual([
    "repo.search",
    "repo.read",
    "repo.symbol",
    "task.blocked",
  ]);
  expect(reader.text).not.toContain("edit.apply");
  expect(reader.text).not.toContain("verify.run");
  expect(reader.text).not.toContain("task.complete");

  const completed = compileContextCapsule(
    input({
      state: {
        ...input().state,
        verificationState: { requiredSatisfied: true },
      },
      requirements: {
        ...input().requirements,
        acceptanceObligations: input().requirements.acceptanceObligations.map(
          (obligation) => ({ ...obligation, status: "satisfied" as const }),
        ),
      },
      actions: {
        legalActions: baseActions,
        state: {
          taskStatus: "running",
          capabilityLevel: "C2",
          remainingActions: 2,
          writesAllowed: true,
          executionAllowed: true,
          completionAllowed: true,
        },
      },
    }),
  );
  expect(completed.actions.legalActions.map((action) => action.kind)).toContain(
    "task.complete",
  );
});

test("fails closed for terminal state, capability disagreement, and empty proof obligations", () => {
  for (const taskStatus of [
    "blocked",
    "failed",
    "completed",
    "cancelled",
  ] as const) {
    const capsule = compileContextCapsule(
      input({
        task: { ...input().task, capabilityLevel: "C2" },
        actions: {
          legalActions: baseActions,
          state: {
            ...input().actions.state,
            taskStatus,
          },
        },
      }),
    );
    expect(capsule.actions.legalActions).toEqual([]);
    expect(capsule.output.schema.properties.type?.enum).toEqual([]);
  }

  expect(() =>
    compileContextCapsule(
      input({
        task: { ...input().task, capabilityLevel: "C0" },
      }),
    ),
  ).toThrow(/capabilityLevel.*match/i);

  const noObligations = compileContextCapsule(
    input({
      requirements: { acceptanceObligations: [] },
      state: {
        ...input().state,
        verificationState: { requiredSatisfied: true },
      },
      actions: {
        legalActions: baseActions,
        state: {
          ...input().actions.state,
          completionAllowed: true,
        },
      },
    }),
  );
  expect(
    noObligations.actions.legalActions.map((action) => action.kind),
  ).not.toContain("task.complete");
});

test("keeps required obligations and forbidden repeats while bounding optional context", () => {
  const capsule = compileContextCapsule(
    input({
      repository: {
        ...input().repository,
        relevantFiles: ["src/parser.ts", "x".repeat(20_000)],
        diagnostics: [{ file: "src/parser.ts", message: "d".repeat(20_000) }],
      },
      instructions: {
        trustedProjectInstructions: [
          { source: "AGENTS.md", text: "trusted".repeat(20_000) },
        ],
        activeSkills: [
          { id: "large", version: "1", summary: "skill".repeat(20_000) },
        ],
      },
      budget: {
        inputTokens: 500,
        outputTokens: 100,
        remainingActions: 4,
        wallClockBudgetMs: 1_000,
      },
    }),
  );

  expect(capsule.estimatedInputTokens).toBeLessThanOrEqual(500);
  expect(capsule.text).toContain("parser-fixed");
  expect(capsule.text).toContain("focused-green");
  expect(capsule.text).toContain("repo.search:parser:src/parser.ts");
  expect(capsule.omittedSections.length).toBeGreaterThan(0);
  expect(capsule.text).not.toContain("x".repeat(1_000));
});

test("does not expose illegal action schemas and validates bounded action arguments", () => {
  const capsule = compileContextCapsule(
    input({
      task: { ...input().task, capabilityLevel: "C1" },
      actions: {
        legalActions: baseActions,
        state: {
          taskStatus: "running",
          capabilityLevel: "C1",
          remainingActions: 0,
          writesAllowed: false,
          executionAllowed: false,
          completionAllowed: false,
        },
      },
    }),
  );

  expect(capsule.actions.legalActions.map((action) => action.kind)).toEqual([
    "task.blocked",
  ]);
  expect(
    validateLegalAction(
      { kind: "task.blocked", reason: "No progress" },
      capsule.actions.legalActions,
    ),
  ).toEqual({ valid: true });
  expect(
    validateLegalAction(
      { kind: "repo.read", path: "src/parser.ts" },
      capsule.actions.legalActions,
    ).valid,
  ).toBe(false);
  expect(
    validateLegalAction({ kind: "repo.search", query: "parse" }, baseActions)
      .valid,
  ).toBe(true);
  const constrainedSearch: LegalActionDescriptor = {
    kind: "repo.search",
    description: "Constrained search.",
    risk: "read",
    schema: {
      type: "object" as const,
      properties: {
        query: { type: "string" as const, enum: ["only-this"] },
      },
      required: ["query"],
      additionalProperties: false as const,
    },
  };
  expect(
    validateLegalAction({ kind: "repo.search", query: "anything" }, [
      constrainedSearch,
    ]).valid,
  ).toBe(false);
  expect(
    validateLegalAction({ kind: "repo.search", query: "only-this" }, [
      constrainedSearch,
    ]).valid,
  ).toBe(true);
  expect(
    validateLegalAction({ kind: "repo.read", path: "../secret" }, baseActions)
      .valid,
  ).toBe(false);
  expect(
    validateLegalAction(
      {
        kind: "edit.apply",
        patch: {
          path: "src/parser.ts",
          expectedBeforeDigest: "not-a-digest",
          operations: [],
        },
      },
      baseActions,
    ).valid,
  ).toBe(false);
  expect(
    validateLegalAction(
      { kind: "task.blocked", reason: "No progress", forged: true },
      capsule.actions.legalActions,
    ).valid,
  ).toBe(false);
});

test("rejects invalid budgets and preserves obligations across a later capsule", () => {
  expect(() =>
    compileContextCapsule(
      input({
        budget: {
          inputTokens: 255,
          outputTokens: 100,
          remainingActions: 1,
          wallClockBudgetMs: 1_000,
        },
      }),
    ),
  ).toThrow(/inputTokens/i);

  const later = compileContextCapsule(
    input({
      requirements: {
        ...input().requirements,
        acceptanceObligations: input().requirements.acceptanceObligations.map(
          (obligation) => ({ ...obligation, status: "satisfied" as const }),
        ),
      },
      state: {
        ...input().state,
        completedWork: ["Parser change applied."],
        verificationState: { requiredSatisfied: true },
      },
      actions: {
        legalActions: baseActions,
        state: {
          taskStatus: "running",
          capabilityLevel: "C2",
          remainingActions: 2,
          writesAllowed: true,
          executionAllowed: true,
          completionAllowed: true,
        },
      },
    }),
  );
  expect(later.requirements.acceptanceObligations.map(({ id }) => id)).toEqual([
    "parser-fixed",
    "focused-green",
  ]);
  expect(later.actions.legalActions.map((action) => action.kind)).toContain(
    "task.complete",
  );
});
