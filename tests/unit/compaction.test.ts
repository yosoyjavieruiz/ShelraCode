import { expect, test } from "bun:test";
import { compactTaskContext } from "../../src/agent/compaction.js";
import {
  addTaskEvidence,
  createTaskLedger,
} from "../../src/agent/task-state.js";

test("compaction preserves authoritative task state and recent observations", () => {
  const ledger = createTaskLedger({
    id: "compact-1",
    objective: "Migrate session refresh safely",
    mode: "coding",
  });
  ledger.filesChanged.push("src/session.ts");
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
    { role: "user" as const, content: ledger.objective },
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
  expect(
    result.messages.some((message) =>
      message.content.includes("latest observation"),
    ),
  ).toBe(true);
  expect(
    result.messages.some((message) => message.content.includes("package.json")),
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
