import { expect, test } from "bun:test";
import { inferProgressiveTargets } from "../../src/agent/progressive-plan.js";

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
