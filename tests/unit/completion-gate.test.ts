import { expect, test } from "bun:test";
import { evaluateCompletionGate } from "../../src/agent/completion-gate.js";
import type { ObjectiveProofAssessment } from "../../src/agent/objective-proof.js";

const base = {
  objectiveSatisfied: true,
  evidenceCount: 0,
  mutationOccurred: false,
  verificationRequired: false,
  verificationPerformed: false,
  verificationPassed: false,
  finalReviewPerformed: true,
  unresolvedBlockers: 0,
  userWorkPreserved: true,
};

test("a repository answer cannot complete without relevant evidence", () => {
  const decision = evaluateCompletionGate({
    ...base,
    mode: "workspace_question",
  });

  expect(decision.canComplete).toBe(false);
  expect(decision.evidenceState).toBe("INSUFFICIENT");
  expect(decision.reasons).toContain("relevant repository evidence is missing");
});

test("a repository answer can complete once relevant evidence exists", () => {
  const decision = evaluateCompletionGate({
    ...base,
    mode: "workspace_question",
    evidenceCount: 1,
  });

  expect(decision.canComplete).toBe(true);
  expect(decision.evidenceState).toBe("SUFFICIENT");
  expect(decision.reasons).toEqual([]);
});

test("coding work cannot complete before required verification passes", () => {
  const decision = evaluateCompletionGate({
    ...base,
    mode: "coding",
    mutationOccurred: true,
    verificationRequired: true,
  });

  expect(decision.canComplete).toBe(false);
  expect(decision.reasons).toContain("required verification has not passed");
});

test("coding work completes only after verification and final review", () => {
  const decision = evaluateCompletionGate({
    ...base,
    mode: "coding",
    mutationOccurred: true,
    verificationRequired: true,
    verificationPerformed: true,
    verificationPassed: true,
    finalReviewPerformed: true,
    evidenceCount: 2,
  });

  expect(decision.canComplete).toBe(true);
  expect(decision.reasons).toEqual([]);
});

test("coding work cannot complete when explicit criteria remain unsatisfied", () => {
  const decision = evaluateCompletionGate({
    ...base,
    mode: "coding",
    objectiveSatisfied: true,
    successCriteriaSatisfied: false,
    mutationOccurred: true,
    verificationRequired: true,
    verificationPerformed: true,
    verificationPassed: true,
    evidenceCount: 2,
  });

  expect(decision.canComplete).toBe(false);
  expect(decision.reasons).toContain("success criteria are not satisfied");
});

test("coding work cannot claim verification when the host found no check", () => {
  const decision = evaluateCompletionGate({
    ...base,
    mode: "coding",
    mutationOccurred: true,
    verificationState: "unavailable",
    evidenceCount: 2,
  });

  expect(decision.canComplete).toBe(false);
  expect(decision.reasons).toContain(
    "required verification is unavailable; completion cannot be claimed as verified",
  );
});

test("coding work cannot complete when a required objective proof is missing", () => {
  const objectiveProof: ObjectiveProofAssessment = {
    pass: false,
    confidence: 0.5,
    proofs: [],
    missingRequirements: [
      {
        requirementId: "deliverable-path-2",
        description: "src/b.ts must be changed",
        kind: "deliverable",
        reason: "No successful mutation was recorded.",
        nextAction: "Edit src/b.ts.",
      },
    ],
    nextActions: ["Edit src/b.ts."],
  };
  const decision = evaluateCompletionGate({
    ...base,
    mode: "coding",
    mutationOccurred: true,
    verificationRequired: true,
    verificationPerformed: true,
    verificationPassed: true,
    evidenceCount: 2,
    objectiveProof,
  } as Parameters<typeof evaluateCompletionGate>[0]);

  expect(decision.canComplete).toBe(false);
  expect(decision.reasons).toContain(
    "required objective proof is missing: deliverable-path-2",
  );
});

test("coding work can complete when the host objective proof passes", () => {
  const objectiveProof: ObjectiveProofAssessment = {
    pass: true,
    confidence: 1,
    proofs: [],
    missingRequirements: [],
    nextActions: [],
  };
  const decision = evaluateCompletionGate({
    ...base,
    mode: "coding",
    mutationOccurred: true,
    verificationRequired: true,
    verificationPerformed: true,
    verificationPassed: true,
    evidenceCount: 2,
    objectiveProof,
  } as Parameters<typeof evaluateCompletionGate>[0]);

  expect(decision.canComplete).toBe(true);
});
