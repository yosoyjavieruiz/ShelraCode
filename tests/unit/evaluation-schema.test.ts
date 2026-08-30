import { expect, test } from "bun:test";
import {
  digestPublicEvaluationCase,
  parsePublicEvaluationCase,
  toModelVisibleEvaluationInput,
} from "../../src/evals/schema.js";

test("model-visible evaluation input excludes the protected acceptance reference", () => {
  const evaluationCase = parsePublicEvaluationCase({
    schemaVersion: 1,
    caseId: "local-greeting-repair",
    revision: "v1",
    title: "Repair a greeting",
    family: "micro",
    capabilityTarget: "C2",
    origin: "local_real",
    workspaceFixture: {
      source: "fixture:greeting-v1",
      digest: "a".repeat(64),
    },
    objective: "Repair the greeting behavior and verify it.",
    policy: {
      writeAuthority: "bounded",
      networkAuthority: "none",
      commandPolicy: "fixture_verifiers_only",
    },
    budgets: {
      actions: 16,
      inputTokens: null,
      outputTokens: 512,
      wallClockMs: 300_000,
    },
    visibleAcceptance: [
      {
        id: "behavior",
        statement: "The public greeting behavior is repaired.",
        type: "behavioral",
        required: true,
      },
    ],
    protectedAcceptanceRef: {
      id: "oracle-greeting-v1",
      sha256: "b".repeat(64),
    },
    tags: ["typescript", "micro"],
  });

  const modelInput = toModelVisibleEvaluationInput(evaluationCase);

  expect(modelInput).toEqual({
    caseId: "local-greeting-repair",
    revision: "v1",
    objective: "Repair the greeting behavior and verify it.",
    policy: {
      writeAuthority: "bounded",
      networkAuthority: "none",
      commandPolicy: "fixture_verifiers_only",
    },
    budgets: {
      actions: 16,
      inputTokens: null,
      outputTokens: 512,
      wallClockMs: 300_000,
    },
    visibleAcceptance: [
      {
        id: "behavior",
        statement: "The public greeting behavior is repaired.",
        type: "behavioral",
        required: true,
      },
    ],
  });
  expect(JSON.stringify(modelInput)).not.toContain("oracle-greeting-v1");
});

test("public evaluation cases reject answer-bearing and malformed fields", () => {
  const validCase = {
    schemaVersion: 1,
    caseId: "held-out-repair",
    revision: "v1",
    title: "Held-out repair",
    family: "micro",
    capabilityTarget: "C2",
    origin: "local_real",
    workspaceFixture: {
      source: "fixture:held-out-v1",
      digest: "c".repeat(64),
    },
    objective: "Repair the observed behavior.",
    policy: {
      writeAuthority: "bounded",
      networkAuthority: "none",
      commandPolicy: "fixture_verifiers_only",
    },
    budgets: {
      actions: 8,
      inputTokens: 4_096,
      outputTokens: 512,
      wallClockMs: 60_000,
    },
    visibleAcceptance: [],
    protectedAcceptanceRef: {
      id: "oracle-held-out-v1",
      sha256: "d".repeat(64),
    },
    tags: ["held-out"],
  };

  expect(() =>
    parsePublicEvaluationCase({
      ...validCase,
      expectedPatch: "replace the implementation with the gold answer",
    }),
  ).toThrow("Unexpected public evaluation case field: expectedPatch");
  expect(() =>
    parsePublicEvaluationCase({
      ...validCase,
      budgets: { ...validCase.budgets, actions: 0 },
    }),
  ).toThrow("budgets.actions must be a positive integer");
  expect(() =>
    parsePublicEvaluationCase({
      ...validCase,
      protectedAcceptanceRef: {
        id: "../oracle",
        sha256: "not-a-digest",
      },
    }),
  ).toThrow("protectedAcceptanceRef.id");
});

test("public case digest changes when model-visible task semantics change", () => {
  const base = {
    schemaVersion: 1,
    caseId: "digest-case",
    revision: "v1",
    title: "Digest case",
    family: "protocol",
    capabilityTarget: "C1",
    origin: "local_real",
    workspaceFixture: {
      source: "fixture:digest-v1",
      digest: "e".repeat(64),
    },
    objective: "Read the requested file.",
    policy: {
      writeAuthority: "none",
      networkAuthority: "none",
      commandPolicy: "none",
    },
    budgets: {
      actions: 2,
      inputTokens: 2_048,
      outputTokens: 256,
      wallClockMs: 30_000,
    },
    visibleAcceptance: [],
    protectedAcceptanceRef: null,
    tags: ["protocol"],
  };
  const first = digestPublicEvaluationCase(parsePublicEvaluationCase(base));
  const same = digestPublicEvaluationCase(
    parsePublicEvaluationCase({
      tags: ["protocol"],
      protectedAcceptanceRef: null,
      visibleAcceptance: [],
      budgets: base.budgets,
      policy: base.policy,
      objective: base.objective,
      workspaceFixture: base.workspaceFixture,
      origin: base.origin,
      capabilityTarget: base.capabilityTarget,
      family: base.family,
      title: base.title,
      revision: base.revision,
      caseId: base.caseId,
      schemaVersion: 1,
    }),
  );
  const changed = digestPublicEvaluationCase(
    parsePublicEvaluationCase({
      ...base,
      objective: "Read and edit the requested file.",
    }),
  );

  expect(first).toMatch(/^[a-f0-9]{64}$/);
  expect(same).toBe(first);
  expect(changed).not.toBe(first);
});
