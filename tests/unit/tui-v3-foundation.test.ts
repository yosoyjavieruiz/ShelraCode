import { expect, test } from "bun:test";
import { getLayoutProfile } from "../../src/tui/state/layout.js";
import { getTheme, themeColor } from "../../src/tui/theme/tokens.js";

test.each([80, 100, 120, 160, 200])(
  "conversation-first layout keeps secondary regions transient at %d columns",
  (width) => {
    const profile = getLayoutProfile(width);
    expect(profile.navigation).toBe("hidden");
    expect(profile.inspector).toBe("hidden");
    expect(profile.composerRows).toBeGreaterThanOrEqual(2);
    expect(profile.showExtendedStatus).toBe(width >= 120);
  },
);

test("no-color keeps semantic foreground absent without removing the token contract", () => {
  const theme = getTheme(true);
  expect(theme.colors.background.canvas).toBe("#000000");
  expect(theme.colors.purple[500]).toBe("#8B5CF6");
  expect(themeColor(theme, theme.colors.text.primary)).toBeUndefined();
});
