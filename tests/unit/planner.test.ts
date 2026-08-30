import { expect, test } from "bun:test";
import {
  appendPlanProposal,
  createMonotonicPlan,
  normalizeAppendOnlyRecoveryPlanProposal,
  normalizeRecoveryPlanProposal,
  parsePlanProposal,
  validatePlanProposal,
  type PlanProposal,
} from "../../src/agent/planner.js";

const context = {
  objective: "Update the session flow.",
  mode: "coding" as const,
  allowedTools: ["ReadFile", "EditFile", "RunTests"],
  workspaceRoot: "C:/workspace",
};

function proposal(overrides: Partial<PlanProposal> = {}): PlanProposal {
  return {
    schemaVersion: 1,
    proposalId: "proposal-1",
    objective: context.objective,
    nodes: [
      {
        id: "inspect",
        objective: "Inspect the current session implementation.",
        dependencies: [],
        scope: {
          candidateFiles: ["src/session.ts"],
          allowedTools: ["ReadFile"],
        },
        requiredEvidence: ["current session implementation"],
        acceptance: ["The current behavior is understood."],
      },
      {
        id: "change",
        objective: "Apply the smallest compatible session change.",
        dependencies: ["inspect"],
        scope: {
          candidateFiles: ["src/session.ts"],
          allowedTools: ["EditFile"],
        },
        requiredEvidence: ["fresh session source"],
        acceptance: ["The requested behavior is implemented."],
      },
    ],
    ...overrides,
  };
}

test("accepts a model plan and appends a monotonic revision", () => {
  const initial = createMonotonicPlan(context.objective);
  const result = appendPlanProposal(initial, proposal(), context);

  expect(result.plan.revision).toBe(1);
  expect(result.plan.nodes.map((node) => node.id)).toEqual([
    "inspect",
    "change",
  ]);
  expect(result.plan.nodes[0]?.source).toBe("model");
  expect(result.plan.revisions[0]).toEqual(
    expect.objectContaining({
      source: "llm",
      proposalId: "proposal-1",
      addedNodeIds: ["inspect", "change"],
    }),
  );
  expect(result.plan.currentNodeId).toBe("inspect");
});

test("keeps plan-level acceptance and unlocks dependent nodes monotonically", () => {
  const result = appendPlanProposal(
    createMonotonicPlan(context.objective),
    proposal({
      acceptanceCriteria: ["The session behavior is understood."],
      evidenceRequirements: ["Fresh session source is recorded."],
      constraints: ["Keep the public API stable."],
    }),
    context,
  );

  expect(result.plan.acceptanceCriteria).toEqual([
    "The session behavior is understood.",
  ]);
  expect(result.plan.evidenceRequirements).toEqual([
    "Fresh session source is recorded.",
  ]);
  expect(result.plan.constraints).toEqual(["Keep the public API stable."]);
  expect(result.plan.nodes[1]?.status).toBe("pending");

  result.plan.nodes[0]!.status = "verified";
  const next = appendPlanProposal(
    result.plan,
    proposal({
      proposalId: "proposal-2",
      nodes: [
        {
          id: "verify-session",
          objective: "Verify the session behavior after inspection.",
          dependencies: ["inspect"],
          scope: {
            candidateFiles: ["tests/session.test.ts"],
            allowedTools: ["RunTests"],
          },
        },
      ],
    }),
    context,
  );

  expect(next.plan.nodes.find((node) => node.id === "change")?.status).toBe(
    "ready",
  );
  expect(next.plan.currentNodeId).toBe("change");
  expect(next.plan.nodes.map((node) => node.id)).toEqual([
    "inspect",
    "change",
    "verify-session",
  ]);
});

