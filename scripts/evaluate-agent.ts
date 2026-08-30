import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  AGENT_CAPABILITY_PROBE_VERSION,
  probeAgentCapability,
  type AgentCapabilityProbeResult,
} from "../src/agent/capability-probe.js";
import { runAgent } from "../src/agent/loop.js";
import { CheckpointService } from "../src/checkpoint/checkpoint.js";
import { OpenAICompatibleLocalRuntime } from "../src/runtimes/http.js";
import { OllamaRuntime } from "../src/runtimes/ollama.js";
import type {
  LocalRuntimeAdapter,
  RuntimeDetection,
} from "../src/runtimes/types.js";
import { LocalCodeDatabase } from "../src/storage/database.js";
import { readProductEnv } from "../src/product/identity.js";
import { runCommand } from "../src/shared/process.js";
import type { ProviderAdapter } from "../src/providers/types.js";
import type {
  AgentProbeHardwareSnapshot,
  ModelCandidate,
} from "../src/shared/types.js";
import { workspaceTools } from "../src/tools/workspace.js";
import type { AgentEvent, AgentRunResult } from "../src/agent/types.js";
import {
  AGENT_EVALUATION_FIXTURE_REVISION,
  EXPECTED_AGENT_JOURNEYS,
  runDeterministicAgentEvaluation,
  summarizeAgentEvaluation,
  type AgentEvaluationReport,
  type AgentJourneyResult,
  type AgentJourneyStatus,
  type JourneyVerificationStatus,
} from "../tests/evals/agent-journeys.js";
import { VERSION } from "../src/version.js";
import {
  createEvaluationRunStore,
  readEvaluationRunBundle,
  type EvaluationRunStore,
} from "../src/evals/artifact-store.js";
import { captureEvaluationSourceSnapshot } from "../src/evals/provenance.js";
import {
  digestPublicEvaluationCase,
  parsePublicEvaluationCase,
  type EvaluationObservationValue,
  type EvaluationRunManifest,
} from "../src/evals/schema.js";
import { PRODUCT_STATE_DIR_NAME } from "../src/product/identity.js";
import { createLocalEvaluationRunManifest } from "../src/evals/local-run.js";
import {
  runLocalEvaluationTrial,
  type LocalEvaluationExecution,
} from "../src/evals/local-runner.js";
import { replayEvaluationRunBundle } from "../src/evals/replay.js";
import { executeLocalProtocolEvaluation } from "../src/evals/protocol-trial.js";

const projectRoot = path.resolve(import.meta.dir, "..");
const PROBE_TIMEOUT_MS = 5 * 60 * 1_000;
const DEFAULT_MAX_LOCAL_MODELS = 1;

interface ArtifactProvenance {
  path: string;
  exists: boolean;
  sizeBytes?: number;
  sha256?: string;
}

interface EvaluationProvenance {
  sourceHead: string | null;
  packageVersion: string;
  artifacts: ArtifactProvenance[];
  runtime: {
    bun: string;
    node: string;
    platform: string;
    arch: string;
    osRelease: string;
  };
  hardware: AgentProbeHardwareSnapshot;
  fixtureRevision: string;
  command: string;
}

interface LocalJourneyRun {
  id: string;
  status: "measured" | "skipped" | "unproven" | "failed";
  reason: string;
  probe?: AgentCapabilityProbeResult;
  journeys: AgentJourneyResult[];
  evidenceRef?: string;
}

interface LocalEvaluationReport {
  policy: "local_only_no_download_no_paid_fallback";
  discoveredModels: number;
  evaluatedModels: LocalJourneyRun[];
  aggregateStatus: "PASS" | "FAIL" | "UNPROVEN";
}

interface EvaluationOutput {
  schemaVersion: 1;
  provenance: EvaluationProvenance;
  deterministic?: AgentEvaluationReport;
  local?: LocalEvaluationReport;
  evidenceBundles?: {
    deterministic?: string;
    local?: string[];
  };
}

function parseFlag(name: string): string | undefined {
  const prefix = `${name}=`;
  return process.argv
    .slice(2)
    .find((argument) => argument.startsWith(prefix))
    ?.slice(prefix.length);
}

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(name);
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function hardwareSnapshot(): AgentProbeHardwareSnapshot {
  return {
    os: `${process.platform} ${os.release()}`,
    platform: process.platform,
    arch: process.arch,
    cpuModel: os.cpus()[0]?.model?.trim() || "Unknown CPU",
    cpuCores: os.cpus().length,
    memoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    accelerator:
      process.platform === "win32"
        ? "Unknown / DirectML possible"
        : process.platform === "darwin"
          ? "Metal"
          : "Unknown",
  };
}

async function artifact(relativePath: string): Promise<ArtifactProvenance> {
  const absolutePath = path.join(projectRoot, relativePath);
  try {
    const contents = await readFile(absolutePath);
    return {
      path: relativePath,
      exists: true,
      sizeBytes: contents.byteLength,
      sha256: createHash("sha256").update(contents).digest("hex"),
    };
  } catch {
    return { path: relativePath, exists: false };
  }
}

async function sourceHead(): Promise<string | null> {
  try {
    const result = await runCommand("git", ["rev-parse", "HEAD"], {
      intent: "read",
      cwd: projectRoot,
      network: "deny",
      isolation: "best_effort",
      allowWeakIsolation: true,
      maxOutputChars: 2_000,
    });
    return result.exitCode === 0 ? result.stdout.trim() || null : null;
  } catch {
    return null;
  }
}

