import { expect, test } from "bun:test";
import {
  getCoreContentGeometry,
  getCoreVerticalLayout,
} from "../../src/tui/state/layout.js";

const horizontalCases: Array<{ terminal: number; x: number; width: number }> = [
  { terminal: 80, x: 1, width: 78 },
  { terminal: 88, x: 1, width: 86 },
  { terminal: 89, x: 3, width: 83 },
  { terminal: 100, x: 3, width: 94 },
  { terminal: 109, x: 3, width: 103 },
  { terminal: 110, x: 3, width: 104 },
  { terminal: 120, x: 3, width: 114 },
  { terminal: 139, x: 11, width: 116 },
  { terminal: 140, x: 6, width: 128 },
  { terminal: 160, x: 16, width: 128 },
  { terminal: 179, x: 25, width: 128 },
  { terminal: 180, x: 20, width: 140 },
  { terminal: 200, x: 30, width: 140 },
];

test.each(horizontalCases)(
  "core content geometry uses the adaptive reading column at $terminal columns",
  ({ terminal, x, width }) => {
    const geometry = getCoreContentGeometry(terminal);
    expect(geometry).toEqual({ x, width });
    expect(geometry.x).toBeGreaterThanOrEqual(0);
    expect(geometry.x + geometry.width).toBeLessThanOrEqual(terminal);
    const rightMargin = terminal - geometry.x - geometry.width;
    expect(Math.abs(rightMargin - geometry.x)).toBeLessThanOrEqual(1);
  },
);

test.each([
  { width: 80, height: 24 },
  { width: 100, height: 30 },
  { width: 120, height: 40 },
  { width: 140, height: 45 },
  { width: 160, height: 50 },
  { width: 200, height: 60 },
])(
  "vertical regions never overlap at $width x $height",
  ({ width, height }) => {
    const layout = getCoreVerticalLayout(width, height, 0);
    expect(layout.header).toEqual({ y: 0, height: 1 });
    expect(layout.status.y + layout.status.height).toBe(height);
    expect(layout.viewport.y).toBe(layout.header.y + layout.header.height);
    expect(layout.viewport.y + layout.viewport.height).toBe(layout.composer.y);
    expect(layout.composer.y + layout.composer.height).toBe(layout.status.y);
    expect(layout.viewport.height).toBeGreaterThan(0);
  },
);

test("composer grows to a bounded eight-row editor without covering status", () => {
  const compact = getCoreVerticalLayout(80, 24, 20);
  const normal = getCoreVerticalLayout(120, 40, 20);
  expect(compact.composer.inputRows).toBeLessThanOrEqual(5);
  expect(normal.composer.inputRows).toBe(8);
  expect(compact.composer.y + compact.composer.height).toBe(compact.status.y);
  expect(normal.composer.y + normal.composer.height).toBe(normal.status.y);
});