test("replanning preserves old nodes and records explicit supersession", () => {
  const first = appendPlanProposal(
    createMonotonicPlan(context.objective),
    proposal(),
    context,
  ).plan;
  const second = appendPlanProposal(
    first,
    proposal({
      proposalId: "proposal-2",
      nodes: [
        {
          id: "repair-session",
          objective:
            "Repair the session change using the new failure evidence.",
          dependencies: ["inspect"],
          scope: {
            candidateFiles: ["src/session.ts"],
            allowedTools: ["EditFile"],
          },
          requiredEvidence: ["latest failure evidence"],
          acceptance: ["The failing behavior is repaired."],
        },
      ],
      supersedes: ["change"],
    }),
    context,
  ).plan;

  expect(second.revision).toBe(2);
  expect(second.nodes.map((node) => node.id)).toEqual([
    "inspect",
    "change",
    "repair-session",
  ]);
  expect(second.nodes.find((node) => node.id === "change")?.status).toBe(
    "superseded",
  );
  expect(second.revisions[1]).toEqual(
    expect.objectContaining({
      source: "llm",
      supersededNodeIds: ["change"],
    }),
  );
});

test("accepts an explicit recovery that changes the semantic scope", () => {
  const result = normalizeRecoveryPlanProposal(
    {
      schemaVersion: 1,
      proposalId: "recovery-different-scope",
      objective: context.objective,
      supersedes: ["inspect-source"],
      nodes: [
        {
          id: "inspect-test",
          objective: "Inspect the related regression test before editing.",
          dependencies: [],
          kind: "workspace",
          scope: {
            candidateFiles: ["tests/session.test.ts"],
            allowedTools: ["ReadFile"],
          },
        },
      ],
    },
    [
      {
        id: "inspect-source",
        objective: "Inspect the current session implementation.",
        dependencies: [],
        kind: "workspace",
        scope: {
          candidateFiles: ["src/session.ts"],
          allowedTools: ["ReadFile"],
        },
      },
    ],
    "inspect-source",
  );

  expect(result.inferred).toBe(false);
  expect(result.proposal?.supersedes).toEqual(["inspect-source"]);
  expect(result.proposal?.nodes.map((node) => node.id)).toEqual([
    "inspect-test",
  ]);
});

test("keeps a full-snapshot recovery monotonic when the LLM changes existing nodes", () => {
  const result = normalizeRecoveryPlanProposal(
    {
      schemaVersion: 1,
      proposalId: "recovery-full-snapshot",
      objective: context.objective,
      supersedes: ["inspect-source"],
      nodes: [
        {
          id: "inspect-source",
          objective: "Inspect the related session regression test instead.",
          dependencies: [],
          kind: "workspace",
          scope: {
            candidateFiles: ["tests/session.test.ts"],
            allowedTools: ["ReadFile"],
          },
        },
        {
          id: "change",
          objective: "Apply the revised compatible session change.",
          dependencies: ["inspect-source"],
          kind: "workspace",
          scope: {
            candidateFiles: ["src/session.ts"],
            allowedTools: ["EditFile"],
          },
        },
      ],
    },
    [
      {
        id: "inspect-source",
        objective: "Inspect the current session implementation.",
        dependencies: [],
        kind: "workspace",
        scope: {
          candidateFiles: ["src/session.ts"],
          allowedTools: ["ReadFile"],
        },
      },
      {
        id: "change",
        objective: "Apply the smallest compatible session change.",
        dependencies: ["inspect-source"],
        kind: "workspace",
        scope: {
          candidateFiles: ["src/session.ts"],
          allowedTools: ["EditFile"],
        },
      },
    ],
    "inspect-source",
  );

  expect(result.proposal).toBeDefined();
  expect(result.proposal?.supersedes).toEqual(["inspect-source", "change"]);
  expect(result.proposal?.nodes.map((node) => node.id)).toEqual([
    "inspect-source-recovery-1",
    "change-recovery-2",
  ]);
  expect(result.proposal?.nodes[1]?.dependencies).toEqual([
    "inspect-source-recovery-1",
  ]);
});

