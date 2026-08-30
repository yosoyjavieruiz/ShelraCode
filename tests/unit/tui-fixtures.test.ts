import { afterEach, expect, test } from "bun:test";
import {
  createUIFixture,
  readUIFixture,
} from "../../src/tui/state/fixtures.js";

afterEach(() => {
  delete process.env.SHELRACODE_UI_FIXTURE;
});

test("ShelraCode fixture environment variable is the canonical visual-test entry", () => {
  process.env.SHELRACODE_UI_FIXTURE = "thinking";
  expect(readUIFixture()).toBe("thinking");
});

test("numbered fixture aliases resolve to deterministic fixture states", () => {
  expect(readUIFixture("03-thinking-agent-matrix")).toBe("thinking");
  expect(readUIFixture("07-multi-tool-group")).toBe("tool-group");
  expect(readUIFixture("20-command-palette")).toBe("palette");
  expect(readUIFixture("21-file-picker")).toBe("context-picker");
});

test("execution fixtures expose structured running activity, plan, and diff state", () => {
  const shell = createUIFixture("shell-live-stream").presentation;
  expect(createUIFixture("shell-live-stream").busy).toBe(true);
  const shellActivity = shell?.items
    .filter((item) => item.kind === "activity-group")
    .flatMap((item) => item.activities)
    .find((activity) => activity.kind === "run");
  expect(shellActivity?.state).toBe("running");
  expect(shellActivity?.liveTail?.length).toBeGreaterThan(0);

  const verification = createUIFixture("test-running").presentation;
  expect(createUIFixture("test-running").busy).toBe(true);
  expect(verification?.runningVerification?.command).toContain("bun test");

  const plan = createUIFixture("plan").presentation?.items.find(
    (item) => item.kind === "plan-update",
  );
  expect(plan?.kind).toBe("plan-update");

  const edit = createUIFixture("edit-diff").presentation?.items.find(
    (item) => item.kind === "activity-group",
  );
  expect(edit?.kind).toBe("activity-group");
  if (edit?.kind === "activity-group") {
    expect(edit.activities[0]?.diff).toBeDefined();
  }

  expect(
    createUIFixture("long-conversation").presentation?.items.length,
  ).toBeGreaterThan(6);
});