async function buildProvenance(): Promise<EvaluationProvenance> {
  return {
    sourceHead: await sourceHead(),
    packageVersion: VERSION,
    artifacts: await Promise.all([
      artifact("dist/index.js"),
      artifact("dist/shelra.exe"),
      artifact("dist/shelra-probe.exe"),
    ]),
    runtime: {
      bun: Bun.version,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      osRelease: os.release(),
    },
    hardware: hardwareSnapshot(),
    fixtureRevision: AGENT_EVALUATION_FIXTURE_REVISION,
    command: [
      "bun",
      "run",
      "scripts/evaluate-agent.ts",
      ...process.argv.slice(2),
    ].join(" "),
  };
}

function observed<T>(value: T): EvaluationObservationValue<T> {
  return { state: "observed", value };
}

function unknown<T>(
  reason: "not_exposed" | "not_collected" | "not_applicable",
): EvaluationObservationValue<T> {
  return { state: "unknown", value: null, reason };
}

function evaluationArtifactRoot(): string {
  const configured = parseFlag("--artifact-root");
  if (configured) return path.resolve(configured);
  const stateRoot =
    readProductEnv(process.env, "STATE_DIR") ??
    path.join(os.homedir(), PRODUCT_STATE_DIR_NAME);
  return path.join(stateRoot, "evaluations", "runs");
}

function runId(label: string, now = new Date()): string {
  const timestamp = now.toISOString().replace(/[-:.]/gu, "");
  return `${timestamp}-${label}-${randomUUID()}`;
}

function digestValue(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function deterministicEvaluationCase() {
  return parsePublicEvaluationCase({
    schemaVersion: 1,
    caseId: "deterministic-agent-matrix",
    revision: AGENT_EVALUATION_FIXTURE_REVISION,
    title: "Deterministic scripted agent matrix",
    family: "host",
    capabilityTarget: "C3",
    origin: "scripted_fake",
    workspaceFixture: {
      source: "tests/evals/agent-journeys.ts",
      digest: digestValue({
        revision: AGENT_EVALUATION_FIXTURE_REVISION,
        journeys: EXPECTED_AGENT_JOURNEYS,
      }),
    },
    objective:
      "Exercise the deterministic host journey matrix with scripted model actions.",
    policy: {
      writeAuthority: "bounded",
      networkAuthority: "none",
      commandPolicy: "disposable_fixtures_only",
    },
    budgets: {
      actions: 256,
      inputTokens: null,
      outputTokens: null,
      wallClockMs: PROBE_TIMEOUT_MS,
    },
    visibleAcceptance: [
      {
        id: "matrix-executed",
        statement:
          "Every declared deterministic journey returns its host-verified expected status.",
        type: "test",
        required: true,
      },
    ],
    protectedAcceptanceRef: null,
    tags: ["deterministic", "scripted-fake", "host-correctness"],
  });
}

async function createDeterministicRunStore(
  root: string,
  provenance: EvaluationProvenance,
  createdAt: Date,
): Promise<EvaluationRunStore> {
  const evaluationCase = deterministicEvaluationCase();
  const source = await captureEvaluationSourceSnapshot({
    root: projectRoot,
    executedSourcePath: path.join(projectRoot, "scripts", "evaluate-agent.ts"),
    packageVersion: provenance.packageVersion,
    artifacts: provenance.artifacts,
  });
  const manifest: EvaluationRunManifest = {
    schemaVersion: 1,
    runId: runId("deterministic", createdAt),
    createdAt: createdAt.toISOString(),
    status: "invocation_pending",
    evidenceClass: "scripted_fake",
    case: {
      caseId: evaluationCase.caseId,
      revision: evaluationCase.revision,
      publicCaseDigest: digestPublicEvaluationCase(evaluationCase),
      fixtureDigest: evaluationCase.workspaceFixture.digest,
      protectedAcceptanceRef: evaluationCase.protectedAcceptanceRef,
    },
    source,
    model: {
      providerFamily: "scripted_fake",
      providerId: "fake-model-adapter",
      modelId: "deterministic-agent-journey-matrix",
      displayName: "Deterministic scripted provider",
      artifactId: unknown("not_applicable"),
      artifactSha256: unknown("not_applicable"),
      revision: observed(AGENT_EVALUATION_FIXTURE_REVISION),
      parameterClass: unknown("not_applicable"),
      quantization: unknown("not_applicable"),
      architecture: unknown("not_applicable"),
      sizeBytes: unknown("not_applicable"),
    },
    runtime: {
      id: "bun-scripted-fixture",
      version: observed(Bun.version),
      endpointProtocol: unknown("not_applicable"),
      endpoint: unknown("not_applicable"),
      chatTemplate: unknown("not_applicable"),
      toolTemplate: unknown("not_applicable"),
      structuredOutputMode: unknown("not_applicable"),
      reasoningMode: unknown("not_applicable"),
      tokenizerId: unknown("not_applicable"),
      toolParser: unknown("not_applicable"),
      contextConfiguration: {},
    },
    request: {
      temperature: 0,
      maxOutputTokens: 512,
      seed: unknown("not_applicable"),
      reasoningEffort: unknown("not_applicable"),
      toolSurfaceDigest: digestValue(
        workspaceTools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          risk: tool.risk,
          parameters: tool.parameters,
        })),
      ),
    },
    environment: {
      bun: Bun.version,
      node: process.version,
      os: `${process.platform} ${os.release()}`,
      platform: process.platform,
      arch: process.arch,
      hardwareFingerprint: observed(digestValue(provenance.hardware)),
    },
    driverProfile: unknown("not_applicable"),
    policy: {
      network: "none",
      downloads: false,
      paidInference: false,
    },
    command: {
      argv: [
        "bun",
        "run",
        "scripts/evaluate-agent.ts",
        ...process.argv.slice(2),
      ],
      environmentNames: ["SHELRA_EVAL_MAX_LOCAL_MODELS", "SHELRA_EVAL_TRIALS"],
    },
    reproduction: {
      argv: [
        "bun",
        "run",
        "scripts/evaluate-agent.ts",
        "--replay-run=<manifest.json>",
      ],
    },
  };
  return createEvaluationRunStore({ root, manifest });
}

function isLoopbackUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function localRuntimeAdapters(
  env: Record<string, string | undefined> = process.env,
): LocalRuntimeAdapter[] {
  const adapters: LocalRuntimeAdapter[] = [];
  const ollamaUrl =
    readProductEnv(env, "OLLAMA_URL") ?? "http://127.0.0.1:11434";
  if (isLoopbackUrl(ollamaUrl)) adapters.push(new OllamaRuntime(ollamaUrl));

  const configuredOpenAi = readProductEnv(env, "OPENAI_BASE_URL");
  if (configuredOpenAi && isLoopbackUrl(configuredOpenAi))
    adapters.push(
      new OpenAICompatibleLocalRuntime(
        "local-openai",
        "OpenAI-compatible local endpoint",
        configuredOpenAi,
      ),
    );

  const lmStudioUrl =
    readProductEnv(env, "LM_STUDIO_URL") ?? "http://127.0.0.1:1234/v1";
  if (isLoopbackUrl(lmStudioUrl))
    adapters.push(
      new OpenAICompatibleLocalRuntime("lm-studio", "LM Studio", lmStudioUrl),
    );

  const llamaCppUrl =
    readProductEnv(env, "LLAMA_CPP_URL") ?? "http://127.0.0.1:8080/v1";
  if (isLoopbackUrl(llamaCppUrl))
    adapters.push(
      new OpenAICompatibleLocalRuntime(
        "llama.cpp",
        "llama.cpp server",
        llamaCppUrl,
      ),
    );
  return adapters;
}

function expectedStatus(id: string): AgentJourneyStatus {
  if (id === "dirty-worktree-safety" || id === "strict-zero-rejection")
    return "rejected";
  if (id === "false-completion") return "blocked";
  return "completed";
}

function unprovenJourney(
  id: string,
  status: "skipped" | "unproven",
  reason: string,
): AgentJourneyResult {
  return {
    id,
    category: "local_model_matrix",
    expectedStatus: expectedStatus(id),
    status,
    passed: false,
    verified: false,
    verificationStatus: "unknown",
    recoveryCount: 0,
    turns: 0,
    toolRuns: 0,
    evidenceCount: 0,
    filesChanged: [],
    compactionObserved: false,
    reason,
  };
}

function latestVerificationStatus(
  result: AgentRunResult,
): JourneyVerificationStatus {
  const runs = result.ledger.verificationRuns;
  if (runs.length === 0)
    return result.ledger.verificationPlan.length > 0
      ? "unknown"
      : "not_required";
  const latest = runs.at(-1);
  if (latest?.status === "passed" && latest.exitCode === 0) return "passed";
  if (runs.some((run) => run.status === "failed")) return "failed";
  return "unknown";
}

function localJourneyFromResult(
  result: AgentRunResult,
  passed: boolean,
  reason: string,
  evidence: string[],
): AgentJourneyResult {
  const diagnostics = [
    ...result.completion.reasons,
    ...(result.failure?.message ? [result.failure.message] : []),
  ]
    .filter(Boolean)
    .slice(0, 3)
    .join(" | ");
  return {
    id: "one-file-modification",
    category: "coding",
    expectedStatus: "completed",
    status: result.status,
    passed,
    verified: result.verified,
    verificationStatus: latestVerificationStatus(result),
    recoveryCount:
      result.ledger.recoveryContracts.length +
      result.ledger.actions.filter((action) => action.status === "failed")
        .length,
    turns: result.turns,
    toolRuns: result.toolRuns.length,
    evidenceCount: result.evidenceCount,
    filesChanged: [...result.ledger.filesChanged],
    compactionObserved: result.messages.some(
      (message) =>
        message.role === "system" &&
        message.content.includes("ShelraCode structured task state"),
    ),
    reason: diagnostics ? `${reason} ${diagnostics}` : reason,
    ...(evidence.length > 0 ? { evidence } : {}),
  };
}

async function createLocalFixture(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), "shelra-local-eval-"));
  await mkdir(path.join(root, "src"), { recursive: true });
  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: "shelra-local-evaluation-fixture",
        version: "0.0.0",
        scripts: { test: "bun test" },
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await writeFile(
    path.join(root, "AGENTS.md"),
    "Preserve the existing API. Run bun test after the edit.\n",
    "utf8",
  );
  await writeFile(
    path.join(root, "src", "message.ts"),
    'export const greeting = "hello";\n',
    "utf8",
  );
  await writeFile(
    path.join(root, "src", "message.test.ts"),
    "import { expect, test } from 'bun:test';\n" +
      "import { greeting } from './message.ts';\n" +
      "test('greeting is updated', () => {\n" +
      "  expect(greeting).toBe('hello world');\n" +
      "});\n",
    "utf8",
  );
  return root;
}