test("filters repeated full-plan nodes when recovery has no single failed node", () => {
  const result = normalizeAppendOnlyRecoveryPlanProposal(
    {
      schemaVersion: 1,
      proposalId: "recovery-echo-with-continuation",
      objective: context.objective,
      nodes: [
        {
          id: "inspect",
          objective: "Inspect the current session implementation.",
          dependencies: [],
          kind: "workspace",
          scope: {
            candidateFiles: ["src/session.ts"],
            allowedTools: ["ReadFile"],
          },
        },
        {
          id: "change",
          objective: "Apply the smallest compatible session change.",
          dependencies: ["inspect"],
          kind: "workspace",
          scope: {
            candidateFiles: ["src/session.ts"],
            allowedTools: ["EditFile"],
          },
        },
        {
          id: "verify-recovery",
          objective: "Verify the session behavior after the change.",
          dependencies: ["change"],
          kind: "workspace",
          scope: {
            candidateFiles: ["tests/session.test.ts"],
            allowedTools: ["RunTests"],
          },
        },
      ],
    },
    [
      {
        id: "inspect",
        objective: "Inspect the current session implementation.",
        dependencies: [],
        kind: "workspace",
        scope: {
          candidateFiles: ["src/session.ts"],
          allowedTools: ["ReadFile"],
        },
      },
      {
        id: "change",
        objective: "Apply the smallest compatible session change.",
        dependencies: ["inspect"],
        kind: "workspace",
        scope: {
          candidateFiles: ["src/session.ts"],
          allowedTools: ["EditFile"],
        },
      },
    ],
  );

  expect(result.proposal).toBeDefined();
  expect(result.proposal?.nodes.map((node) => node.id)).toEqual([
    "verify-recovery",
  ]);
  expect(result.proposal?.nodes[0]?.dependencies).toEqual(["change"]);
  expect(result.proposal?.supersedes).toBeUndefined();
});

test("requires explicit supersession when a recovery changes an existing node", () => {
  const result = normalizeAppendOnlyRecoveryPlanProposal(
    {
      schemaVersion: 1,
      proposalId: "recovery-changed-without-bookkeeping",
      objective: context.objective,
      nodes: [
        {
          id: "inspect",
          objective: "Inspect a different session file.",
          dependencies: [],
          kind: "workspace",
          scope: {
            candidateFiles: ["tests/session.test.ts"],
            allowedTools: ["ReadFile"],
          },
        },
        {
          id: "new-step",
          objective: "Continue with the revised evidence.",
          dependencies: ["inspect"],
          kind: "semantic",
          scope: { candidateFiles: [], allowedTools: [] },
        },
      ],
    },
    [
      {
        id: "inspect",
        objective: "Inspect the current session implementation.",
        dependencies: [],
        kind: "workspace",
        scope: {
          candidateFiles: ["src/session.ts"],
          allowedTools: ["ReadFile"],
        },
      },
    ],
  );

  expect(result.proposal).toBeUndefined();
  expect(result.reason).toMatch(/explicitly list.*supersedes/i);
});

test("rejects cycles, outside-workspace paths and illegal read-only writes", () => {
  const cycle = proposal({
    nodes: [
      { id: "a", objective: "A", dependencies: ["b"] },
      { id: "b", objective: "B", dependencies: ["a"] },
    ],
  });
  expect(validatePlanProposal(cycle, context).errors.join(" ")).toMatch(
    /cycle/i,
  );

  const outside = proposal({
    nodes: [
      {
        id: "unsafe",
        objective: "Touch an outside file.",
        dependencies: [],
        scope: {
          candidateFiles: ["../secrets.txt"],
          allowedTools: ["EditFile"],
        },
      },
    ],
  });
  expect(validatePlanProposal(outside, context).errors.join(" ")).toMatch(
    /workspace|outside/i,
  );

  const readOnly = validatePlanProposal(
    proposal({
      nodes: [
        {
          id: "write",
          objective: "Write during a read-only plan.",
          dependencies: [],
          scope: { allowedTools: ["EditFile"] },
        },
      ],
    }),
    { ...context, mode: "plan" },
  );
  expect(readOnly.errors.join(" ")).toMatch(/read-only|mutation|write/i);
});

