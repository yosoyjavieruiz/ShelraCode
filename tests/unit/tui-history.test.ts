import { expect, test } from "bun:test";
import {
  addPromptToHistory,
  navigatePromptHistory,
} from "../../src/tui/state/history.js";

test("prompt history keeps recent unique prompts newest first", () => {
  let history: string[] = [];
  history = addPromptToHistory(history, "first");
  history = addPromptToHistory(history, "second");
  history = addPromptToHistory(history, "first");
  expect(history).toEqual(["first", "second"]);
});

test("prompt history navigates up and returns the draft at the bottom", () => {
  const history = ["first", "second"];
  const first = navigatePromptHistory(history, -1, -1, "draft");
  expect(first).toEqual({ index: 1, value: "second", draft: "draft" });
  const second = navigatePromptHistory(
    history,
    first.index,
    -1,
    first.draft,
  );
  expect(second).toEqual({ index: 0, value: "first", draft: "draft" });
  const bottom = navigatePromptHistory(
    history,
    second.index,
    1,
    second.draft,
  );
  expect(bottom).toEqual({ index: 1, value: "second", draft: "draft" });
  const restored = navigatePromptHistory(
    history,
    bottom.index,
    1,
    bottom.draft,
  );
  expect(restored).toEqual({ index: -1, value: "draft", draft: "draft" });
});
