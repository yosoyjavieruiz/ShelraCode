import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { createSignal } from "solid-js";
import { AgentMatrixPulse } from "../../src/tui/components/AgentMatrixPulse.js";
import { getTheme } from "../../src/tui/theme/tokens.js";

let renderer: { destroy: () => void } | undefined;
afterEach(() => {
  renderer?.destroy();
  renderer = undefined;
});

// The matrix keeps its signature while using roughly half the previous dot
// area: 2x2 instead of 3x3, still borderless and compact in the conversation.
test("agent matrix has no border and stays to two compact lines", async () => {
  const setup = await testRender(
    () => (
      <AgentMatrixPulse
        theme={getTheme(true)}
        phase={() => "discover"}
        tick={() => 0}
        elapsedSeconds={() => 2}
        width={() => 80}
      />
    ),
    { width: 80, height: 8 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).not.toMatch(/[╭╮╰╯│─]/);
  const nonBlankLines = frame
    .split("\n")
    .filter((line) => line.trim().length > 0);
  expect(nonBlankLines.length).toBe(2);
  expect(frame).toContain("● ·");
  expect(frame).toContain("· ·");
});

test("agent matrix renders the phase label and an interrupt hint", async () => {
  const setup = await testRender(
    () => (
      <AgentMatrixPulse
        theme={getTheme(true)}
        phase={() => "discover"}
        tick={() => 0}
        elapsedSeconds={() => 0}
        width={() => 80}
      />
    ),
    { width: 80, height: 8 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("Agent · Exploring repository");
  expect(frame).toContain("Esc interrupt");
});

test("agent matrix shows elapsed time once meaningfully nonzero", async () => {
  const setup = await testRender(
    () => (
      <AgentMatrixPulse
        theme={getTheme(true)}
        phase={() => "verify"}
        tick={() => 0}
        elapsedSeconds={() => 8}
        width={() => 80}
      />
    ),
    { width: 80, height: 8 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("Agent · Verifying");
  expect(frame).toContain("8s · Esc interrupt");
});

// The orbiting dot is the whole point of the component (docs/ui-chat-v2/
// AGENT-MATRIX.md) — this is the regression guard that the matrix actually
// animates rather than freezing on the first frame, the exact failure mode
// this project has hit before with props that look reactive but aren't
// (see the Composer/StatusBar history in AgentMatrixPulse's own comments).
test("agent matrix's dot orbit visibly changes as tick advances", async () => {
  const [tick, setTick] = createSignal(0);
  const setup = await testRender(
    () => (
      <AgentMatrixPulse
        theme={getTheme(true)}
        phase={() => "plan"}
        tick={tick}
        elapsedSeconds={() => 0}
        width={() => 80}
      />
    ),
    { width: 80, height: 8 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  const first = setup.captureCharFrame();

  setTick(1);
  await setup.renderOnce();
  const second = setup.captureCharFrame();

  setTick(2);
  await setup.renderOnce();
  const third = setup.captureCharFrame();

  // Every advance moves the single lit dot to a different cell, so each
  // captured grid must differ from the one before it.
  expect(second).not.toBe(first);
  expect(third).not.toBe(second);
  expect(third).not.toBe(first);
});

test("reduced motion collapses the matrix to one static line, no animated glyph", async () => {
  const setup = await testRender(
    () => (
      <AgentMatrixPulse
        theme={getTheme(true)}
        phase={() => "discover"}
        tick={() => 3}
        elapsedSeconds={() => 0}
        width={() => 80}
        reducedMotion={() => true}
      />
    ),
    { width: 80, height: 8 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("Agent · Exploring repository");
  expect(frame).not.toContain("●");
});

test("narrow terminals fall back to the compact single-line form", async () => {
  const setup = await testRender(
    () => (
      <AgentMatrixPulse
        theme={getTheme(true)}
        phase={() => "analyze"}
        tick={() => 0}
        elapsedSeconds={() => 0}
        width={() => 30}
      />
    ),
    { width: 30, height: 8 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("Agent · Understanding");
  expect(frame).toContain("request");
  expect(frame).not.toContain("●");
});

// Color escalation (violet -> amber past 10s, docs/ui-chat-v2/RESEARCH.md)
// isn't assertable through captureCharFrame (this suite doesn't inspect
// cell colors anywhere — see StatusBar's tests for the same convention),
// so this is a smoke test: the long-wait path renders the same content
// correctly rather than crashing or dropping text once "warm" flips on.
test("a long-running turn (past the amber threshold) still renders correctly", async () => {
  const setup = await testRender(
    () => (
      <AgentMatrixPulse
        theme={getTheme(true)}
        phase={() => "verify"}
        tick={() => 5}
        elapsedSeconds={() => 42}
        width={() => 80}
      />
    ),
    { width: 80, height: 8 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("Agent · Verifying");
  expect(frame).toContain("42s · Esc interrupt");
});

test("interruptible=false hides the interrupt hint", async () => {
  const setup = await testRender(
    () => (
      <AgentMatrixPulse
        theme={getTheme(true)}
        phase={() => "discover"}
        tick={() => 0}
        elapsedSeconds={() => 0}
        width={() => 80}
        interruptible={() => false}
      />
    ),
    { width: 80, height: 8 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  expect(setup.captureCharFrame()).not.toContain("Esc interrupt");
});
