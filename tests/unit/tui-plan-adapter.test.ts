import { expect, test } from "bun:test";
import {
  beginTranscriptTurn,
  createTranscriptPresentation,
  presentAppEvent,
} from "../../src/tui/presentation/adapter.js";

function withTurn() {
  return beginTranscriptTurn(createTranscriptPresentation(), {
    turnId: "turn-1",
    text: "Fix the refresh race and add a regression test.",
  });
}

test("plan.changed creates a plan-update item with real step descriptions and mapped states", () => {
  const state = presentAppEvent(withTurn(), {
    type: "plan.changed",
    steps: [
      {
        id: "s1",
        description: "Inspect current implementation",
        status: "done",
      },
      { id: "s2", description: "Fix routing fallback", status: "active" },
      { id: "s3", description: "Add regression test", status: "pending" },
    ],
  });
  const item = state.items.find((entry) => entry.kind === "plan-update");
  expect(item?.kind).toBe("plan-update");
  if (item?.kind !== "plan-update")
    throw new Error("expected plan-update item");
  expect(item.completed).toBe(1);
  expect(item.total).toBe(3);
  expect(item.steps).toEqual([
    { label: "Inspect current implementation", state: "success" },
    { label: "Fix routing fallback", state: "running" },
    { label: "Add regression test", state: "pending" },
  ]);
});

test("a second plan.changed in the same turn updates the existing item in place, not a new one", () => {
  let state = presentAppEvent(withTurn(), {
    type: "plan.changed",
    steps: [
      {
        id: "s1",
        description: "Inspect current implementation",
        status: "active",
      },
      { id: "s2", description: "Fix routing fallback", status: "pending" },
    ],
  });
  state = presentAppEvent(state, {
    type: "plan.changed",
    steps: [
      {
        id: "s1",
        description: "Inspect current implementation",
        status: "done",
      },
      { id: "s2", description: "Fix routing fallback", status: "active" },
    ],
  });
  const planItems = state.items.filter((entry) => entry.kind === "plan-update");
  expect(planItems).toHaveLength(1);
  const item = planItems[0];
  expect(item?.kind === "plan-update" && item.completed).toBe(1);
});

test("a later plan.changed updates the current turn plan after tool activity", () => {
  let state = presentAppEvent(withTurn(), {
    type: "plan.changed",
    steps: [
      { id: "s1", description: "Create file", status: "active" },
      { id: "s2", description: "Verify result", status: "pending" },
    ],
  });
  state = presentAppEvent(state, {
    type: "tool.started",
    callId: "call-1",
    tool: "CreateFile",
    input: { path: "index.html" },
  });
  state = presentAppEvent(state, {
    type: "tool.finished",
    callId: "call-1",
    tool: "CreateFile",
    result: {
      tool: "CreateFile",
      ok: true,
      output: "created index.html",
      durationMs: 1,
    },
  });
  state = presentAppEvent(state, {
    type: "plan.changed",
    steps: [
      { id: "s1", description: "Create file", status: "done" },
      { id: "s2", description: "Verify result", status: "active" },
    ],
  });

  const planItems = state.items.filter((entry) => entry.kind === "plan-update");
  expect(planItems).toHaveLength(1);
  expect(planItems[0]?.kind === "plan-update" && planItems[0].completed).toBe(
    1,
  );
});

test("failed and skipped steps map to failed/cancelled activity states", () => {
  const state = presentAppEvent(withTurn(), {
    type: "plan.changed",
    steps: [
      { id: "s1", description: "Run migration", status: "failed" },
      { id: "s2", description: "Notify downstream", status: "skipped" },
    ],
  });
  const item = state.items.find((entry) => entry.kind === "plan-update");
  expect(item?.kind === "plan-update" && item.steps).toEqual([
    { label: "Run migration", state: "failed" },
    { label: "Notify downstream", state: "cancelled" },
  ]);
});
