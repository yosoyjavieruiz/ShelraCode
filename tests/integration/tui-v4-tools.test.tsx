import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { AppShell } from "../../src/tui/app.js";
import { Activity, Transcript } from "../../src/tui/components/Transcript.js";
import { createUIFixture } from "../../src/tui/state/fixtures.js";
import { getTheme } from "../../src/tui/theme/tokens.js";

let renderer: { destroy: () => void } | undefined;
afterEach(() => {
  renderer?.destroy();
  renderer = undefined;
});

test("Ctrl+J command path focuses a tool group and Enter toggles details", async () => {
  let runAction: ((id: string) => void) | undefined;
  let toggles = 0;
  const setup = await testRender(
    () => (
      <AppShell
        fixture="tool-group"
        onActionReady={(run) => {
          runAction = run;
        }}
        onActivityToggle={() => {
          toggles += 1;
        }}
      />
    ),
    { width: 80, height: 24 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  expect(setup.captureCharFrame()).not.toContain("3 lines read");

  expect(runAction).toBeDefined();
  (runAction as (id: string) => void)("home-next");
  const focusedActivity = setup.renderer.currentFocusedRenderable;
  expect(focusedActivity?.id).toContain("activity-");
  expect(focusedActivity?.onKeyDown).toBeFunction();
  await setup.renderOnce();
  expect(setup.renderer.currentFocusedRenderable?.id).toContain("activity-");
  setup.mockInput.pressEnter();
  expect(toggles).toBe(1);
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain("3 lines read");

  setup.mockInput.pressEnter();
  await setup.renderOnce();
  expect(setup.captureCharFrame()).not.toContain("3 lines read");
  const activity = setup.renderer.currentFocusedRenderable;
  expect(activity?.id).toContain("activity-");
  await setup.mockMouse.click(activity?.x ?? 0, activity?.y ?? 0);
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain("3 lines read");
});

test("tool rows expose completed and running states with text-safe markers", async () => {
  const completed = await testRender(() => <AppShell fixture="tool-group" />, {
    width: 100,
    height: 30,
  });
  await completed.renderOnce();
  expect(completed.captureCharFrame()).toContain("✓ READ");
  completed.renderer.destroy();

  const running = await testRender(() => <AppShell fixture="tool-stream" />, {
    width: 100,
    height: 30,
  });
  renderer = running.renderer;
  await running.renderOnce();
  expect(running.captureCharFrame()).toContain("● READ");
});

test("repetitive tool groups collapse to one useful summary", async () => {
  const items = [
    {
      id: "read-1",
      kind: "read" as const,
      label: "READ",
      target: "src/auth/session.ts",
      state: "success" as const,
      durationMs: 12,
      summary: "284 lines",
    },
    {
      id: "read-2",
      kind: "read" as const,
      label: "READ",
      target: "src/auth/token.ts",
      state: "success" as const,
      durationMs: 14,
      summary: "112 lines",
    },
    {
      id: "read-3",
      kind: "read" as const,
      label: "READ",
      target: "tests/auth.test.ts",
      state: "success" as const,
      durationMs: 17,
      summary: "86 lines",
    },
  ];
  const setup = await testRender(
    () => (
      <Activity
        theme={getTheme(true)}
        item={{
          id: "read-group",
          turnId: "read-turn",
          kind: "activity-group",
          label: "READ",
          activities: items,
          expanded: false,
        }}
        forceExpanded={false}
      />
    ),
    { width: 80, height: 8 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  const collapsed = setup.captureCharFrame();
  expect(collapsed).toContain("3 files");
  expect(collapsed).not.toContain("src/auth/token.ts");
});

test("focused activity receives Enter through OpenTUI input", async () => {
  let toggles = 0;
  const items = createUIFixture("tool-group").presentation?.items ?? [];
  const activity = items.find((item) => item.kind === "activity-group");
  expect(activity).toBeDefined();
  const setup = await testRender(
    () => (
      <Transcript
        theme={getTheme(true)}
        items={items}
        width={80}
        onActivityToggle={() => {
          toggles += 1;
        }}
      />
    ),
    { width: 80, height: 18 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  setup.renderer.root.findDescendantById(`activity-${activity?.id}`)?.focus();
  setup.mockInput.pressEnter();
  expect(toggles).toBe(1);
});

test("transcript rerenders when a controlled activity expands", async () => {
  const initialItems = createUIFixture("tool-group").presentation?.items ?? [];
  let expand: (() => void) | undefined;
  const setup = await testRender(
    () => {
      const [expandedIds, setExpandedIds] = createSignal<ReadonlySet<string>>(
        new Set(),
      );
      expand = () => {
        const activity = initialItems.find(
          (item) => item.kind === "activity-group",
        );
        if (activity) setExpandedIds(new Set([activity.id]));
      };
      return (
        <Transcript
          theme={getTheme(true)}
          items={initialItems}
          width={80}
          expandedActivityIds={expandedIds}
        />
      );
    },
    { width: 80, height: 18 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  expect(setup.captureCharFrame()).not.toContain("3 lines read");
  expand?.();
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain("3 lines read");
});

test("OpenTUI test renderer applies Solid signal text updates", async () => {
  let change: (() => void) | undefined;
  const setup = await testRender(
    () => {
      const [value, setValue] = createSignal("closed");
      change = () => setValue("open");
      return <text>{value}</text>;
    },
    { width: 20, height: 2 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain("closed");
  change?.();
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain("open");
});

test("activity reacts to controlled expansion", async () => {
  const group = createUIFixture("tool-group").presentation?.items.find(
    (item) => item.kind === "activity-group",
  );
  expect(group?.kind).toBe("activity-group");
  let expand: (() => void) | undefined;
  const setup = await testRender(
    () => {
      const [expandedIds, setExpandedIds] = createSignal<ReadonlySet<string>>(
        new Set(),
      );
      expand = () => {
        if (group) setExpandedIds(new Set([group.id]));
      };
      return group?.kind === "activity-group" ? (
        <Activity
          theme={getTheme(true)}
          item={group}
          forceExpanded={false}
          expandedIds={expandedIds}
        />
      ) : null;
    },
    { width: 80, height: 18 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  expect(setup.captureCharFrame()).not.toContain("3 lines read");
  expand?.();
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain("3 lines read");
});
