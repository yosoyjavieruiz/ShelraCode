import { createCliRenderer } from "@opentui/core";
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui";
import { registerTimedLeader } from "@opentui/keymap/addons";
import { KeymapProvider } from "@opentui/keymap/solid";
import { render } from "@opentui/solid";
import { AppShell } from "./app.js";
import { HOME_SHORTCUTS, LEADER_SHORTCUTS } from "./commands/keybindings.js";
import { readUIFixture } from "./state/fixtures.js";
import {
  prepareInteractiveTerminal,
  shouldCancelOnSignal,
} from "./terminal.js";

export async function launchTui(
  initialScreen: "conversation" | "setup" = "conversation",
): Promise<void> {
  prepareInteractiveTerminal({
    env: process.env,
    platform: process.platform,
    isInteractive: Boolean(process.stdin.isTTY && process.stdout.isTTY),
  });

  const renderer = await createCliRenderer({
    exitOnCtrlC: false,
    // Keep the chat in a dedicated alternate-screen surface: the transcript
    // and composer own the full frame, and teardown restores the caller's
    // shell instead of appending a second UI below it.
    screenMode: "alternate-screen",
    targetFps: 30,
  });
  const keymap = createDefaultOpenTuiKeymap(renderer);
  let runAction: ((id: string) => void) | undefined;
  let taskActive = false;
  registerTimedLeader(keymap, {
    trigger: { key: { name: "x", ctrl: true } },
    timeoutMs: 1_500,
  });
  keymap.registerLayer({
    priority: 100,
    commands: [
      {
        name: "shelracode.palette",
        run: () => runAction?.("palette"),
      },
      ...LEADER_SHORTCUTS.map(([key, id]) => ({
        name: `shelracode.${id}`,
        run: () => runAction?.(id),
        keybinding: `<leader>${key}`,
      })),
      ...HOME_SHORTCUTS.map(([key, id]) => ({
        name: `shelracode.${id}`,
        run: () => runAction?.(id),
        keybinding: key,
      })),
    ],
    bindings: [
      { key: "ctrl+p", cmd: "shelracode.palette" },
      ...LEADER_SHORTCUTS.map(([key, id]) => ({
        key: `<leader>${key}`,
        cmd: `shelracode.${id}`,
      })),
      ...HOME_SHORTCUTS.map(([key, id]) => ({
        key,
        cmd: `shelracode.${id}`,
      })),
    ],
  });

  let shuttingDown = false;
  const teardown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    renderer.destroy();
  };
  const onSignal = (): void => {
    // Ctrl+C is a task cancellation while the app is mounted. Only exit when
    // there is no active task to cancel; this prevents SIGINT from tearing
    // down the renderer before runAgent can persist `cancelled`.
    if (shouldCancelOnSignal(taskActive)) {
      runAction?.("cancel-task");
      return;
    }
    teardown();
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);
  try {
    await new Promise<void>((resolve, reject) => {
      const renderPromise = render(
        () => (
          <KeymapProvider keymap={keymap}>
            <AppShell
              initialScreen={initialScreen}
              fixture={readUIFixture()}
              onExit={() => {
                setTimeout(teardown, 0);
              }}
              onActionReady={(run) => {
                runAction = run;
              }}
              onTaskStateChange={(active) => {
                taskActive = active;
              }}
            />
          </KeymapProvider>
        ),
        renderer,
      );
      renderer.once("destroy", resolve);
      void renderPromise.catch((error: unknown) => {
        teardown();
        reject(error);
      });
    });
    process.exitCode = 0;
  } finally {
    process.removeListener("SIGINT", onSignal);
    process.removeListener("SIGTERM", onSignal);
  }
}