async function runLocalRepresentative(
  candidate: ModelCandidate,
  provider: ProviderAdapter,
  signal: AbortSignal,
  onEvent?: (event: AgentEvent) => void,
): Promise<AgentJourneyResult> {
  const root = await createLocalFixture();
  const database = new LocalCodeDatabase(":memory:");
  const checkpoint = new CheckpointService(database, root);
  const objective =
    'Read src/message.ts, change the exact greeting value from "hello" to "hello world", run bun test, and report only the verified result.';
  try {
    const result = await runAgent(
      {
        id: `local-eval-${candidate.providerId}-${candidate.modelId ?? candidate.id}`,
        objective,
        root,
        candidate,
        repositoryPolicy: "local_only",
        permissionMode: "EDIT",
        mode: "coding",
        context:
          "This is a disposable local evaluation fixture. Use only the exposed workspace tools and preserve the existing file structure.",
        successCriteria: [
          'src/message.ts exports greeting = "hello world"',
          "bun test passes",
        ],
        verificationCommands: [{ stage: "test", command: "bun test" }],
        verificationPolicy: "required",
        repositoryState: "non_empty",
        maxTurns: 16,
        temperature: 0,
        maxOutputTokens: 512,
        systemPromptProfile: "coding",
      },
      {
        provider,
        tools: workspaceTools,
        toolChoice: "auto",
        checkUserWorkPreserved: (checkpointId) =>
          checkpointId ? checkpoint.isPreserved(checkpointId) : true,
        reviewFinalDiff: () => true,
        ...(onEvent ? { onEvent } : {}),
        async verifySuccessCriteria(_task, ledger) {
          const message = await readFile(
            path.join(root, "src", "message.ts"),
            "utf8",
          );
          const latestTest = [...ledger.verificationRuns]
            .reverse()
            .find((run) => run.stage === "test");
          const updated = message.includes('greeting = "hello world"');
          const tested =
            latestTest?.status === "passed" && latestTest.exitCode === 0;
          return {
            pass: updated && tested,
            satisfiedCriterionIds: [
              ...(updated ? ["criterion-1"] : []),
              ...(tested ? ["criterion-2"] : []),
            ],
            issues: [
              ...(updated ? [] : ["The greeting was not updated."]),
              ...(tested ? [] : ["bun test has not passed yet."]),
            ],
            nextPaths: updated ? [] : ["src/message.ts"],
            nextActions: updated
              ? []
              : ['Edit src/message.ts to set greeting to "hello world".'],
          };
        },
        async createExecutionContext(task) {
          return {
            root: task.root,
            permissionMode: task.permissionMode,
            signal,
            network: false,
            osIsolation: "best_effort" as const,
            allowWeakProcessIsolation: true,
            checkpoint,
            env: process.env,
          };
        },
      },
      signal,
    );
    const content = await readFile(
      path.join(root, "src", "message.ts"),
      "utf8",
    );
    const latestTest = [...result.ledger.verificationRuns]
      .reverse()
      .find((run) => run.stage === "test");
    const passed =
      result.status === "completed" &&
      result.verified &&
      content.includes('greeting = "hello world"') &&
      latestTest?.status === "passed" &&
      latestTest.exitCode === 0;
    return localJourneyFromResult(
      result,
      passed,
      passed
        ? "A real local model completed the disposable one-file edit with host verification."
        : "The real local model did not complete the disposable one-file edit with host verification.",
      [
        `model=${candidate.modelId ?? candidate.displayName}`,
        `runtime=${candidate.local?.runtime ?? candidate.providerId}`,
        `fileUpdated=${content.includes('greeting = "hello world"')}`,
        `testPassed=${latestTest?.status === "passed" && latestTest.exitCode === 0}`,
      ],
    );
  } finally {
    database.close();
    await rm(root, { recursive: true, force: true });
  }
}

function environmentInput(candidate: ModelCandidate) {
  return {
    ...(candidate.local?.modelRevision === undefined
      ? {}
      : { modelRevision: candidate.local.modelRevision }),
    ...(candidate.local?.quant === undefined
      ? {}
      : { quantization: candidate.local.quant }),
    ...(candidate.capabilities.maxContext === undefined
      ? {}
      : { contextLength: candidate.capabilities.maxContext }),
    ...(candidate.local?.runtimeVersion === undefined
      ? {}
      : { runtimeVersion: candidate.local.runtimeVersion }),
    ...(candidate.local?.chatTemplate === undefined
      ? {}
      : { chatTemplate: candidate.local.chatTemplate }),
    ...(candidate.local?.toolParser === undefined
      ? {}
      : { toolParser: candidate.local.toolParser }),
    hardware: hardwareSnapshot(),
    task: "local-agent-evaluation-capability-and-disposable-edit",
  };
}

function printJourneyLine(journey: AgentJourneyResult): void {
  const proof = journey.verified
    ? `verified=${journey.verificationStatus}`
    : `verified=${journey.verificationStatus}`;
  console.log(
    `  ${journey.id}: ${journey.status} ${journey.passed ? "PASS" : "—"} turns=${journey.turns} tools=${journey.toolRuns} recovery=${journey.recoveryCount} ${proof}`,
  );
}

