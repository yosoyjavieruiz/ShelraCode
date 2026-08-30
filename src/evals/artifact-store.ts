import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import {
  appendFile,
  lstat,
  mkdir,
  open,
  readFile,
  rename,
} from "node:fs/promises";
import path from "node:path";
import {
  digestEvaluationRunManifest,
  parseEvaluationRunManifest,
  type EvaluationRunManifest,
} from "./schema.js";
import { redactEvaluationValue } from "./redaction.js";

export type EvaluationObservationOrigin =
  "provider" | "agent" | "host" | "verifier";

export interface EvaluationObservationInput {
  origin: EvaluationObservationOrigin;
  kind: string;
  payload: unknown;
}

export interface EvaluationObservation {
  schemaVersion: 1;
  runId: string;
  sequence: number;
  recordedAt: string;
  origin: EvaluationObservationOrigin;
  kind: string;
  payload: unknown;
  previousDigest: string | null;
  digest: string;
}

export interface EvaluationRunSummaryInput {
  startedAt: string;
  completedAt: string;
  outcome: "PASS" | "FAIL" | "BLOCKED" | "UNPROVEN" | "SKIPPED";
  modelStatus:
    "completed" | "blocked" | "failed" | "cancelled" | "skipped" | "unproven";
  failure?: {
    class: string;
    summary: string;
    evidenceRefs: string[];
  };
  metrics: Record<string, string | number | boolean | null>;
  evidenceRefs: string[];
}

export interface EvaluationRunSummary extends EvaluationRunSummaryInput {
  schemaVersion: 1;
  runId: string;
  manifestDigest: string;
  observationCount: number;
  finalObservationDigest: string | null;
}

export interface EvaluationRunBundle {
  manifest: EvaluationRunManifest;
  observations: EvaluationObservation[];
  summary: EvaluationRunSummary;
}

export interface EvaluationRunStore {
  readonly runDirectory: string;
  readonly manifestPath: string;
  readonly observationsPath: string;
  readonly summaryPath: string;
  readonly manifestDigest: string;
  appendObservation(
    input: EvaluationObservationInput,
  ): Promise<EvaluationObservation>;
  seal(input: EvaluationRunSummaryInput): Promise<EvaluationRunSummary>;
}

async function writeImmutableJson(
  targetPath: string,
  value: unknown,
): Promise<void> {
  const temporaryPath = path.join(
    path.dirname(targetPath),
    `.${path.basename(targetPath)}.${randomUUID()}.tmp`,
  );
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, targetPath);
}

function observationDigest(
  observation: Omit<EvaluationObservation, "digest">,
): string {
  return createHash("sha256").update(JSON.stringify(observation)).digest("hex");
}

function assertIsoTimestamp(value: string, label: string): void {
  if (Number.isNaN(Date.parse(value)))
    throw new Error(`${label} must be an ISO timestamp.`);
}

function assertEvidenceReferences(
  references: string[],
  observations: EvaluationObservation[],
  label: string,
): void {
  const sequences = new Set(observations.map((item) => item.sequence));
  for (const reference of references) {
    const match = /^observation:([1-9][0-9]*)$/u.exec(reference);
    if (!match || !sequences.has(Number(match[1])))
      throw new Error(`${label} names an unknown observation: ${reference}.`);
  }
}

