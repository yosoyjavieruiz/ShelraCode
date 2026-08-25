import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { StatusBar } from "../../src/tui/components/StatusBar.js";
import { getTheme } from "../../src/tui/theme/tokens.js";

let renderer: { destroy: () => void } | undefined;
afterEach(() => {
  renderer?.destroy();
  renderer = undefined;
});

// Regression guard for the same reactivity mistake found in Composer.tsx:
// every prop here must be a raw accessor (`notice={notice}`), not an
// already-invoked value (`notice={notice()}`) — the latter freezes at
// whatever the value was on the first render in this render pipeline.
// Confirmed by direct experiment that element *attributes* (`fg`/`visible`)
// do not react here to either form, so StatusBar expresses all dynamic
// state (including show/hide) as text content instead.
test("status bar animates the spinner frame while busy", async () => {
  const frames = ["⠋", "⠙", "⠹"] as const;
  const [frame, setFrame] = createSignal<string>(frames[0]);
  const setup = await testRender(
    () => (
      <StatusBar
        theme={getTheme(true)}
        notice={() => "Reading file.ts"}
        width={() => 80}
        busy={() => true}
        spinnerFrame={frame}
        elapsedSeconds={() => 0}
      />
    ),
    { width: 80, height: 2 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain("⠋ Reading file.ts");

  setFrame(frames[1]);
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain("⠙ Reading file.ts");
  expect(setup.captureCharFrame()).not.toContain("⠋ Reading file.ts");
});

test("status bar shows elapsed time and an interrupt hint while busy, neither when idle", async () => {
  const [seconds, setSeconds] = createSignal(0);
  const setup = await testRender(
    () => (
      <StatusBar
        theme={getTheme(true)}
        notice={() => "Running tests"}
        width={() => 80}
        busy={() => true}
        spinnerFrame={() => "⠋"}
        elapsedSeconds={seconds}
      />
    ),
    { width: 80, height: 2 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  // Elapsed time only renders once it's meaningfully nonzero.
  expect(setup.captureCharFrame()).not.toContain("· 0s");
  expect(setup.captureCharFrame()).toContain("Esc interrupt");

  setSeconds(75);
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain("· 1m15s");
});

test("status bar shows neither spinner nor elapsed time when idle", async () => {
  const setup = await testRender(
    () => (
      <StatusBar
        theme={getTheme(true)}
        notice={() => "Ready"}
        width={() => 80}
        busy={() => false}
        spinnerFrame={() => "⠋"}
        elapsedSeconds={() => 42}
      />
    ),
    { width: 80, height: 2 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).not.toContain("⠋");
  expect(frame).not.toContain("42s");
  expect(frame).not.toContain("Esc interrupt");
  expect(frame).toContain("Ready");
});

test("status bar can stay active without competing with a transcript indicator", async () => {
  const setup = await testRender(
    () => (
      <StatusBar
        theme={getTheme(true)}
        notice={() => "Running tests"}
        width={() => 80}
        busy={() => true}
        showSpinner={() => false}
        spinnerFrame={() => "â ‹"}
        elapsedSeconds={() => 8}
      />
    ),
    { width: 80, height: 2 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).not.toContain("â ‹");
  expect(frame).toContain("Running tests");
  expect(frame).toContain("8s");
  expect(frame).toContain("Esc interrupt");
});
