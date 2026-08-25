import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * A small, disposable fixture project the agent loop can safely read, edit,
 * and run tests against. Mirrors the shape master-prompt §98 asks for:
 * package manifest, simple source, a controllable bug, a test that exposes
 * it, and an AGENTS.md.
 */
export async function createFunctionalFixtureRepo(): Promise<string> {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-functional-fixture-"),
  );
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({ name: "functional-fixture", version: "0.0.0" }, null, 2) +
      "\n",
    "utf8",
  );
  await writeFile(
    path.join(root, "AGENTS.md"),
    "# functional-fixture\n\nA disposable fixture repository for LocalCode's functional acceptance tests.\n",
    "utf8",
  );
  await writeFile(
    path.join(root, "src", "math.ts"),
    "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
    "utf8",
  );
  await writeFile(
    path.join(root, "src", "message.ts"),
    'export const greeting = "hello";\n',
    "utf8",
  );
  await writeFile(
    path.join(root, "math.test.ts"),
    "import { expect, test } from 'bun:test';\n" +
      "import { add } from './src/math.ts';\n" +
      "test('add sums two numbers', () => {\n" +
      "  expect(add(2, 3)).toBe(5);\n" +
      "});\n",
    "utf8",
  );
  return root;
}

/** Introduces a controlled bug into `add()` for the "fix a failing test"
 * scenario — every other scenario runs against a passing baseline. */
export async function breakFixtureMathAdd(root: string): Promise<void> {
  await writeFile(
    path.join(root, "src", "math.ts"),
    "export function add(a: number, b: number): number {\n  return a - b;\n}\n",
    "utf8",
  );
}
