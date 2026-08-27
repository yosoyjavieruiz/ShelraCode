import { expect, test } from "bun:test";
import { assessObjectiveProof } from "../../src/agent/objective-proof.js";
import { compileTaskContract } from "../../src/agent/task-contract.js";
import {
  addTaskEvidence,
  createTaskLedger,
  recordTaskAction,
  recordVerificationRun,
} from "../../src/agent/task-state.js";

function codingContract(paths: string[], commands: string[] = []) {
  return compileTaskContract({
    id: "proof-contract",
    originalRequest: `Implement the requested change in ${paths.join(" and ")}.`,
    mode: "coding",
    explicitPaths: paths,
    verificationCommands: commands.map((command) => ({
      stage: "test" as const,
      command,
    })),
  });
}

function addReview(ledger: ReturnType<typeof createTaskLedger>): void {
  recordTaskAction(ledger, {
    id: "review",
    kind: "review",
    target: "final diff",
    status: "succeeded",
  });
}

function addReadAndWrite(
  ledger: ReturnType<typeof createTaskLedger>,
  path: string,
): void {
  recordTaskAction(ledger, {
    id: `read:${path}`,
    kind: "read",
    target: path,
    status: "succeeded",
  });
  recordTaskAction(ledger, {
    id: `write:${path}`,
    kind: "write",
    target: path,
    status: "succeeded",
  });
}

test("reports the unproven explicit deliverable when only one target changed", () => {
  const contract = codingContract(["src/a.ts", "src/b.ts"], ["bun test"]);
  const ledger = createTaskLedger({
    id: "proof-missing-target",
    objective: contract.objective,
    mode: "coding",
    contract,
  });
  addTaskEvidence(ledger, {
    id: "repo",
    kind: "file",
    source: "src/a.ts",
    summary: "The implementation was inspected.",
    relevance: 1,
    freshness: 1,
  });
  addReadAndWrite(ledger, "src/a.ts");
  recordTaskAction(ledger, {
    id: "read:src/b.ts",
    kind: "read",
    target: "src/b.ts",
    status: "succeeded",
  });
  recordVerificationRun(ledger, {
    id: "test",
    stage: "test",
    command: "bun test",
    status: "passed",
    exitCode: 0,
    startedAt: new Date().toISOString(),
  });
  addReview(ledger);

  const assessment = assessObjectiveProof(contract, ledger, ledger.evidence, [
    { path: "src/a.ts", exists: true },
    { path: "src/b.ts", exists: true },
  ]);

  expect(assessment.pass).toBe(false);
  expect(assessment.missingRequirements).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ requirementId: "deliverable-path-2" }),
    ]),
  );
  expect(assessment.nextActions.join(" ")).toContain("src/b.ts");
});

test("proves every explicit deliverable only with fresh reads, writes, artifact facts, verification, and review", () => {
  const contract = codingContract(["src/a.ts", "src/b.ts"], ["bun test"]);
  const ledger = createTaskLedger({
    id: "proof-complete",
    objective: contract.objective,
    mode: "coding",
    contract,
  });
  addTaskEvidence(ledger, {
    id: "repo",
    kind: "file",
    source: "src/a.ts",
    summary: "Both target files were inspected.",
    relevance: 1,
    freshness: 1,
  });
  addReadAndWrite(ledger, "src/a.ts");
  addReadAndWrite(ledger, "src/b.ts");
  recordVerificationRun(ledger, {
    id: "test",
    stage: "test",
    command: "bun test",
    status: "passed",
    exitCode: 0,
    startedAt: new Date().toISOString(),
  });
  addReview(ledger);

  const assessment = assessObjectiveProof(contract, ledger, ledger.evidence, [
    { path: "src/a.ts", exists: true },
    { path: "src/b.ts", exists: true },
  ]);

  expect(assessment).toEqual(
    expect.objectContaining({ pass: true, confidence: 1 }),
  );
  expect(assessment.missingRequirements).toEqual([]);
  expect(
    assessment.proofs.filter((proof) => proof.status === "proven").length,
  ).toBeGreaterThanOrEqual(5);
});

test("does not treat a successful model read and write as artifact proof without a host fact", () => {
  const contract = codingContract(["src/a.ts"]);
  const ledger = createTaskLedger({
    id: "proof-no-artifact-fact",
    objective: contract.objective,
    mode: "coding",
    contract,
  });
  addTaskEvidence(ledger, {
    id: "repo",
    kind: "file",
    source: "src/a.ts",
    summary: "The target was inspected.",
    relevance: 1,
    freshness: 1,
  });
  addReadAndWrite(ledger, "src/a.ts");
  addReview(ledger);

  const assessment = assessObjectiveProof(contract, ledger, ledger.evidence);

  expect(assessment.pass).toBe(false);
  expect(assessment.missingRequirements).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        requirementId: "deliverable-path-1",
        reason: expect.stringContaining("artifact fact"),
      }),
    ]),
  );
});