test("allows execution-only verification nodes without a file mutation scope", () => {
  const verification = proposal({
    nodes: [
      {
        id: "verify-runtime",
        objective: "Run the narrowest runtime smoke check for the change.",
        dependencies: [],
        scope: { allowedTools: ["RunTests"] },
        acceptance: ["The runtime check completes successfully."],
      },
    ],
  });

  expect(validatePlanProposal(verification, context).errors).toEqual([]);
});

test("rejects a workspace node that has no executable tool scope", () => {
  const invalid = proposal({
    nodes: [
      {
        id: "implement",
        objective: "Implement the requested change.",
        dependencies: [],
        kind: "workspace",
        scope: {
          candidateFiles: ["src/session.ts"],
          allowedTools: [],
        },
      },
    ],
  });

  expect(validatePlanProposal(invalid, context).errors.join(" ")).toMatch(
    /workspace node.*allowed workspace tool/i,
  );
});

test("keeps repository work out of semantic nodes and requires mutation for a fresh coding plan", () => {
  const invalidSemantic = proposal({
    nodes: [
      {
        id: "generate-readme",
        objective: "Generate README.md from the repository manifests.",
        kind: "semantic",
        dependencies: [],
        scope: { candidateFiles: ["README.md"], allowedTools: [] },
      },
    ],
  });

  const result = validatePlanProposal(invalidSemantic, {
    ...context,
    requireWorkspaceMutation: true,
  });

  // The keyword-mention is a warning now (structural emptiness of a
  // semantic node's tools/scope is the real safety guarantee), but an
  // all-semantic plan with zero real workspace nodes still hard-fails the
  // "must include a mutation path" requirement.
  expect(result.warnings.join(" ")).toMatch(
    /semantic node.*mentions a mutation-like word/i,
  );
  expect(result.errors.join(" ")).toMatch(
    /at least one workspace node.*mutation tool/i,
  );
});

test("keeps valid array entries instead of discarding the whole array when one entry has the wrong type", () => {
  const parsed = parsePlanProposal({
    schemaVersion: 1,
    proposalId: "proposal-mixed-types",
    objective: "Implement the counter app.",
    nodes: [
      {
        id: "implement-counter-app",
        objective: "Create the counter app entry point.",
        // A small local model occasionally emits a stray non-string element
        // (here an object instead of a plain path). That must not silently
        // wipe out the otherwise-valid candidateFiles/dependencies arrays.
        dependencies: ["scaffold", { not: "a string" }],
        kind: "workspace",
        scope: {
          candidateFiles: ["index.html", 42],
          allowedTools: ["CreateFile"],
        },
      },
    ],
  });

  expect(parsed?.nodes[0]?.dependencies).toEqual(["scaffold"]);
  expect(parsed?.nodes[0]?.scope?.candidateFiles).toEqual(["index.html"]);
});

test("coerces a bare string into a one-element array for candidateFiles/allowedTools", () => {
  const parsed = parsePlanProposal({
    schemaVersion: 1,
    proposalId: "proposal-bare-string-scope",
    objective: "Implement the counter app.",
    nodes: [
      {
        id: "implement-counter-app",
        objective: "Create the counter app entry point.",
        dependencies: [],
        kind: "workspace",
        // A model not under strict grammar-constrained decoding sometimes
        // emits a single-item list as a bare string instead of a
        // one-element array.
        scope: {
          candidateFiles: "index.html",
          allowedTools: "CreateFile",
        },
      },
    ],
  });

  expect(parsed?.nodes[0]?.scope?.candidateFiles).toEqual(["index.html"]);
  expect(parsed?.nodes[0]?.scope?.allowedTools).toEqual(["CreateFile"]);
});

