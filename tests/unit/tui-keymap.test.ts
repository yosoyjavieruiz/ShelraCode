import { afterEach, expect, test } from "bun:test";
import { registerTimedLeader } from "@opentui/keymap/addons";
import { createTestKeymap } from "@opentui/keymap/testing";
import { HOME_SHORTCUTS } from "../../src/tui/commands/keybindings.js";

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

test("LocalCode leader shortcuts dispatch named UI commands", () => {
  const harness = createTestKeymap({ defaultKeys: true });
  cleanup = harness.cleanup;
  const calls: string[] = [];
  const disposeLeader = registerTimedLeader(harness.keymap, {
    trigger: { key: { name: "x", ctrl: true } },
    timeoutMs: 1_500,
  });
  harness.keymap.registerLayer({
    commands: [
      {
        name: "localcode.models",
        run: () => {
          calls.push("models");
        },
      },
    ],
    bindings: [{ key: "<leader>m", cmd: "localcode.models" }],
  });

  harness.host.press("x", { ctrl: true });
  harness.host.press("m");

  expect(calls).toEqual(["models"]);
  disposeLeader();
});

test("Home suggestion shortcuts dispatch before the composer", () => {
  const harness = createTestKeymap({ defaultKeys: true });
  cleanup = harness.cleanup;
  const calls: string[] = [];
  harness.keymap.registerLayer({
    priority: 100,
    commands: HOME_SHORTCUTS.map(([, id]) => ({
      name: `localcode.${id}`,
      run: () => {
        calls.push(id);
      },
    })),
    bindings: HOME_SHORTCUTS.map(([key, id]) => ({
      key,
      cmd: `localcode.${id}`,
    })),
  });

  harness.host.press("j", { ctrl: true });
  harness.host.press("k", { ctrl: true });

  expect(calls).toEqual(["home-next", "home-previous"]);
});
