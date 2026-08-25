import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { ProgressBar } from "../../src/tui/components/ProgressBar.js";
import { SelectableRow } from "../../src/tui/components/SelectableRow.js";
import { StatusMark } from "../../src/tui/components/StatusMark.js";
import { WorkspaceHeader } from "../../src/tui/components/WorkspaceHeader.js";
import { getTheme } from "../../src/tui/theme/tokens.js";

const renderers: Array<{ destroy: () => void }> = [];
afterEach(() => {
  for (const renderer of renderers) renderer.destroy();
  renderers.length = 0;
});

test("semantic primitives expose text labels in no-color mode", async () => {
  const setup = await testRender(
    () => (
      <box flexDirection="column" width="100%">
        <WorkspaceHeader
          theme={getTheme(true)}
          eyebrow="Models"
          title="Choose a model"
        />
        <StatusMark theme={getTheme(true)} state="success" label="Healthy" />
        <SelectableRow
          theme={getTheme(true)}
          title="Qwen Coder"
          subtitle="Local · 32k context"
          trailing="active"
          focused
          selected
        />
        <ProgressBar theme={getTheme(true)} label="Quota" value={3} max={10} />
      </box>
    ),
    { width: 60, height: 10 },
  );
  renderers.push(setup.renderer);
  await setup.renderOnce();
  const frame = setup.captureCharFrame();
  expect(frame).toContain("MODELS");
  expect(frame).toContain("Choose a model");
  expect(frame).toContain("Healthy");
  expect(frame).toContain("Qwen Coder");
  expect(frame).toContain("active");
  expect(frame).toContain("Quota");
  expect(frame).toContain("30%");
});
