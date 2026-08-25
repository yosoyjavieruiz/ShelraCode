import { expect, test } from "bun:test";
import {
  beginTranscriptTurn,
  createTranscriptPresentation,
  presentAppEvent,
} from "../../src/tui/presentation/adapter.js";

function withTurn() {
  return beginTranscriptTurn(createTranscriptPresentation(), {
    turnId: "turn-1",
    text: "Run the test suite.",
  });
}

function runningActivity(state: ReturnType<typeof withTurn>) {
  const group = state.items.find((item) => item.kind === "activity-group");
  return group?.kind === "activity-group" ? group.activities[0] : undefined;
}

test("tool.output appends to the matching running activity's live tail", () => {
  let state = presentAppEvent(withTurn(), {
    type: "tool.started",
    callId: "call-1",
    tool: "RunTests",
    input: { command: "bun test" },
  });
  state = presentAppEvent(state, {
    type: "tool.output",
    callId: "call-1",
    tool: "RunTests",
    stream: "stdout",
    text: "PASS auth/login\nPASS auth/logout\n",
  });
  expect(runningActivity(state)?.liveTail).toEqual([
    "PASS auth/login",
    "PASS auth/logout",
  ]);
});

test("live tail keeps only the last 6 lines", () => {
  let state = presentAppEvent(withTurn(), {
    type: "tool.started",
    callId: "call-1",
    tool: "Shell",
    input: { command: "bun run build" },
  });
  for (let index = 0; index < 10; index += 1) {
    state = presentAppEvent(state, {
      type: "tool.output",
      callId: "call-1",
      tool: "Shell",
      stream: "stdout",
      text: `line ${index}\n`,
    });
  }
  expect(runningActivity(state)?.liveTail).toEqual([
    "line 4",
    "line 5",
    "line 6",
    "line 7",
    "line 8",
    "line 9",
  ]);
});

test("tool.finished clears the live tail — details/summary become the permanent record", () => {
  let state = presentAppEvent(withTurn(), {
    type: "tool.started",
    callId: "call-1",
    tool: "RunTests",
    input: { command: "bun test" },
  });
  state = presentAppEvent(state, {
    type: "tool.output",
    callId: "call-1",
    tool: "RunTests",
    stream: "stdout",
    text: "PASS auth/login\n",
  });
  state = presentAppEvent(state, {
    type: "tool.finished",
    callId: "call-1",
    tool: "RunTests",
    result: {
      tool: "RunTests",
      ok: true,
      output: { exitCode: 0, output: "31 pass\n0 fail" },
      durationMs: 2_000,
    },
  });
  expect(runningActivity(state)?.liveTail).toBeUndefined();
});

test("tool.output for an unrelated callId does not touch a running activity's tail", () => {
  let state = presentAppEvent(withTurn(), {
    type: "tool.started",
    callId: "call-1",
    tool: "RunTests",
    input: { command: "bun test" },
  });
  state = presentAppEvent(state, {
    type: "tool.output",
    callId: "some-other-call",
    tool: "RunTests",
    stream: "stdout",
    text: "should not appear\n",
  });
  expect(runningActivity(state)?.liveTail).toBeUndefined();
});

test("verification.started opens a live tail independent of any tool call, and clears agentPhase", () => {
  let state = presentAppEvent(withTurn(), {
    type: "phase.changed",
    phase: "verify",
  });
  expect(state.agentPhase).toBe("verify");
  state = presentAppEvent(state, {
    type: "verification.started",
    id: "task-1:verification:1",
    command: "bun test",
  });
  expect(state.agentPhase).toBeUndefined();
  expect(state.runningVerification).toEqual({
    id: "task-1:verification:1",
    command: "bun test",
    tail: [],
  });
});

test("tool.output matching the running verification id feeds its tail, not an activity", () => {
  let state = presentAppEvent(withTurn(), {
    type: "verification.started",
    id: "task-1:verification:1",
    command: "bun test",
  });
  state = presentAppEvent(state, {
    type: "tool.output",
    callId: "task-1:verification:1",
    tool: "RunTests",
    stream: "stdout",
    text: "PASS auth/login\nRUNS auth/refresh\n",
  });
  expect(state.runningVerification?.tail).toEqual([
    "PASS auth/login",
    "RUNS auth/refresh",
  ]);
});

test("verification.finished clears the running verification", () => {
  let state = presentAppEvent(withTurn(), {
    type: "verification.started",
    id: "task-1:verification:1",
    command: "bun test",
  });
  state = presentAppEvent(state, {
    type: "verification.finished",
    exitCode: 0,
    output: "31 pass\n0 fail",
  });
  expect(state.runningVerification).toBeUndefined();
});
