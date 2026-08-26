import { expect, test } from "bun:test";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  inferProgressiveTargets,
  selectProgressiveTargets,
} from "../../src/agent/progressive-plan.js";

test("progressive target inference prefers implementation and requested test files", () => {
  expect(
    inferProgressiveTargets(
      "Fix the authentication refresh flow and add tests.",
      [
        "README.md",
        "src/auth/session.ts",
        "src/ui/landing.ts",
        "tests/auth/session.test.ts",
      ],
    ),
  ).toEqual([
    "src/auth/session.ts",
    "src/ui/landing.ts",
    "tests/auth/session.test.ts",
  ]);
});

test("progressive target inference never promotes prose-only files", () => {
  expect(
    inferProgressiveTargets("Update the authentication flow.", [
      "docs/authentication.md",
      ".env",
      "src/auth.ts",
    ]),
  ).toEqual(["src/auth.ts"]);
});

test("explicit paths are not expanded by unrelated search matches", () => {
  expect(
    selectProgressiveTargets(
      "Refactor the routing subsystem across src/router/router.ts and src/tui/app.tsx.",
      ["src/router/router.ts", "src/tui/app.tsx"],
      [
        "src/router/router.ts",
        "src/tui/app.tsx",
        "src/tui/views/Centers.tsx",
        "src/tui/views/HomeView.tsx",
        "tests/integration/tui-v4-events.test.tsx",
      ],
    ),
  ).toEqual(["src/router/router.ts", "src/tui/app.tsx"]);
});

test("target inference is used only when the objective has no explicit path", () => {
  expect(
    selectProgressiveTargets(
      "Fix the authentication refresh flow and add tests.",
      [],
      ["README.md", "src/auth/session.ts", "tests/auth/session.test.ts"],
    ),
  ).toEqual(["src/auth/session.ts", "tests/auth/session.test.ts"]);
});

test("creation preparation authorizes a safe missing file inside the workspace", async () => {
  const progressivePlan = await import(
    "../../src/agent/progressive-plan.js"
  );
  expect("verifiedPreparationTargets" in progressivePlan).toBe(true);
  if (!("verifiedPreparationTargets" in progressivePlan)) return;

  const root = await mkdtemp(path.join(os.tmpdir(), "shelra-create-scope-"));
  await mkdir(path.join(root, "src"));

  expect(
    await progressivePlan.verifiedPreparationTargets(
      root,
      "Create a premium real-time digital clock web application.",
      ["index.html"],
    ),
  ).toEqual(["index.html"]);
});

test("greenfield creation does not invent a domain-specific artifact without a model path", async () => {
  const progressivePlan = await import(
    "../../src/agent/progressive-plan.js"
  );
  expect("verifiedPreparationTargets" in progressivePlan).toBe(true);
  if (!("verifiedPreparationTargets" in progressivePlan)) return;

  const root = await mkdtemp(path.join(os.tmpdir(), "shelra-web-scope-"));
  expect(
    await progressivePlan.verifiedPreparationTargets(
      root,
      "Create a premium real-time digital clock web application with JavaScript.",
      [],
    ),
  ).toEqual([]);
});

test("preparation evidence does not promote an unrelated project manifest into creation scope", async () => {
  const progressivePlan = await import(
    "../../src/agent/progressive-plan.js"
  );
  expect("verifiedPreparationTargets" in progressivePlan).toBe(true);
  if (!("verifiedPreparationTargets" in progressivePlan)) return;

  const root = await mkdtemp(path.join(os.tmpdir(), "shelra-web-evidence-"));
  await Bun.write(path.join(root, "package.json"), "{}\n");
  expect(
    await progressivePlan.verifiedPreparationTargets(
      root,
      "Create a premium real-time digital clock web application.",
      ["index.html", "package.json"],
    ),
  ).toEqual(["index.html"]);
});
