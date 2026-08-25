import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { AppShell } from "../../src/tui/app.js";

let renderer: { destroy: () => void } | undefined;

afterEach(() => {
  renderer?.destroy();
  renderer = undefined;
});

async function renderFixture(
  fixture: "palette" | "context-picker" | "model-picker" | "approval",
  width = 100,
  height = 30,
) {
  const setup = await testRender(() => <AppShell fixture={fixture} />, {
    width,
    height,
  });
  renderer = setup.renderer;
  await setup.renderOnce();
  await new Promise((resolve) => setTimeout(resolve, 25));
  await setup.renderOnce();
  return setup;
}

test("context picker filters, toggles by keyboard and mouse, and updates composer context", async () => {
  const setup = await renderFixture("context-picker");
  expect(setup.captureCharFrame()).toContain("Context");
  expect(setup.captureCharFrame()).toContain("package.json");
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("context-search");

  await setup.mockInput.typeText("package");
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain("package.json");
  expect(setup.captureCharFrame()).not.toContain("src/tui/app.tsx");

  setup.mockInput.pressEnter();
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain("1 selected");

  setup.mockInput.pressEscape();
  await new Promise((resolve) => setTimeout(resolve, 60));
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain("@ context 1");
  expect(setup.renderer.currentFocusedRenderable?.id).toBe(
    "core-composer-input",
  );

  let runAction: ((id: string) => void) | undefined;
  setup.renderer.destroy();
  const mouseSetup = await testRender(
    () => (
      <AppShell
        fixture="context-picker"
        onActionReady={(run) => {
          runAction = run;
        }}
      />
    ),
    { width: 100, height: 30 },
  );
  renderer = mouseSetup.renderer;
  await mouseSetup.renderOnce();
  await new Promise((resolve) => setTimeout(resolve, 25));
  await mouseSetup.renderOnce();
  const row = mouseSetup.renderer.root.findDescendantById("context-option-1");
  expect(row).toBeDefined();
  await mouseSetup.mockMouse.click(row?.x ?? 0, row?.y ?? 0);
  await mouseSetup.renderOnce();
  expect(mouseSetup.captureCharFrame()).toContain("1 selected");
  expect(runAction).toBeDefined();
});

test("typing @ opens the file reference picker from the composer", async () => {
  const setup = await testRender(() => <AppShell fixture="home" />, {
    width: 100,
    height: 30,
  });
  renderer = setup.renderer;
  await setup.renderOnce();

  await setup.mockInput.typeText("@");
  await setup.renderOnce();

  expect(setup.captureCharFrame()).toContain("Context");
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("context-search");
});

test("pasting a structured prompt with CSS at-rules keeps the composer focused", async () => {
  const setup = await testRender(() => <AppShell fixture="conversation" />, {
    width: 100,
    height: 30,
  });
  renderer = setup.renderer;
  await setup.renderOnce();

  const prompt =
    "Build a page\n\n@media (prefers-reduced-motion: reduce) {\n  animation: none;\n}\nContinue the implementation.";
  await setup.mockInput.pasteBracketedText(prompt);
  await setup.renderOnce();

  const editor = setup.renderer.root.findDescendantById(
    "core-composer-input",
  ) as { plainText?: string } | undefined;
  expect(setup.captureCharFrame()).not.toContain("Context");
  expect(editor?.plainText).toBe(prompt);
  expect(setup.renderer.currentFocusedRenderable?.id).toBe(
    "core-composer-input",
  );
});

test("approval Escape denies and returns focus to the composer", async () => {
  const setup = await renderFixture("approval");
  const frame = setup.captureCharFrame();
  expect(frame).toContain("Approval required");
  expect(frame).toContain("npm publish");
  expect(setup.renderer.currentFocusedRenderable?.id).toBe("approval-dialog");
  setup.mockInput.pressEscape();
  await new Promise((resolve) => setTimeout(resolve, 60));
  await setup.renderOnce();
  expect(setup.captureCharFrame()).toContain("Approval denied");
  expect(setup.renderer.currentFocusedRenderable?.id).toBe(
    "core-composer-input",
  );
});
