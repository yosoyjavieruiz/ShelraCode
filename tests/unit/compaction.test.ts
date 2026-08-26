import { expect, test } from "bun:test";
import { compactTaskContext } from "../../src/agent/compaction.js";
import {
  addTaskBlocker,
  addTaskEvidence,
  createTaskLedger,
  recordRecoveryContract,
} from "../../src/agent/task-state.js";
import { compileTaskGraph } from "../../src/agent/task-graph.js";
import { compileTaskContract } from "../../src/agent/task-contract.js";
import { createRecoveryContract } from "../../src/agent/recovery.js";

test("compaction preserves authoritative task state and recent observations", () => {
  const ledger = createTaskLedger({
    id: "compact-1",
    objective: "Migrate session refresh safely",
    mode: "coding",
  });
  ledger.contract = compileTaskContract({
    id: ledger.id,
    originalRequest: ledger.objective,
    mode: ledger.mode,
  });
  recordRecoveryContract(
    ledger,
    createRecoveryContract({
      id: "recovery-1",
      cause: "TEST_FAILED",
      evidence: ["test.ts: expected 2"],
      forbiddenRepeats: ["same edit"],
      proposedRecovery: "repair",
    }),
  );
  ledger.filesChanged.push("src/session.ts");
  ledger.taskGraph = compileTaskGraph({
    objective: ledger.objective,
    mode: ledger.mode,
    candidateFiles: ["src/session.ts"],
    verificationCommands: ["bun test"],
  });
  addTaskEvidence(ledger, {
    id: "manifest",
    kind: "manifest",
    source: "package.json",
    summary: "The test script is bun test.",
    relevance: 1,
    freshness: 1,
  });
  const messages = [
    { role: "system" as const, content: "You are LocalCode." },
    {
      role: "user" as const,
      content: `${ledger.objective}\nHost context: src/session.ts exports refreshSession.`,
    },
    ...Array.from({ length: 8 }, (_, index) => ({
      role: "tool" as const,
      toolCallId: `tool-${index}`,
      content: `old output ${index} ${"x".repeat(300)}`,
    })),
    { role: "assistant" as const, content: "The latest observation matters." },
  ];

  const result = compactTaskContext(ledger, messages, 1_800);
  expect(result.omittedMessages).toBeGreaterThan(0);
  expect(result.preservedState).toContain("Migrate session refresh safely");
  expect(result.preservedState).toContain("src/session.ts");
  expect(result.preservedState).toContain("mutate-src-session-ts");
  expect(result.preservedState).toContain("recovery-1");
  expect(result.preservedState).toContain("acceptanceCriteria");
  expect(
    result.messages.some((message) =>
      message.content.includes("latest observation"),
    ),
  ).toBe(true);
  expect(
    result.messages.some((message) => message.content.includes("package.json")),
  ).toBe(true);
  expect(
    result.messages.some((message) =>
      message.content.includes("src/session.ts exports refreshSession"),
    ),
  ).toBe(true);
});

test("compaction rejects an unsafe budget", () => {
  const ledger = createTaskLedger({
    id: "compact-2",
    objective: "Answer",
    mode: "knowledge",
  });
  expect(() => compactTaskContext(ledger, [], 100)).toThrow(/budget/i);
});

test("compaction exposes rehydration text and structural source ids", () => {
  const ledger = createTaskLedger({
    id: "compact-rehydration",
    objective: "Fix the parser",
    mode: "coding",
  });
  ledger.taskGraph = compileTaskGraph({
    objective: ledger.objective,
    mode: ledger.mode,
    candidateFiles: ["src/parser.ts"],
    verificationCommands: [],
  });
  if (ledger.taskGraph) ledger.taskGraph.currentNodeId = "current-node";
  addTaskEvidence(ledger, {
    id: "parser-source",
    kind: "file",
    source: "src/parser.ts",
    summary: "parser symbol",
    relevance: 1,
    freshness: 1,
  });
  addTaskBlocker(ledger, {
    id: "missing-proof",
    summary: "missing proof for parser deliverable",
    recoverable: true,
  });

  const compacted = compactTaskContext(ledger, [], 1_800);

  expect(compacted.text).toContain("Fix the parser");
  expect(compacted.text).toContain("current-node");
  expect(compacted.text).toContain("missing proof");
  expect(compacted.sourceIds).toContain("src/parser.ts");
});