function assertTrialResultBinding(
  summary: EvaluationRunSummary,
  observations: EvaluationObservation[],
  evidenceClass: EvaluationRunManifest["evidenceClass"],
): void {
  const sealedEvidence = new Set(summary.evidenceRefs);
  const allTrialResults = observations.filter(
    (observation) => observation.kind === "trial.result",
  );
  const trialResults = allTrialResults.filter((observation) =>
    sealedEvidence.has(`observation:${observation.sequence}`),
  );
  if (evidenceClass === "real_local_model") {
    if (allTrialResults.length === 0 || trialResults.length !== 1)
      throw new Error(
        "real_local_model summary evidence must bind exactly one trial.result.",
      );
    if (allTrialResults.length !== 1)
      throw new Error(
        "real_local_model run must record exactly one trial.result observation.",
      );
  }
  if (trialResults.length === 0) return;
  if (trialResults.length !== 1)
    throw new Error(
      "Evaluation summary evidence must bind exactly one trial.result.",
    );
  const payload = trialResults[0]?.payload;
  if (typeof payload !== "object" || payload === null || Array.isArray(payload))
    throw new Error("Referenced trial.result payload is malformed.");
  const result = payload as Record<string, unknown>;
  if (result.outcome !== summary.outcome)
    throw new Error(
      "Evaluation summary outcome contradicts trial.result outcome.",
    );
  if (result.modelStatus !== summary.modelStatus)
    throw new Error(
      "Evaluation summary modelStatus contradicts trial.result modelStatus.",
    );

  if (!summary.failure) {
    if (result.failure !== null && result.failure !== undefined)
      throw new Error(
        "Evaluation summary failure contradicts trial.result failure.",
      );
    return;
  }
  if (
    typeof result.failure !== "object" ||
    result.failure === null ||
    Array.isArray(result.failure)
  )
    throw new Error(
      "Evaluation summary failure contradicts trial.result failure.",
    );
  const failure = result.failure as Record<string, unknown>;
  if (
    failure.class !== summary.failure.class ||
    failure.summary !== summary.failure.summary
  )
    throw new Error(
      "Evaluation summary failure contradicts trial.result failure.",
    );
}

function assertSummaryContract(
  summary: EvaluationRunSummary,
  observations: EvaluationObservation[],
  manifest: EvaluationRunManifest,
): void {
  if (Date.parse(summary.completedAt) < Date.parse(summary.startedAt))
    throw new Error("summary.completedAt must not precede summary.startedAt.");

  const allowedStatuses: Record<
    EvaluationRunSummary["outcome"],
    EvaluationRunSummary["modelStatus"][]
  > = {
    PASS: ["completed"],
    FAIL: ["failed", "blocked"],
    BLOCKED: ["blocked", "cancelled"],
    UNPROVEN: ["unproven"],
    SKIPPED: ["skipped"],
  };
  if (!allowedStatuses[summary.outcome].includes(summary.modelStatus))
    throw new Error(
      `${summary.outcome} outcome requires ${allowedStatuses[summary.outcome].join(" or ")} model status.`,
    );

  if (summary.outcome === "PASS" && summary.failure)
    throw new Error("PASS outcome must not include a failure.");
  if (
    ["FAIL", "BLOCKED", "UNPROVEN"].includes(summary.outcome) &&
    !summary.failure
  )
    throw new Error(`${summary.outcome} outcome requires a failure record.`);
  if (summary.evidenceRefs.length === 0)
    throw new Error("Evaluation summary requires recorded evidence.");

  assertEvidenceReferences(
    summary.evidenceRefs,
    observations,
    "summary.evidenceRefs",
  );
  const finalReference = observations.at(-1);
  if (
    finalReference &&
    !summary.evidenceRefs.includes(`observation:${finalReference.sequence}`)
  )
    throw new Error(
      "summary.evidenceRefs must include the final recorded observation.",
    );
  if (summary.failure) {
    assertEvidenceReferences(
      summary.failure.evidenceRefs,
      observations,
      "summary.failure.evidenceRefs",
    );
    for (const reference of summary.failure.evidenceRefs)
      if (!summary.evidenceRefs.includes(reference))
        throw new Error(
          `summary.failure.evidenceRefs is not sealed by summary.evidenceRefs: ${reference}.`,
        );
  }
  assertTrialResultBinding(summary, observations, manifest.evidenceClass);
}