test("accepts a semantic node that reasons about validation over already-supplied evidence, with only a warning", () => {
  const validated = proposal({
    nodes: [
      {
        id: "validate-app",
        objective:
          "Validate that the implementation satisfies the acceptance criteria already supplied as evidence.",
        kind: "semantic",
        dependencies: [],
        scope: { candidateFiles: [], allowedTools: [] },
      },
    ],
  });

  const result = validatePlanProposal(validated, context);

  expect(result.valid).toBe(true);
  expect(result.errors).toEqual([]);
  expect(result.warnings.join(" ")).toMatch(/validate-app.*observation-like/i);
});

test("accepts a semantic node that describes an unambiguous repository read, with only a warning", () => {
  // Free-text keyword matching cannot distinguish a genuinely mislabeled
  // node from one whose objective merely mentions what a LATER node will
  // read (e.g. "based on what reading the entry point reveals, decide...").
  // The structural guarantee (empty tools/scope) is what actually prevents
  // a semantic node from touching the workspace, so this is a warning.
  const proposalWithRead = proposal({
    nodes: [
      {
        id: "read-and-summarize",
        objective: "Read src/auth.ts and summarize the login flow.",
        kind: "semantic",
        dependencies: [],
        scope: { candidateFiles: [], allowedTools: [] },
      },
    ],
  });

  const result = validatePlanProposal(proposalWithRead, context);

  expect(result.valid).toBe(true);
  expect(result.errors).toEqual([]);
  expect(result.warnings.join(" ")).toMatch(
    /read-and-summarize.*repository-observation word/i,
  );
});

test("accepts an initial plan that only investigates first, deferring the mutation node to the next revision", () => {
  // A model naturally wants to inspect the entry point before deciding what
  // to change; the very first proposal for a coding task should not be
  // forced to already commit to a mutation target before it has read
  // anything.
  const investigateFirst = proposal({
    nodes: [
      {
        id: "inspect-entry-point",
        objective:
          "Inspect the entry point to determine how the counter feature should be added.",
        kind: "workspace",
        dependencies: [],
        scope: { candidateFiles: ["index.html"], allowedTools: ["ReadFile"] },
      },
    ],
  });

  const result = validatePlanProposal(investigateFirst, {
    ...context,
    requireWorkspaceMutation: true,
  });

  expect(result.valid).toBe(true);
  expect(result.errors).toEqual([]);
  expect(result.warnings.join(" ")).toMatch(
    /at least one workspace node.*mutation tool/i,
  );
});

test("still hard-rejects a plan with no real workspace node at all when a mutation is required", () => {
  const allSemantic = proposal({
    nodes: [
      {
        id: "think-about-it",
        objective: "Decide the best approach for the counter feature.",
        kind: "semantic",
        dependencies: [],
        scope: { candidateFiles: [], allowedTools: [] },
      },
    ],
  });

  const result = validatePlanProposal(allSemantic, {
    ...context,
    requireWorkspaceMutation: true,
  });

  expect(result.valid).toBe(false);
  expect(result.errors.join(" ")).toMatch(
    /at least one workspace node.*mutation tool/i,
  );
});

test("still hard-rejects a continuation plan (existing nodes present) that never adds a mutation node", () => {
  const stillNoMutation = proposal({
    nodes: [
      {
        id: "inspect-again",
        objective: "Inspect another file before deciding.",
        kind: "workspace",
        dependencies: [],
        scope: { candidateFiles: ["style.css"], allowedTools: ["ReadFile"] },
      },
    ],
  });

  const result = validatePlanProposal(stillNoMutation, {
    ...context,
    requireWorkspaceMutation: true,
    existingNodes: [{ id: "inspect-entry-point", dependencies: [] }],
  });

  expect(result.valid).toBe(false);
  expect(result.errors.join(" ")).toMatch(
    /at least one workspace node.*mutation tool/i,
  );
});
