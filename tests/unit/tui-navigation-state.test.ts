import { expect, test } from "bun:test";
import { resolveEscapeAction } from "../../src/tui/state/navigation.js";

test("Escape closes an overlay before changing the underlying screen", () => {
  expect(
    resolveEscapeAction({
      overlayOpen: true,
      screen: "models",
      activeTask: false,
      draft: "",
    }),
  ).toBe("close-overlay");
});

test("Escape returns from a workspace to conversation", () => {
  expect(
    resolveEscapeAction({
      overlayOpen: false,
      screen: "settings",
      activeTask: false,
      draft: "",
    }),
  ).toBe("return-conversation");
});

test("Escape cancels an active task before clearing a draft", () => {
  expect(
    resolveEscapeAction({
      overlayOpen: false,
      screen: "conversation",
      activeTask: true,
      draft: "draft",
    }),
  ).toBe("cancel-task");
  expect(
    resolveEscapeAction({
      overlayOpen: false,
      screen: "conversation",
      activeTask: false,
      draft: "draft",
    }),
  ).toBe("clear-draft");
});