test("does not convert a model completion claim into proof for an unscoped objective", () => {
  const contract = compileTaskContract({
    id: "proof-no-claim",
    originalRequest:
      "Implement the authentication behavior requested by the user.",
    mode: "coding",
  });
  const ledger = createTaskLedger({
    id: "proof-no-claim",
    objective: contract.objective,
    mode: "coding",
    contract,
  });
  addTaskEvidence(ledger, {
    id: "repo",
    kind: "file",
    source: "README.md",
    summary: "Repository context was inspected.",
    relevance: 1,
    freshness: 1,
  });
  recordTaskAction(ledger, {
    id: "write-unrelated",
    kind: "write",
    target: "src/unrelated.ts",
    status: "succeeded",
  });
  addReview(ledger);

  const assessment = assessObjectiveProof(contract, ledger, ledger.evidence);

  expect(assessment.pass).toBe(false);
  expect(assessment.missingRequirements).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ requirementId: "deliverable-objective" }),
    ]),
  );
});

test("accepts an unscoped deliverable only after host criteria are satisfied", () => {
  const contract = compileTaskContract({
    id: "proof-host-criteria",
    originalRequest:
      "Implement the authentication behavior requested by the user.",
    mode: "coding",
  });
  const ledger = createTaskLedger({
    id: "proof-host-criteria",
    objective: contract.objective,
    mode: "coding",
    contract,
    successCriteria: [
      {
        id: "host-criteria",
        description: "The host verifier approved the requested behavior.",
        required: true,
        satisfied: true,
      },
    ],
  });
  addTaskEvidence(ledger, {
    id: "repo",
    kind: "file",
    source: "src/auth.ts",
    summary: "The authentication implementation was inspected.",
    relevance: 1,
    freshness: 1,
  });
  recordTaskAction(ledger, {
    id: "write-auth",
    kind: "write",
    target: "src/auth.ts",
    status: "succeeded",
  });
  addReview(ledger);

  const assessment = assessObjectiveProof(contract, ledger, ledger.evidence);

  expect(assessment.pass).toBe(true);
  expect(assessment.proofs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        requirementId: "deliverable-objective",
        source: "host:success-criteria",
        status: "proven",
      }),
    ]),
  );
});

test("treats project verification as not applicable only when the contract says so", () => {
  const contract = codingContract(["src/a.ts"]);
  const ledger = createTaskLedger({
    id: "proof-no-project-check",
    objective: contract.objective,
    mode: "coding",
    contract,
  });
  addTaskEvidence(ledger, {
    id: "repo",
    kind: "file",
    source: "src/a.ts",
    summary: "The target was inspected.",
    relevance: 1,
    freshness: 1,
  });
  addReadAndWrite(ledger, "src/a.ts");
  addReview(ledger);

  const assessment = assessObjectiveProof(contract, ledger, ledger.evidence, [
    { path: "src/a.ts", exists: true },
  ]);

  expect(assessment.pass).toBe(true);
  expect(assessment.proofs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        requirementId: "criterion-verification",
        status: "not_applicable",
      }),
    ]),
  );
});

test("rejects a created artifact whose explicit exact content is wrong", () => {
  const contract = compileTaskContract({
    id: "proof-exact-content",
    originalRequest:
      "Create a new file named approval-test.txt containing exactly the word approved.",
    mode: "coding",
    explicitPaths: ["approval-test.txt"],
  });
  const ledger = createTaskLedger({
    id: "proof-exact-content",
    objective: contract.objective,
    mode: "coding",
    contract,
  });
  addTaskEvidence(ledger, {
    id: "repo",
    kind: "file",
    source: "approval-test.txt",
    summary: "The requested artifact scope was checked.",
    relevance: 1,
    freshness: 1,
  });
  recordTaskAction(ledger, {
    id: "write",
    kind: "write",
    target: "approval-test.txt",
    status: "succeeded",
  });
  addReview(ledger);

  const assessment = assessObjectiveProof(contract, ledger, ledger.evidence, [
    { path: "approval-test.txt", exists: true, content: "rejected\n" },
  ]);

  expect(assessment.pass).toBe(false);
  expect(assessment.missingRequirements).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        requirementId: "deliverable-path-1",
        reason: expect.stringContaining("exact content"),
      }),
    ]),
  );
});

test("proves an explicit exact artifact expectation after host inspection", () => {
  const contract = compileTaskContract({
    id: "proof-exact-content-pass",
    originalRequest:
      "Create a new file named approval-test.txt containing exactly the word approved.",
    mode: "coding",
    explicitPaths: ["approval-test.txt"],
  });
  const ledger = createTaskLedger({
    id: "proof-exact-content-pass",
    objective: contract.objective,
    mode: "coding",
    contract,
  });
  addTaskEvidence(ledger, {
    id: "repo",
    kind: "file",
    source: "approval-test.txt",
    summary: "The requested artifact scope was checked.",
    relevance: 1,
    freshness: 1,
  });
  recordTaskAction(ledger, {
    id: "write",
    kind: "write",
    target: "approval-test.txt",
    status: "succeeded",
  });
  addReview(ledger);

  const assessment = assessObjectiveProof(contract, ledger, ledger.evidence, [
    { path: "approval-test.txt", exists: true, content: "approved\n" },
  ]);

  expect(assessment.pass).toBe(true);
});
