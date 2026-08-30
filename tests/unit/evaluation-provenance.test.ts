import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { captureEvaluationSourceSnapshot } from "../../src/evals/provenance.js";
import { runCommand } from "../../src/shared/process.js";

async function git(root: string, args: string[]): Promise<void> {
  const result = await runCommand("git", args, {
    cwd: root,
    intent: "execute",
    network: "deny",
    isolation: "best_effort",
    allowWeakIsolation: true,
    maxOutputChars: 4_000,
  });
  if (result.exitCode !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
}

test("source snapshot digest changes with uncommitted tracked or untracked executed source", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "shelra-eval-source-"));
  const executedSource = path.join(root, "evaluate.ts");

  try {
    await writeFile(executedSource, 'export const version = "one";\n', "utf8");
    await git(root, ["init", "-q"]);
    await git(root, ["config", "user.name", "Shelra evaluation"]);
    await git(root, ["config", "user.email", "evaluation@shelra.invalid"]);
    await git(root, ["add", "evaluate.ts"]);
    await git(root, ["commit", "-qm", "baseline"]);

    const clean = await captureEvaluationSourceSnapshot({
      root,
      executedSourcePath: executedSource,
      packageVersion: "0.1.1",
      artifacts: [],
    });
    await writeFile(executedSource, 'export const version = "two";\n', "utf8");
    await writeFile(path.join(root, "untracked.ts"), "export {};\n", "utf8");
    const dirty = await captureEvaluationSourceSnapshot({
      root,
      executedSourcePath: executedSource,
      packageVersion: "0.1.1",
      artifacts: [],
    });
    await writeFile(
      path.join(root, "untracked.ts"),
      "export const x = 1;\n",
      "utf8",
    );
    const changedUntracked = await captureEvaluationSourceSnapshot({
      root,
      executedSourcePath: executedSource,
      packageVersion: "0.1.1",
      artifacts: [],
    });

    expect(clean.head.state).toBe("observed");
    expect(clean.dirtyStateDigest).not.toEqual(dirty.dirtyStateDigest);
    expect(dirty.dirtyStateDigest).not.toEqual(
      changedUntracked.dirtyStateDigest,
    );
    expect(dirty.executedSource).toMatchObject({
      state: "observed",
      value: {
        kind: "source",
        path: "evaluate.ts",
      },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
