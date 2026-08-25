import { describe, expect, test } from "bun:test";
import {
  filterUICommands,
  getCommandSlashes,
  type UICommand,
} from "../../src/tui/commands/registry.js";
import { getLayoutMode, getLayoutProfile } from "../../src/tui/state/layout.js";
import { getTheme, themeColor } from "../../src/tui/theme/tokens.js";

describe("Obsidian Violet foundation", () => {
  test("uses a true-black canvas and semantic colors", () => {
    const theme = getTheme(false);

    expect(theme.colors.background.canvas).toBe("#000000");
    expect(theme.colors.purple[500]).toBe("#8B5CF6");
    expect(theme.colors.text.primary).toBe("#F5F5F7");
    expect(themeColor(theme, theme.colors.status.success)).toBe(
      theme.colors.status.success,
    );
  });

  test("neutral tokens match the exact Obsidian Violet spec", () => {
    const theme = getTheme(false);

    expect(theme.colors.background.canvas).toBe("#000000");
    expect(theme.colors.background.surface).toBe("#050506");
    expect(theme.colors.background.elevated).toBe("#08080A");
    expect(theme.colors.background.active).toBe("#15101D");
    expect(theme.colors.border.subtle).toBe("#141416");
    expect(theme.colors.border.default).toBe("#202024");
    expect(theme.colors.border.strong).toBe("#34343A");
    expect(theme.colors.text.primary).toBe("#F5F5F7");
    expect(theme.colors.text.secondary).toBe("#A1A1AA");
    expect(theme.colors.text.tertiary).toBe("#71717A");
    expect(theme.colors.text.muted).toBe("#52525B");
    expect(theme.colors.purple[500]).toBe("#8B5CF6");
    expect(theme.colors.purple[600]).toBe("#7C3AED");
    expect(theme.colors.purple[400]).toBe("#A78BFA");
  });

  test("keeps hierarchy usable when NO_COLOR is active", () => {
    const theme = getTheme(true);

    expect(theme.colorsEnabled).toBe(false);
    expect(themeColor(theme, theme.colors.purple[500])).toBeUndefined();
  });
});

describe("responsive layout", () => {
  test.each([
    [79, "narrow"],
    [80, "compact"],
    [109, "compact"],
    [110, "medium"],
    [149, "medium"],
    [150, "wide"],
  ] as const)("maps %d columns to %s", (width, expected) => {
    expect(getLayoutMode(width)).toBe(expected);
  });

  test("drops secondary regions before the conversation", () => {
    expect(getLayoutProfile(160)).toMatchObject({
      navigation: "hidden",
      inspector: "hidden",
    });
    expect(getLayoutProfile(120)).toMatchObject({
      navigation: "hidden",
      inspector: "hidden",
    });
    expect(getLayoutProfile(90)).toMatchObject({
      navigation: "hidden",
      inspector: "hidden",
    });
  });
});

describe("unified UI command registry", () => {
  const commands: UICommand[] = [
    {
      id: "models",
      slash: "/models",
      label: "Open Models",
      description: "Browse local and free cloud models",
      category: "Models",
      keywords: ["model", "local", "cloud"],
    },
    {
      id: "routing",
      slash: "/routing",
      label: "Routing",
      description: "Inspect the current route",
      category: "Routing",
      keywords: ["route", "policy"],
    },
    {
      id: "settings",
      slash: "/settings",
      label: "Settings",
      category: "Settings",
    },
  ];

  test("filters by label, slash command, description, and keywords", () => {
    expect(filterUICommands(commands, "cloud").map((item) => item.id)).toEqual([
      "models",
    ]);
    expect(filterUICommands(commands, "/route").map((item) => item.id)).toEqual(
      ["routing"],
    );
  });

  test("returns only commands with slash entries for autocomplete", () => {
    expect(getCommandSlashes(commands)).toEqual([
      "/models",
      "/routing",
      "/settings",
    ]);
  });
});
