import { expect, test } from "bun:test";
import {
  appendPlanProposal,
  createMonotonicPlan,
  normalizeAppendOnlyRecoveryPlanProposal,
  normalizeRecoveryPlanProposal,
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

  const errors = validatePlanProposal(invalidSemantic, {
    ...context,
    requireWorkspaceMutation: true,
  }).errors.join(" ");

  expect(errors).toMatch(/semantic node.*workspace observation or mutation/i);
  expect(errors).toMatch(/at least one workspace node.*mutation tool/i);
});
