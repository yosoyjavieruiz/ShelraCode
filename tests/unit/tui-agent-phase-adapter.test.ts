import { expect, test } from "bun:test";
import type { AppEvent } from "../../src/shared/events.js";
import {
  beginTranscriptTurn,
  createTranscriptPresentation,
  isAbstractAgentPhase,
} from "../../src/tui/presentation/adapter.js";
import { presentAppEvent } from "../../src/tui/presentation/adapter.js";

function withTurn() {
  return beginTranscriptTurn(createTranscriptPresentation(), {
    turnId: "turn-1",
    text: "Fix the refresh race.",
  });
}

test("isAbstractAgentPhase excludes act and every terminal phase", () => {
  expect(isAbstractAgentPhase("discover")).toBe(true);
  expect(isAbstractAgentPhase("verify")).toBe(true);
  expect(isAbstractAgentPhase("act")).toBe(false);
  expect(isAbstractAgentPhase("complete")).toBe(false);
  expect(isAbstractAgentPhase("blocked")).toBe(false);
  expect(isAbstractAgentPhase("failed")).toBe(false);
  expect(isAbstractAgentPhase("cancelled")).toBe(false);
  expect(isAbstractAgentPhase(undefined)).toBe(false);
});

test("phase.changed records an abstract phase for AgentMatrixPulse to read", () => {
  const event: AppEvent = { type: "phase.changed", phase: "discover" };
  const state = presentAppEvent(withTurn(), event);
  expect(state.agentPhase).toBe("discover");
});

test("a submitted turn immediately exposes an initial agent phase", () => {
  expect(withTurn().agentPhase).toBe("frame");
});

test("phase.changed to a non-abstract phase (act) clears agentPhase rather than showing it", () => {
  let state = presentAppEvent(withTurn(), {
    type: "phase.changed",
    phase: "plan",
  });
  expect(state.agentPhase).toBe("plan");
  state = presentAppEvent(state, { type: "phase.changed", phase: "act" });
  expect(state.agentPhase).toBeUndefined();
});

test("tool.started clears agentPhase so the matrix and a running tool never show together", () => {
  let state = presentAppEvent(withTurn(), {
    type: "phase.changed",
    phase: "discover",
  });
  expect(state.agentPhase).toBe("discover");
  state = presentAppEvent(state, {
    type: "tool.started",
    callId: "call-1",
    tool: "ReadFile",
    input: { path: "src/index.ts" },
  });
  expect(state.agentPhase).toBeUndefined();
});

test("a later abstract phase (e.g. reflect after a tool finishes) brings the matrix back", () => {
  let state = presentAppEvent(withTurn(), {
    type: "phase.changed",
    phase: "discover",
  });
  state = presentAppEvent(state, {
    type: "tool.started",
    callId: "call-1",
    tool: "ReadFile",
    input: { path: "src/index.ts" },
  });
  expect(state.agentPhase).toBeUndefined();
  state = presentAppEvent(state, {
    type: "tool.finished",
    callId: "call-1",
    tool: "ReadFile",
    result: {
      tool: "ReadFile",
      ok: true,
      output: { content: "" },
      durationMs: 5,
    },
  });
  state = presentAppEvent(state, {
    type: "phase.changed",
    phase: "reflect",
  });
  expect(state.agentPhase).toBe("reflect");
});

test("terminal task events clear a lingering agentPhase", () => {
  let state = presentAppEvent(withTurn(), {
    type: "phase.changed",
    phase: "verify",
  });
  state = presentAppEvent(state, {
    type: "task.completed",
    result: { text: "Done", verified: true },
  });
  expect(state.agentPhase).toBeUndefined();

  let failedState = presentAppEvent(withTurn(), {
    type: "phase.changed",
    phase: "verify",
  });
  failedState = presentAppEvent(failedState, {
    type: "task.failed",
    error: "boom",
  });
  expect(failedState.agentPhase).toBeUndefined();

  let blockedState = presentAppEvent(withTurn(), {
    type: "phase.changed",
    phase: "review",
  });
  blockedState = presentAppEvent(blockedState, {
    type: "task.blocked",
    error: "verification failed",
  });
  expect(blockedState.agentPhase).toBeUndefined();

  let cancelledState = presentAppEvent(withTurn(), {
    type: "phase.changed",
    phase: "discover",
  });
  cancelledState = presentAppEvent(cancelledState, {
    type: "task.cancelled",
    error: "Task cancelled.",
  });
  expect(cancelledState.agentPhase).toBeUndefined();
});
