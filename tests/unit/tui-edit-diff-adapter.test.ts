import { expect, test } from "bun:test";
import {
  beginTranscriptTurn,
  createTranscriptPresentation,
  presentAppEvent,
} from "../../src/tui/presentation/adapter.js";

function withTurn() {
  return beginTranscriptTurn(createTranscriptPresentation(), {
    turnId: "turn-1",
    text: "Fix the refresh race.",
  });
}

function editActivity(state: ReturnType<typeof withTurn>) {
  const group = state.items.find((item) => item.kind === "activity-group");
  return group?.kind === "activity-group" ? group.activities[0] : undefined;
}

test("EditFile gets a real +/- diff summary instead of a replacement count", () => {
  let state = presentAppEvent(withTurn(), {
    type: "tool.started",
    callId: "call-1",
    tool: "EditFile",
    input: {
      path: "src/auth/session.ts",
      oldText: "const a = 1;\nconst b = 2;\n",
      newText: "const a = 1;\nconst b = 3;\nconst c = 4;\n",
    },
  });
  expect(editActivity(state)?.diff).toEqual({ added: 2, removed: 1 });

  state = presentAppEvent(state, {
    type: "tool.finished",
    callId: "call-1",
    tool: "EditFile",
    result: {
      tool: "EditFile",
      ok: true,
      output: { path: "src/auth/session.ts", replacements: 1 },
      durationMs: 5,
    },
  });
  const activity = editActivity(state);
  expect(activity?.summary).toBe("+2 −1");
  expect(activity?.details).toEqual([
    "  const a = 1;",
    "- const b = 2;",
    "+ const b = 3;",
    "+ const c = 4;",
  ]);
});

test("a failed EditFile keeps the error summary, not a diff", () => {
  let state = presentAppEvent(withTurn(), {
    type: "tool.started",
    callId: "call-1",
    tool: "EditFile",
    input: {
      path: "src/auth/session.ts",
      oldText: "missing text",
      newText: "replacement",
    },
  });
  state = presentAppEvent(state, {
    type: "tool.finished",
    callId: "call-1",
    tool: "EditFile",
    result: {
      tool: "EditFile",
      ok: false,
      error: "EditFile target text was not found.",
      durationMs: 3,
    },
  });
  const activity = editActivity(state);
  expect(activity?.summary).toBe("BLOCKED · TOOL_ERROR");
  expect(activity?.details).toContain("EditFile target text was not found.");
});

test("a pure insertion/deletion diffs correctly (not just line-count deltas)", () => {
  const state = presentAppEvent(withTurn(), {
    type: "tool.started",
    callId: "call-1",
    tool: "EditFile",
    input: {
      path: "src/x.ts",
      oldText: "line one\nline two\n",
      newText: "",
    },
  });
  expect(editActivity(state)?.diff).toEqual({ added: 0, removed: 2 });
});

test("other tools never get diff fields", () => {
  const state = presentAppEvent(withTurn(), {
    type: "tool.started",
    callId: "call-1",
    tool: "ReadFile",
    input: { path: "src/x.ts" },
  });
  const group = state.items.find((item) => item.kind === "activity-group");
  const activity =
    group?.kind === "activity-group" ? group.activities[0] : undefined;
  expect(activity?.diff).toBeUndefined();
  expect(activity?.diffLines).toBeUndefined();
});
