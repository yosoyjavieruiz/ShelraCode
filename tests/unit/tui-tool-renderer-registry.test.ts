import { expect, test } from "bun:test";
import {
  ToolRendererRegistry,
  getToolRenderer,
} from "../../src/tui/components/tool-renderers.js";

test("known activity kinds resolve to dedicated tool renderers", () => {
  expect(getToolRenderer("read")).toBe(ToolRendererRegistry.read);
  expect(getToolRenderer("search")).toBe(ToolRendererRegistry.search);
  expect(getToolRenderer("edit")).toBe(ToolRendererRegistry.edit);
  expect(getToolRenderer("run")).toBe(ToolRendererRegistry.run);
  expect(getToolRenderer("test")).toBe(ToolRendererRegistry.test);
});

test("unknown or malformed renderer metadata falls back safely", () => {
  expect(getToolRenderer("unknown")).toBe(ToolRendererRegistry.generic);
  expect(getToolRenderer(undefined)).toBe(ToolRendererRegistry.generic);
  expect(getToolRenderer(null)).toBe(ToolRendererRegistry.generic);
});
