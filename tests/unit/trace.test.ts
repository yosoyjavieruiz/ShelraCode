import { expect, test } from "bun:test";
import { createAgentTraceRecorder } from "../../src/agent/trace.js";

test("developer trace is opt-in and redacts secret-shaped fields", () => {
  const events: unknown[] = [];
  const recorder = createAgentTraceRecorder(true, (event) =>
    events.push(event),
  );
  recorder.record({
    taskId: "trace-1",
    type: "tool.observed",
    data: {
      apiKey: "should-not-appear",
      message: "Bearer abc.def.ghi",
    },
  });

  const rendered = JSON.stringify(events);
  expect(rendered).not.toContain("should-not-appear");
  expect(rendered).not.toContain("abc.def.ghi");
  expect(rendered).toContain("REDACTED");
});

test("disabled developer trace does not call its sink", () => {
  let calls = 0;
  const recorder = createAgentTraceRecorder(false, () => {
    calls += 1;
  });
  recorder.record({ taskId: "trace-2", type: "task.started" });
  expect(calls).toBe(0);
});
