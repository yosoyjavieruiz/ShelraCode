import { expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { selectVerificationPlan } from "../../src/agent/verification-plan.js";
import { discoverProjectCommands } from "../../src/context/project-commands.js";

test("project command discovery maps manifest scripts to verification stages", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "localcode-commands-"));
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      scripts: {
        test: "bun test",
        typecheck: "tsc --noEmit",
        lint: "eslint .",
        build: "bun run build",
        format: "prettier --write .",
      },
    }),
    "utf8",
  );

  const commands = await discoverProjectCommands(root);

  expect(commands.test).toEqual(["bun test"]);
  expect(commands.typecheck).toEqual(["tsc --noEmit"]);
  expect(commands.lint).toEqual(["eslint ."]);
  expect(commands.build).toEqual(["bun run build"]);
  expect(commands.format).toEqual(["prettier --write ."]);

  expect(selectVerificationPlan(commands)).toEqual([
    { stage: "test", command: "bun test" },
    { stage: "typecheck", command: "tsc --noEmit" },
    { stage: "lint", command: "eslint ." },
    { stage: "build", command: "bun run build" },
  ]);
});

test("verification plan ignores mutating-only stages", () => {
  expect(
    selectVerificationPlan({
      format: ["prettier --write ."],
    }),
  ).toEqual([]);
});

test("project command discovery recognizes common build evidence", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-build-evidence-"),
  );
  await writeFile(
    path.join(root, "Makefile"),
    "test:\n\t@echo test\ntypecheck:\n\t@echo types\nbuild:\n\t@echo build\n",
    "utf8",
  );
  const commands = await discoverProjectCommands(root);

  expect(commands.test).toEqual(["make test"]);
  expect(commands.typecheck).toEqual(["make typecheck"]);
  expect(commands.build).toEqual(["make build"]);
});

test("project command discovery keeps non-package evidence when package scripts are absent", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-package-without-scripts-"),
  );
  await writeFile(
    path.join(root, "package.json"),
    '{"name":"fixture"}\n',
    "utf8",
  );
  await writeFile(path.join(root, "justfile"), "test:\n\t@echo test\n", "utf8");
  const commands = await discoverProjectCommands(root);

  expect(commands.test).toEqual(["just test"]);
});

test("project command discovery adds conservative ecosystem defaults", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-ecosystem-evidence-"),
  );
  await writeFile(
    path.join(root, "Cargo.toml"),
    "[package]\nname = 'fixture'\n",
    "utf8",
  );
  const commands = await discoverProjectCommands(root);

  expect(commands.test).toEqual(["cargo test"]);
  expect(commands.typecheck).toEqual(["cargo check"]);
  expect(commands.build).toEqual(["cargo build"]);
});

test("project command discovery reads only recognized verification commands from docs", async () => {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "localcode-doc-command-evidence-"),
  );
  await writeFile(
    path.join(root, "README.md"),
    "Run checks:\n\n- bun test\n- bun run typecheck\n- bun run build\n- bun run format --write\n",
    "utf8",
  );
  const commands = await discoverProjectCommands(root);

  expect(commands.test).toEqual(["bun test"]);
  expect(commands.typecheck).toEqual(["bun run typecheck"]);
  expect(commands.build).toEqual(["bun run build"]);
  expect(commands.format).toBeUndefined();
});