function printHumanReport(
  output: EvaluationOutput,
  summaryOnly: boolean,
): void {
  if (output.deterministic) {
    const summary = output.deterministic.summary;
    console.log(
      `Deterministic matrix: ${summary.aggregateStatus} (${summary.passed}/${output.deterministic.journeys.length} passed; failed=${summary.failed}; unproven=${summary.unproven}; skipped=${summary.skipped})`,
    );
    if (!summaryOnly)
      for (const journey of output.deterministic.journeys)
        printJourneyLine(journey);
  }
  if (output.local) {
    console.log(
      `Local matrix: ${output.local.aggregateStatus} (discovered=${output.local.discoveredModels}; evaluated=${output.local.evaluatedModels.length}; policy=${output.local.policy})`,
    );
    if (!summaryOnly)
      for (const model of output.local.evaluatedModels) {
        console.log(`  model ${model.id}: ${model.status} — ${model.reason}`);
        if (model.probe)
          console.log(
            `    probe=${model.probe.agentCapabilityClass} eligible=${model.probe.agenticCodingEligible} version=${model.probe.probeVersion}`,
          );
        for (const journey of model.journeys)
          if (journey.status !== "unproven" || journey.passed)
            printJourneyLine(journey);
      }
  }
  if (!summaryOnly)
    console.log(
      `Provenance: HEAD=${output.provenance.sourceHead ?? "unknown"} version=${output.provenance.packageVersion} fixture=${output.provenance.fixtureRevision}`,
    );
}

function safeRunLabel(value: string): string {
  const normalized = value
    .replace(/[^A-Za-z0-9._-]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);
  return normalized || "local-model";
}

function exactIdentityConflict(
  candidate: ModelCandidate,
  runtime: RuntimeDetection,
): string | undefined {
  const local = candidate.local;
  if (local?.runtime && local.runtime !== runtime.id)
    return `Candidate runtime ${local.runtime} conflicts with detected runtime ${runtime.id}.`;
  if (
    local?.runtimeVersion &&
    runtime.version &&
    local.runtimeVersion !== runtime.version
  )
    return `Candidate runtime version ${local.runtimeVersion} conflicts with detected version ${runtime.version}.`;
  if ((local?.loadedInstances?.length ?? 0) > 1)
    return `Runtime reported ${local!.loadedInstances!.length} loaded instances for one model key; the invoked instance is ambiguous.`;
  return undefined;
}

function localEvaluationCase() {
  return parsePublicEvaluationCase({
    schemaVersion: 1,
    caseId: "local-agent-baseline",
    revision: `probe-${AGENT_CAPABILITY_PROBE_VERSION}-fixture-v1`,
    title: "Real local model capability and bounded edit baseline",
    family: "micro",
    capabilityTarget: "C2",
    origin: "local_real",
    workspaceFixture: {
      source: "generated:scripts/evaluate-agent.ts#local-baseline",
      digest: digestValue({
        probeVersion: AGENT_CAPABILITY_PROBE_VERSION,
        packageJson: {
          name: "shelra-local-evaluation-fixture",
          version: "0.0.0",
          scripts: { test: "bun test" },
        },
        agents: "Preserve the existing API. Run bun test after the edit.\n",
        source: 'export const greeting = "hello";\n',
        testExpectation: "hello world",
      }),
    },
    objective:
      "Measure the exact local model's tool protocol, then attempt one bounded disposable edit and verifier run only if the protocol gate passes.",
    policy: {
      writeAuthority: "bounded",
      networkAuthority: "loopback",
      commandPolicy: "disposable_fixture_only",
    },
    budgets: {
      actions: 64,
      inputTokens: null,
      outputTokens: 512,
      wallClockMs: PROBE_TIMEOUT_MS,
    },
    visibleAcceptance: [
      {
        id: "protocol-measured",
        statement:
          "The real model protocol result is captured separately from host-only evidence.",
        type: "behavioral",
        required: true,
      },
      {
        id: "bounded-edit-verified",
        statement:
          "If the protocol gate passes, the requested edit and bun test are verified by the host.",
        type: "test",
        required: true,
      },
    ],
    protectedAcceptanceRef: null,
    tags: ["local", "real-model", "micro", "no-download"],
  });
}

function localProtocolEvaluationCase() {
  return parsePublicEvaluationCase({
    schemaVersion: 1,
    caseId: "local-protocol-replay",
    revision: `probe-${AGENT_CAPABILITY_PROBE_VERSION}-protocol-v1`,
    title: "Real local model protocol-only replay baseline",
    family: "protocol",
    capabilityTarget: "C1",
    origin: "local_real",
    workspaceFixture: {
      source: "none:protocol-only",
      digest: digestValue({
        probeVersion: AGENT_CAPABILITY_PROBE_VERSION,
        executableWorkspace: false,
        replayScope: "all_recorded_provider_frames",
      }),
    },
    objective:
      "Measure and preserve the exact local model's bounded tool protocol without executing workspace mutations.",
    policy: {
      writeAuthority: "none",
      networkAuthority: "loopback",
      commandPolicy: "no_workspace_execution",
    },
    budgets: {
      actions: 16,
      inputTokens: null,
      outputTokens: 512,
      wallClockMs: PROBE_TIMEOUT_MS,
    },
    visibleAcceptance: [
      {
        id: "protocol-recorded",
        statement:
          "Every real provider frame in the protocol trial is sealed and consumed by offline replay.",
        type: "behavioral",
        required: true,
      },
    ],
    protectedAcceptanceRef: null,
    tags: ["local", "real-model", "protocol", "replay", "no-write"],
  });
}

interface LocalTrialValue {
  probe?: AgentCapabilityProbeResult;
  representative?: AgentJourneyResult;
  identityConflict?: string;
  failedDimensions?: string[];
}

