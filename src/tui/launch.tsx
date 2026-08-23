import { createCliRenderer } from "@opentui/core";
import { render } from "@opentui/solid";
import { AppShell } from "./app.js";

export async function launchTui(): Promise<void> {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    targetFps: 30,
  });

  await new Promise<void>((resolve, reject) => {
    renderer.once("destroy", resolve);

    void render(() => <AppShell />, renderer).catch((error: unknown) => {
      renderer.destroy();
      reject(error);
    });
  });
}
