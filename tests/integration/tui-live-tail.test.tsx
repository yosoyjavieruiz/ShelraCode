import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { Activity, Transcript } from "../../src/tui/components/Transcript.js";
import {
  beginTranscriptTurn,
  createTranscriptPresentation,
  presentAppEvent,
} from "../../src/tui/presentation/adapter.js";
import { getTheme } from "../../src/tui/theme/tokens.js";

let renderer: { destroy: () => void } | undefined;
afterEach(() => {
  renderer?.destroy();
  renderer = undefined;
});

test("a running Shell/RunTests activity shows its live tail in the transcript", async () => {
  let state = beginTranscriptTurn(createTranscriptPresentation(), {
    turnId: "turn-1",
    text: "Run the auth suite.",
  });
  state = presentAppEvent(state, {
    type: "tool.started",
    callId: "call-1",
    tool: "RunTests",
    input: { command: "bun test auth" },
  });
  state = presentAppEvent(state, {
    type: "tool.output",
    callId: "call-1",
    tool: "RunTests",
    stream: "stdout",
    text: "PASS auth/login\nRUNS auth/refresh\n",
  });
  const setup = await testRender(
    () => (
      <Transcript
        theme={getTheme(true)}
        items={() => state.items}
        width={100}
      />
    ),
    { width: 100, height: 20 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("PASS auth/login");
  expect(frame).toContain("RUNS auth/refresh");
});

test("repetitive running test groups keep their live tail visible", async () => {
  const setup = await testRender(
    () => (
      <Activity
        theme={getTheme(true)}
        item={{
          id: "tests",
          turnId: "turn-1",
          kind: "activity-group",
          label: "TEST",
          expanded: false,
          activities: [
            {
              id: "test-1",
              kind: "test",
              label: "TEST",
              target: "bun test auth",
              state: "running",
              liveTail: ["PASS auth/login"],
            },
            {
              id: "test-2",
              kind: "test",
              label: "TEST",
              target: "bun test sessions",
              state: "running",
              liveTail: ["RUNS auth/refresh"],
            },
          ],
        }}
        forceExpanded={false}
      />
    ),
    { width: 100, height: 10 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("RUNS auth/refresh");
});

test("host-driven verification renders its own running row and live tail", async () => {
  let state = beginTranscriptTurn(createTranscriptPresentation(), {
    turnId: "turn-1",
    text: "Fix the bug and verify.",
  });
  state = presentAppEvent(state, {
    type: "verification.started",
    id: "task-1:verification:1",
    command: "bun test",
  });
  state = presentAppEvent(state, {
    type: "tool.output",
    callId: "task-1:verification:1",
    tool: "RunTests",
    stream: "stdout",
    text: "PASS auth/login\n",
  });
  const setup = await testRender(
    () => (
      <Transcript
        theme={getTheme(true)}
        items={() => state.items}
        width={100}
        runningVerification={() => state.runningVerification}
      />
    ),
    { width: 100, height: 20 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("TEST");
  expect(frame).toContain("bun test");
  expect(frame).toContain("PASS auth/login");
});

test("live tail disappears once the tool finishes, replaced by its summary", async () => {
  let state = beginTranscriptTurn(createTranscriptPresentation(), {
    turnId: "turn-1",
    text: "Run the auth suite.",
  });
  state = presentAppEvent(state, {
    type: "tool.started",
    callId: "call-1",
    tool: "RunTests",
    input: { command: "bun test auth" },
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
      durationMs: 2_400,
    },
  });
  const setup = await testRender(
    () => (
      <Transcript
        theme={getTheme(true)}
        items={() => state.items}
        width={100}
      />
    ),
    { width: 100, height: 20 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).not.toContain("PASS auth/login");
  expect(frame).toContain("31 passed");
});
