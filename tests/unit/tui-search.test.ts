import { expect, test } from "bun:test";
import {
  createUICommands,
  rankUICommands,
  type UICommand,
} from "../../src/tui/commands/registry.js";
import { rankFileReferences } from "../../src/tui/state/search.js";

const commands: UICommand[] = [
  {
    id: "models",
    label: "Open Models",
    slash: "/models",
    description: "Choose a local or free cloud model",
    category: "Models",
    keywords: ["catalog", "picker"],
  },
  {
    id: "routing",
    label: "Routing",
    slash: "/routing",
    description: "Explain the selected route",
    category: "Routing",
    keywords: ["route", "policy"],
  },
];

test("fuzzy command search matches non-contiguous query letters", () => {
  expect(rankUICommands(commands, "mdl").map((command) => command.id)).toEqual([
    "models",
  ]);
  expect(rankUICommands(commands, "rte").map((command) => command.id)).toEqual([
    "routing",
  ]);
});

test("fuzzy ranking keeps exact and prefix matches ahead of weaker matches", () => {
  const results = rankUICommands(commands, "model");
  expect(results[0]?.id).toBe("models");
});

test("slash aliases outrank neighboring labels", () => {
  const results = rankUICommands(
    [
      {
        id: "models",
        slash: "/models",
        label: "Open Models",
        category: "Models",
      },
      {
        id: "model",
        slash: "/model",
        label: "Switch model",
        category: "Models",
      },
    ],
    "/model",
  );
  expect(results[0]?.id).toBe("model");
});

test("permissions keeps the canonical slash command", () => {
  const commands = createUICommands(() => undefined);
  const permissionCommand = commands.find(
    (command) => command.id === "permissions",
  );

  expect(permissionCommand?.slash).toBe("/permissions");
  expect(commands.some((command) => command.slash === "/permiss")).toBe(false);
});

test("file references use non-contiguous fuzzy matching", () => {
  const results = rankFileReferences(
    ["package.json", "src/tui/app.tsx", "docs/ARCHITECTURE.md"],
    "stapp",
  );
  expect(results[0]).toBe("src/tui/app.tsx");
  expect(results).not.toContain("package.json");
});
