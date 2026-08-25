import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import {
  HomeView,
  homeSuggestions,
  moveHomeSuggestionIndex,
} from "../../src/tui/views/HomeView.js";
import { getTheme } from "../../src/tui/theme/tokens.js";

let renderer: { destroy: () => void } | undefined;
afterEach(() => {
  renderer?.destroy();
  renderer = undefined;
});

test("home suggestion movement starts predictably and wraps", () => {
  expect(moveHomeSuggestionIndex(-1, 1, 3)).toBe(0);
  expect(moveHomeSuggestionIndex(-1, -1, 3)).toBe(2);
  expect(moveHomeSuggestionIndex(2, 1, 3)).toBe(0);
});

test("home suggestion has a text-safe selected marker at 80 columns", async () => {
  const setup = await testRender(
    () => (
      <HomeView
        theme={getTheme(true)}
        width={78}
        dirty
        selectedIndex={() => 1}
        onSelect={() => undefined}
        onSuggestion={() => undefined}
      />
    ),
    { width: 80, height: 18 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain("› Run tests for changed files");
});

test("home content anchors near the top at tall terminal heights instead of centering", async () => {
  const setup = await testRender(
    () => (
      <HomeView
        theme={getTheme(true)}
        width={160}
        height={50}
        dirty
        selectedIndex={() => 0}
        onSelect={() => undefined}
        onSuggestion={() => undefined}
      />
    ),
    { width: 160, height: 50 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  const lines = frame.split("\n");
  // The restored logo is followed by its tagline, so anchoring is checked
  // against the stable tagline row rather than a variable-width glyph row.
  const brandLine = lines.findIndex((line) =>
    line.includes("Maximum intelligence. Your way."),
  );
  // Anchored near the top: brand mark must appear within the first 12 rows
  // of a 50-row viewport, not vertically centered around row 24-25.
  expect(brandLine).toBeGreaterThanOrEqual(0);
  expect(brandLine).toBeLessThan(12);
});

test("home hero restores the original ShelraCode logo at generous widths", async () => {
  const setup = await testRender(
    () => (
      <HomeView
        theme={getTheme(true)}
        width={120}
        height={40}
        dirty={false}
        selectedIndex={() => -1}
        onSelect={() => undefined}
        onSuggestion={() => undefined}
      />
    ),
    { width: 120, height: 40 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("Maximum intelligence. Your way.");
  expect(frame).toContain(String.fromCodePoint(0x2588));
  expect(frame).not.toContain("Local-first coding agent");
  expect(
    frame
      .split("\n")
      // The final wordmark row uses box-drawing `═`/`╝` glyphs rather than
      // full blocks, so count both glyph families that make up the logo.
      .filter((line) => /[█═]/u.test(line)),
  ).toHaveLength(6);
});

test("home hero keeps the compact brand mark at narrow widths", async () => {
  const setup = await testRender(
    () => (
      <HomeView
        theme={getTheme(true)}
        width={40}
        height={24}
        dirty={false}
        selectedIndex={() => -1}
        onSelect={() => undefined}
        onSuggestion={() => undefined}
      />
    ),
    { width: 40, height: 24 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("ShelraCode");
});

test("home status line names the working directory and branch, matching Claude Code's welcome-screen convention", async () => {
  const setup = await testRender(
    () => (
      <HomeView
        theme={getTheme(true)}
        width={78}
        model="qwen2.5-coder-7b"
        workspace="shelra"
        branch="main"
        dirty={false}
        selectedIndex={() => -1}
        onSelect={() => undefined}
        onSuggestion={() => undefined}
      />
    ),
    { width: 80, height: 18 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("shelra · main · Local ready · qwen2.5-coder-7b");
  expect(frame).toContain("Try");
});

test("home status line falls back cleanly when workspace/branch are unknown", async () => {
  const setup = await testRender(
    () => (
      <HomeView
        theme={getTheme(true)}
        width={78}
        dirty={false}
        selectedIndex={() => -1}
        onSelect={() => undefined}
        onSuggestion={() => undefined}
      />
    ),
    { width: 80, height: 18 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain("Local-first routing ready");
});

test("home keyboard hint is visible at narrow widths and expands at wide ones", async () => {
  const narrow = await testRender(
    () => (
      <HomeView
        theme={getTheme(true)}
        width={72}
        dirty={false}
        selectedIndex={() => -1}
        onSelect={() => undefined}
        onSuggestion={() => undefined}
      />
    ),
    { width: 72, height: 18 },
  );
  await narrow.renderOnce();
  expect(narrow.captureCharFrame()).toContain("↑↓ · Enter · Ctrl+P");
  narrow.renderer.destroy();

  const wide = await testRender(
    () => (
      <HomeView
        theme={getTheme(true)}
        width={120}
        dirty={false}
        selectedIndex={() => -1}
        onSelect={() => undefined}
        onSuggestion={() => undefined}
      />
    ),
    { width: 120, height: 30 },
  );
  await wide.renderOnce();
  expect(wide.captureCharFrame()).toContain(
    "↑↓ browse · Enter to run · Ctrl+P commands",
  );
  wide.renderer.destroy();
});

test("focused home suggestion activates with Enter", async () => {
  let selected = "";
  const setup = await testRender(
    () => (
      <HomeView
        theme={getTheme(true)}
        width={78}
        dirty={false}
        selectedIndex={() => 0}
        onSelect={() => undefined}
        onSuggestion={(value) => {
          selected = value;
        }}
      />
    ),
    { width: 80, height: 18 },
  );
  renderer = setup.renderer;
  await setup.renderOnce();
  setup.renderer.root.findDescendantById("home-suggestion-0")?.focus();
  setup.mockInput.pressEnter();
  expect(selected).toBe(homeSuggestions(false)[0] as string);
});