function parseSummary(
  value: unknown,
  manifest: EvaluationRunManifest,
): EvaluationRunSummary {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Evaluation summary must be an object.");
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== 1 || input.runId !== manifest.runId)
    throw new Error("Evaluation summary does not match its manifest.");
  const outcome = input.outcome;
  if (
    !["PASS", "FAIL", "BLOCKED", "UNPROVEN", "SKIPPED"].includes(
      String(outcome),
    )
  )
    throw new Error("Evaluation summary has an invalid outcome.");
  const modelStatus = input.modelStatus;
  if (
    ![
      "completed",
      "blocked",
      "failed",
      "cancelled",
      "skipped",
      "unproven",
    ].includes(String(modelStatus))
  )
    throw new Error("Evaluation summary has an invalid model status.");
  if (
    typeof input.startedAt !== "string" ||
    typeof input.completedAt !== "string" ||
    typeof input.manifestDigest !== "string" ||
    typeof input.observationCount !== "number" ||
    !Number.isInteger(input.observationCount) ||
    input.observationCount < 0 ||
    (input.finalObservationDigest !== null &&
      typeof input.finalObservationDigest !== "string") ||
    typeof input.metrics !== "object" ||
    input.metrics === null ||
    Array.isArray(input.metrics) ||
    !Array.isArray(input.evidenceRefs) ||
    !input.evidenceRefs.every((reference) => typeof reference === "string")
  )
    throw new Error("Evaluation summary is malformed.");
  if (input.failure !== undefined) {
    if (
      typeof input.failure !== "object" ||
      input.failure === null ||
      Array.isArray(input.failure)
    )
      throw new Error("Evaluation summary failure is malformed.");
    const failure = input.failure as Record<string, unknown>;
    if (
      typeof failure.class !== "string" ||
      failure.class.length === 0 ||
      typeof failure.summary !== "string" ||
      failure.summary.length === 0 ||
      !Array.isArray(failure.evidenceRefs) ||
      !failure.evidenceRefs.every((reference) => typeof reference === "string")
    )
      throw new Error("Evaluation summary failure is malformed.");
  }
  assertIsoTimestamp(input.startedAt, "summary.startedAt");
  assertIsoTimestamp(input.completedAt, "summary.completedAt");
  return input as unknown as EvaluationRunSummary;
}

function parseObservation(
  value: unknown,
  manifest: EvaluationRunManifest,
  expectedSequence: number,
  previousDigest: string | null,
): EvaluationObservation {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`Evaluation observation ${expectedSequence} is malformed.`);
  const input = value as Record<string, unknown>;
  if (
    input.schemaVersion !== 1 ||
    input.runId !== manifest.runId ||
    input.sequence !== expectedSequence ||
    input.previousDigest !== previousDigest ||
    typeof input.recordedAt !== "string" ||
    !["provider", "agent", "host", "verifier"].includes(String(input.origin)) ||
    typeof input.kind !== "string" ||
    typeof input.digest !== "string"
  )
    throw new Error(`Evaluation observation ${expectedSequence} is invalid.`);
  const observation = input as unknown as EvaluationObservation;
  const { digest, ...unsigned } = observation;
  if (observationDigest(unsigned) !== digest)
    throw new Error(
      `Evaluation observation ${expectedSequence} digest mismatch.`,
    );
  return observation;
}

