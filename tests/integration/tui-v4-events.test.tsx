import { afterEach, expect, test } from "bun:test";
import { testRender } from "@opentui/solid";
import { AppShell } from "../../src/tui/app.js";
import type { UIFixtureKind } from "../../src/tui/state/fixtures.js";

let renderer: { destroy: () => void } | undefined;
afterEach(() => {
  renderer?.destroy();
  renderer = undefined;
});

async function frame(
  fixture: UIFixtureKind,
  width = 120,
  height = 40,
): Promise<string> {
  const setup = await testRender(() => <AppShell fixture={fixture} />, {
    width,
    height,
  });
  renderer = setup.renderer;
  await setup.renderOnce();
  await new Promise((resolve) => setTimeout(resolve, 5));
  await setup.renderOnce();
  return setup.captureCharFrame();
}

test("local route is compact and contains no cloud scoring language", async () => {
  const output = await frame("local-route");
  expect(output).not.toContain("◆ Local · Qwen 2.5 Coder 1.5B");
  expect(output).toContain("Local · Private");
  for (const forbidden of [
    "quota",
    "cost gate",
    "paid route",
    "taskFit",
    "reliability",
    "Score",
    "LM Studio",
  ]) {
    expect(output).not.toContain(forbidden);
  }
});

test("route change shows the useful transition and explicit reason", async () => {
  const output = await frame("route-change");
  expect(output).toContain("Route changed");
  expect(output).toContain("Local · Qwen 2.5 Coder 1.5B");
  expect(output).toContain("Free · Groq · Llama 3.3 70B");
  expect(output).toContain("Local verification failed twice.");
  expect(output).toContain("Free · Private");
  expect(output).toContain("Auto · free cloud");
  expect(output).not.toContain("quota headroom");
});

test("test failures and runtime errors stay human-first and bounded", async () => {
  const failure = await frame("test-failure");
  expect(failure).toContain("× Tests · 30 passed · 1 failed");
  expect(failure).toContain("TEST    bun test auth");
  expect(failure).not.toContain("31 passed");
  expect(failure).toContain("auth/session.test.ts");
  expect(failure).toContain("refreshes expired token");

  renderer?.destroy();
  renderer = undefined;
  const error = await frame("error");
  expect(error).toContain("! Local model stopped");
  expect(error).toContain("Restarting runtime…");
});

test("completion appears before the final assistant explanation", async () => {
  const output = await frame("complete", 80, 24);
  const completion = output.indexOf("Done · 1 file changed · 31 tests passed");
  const explanation = output.indexOf(
    "The refresh race is fixed and the authentication suite passes.",
  );
  expect(completion).toBeGreaterThanOrEqual(0);
  expect(explanation).toBeGreaterThan(completion);
});