interface LocalEvaluationResult {
  report: LocalEvaluationReport;
  evidenceBundles: string[];
}

async function evaluateLocalModelsWithEvidence(
  signal: AbortSignal,
  maxModels: number,
  artifactRoot: string,
  provenance: EvaluationProvenance,
  protocolOnly = false,
): Promise<LocalEvaluationResult> {
  const discovered: Array<{
    adapter: LocalRuntimeAdapter;
    candidate: ModelCandidate;
    runtime: RuntimeDetection;
  }> = [];
  for (const adapter of localRuntimeAdapters()) {
    let runtime: RuntimeDetection;
    try {
      runtime = await adapter.detect(signal);
    } catch (error) {
      runtime = {
        id: adapter.id,
        displayName: adapter.id,
        installed: false,
        detail: error instanceof Error ? error.message : String(error),
      };
    }
    let candidates: ModelCandidate[];
    try {
      candidates = await adapter.listModels(signal);
    } catch {
      candidates = [];
    }
    for (const candidate of candidates)
      if (candidate.source === "local")
        discovered.push({ adapter, candidate, runtime });
  }

  const unique = [
    ...new Map(discovered.map((entry) => [entry.candidate.id, entry])).values(),
  ].sort(
    (left, right) =>
      Number(right.candidate.local?.loaded === true) -
      Number(left.candidate.local?.loaded === true),
  );
  const evaluatedModels: LocalJourneyRun[] = [];
  const evidenceBundles: string[] = [];
  const evaluationCase = protocolOnly
    ? localProtocolEvaluationCase()
    : localEvaluationCase();
  const source = await captureEvaluationSourceSnapshot({
    root: projectRoot,
    executedSourcePath: path.join(projectRoot, "scripts", "evaluate-agent.ts"),
    packageVersion: provenance.packageVersion,
    artifacts: provenance.artifacts,
  });

  for (const { adapter, candidate, runtime } of unique.slice(0, maxModels)) {
    const modelLabel = candidate.modelId ?? candidate.displayName;
    if (candidate.local?.loaded === false) {
      const reason = `Model ${modelLabel} is discovered but not loaded; the evaluator never loads or downloads models.`;
      evaluatedModels.push({
        id: candidate.id,
        status: "skipped",
        reason,
        journeys: EXPECTED_AGENT_JOURNEYS.map((id) =>
          unprovenJourney(id, "skipped", reason),
        ),
      });
      continue;
    }
    const provider = adapter.provider?.();
    if (!provider) {
      const reason = `Runtime ${adapter.id} does not expose a provider adapter.`;
      evaluatedModels.push({
        id: candidate.id,
        status: "skipped",
        reason,
        journeys: EXPECTED_AGENT_JOURNEYS.map((id) =>
          unprovenJourney(id, "skipped", reason),
        ),
      });
      continue;
    }

    const createdAt = new Date();
    const manifest = createLocalEvaluationRunManifest({
      runId: runId(
        `${protocolOnly ? "protocol-local" : "local"}-${safeRunLabel(candidate.id)}`,
        createdAt,
      ),
      createdAt: createdAt.toISOString(),
      evaluationCase,
      source,
      candidate,
      runtime,
      request: {
        temperature: 0,
        maxOutputTokens: 512,
        toolSurfaceDigest: digestValue({
          probeVersion: AGENT_CAPABILITY_PROBE_VERSION,
          tools: workspaceTools.map((tool) => ({
            name: tool.name,
            risk: tool.risk,
            parameters: tool.parameters,
          })),
        }),
      },
      environment: {
        bun: Bun.version,
        node: process.version,
        os: `${process.platform} ${os.release()}`,
        platform: process.platform,
        arch: process.arch,
        hardwareFingerprint: observed(digestValue(provenance.hardware)),
      },
      commandArgv: [
        "bun",
        "run",
        "scripts/evaluate-agent.ts",
        ...process.argv.slice(2),
      ],
      environmentNames: ["SHELRA_EVAL_MAX_LOCAL_MODELS", "SHELRA_EVAL_TRIALS"],
    });
    const trial = await runLocalEvaluationTrial<LocalTrialValue>({
      artifactRoot,
      manifest,
      provider,
      async execute({
        provider: recordingProvider,
        recordAgentEvent,
      }): Promise<LocalEvaluationExecution<LocalTrialValue>> {
        const identityConflict = exactIdentityConflict(candidate, runtime);
        if (identityConflict)
          return {
            value: { identityConflict },
            outcome: "UNPROVEN",
            modelStatus: "unproven",
            failure: {
              class: "EXACT_IDENTITY_UNRESOLVED",
              summary: identityConflict,
              evidenceRefs: ["trial.result"],
            },
            metrics: { inferenceRequests: 0 },
            evidenceRefs: ["trial.result"],
          };

        if (protocolOnly)
          return executeLocalProtocolEvaluation({
            provider: recordingProvider,
            modelId: modelLabel,
            signal,
            environment: environmentInput(candidate),
          });

        const probeRoot = await mkdtemp(
          path.join(os.tmpdir(), "shelra-agent-eval-probe-"),
        );
        let probe: AgentCapabilityProbeResult;
        try {
          probe = await probeAgentCapability(
            recordingProvider,
            modelLabel,
            signal,
            {
              root: probeRoot,
              environment: environmentInput(candidate),
            },
          );
        } finally {
          await rm(probeRoot, { recursive: true, force: true });
        }
        if (!probe.agenticCodingEligible)
          return {
            value: { probe },
            outcome: "UNPROVEN",
            modelStatus: "unproven",
            failure: {
              class: "CAPABILITY_PROBE_NOT_ELIGIBLE",
              summary: `Model ${modelLabel} measured ${probe.agentCapabilityClass}; the unsupported coding journey was not attempted.`,
              evidenceRefs: ["provider.events", "trial.result"],
            },
            metrics: {
              conversation: probe.conversation,
              readTool: probe.readTool,
              multiTurnTools: probe.multiTurnTools,
              agenticCodingEligible: probe.agenticCodingEligible,
            },
            evidenceRefs: ["provider.events", "trial.result"],
          };

        const measuredCandidate: ModelCandidate = {
          ...candidate,
          agentProbe: probe,
          quality: { ...candidate.quality, confidence: "measured" },
        };
        const representative = await runLocalRepresentative(
          measuredCandidate,
          recordingProvider,
          signal,
          recordAgentEvent,
        );
        const modelStatus = [
          "completed",
          "blocked",
          "failed",
          "cancelled",
        ].includes(representative.status)
          ? (representative.status as
              "completed" | "blocked" | "failed" | "cancelled")
          : "failed";
        return {
          value: { probe, representative },
          outcome: representative.passed
            ? "PASS"
            : modelStatus === "cancelled"
              ? "BLOCKED"
              : "FAIL",
          modelStatus,
          ...(representative.passed
            ? {}
            : {
                failure: {
                  class: `LOCAL_JOURNEY_${modelStatus.toUpperCase()}`,
                  summary: representative.reason,
                  evidenceRefs: ["provider.events", "agent.events"],
                },
              }),
          metrics: {
            conversation: probe.conversation,
            readTool: probe.readTool,
            multiTurnTools: probe.multiTurnTools,
            agenticCodingEligible: probe.agenticCodingEligible,
            representativePassed: representative.passed,
            turns: representative.turns,
            toolRuns: representative.toolRuns,
            recoveryCount: representative.recoveryCount,
          },
          evidenceRefs: ["provider.events", "agent.events", "trial.result"],
        };
      },
    });
    evidenceBundles.push(trial.manifestPath);
    const trialValue = trial.value;
    if (!trialValue) {
      const reason = `Local evaluation driver failed for ${modelLabel}: ${trial.summary.failure?.summary ?? "unknown failure"}`;
      evaluatedModels.push({
        id: candidate.id,
        status: "failed",
        reason,
        evidenceRef: trial.manifestPath,
        journeys: EXPECTED_AGENT_JOURNEYS.map((id) =>
          unprovenJourney(id, "unproven", reason),
        ),
      });
      continue;
    }
    if (trialValue.identityConflict) {
      const reason = `Exact identity is unresolved for ${modelLabel}: ${trialValue.identityConflict}`;
      evaluatedModels.push({
        id: candidate.id,
        status: "skipped",
        reason,
        evidenceRef: trial.manifestPath,
        journeys: EXPECTED_AGENT_JOURNEYS.map((id) =>
          unprovenJourney(id, "skipped", reason),
        ),
      });
      continue;
    }
    const probe = trialValue.probe;
    if (!probe) {
      const reason = `Local evaluation for ${modelLabel} produced no capability probe.`;
      evaluatedModels.push({
        id: candidate.id,
        status: "failed",
        reason,
        evidenceRef: trial.manifestPath,
        journeys: EXPECTED_AGENT_JOURNEYS.map((id) =>
          unprovenJourney(id, "unproven", reason),
        ),
      });
      continue;
    }
    if (protocolOnly) {
      const failedDimensions = trialValue.failedDimensions ?? [];
      const reason =
        failedDimensions.length === 0
          ? `Protocol-only trial passed every measured dimension for ${modelLabel}; no coding journey was executed.`
          : `Protocol-only trial preserved ${failedDimensions.join(", ")} as non-passing for ${modelLabel}; no coding journey was executed.`;
      evaluatedModels.push({
        id: candidate.id,
        status: "measured",
        reason,
        probe,
        evidenceRef: trial.manifestPath,
        journeys: EXPECTED_AGENT_JOURNEYS.map((id) =>
          unprovenJourney(id, "unproven", reason),
        ),
      });
      continue;
    }
    if (!probe.agenticCodingEligible) {
      const reason = `Model ${modelLabel} is ${probe.agentCapabilityClass}; full local matrix is UNPROVEN and no unsupported coding run is attempted. ${probe.notes.slice(0, 2).join(" ")}`;
      evaluatedModels.push({
        id: candidate.id,
        status: "skipped",
        reason,
        probe,
        evidenceRef: trial.manifestPath,
        journeys: EXPECTED_AGENT_JOURNEYS.map((id) =>
          unprovenJourney(id, "skipped", reason),
        ),
      });
      continue;
    }
    const representative = trialValue.representative;
    if (!representative) {
      const reason = `Eligible model ${modelLabel} produced no representative journey result.`;
      evaluatedModels.push({
        id: candidate.id,
        status: "failed",
        reason,
        probe,
        evidenceRef: trial.manifestPath,
        journeys: EXPECTED_AGENT_JOURNEYS.map((id) =>
          unprovenJourney(id, "unproven", reason),
        ),
      });
      continue;
    }
    const journeys = EXPECTED_AGENT_JOURNEYS.map((id) =>
      id === representative.id
        ? representative
        : unprovenJourney(
            id,
            "unproven",
            `The current local evaluator measured only the representative one-file journey for ${modelLabel}; this journey remains UNPROVEN.`,
          ),
    );
    evaluatedModels.push({
      id: candidate.id,
      status: representative.status === "failed" ? "failed" : "measured",
      reason:
        representative.status === "failed"
          ? representative.reason
          : `Capability probe passed for ${modelLabel}; one representative coding journey was executed in a disposable fixture and the remaining matrix entries remain UNPROVEN.`,
      probe,
      journeys,
      evidenceRef: trial.manifestPath,
    });
  }

  const summary = summarizeAgentEvaluation(
    evaluatedModels.flatMap((model) => model.journeys),
  );
  return {
    report: {
      policy: "local_only_no_download_no_paid_fallback",
      discoveredModels: discovered.length,
      evaluatedModels,
      aggregateStatus:
        discovered.length === 0 ? "UNPROVEN" : summary.aggregateStatus,
    },
    evidenceBundles,
  };
}