export async function createEvaluationRunStore(input: {
  root: string;
  manifest: EvaluationRunManifest;
  clock?: () => Date;
}): Promise<EvaluationRunStore> {
  const manifest = parseEvaluationRunManifest(
    redactEvaluationValue(input.manifest),
  );
  await mkdir(input.root, { recursive: true });
  if ((await lstat(input.root)).isSymbolicLink())
    throw new Error("Evaluation artifact root must not be a symbolic link.");
  const runDirectory = path.join(input.root, manifest.runId);
  try {
    await mkdir(runDirectory);
  } catch (error) {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "";
    if (code === "EEXIST")
      throw new Error(`Evaluation run ${manifest.runId} already exists.`);
    throw error;
  }
  const manifestPath = path.join(runDirectory, "manifest.json");
  await writeImmutableJson(manifestPath, manifest);
  const observationsPath = path.join(runDirectory, "observations.jsonl");
  const summaryPath = path.join(runDirectory, "summary.json");
  const manifestDigest = digestEvaluationRunManifest(manifest);
  const clock = input.clock ?? (() => new Date());
  let sequence = 0;
  let lastDigest: string | null = null;
  const recordedObservations: EvaluationObservation[] = [];
  let sealed = false;
  let writeQueue: Promise<void> = Promise.resolve();

  const store: EvaluationRunStore = {
    runDirectory,
    manifestPath,
    observationsPath,
    summaryPath,
    manifestDigest,
    appendObservation(observationInput) {
      if (sealed)
        return Promise.reject(
          new Error(`Evaluation run ${manifest.runId} is already sealed.`),
        );
      let recorded!: EvaluationObservation;
      const operation = writeQueue.then(async () => {
        const unsigned: Omit<EvaluationObservation, "digest"> = {
          schemaVersion: 1,
          runId: manifest.runId,
          sequence: sequence + 1,
          recordedAt: clock().toISOString(),
          origin: observationInput.origin,
          kind: observationInput.kind,
          payload: redactEvaluationValue(observationInput.payload),
          previousDigest: lastDigest,
        };
        recorded = { ...unsigned, digest: observationDigest(unsigned) };
        await appendFile(observationsPath, `${JSON.stringify(recorded)}\n`, {
          encoding: "utf8",
          flag: "a",
          mode: 0o600,
        });
        sequence = recorded.sequence;
        lastDigest = recorded.digest;
        recordedObservations.push(recorded);
      });
      writeQueue = operation;
      return operation.then(() => recorded);
    },
    async seal(summaryInput) {
      if (sealed)
        throw new Error(`Evaluation run ${manifest.runId} is already sealed.`);
      sealed = true;
      await writeQueue;
      assertIsoTimestamp(summaryInput.startedAt, "summary.startedAt");
      assertIsoTimestamp(summaryInput.completedAt, "summary.completedAt");
      const safeInput = redactEvaluationValue(
        summaryInput,
      ) as EvaluationRunSummaryInput;
      const summary: EvaluationRunSummary = {
        schemaVersion: 1,
        runId: manifest.runId,
        manifestDigest,
        ...safeInput,
        observationCount: sequence,
        finalObservationDigest: lastDigest,
      };
      assertSummaryContract(summary, recordedObservations, manifest);
      await writeImmutableJson(summaryPath, summary);
      return summary;
    },
  };
  return store;
}

export async function readEvaluationRunBundle(
  manifestPath: string,
): Promise<EvaluationRunBundle> {
  if (path.basename(manifestPath) !== "manifest.json")
    throw new Error("Evaluation bundle entry point must be manifest.json.");
  const runDirectory = path.dirname(manifestPath);
  const runDirectoryStat = await lstat(runDirectory);
  if (runDirectoryStat.isSymbolicLink())
    throw new Error("Evaluation run directory must not be a symbolic link.");
  if (!runDirectoryStat.isDirectory())
    throw new Error("Evaluation run directory must be a directory.");
  const assertRegularFile = async (
    filePath: string,
    optional = false,
  ): Promise<boolean> => {
    try {
      const fileStat = await lstat(filePath);
      if (fileStat.isSymbolicLink() || !fileStat.isFile())
        throw new Error(
          `Evaluation bundle file must be a regular file: ${path.basename(filePath)}.`,
        );
      return true;
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : "";
      if (optional && code === "ENOENT") return false;
      throw error;
    }
  };
  const observationsPath = path.join(runDirectory, "observations.jsonl");
  const summaryPath = path.join(runDirectory, "summary.json");
  await assertRegularFile(manifestPath);
  const observationsExist = await assertRegularFile(observationsPath, true);
  await assertRegularFile(summaryPath);
  const manifest = parseEvaluationRunManifest(
    JSON.parse(await readFile(manifestPath, "utf8")) as unknown,
  );
  let serializedObservations = "";
  if (observationsExist)
    serializedObservations = await readFile(observationsPath, "utf8");
  const observations: EvaluationObservation[] = [];
  for (const line of serializedObservations.split(/\r?\n/u).filter(Boolean)) {
    const previousDigest = observations.at(-1)?.digest ?? null;
    observations.push(
      parseObservation(
        JSON.parse(line) as unknown,
        manifest,
        observations.length + 1,
        previousDigest,
      ),
    );
  }
  const summary = parseSummary(
    JSON.parse(await readFile(summaryPath, "utf8")) as unknown,
    manifest,
  );
  if (summary.manifestDigest !== digestEvaluationRunManifest(manifest))
    throw new Error("Evaluation summary manifest digest mismatch.");
  if (
    summary.observationCount !== observations.length ||
    summary.finalObservationDigest !== (observations.at(-1)?.digest ?? null)
  )
    throw new Error("Evaluation summary does not seal its observation chain.");
  assertSummaryContract(summary, observations, manifest);
  return { manifest, observations, summary };
}
