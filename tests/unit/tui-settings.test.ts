import { expect, test } from "bun:test";
import {
  filterSettingIndices,
  moveSettingIndex,
} from "../../src/tui/state/settings.js";

test("settings search keeps only matching backed controls", () => {
  expect(filterSettingIndices("routing")).toEqual([5]);
  expect(filterSettingIndices("mode")).toEqual([5, 6]);
  expect(filterSettingIndices("policy")).toEqual([4, 5, 6]);
  expect(filterSettingIndices("violet")).toEqual([1]);
  expect(filterSettingIndices("private")).toEqual([4]);
});

test("settings selection wraps within the filtered rows", () => {
  expect(moveSettingIndex(5, 1, "mode")).toBe(6);
  expect(moveSettingIndex(6, 1, "mode")).toBe(5);
});
