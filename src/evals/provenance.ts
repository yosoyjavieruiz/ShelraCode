import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { runCommand } from "../shared/process.js";
import type {
  EvaluationArtifactIdentity,
  EvaluationObservationValue,
  EvaluationRunManifest,
} from "./schema.js";

function observed<T>(value: T): EvaluationObservationValue<T> {
  return { state: "observed", value };
}

function notCollected<T>(): EvaluationObservationValue<T> {
  return { state: "unknown", value: null, reason: "not_collected" };
}

async function gitOutput(
  root: string,
  args: string[],
): Promise<string | undefined> {
  try {
    const result = await runCommand("git", args, {
      cwd: root,
      intent: "read",
      network: "deny",
      isolation: "best_effort",
      allowWeakIsolation: true,
      maxOutputChars: 50_000_000,
    });
    return result.exitCode === 0 ? result.stdout : undefined;
  } catch {
    return undefined;
  }
}

function relativeSourcePath(root: string, sourcePath: string): string {
  const relative = path.relative(root, sourcePath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error(
      "Executed evaluation source must be inside the source root.",
    );
  return relative.split(path.sep).join("/");
}

async function fileSha256(filePath: string): Promise<string> {
  return createHash("sha256")
    .update(await readFile(filePath))
    .digest("hex");
}

async function dirtyStateDigest(
  root: string,
): Promise<EvaluationObservationValue<string>> {
  const [trackedDiff, untrackedOutput] = await Promise.all([
    gitOutput(root, ["diff", "--binary", "HEAD", "--"]),
    gitOutput(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
  ]);
  if (trackedDiff === undefined || untrackedOutput === undefined)
    return notCollected();

  const digest = createHash("sha256");
  digest.update("tracked-diff\0");
  digest.update(trackedDiff);
  digest.update("\0untracked-files\0");
  const untracked = untrackedOutput.split("\0").filter(Boolean).sort();
  for (const relative of untracked) {
    const absolute = path.resolve(root, relative);
    const checked = path.relative(root, absolute);
    if (checked.startsWith("..") || path.isAbsolute(checked))
      throw new Error(
        `Git reported an untracked path outside root: ${relative}`,
      );
    digest.update(relative);
    digest.update("\0");
    digest.update(await fileSha256(absolute));
    digest.update("\0");
  }
  return observed(digest.digest("hex"));
}

export async function captureEvaluationSourceSnapshot(input: {
  root: string;
  executedSourcePath: string;
  packageVersion: string;
  artifacts: EvaluationArtifactIdentity[];
}): Promise<EvaluationRunManifest["source"]> {
  const root = path.resolve(input.root);
  const executedSourcePath = path.resolve(input.executedSourcePath);
  const relativePath = relativeSourcePath(root, executedSourcePath);
  const head = (await gitOutput(root, ["rev-parse", "HEAD"]))?.trim();
  return {
    head: head ? observed(head) : notCollected(),
    dirtyStateDigest: await dirtyStateDigest(root),
    executedSource: observed({
      kind: "source",
      path: relativePath,
      sha256: await fileSha256(executedSourcePath),
    }),
    packageVersion: input.packageVersion,
    artifacts: input.artifacts,
  };
}