async function replayEvaluationRun(
  manifestPath: string,
  json: boolean,
): Promise<void> {
  const resolvedManifestPath = path.resolve(manifestPath);
  const bundle = await readEvaluationRunBundle(resolvedManifestPath);
  const replay = await replayEvaluationRunBundle(bundle);
  if (json) {
    console.log(JSON.stringify(replay.report, null, 2));
  } else
    console.log(
      `Evaluation replay: integrity=verified run=${replay.report.runId} recorded=${replay.report.recordedOutcome} reproduction=${replay.report.reproduction.status}`,
    );
  process.exitCode = replay.exitCode;
}

async function main(): Promise<void> {
  const replayManifest = parseFlag("--replay-run");
  if (replayManifest) {
    await replayEvaluationRun(replayManifest, hasFlag("--json"));
    return;
  }
  const protocolOnly = hasFlag("--protocol-only");
  const local = protocolOnly || hasFlag("--local") || hasFlag("--local-only");
  const deterministic = !hasFlag("--local-only") && !protocolOnly;
  const json = hasFlag("--json");
  const summaryOnly = hasFlag("--summary");
  const maxModels = positiveInteger(
    parseFlag("--max-models") ?? process.env.SHELRA_EVAL_MAX_LOCAL_MODELS,
    DEFAULT_MAX_LOCAL_MODELS,
  );
  const provenance = await buildProvenance();
  const output: EvaluationOutput = {
    schemaVersion: 1,
    provenance,
    evidenceBundles: {},
  };
  const artifactRoot = evaluationArtifactRoot();

  if (deterministic) {
    const startedAt = new Date();
    const store = await createDeterministicRunStore(
      artifactRoot,
      provenance,
      startedAt,
    );
    output.evidenceBundles!.deterministic = store.manifestPath;
    await store.appendObservation({
      origin: "host",
      kind: "deterministic.started",
      payload: {
        evidenceClass: "scripted_fake",
        fixtureRevision: AGENT_EVALUATION_FIXTURE_REVISION,
        journeyIds: EXPECTED_AGENT_JOURNEYS,
      },
    });
    try {
      output.deterministic = await runDeterministicAgentEvaluation();
      await store.appendObservation({
        origin: "host",
        kind: "deterministic.result",
        payload: output.deterministic,
      });
      const summary = output.deterministic.summary;
      await store.seal({
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        outcome: summary.aggregateStatus,
        modelStatus:
          summary.aggregateStatus === "PASS"
            ? "completed"
            : summary.aggregateStatus === "FAIL"
              ? "failed"
              : "unproven",
        ...(summary.aggregateStatus === "PASS"
          ? {}
          : {
              failure: {
                class: "DETERMINISTIC_MATRIX_NOT_PASSING",
                summary: `Deterministic matrix result: ${summary.aggregateStatus}.`,
                evidenceRefs: ["observation:2"],
              },
            }),
        metrics: {
          total: output.deterministic.journeys.length,
          passed: summary.passed,
          failed: summary.failed,
          unproven: summary.unproven,
          skipped: summary.skipped,
        },
        evidenceRefs: ["observation:1", "observation:2"],
      });
    } catch (error) {
      await store.appendObservation({
        origin: "host",
        kind: "deterministic.exception",
        payload: {
          name: error instanceof Error ? error.name : "UnknownError",
          message: error instanceof Error ? error.message : String(error),
        },
      });
      await store.seal({
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        outcome: "FAIL",
        modelStatus: "failed",
        failure: {
          class: "DETERMINISTIC_EVALUATOR_EXCEPTION",
          summary: error instanceof Error ? error.message : String(error),
          evidenceRefs: ["observation:2"],
        },
        metrics: {},
        evidenceRefs: ["observation:1", "observation:2"],
      });
      throw error;
    }
  }

  if (local) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const localResult = await evaluateLocalModelsWithEvidence(
        controller.signal,
        maxModels,
        artifactRoot,
        provenance,
        protocolOnly,
      );
      output.local = localResult.report;
      output.evidenceBundles!.local = localResult.evidenceBundles;
    } finally {
      clearTimeout(timeout);
    }
  }

  if (json) console.log(JSON.stringify(output, null, 2));
  else printHumanReport(output, summaryOnly);

  const deterministicFailed =
    output.deterministic?.summary.aggregateStatus === "FAIL";
  const localFailed = output.local?.aggregateStatus === "FAIL";
  if (deterministicFailed || localFailed) process.exitCode = 1;
}

await main();
