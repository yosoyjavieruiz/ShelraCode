import { expect, test } from "bun:test";
import { evaluateMutationEvidenceGate } from "../../src/agent/context-gate.js";

test("coding mutation is blocked when discovery found no relevant evidence", () => {
  const result = evaluateMutationEvidenceGate({
    mode: "coding",
    declaredState: "INSUFFICIENT",
    evidence: [],
  });

  expect(result).toMatchObject({
    allowed: false,
    state: "INSUFFICIENT",
  });
});

test("a successful relevant read opens the mutation gate", () => {
  const result = evaluateMutationEvidenceGate({
    mode: "coding",
    declaredState: "INSUFFICIENT",
    evidence: [
      {
        id: "read-auth",
        kind: "file",
        source: "ReadFile",
        summary: "Read the authentication implementation.",
        relevance: 0.9,
        freshness: 1,
      },
    ],
  });

  expect(result).toEqual({ allowed: true, state: "SUFFICIENT" });
});

test("an empty repository opens the gate only for greenfield intent", () => {
  const allowed = evaluateMutationEvidenceGate({
    mode: "coding",
    declaredState: "INSUFFICIENT",
    evidence: [],
    repositoryState: "empty",
    greenfieldIntent: true,
  });
  const blocked = evaluateMutationEvidenceGate({
    mode: "coding",
    declaredState: "INSUFFICIENT",
    evidence: [],
    repositoryState: "empty",
    greenfieldIntent: false,
  });

  expect(allowed).toEqual({ allowed: true, state: "SUFFICIENT" });
  expect(blocked).toMatchObject({ allowed: false, state: "INSUFFICIENT" });
});

test("conflicting discovery never authorizes mutation", () => {
  const result = evaluateMutationEvidenceGate({
    mode: "coding",
    declaredState: "CONFLICTING",
    evidence: [
      {
        id: "one",
        kind: "file",
        source: "a.ts",
        summary: "One implementation.",
        relevance: 0.9,
        freshness: 1,
      },
    ],
  });

  expect(result).toMatchObject({
    allowed: false,
    state: "CONFLICTING",
  });
});
