import { createHash } from "node:crypto";
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
import type { LocalRuntimeAdapter } from "../src/runtimes/types.js";
import { LocalCodeDatabase } from "../src/storage/database.js";
import { runCommand } from "../src/shared/process.js";
import type { ProviderAdapter } from "../src/providers/types.js";
import type {
  AgentProbeHardwareSnapshot,
  ModelCandidate,
} from "../src/shared/types.js";
import { workspaceTools } from "../src/tools/workspace.js";
import type { AgentRunResult } from "../src/agent/types.js";
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
  const ollamaUrl = env.LOCALCODE_OLLAMA_URL ?? "http://127.0.0.1:11434";
  if (isLoopbackUrl(ollamaUrl)) adapters.push(new OllamaRuntime(ollamaUrl));

  const configuredOpenAi = env.LOCALCODE_OPENAI_BASE_URL;
  if (configuredOpenAi && isLoopbackUrl(configuredOpenAi))
    adapters.push(
      new OpenAICompatibleLocalRuntime(
        "local-openai",
        "OpenAI-compatible local endpoint",
        configuredOpenAi,
      ),
    );

  const lmStudioUrl = env.LOCALCODE_LM_STUDIO_URL ?? "http://127.0.0.1:1234/v1";
  if (isLoopbackUrl(lmStudioUrl))
    adapters.push(
      new OpenAICompatibleLocalRuntime("lm-studio", "LM Studio", lmStudioUrl),
    );

  const llamaCppUrl = env.LOCALCODE_LLAMA_CPP_URL ?? "http://127.0.0.1:8080/v1";
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
        message.content.includes("LocalCode structured task state"),
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

async function evaluateLocalModels(
  signal: AbortSignal,
  maxModels: number,
): Promise<LocalEvaluationReport> {
  const adapters = localRuntimeAdapters();
  const discovered: Array<{
    adapter: LocalRuntimeAdapter;
    candidate: ModelCandidate;
  }> = [];
  for (const adapter of adapters) {
    let candidates: ModelCandidate[];
    try {
      candidates = await adapter.listModels(signal);
    } catch {
      candidates = [];
    }
    for (const candidate of candidates)
      if (candidate.source === "local") discovered.push({ adapter, candidate });
  }

  const unique = [
    ...new Map(discovered.map((entry) => [entry.candidate.id, entry])).values(),
  ].sort(
    (left, right) =>
      Number(right.candidate.local?.loaded === true) -
      Number(left.candidate.local?.loaded === true),
  );
  const evaluatedModels: LocalJourneyRun[] = [];
  for (const entry of unique.slice(0, maxModels)) {
    const { adapter, candidate } = entry;
    const modelLabel = candidate.modelId ?? candidate.displayName;
    if (candidate.local?.loaded === false) {
      evaluatedModels.push({
        id: candidate.id,
        status: "skipped",
        reason: `Model ${modelLabel} is discovered but not loaded; the evaluator never loads or downloads models.`,
        journeys: EXPECTED_AGENT_JOURNEYS.map((id) =>
          unprovenJourney(
            id,
            "skipped",
            `Skipped because local runtime reports ${modelLabel} as unloaded.`,
          ),
        ),
      });
      continue;
    }

    const provider = adapter.provider?.();
    if (!provider) {
      evaluatedModels.push({
        id: candidate.id,
        status: "skipped",
        reason: `Runtime ${adapter.id} does not expose a provider adapter.`,
        journeys: EXPECTED_AGENT_JOURNEYS.map((id) =>
          unprovenJourney(
            id,
            "skipped",
            `No provider adapter for ${adapter.id}.`,
          ),
        ),
      });
      continue;
    }

    let probe: AgentCapabilityProbeResult;
    try {
      const probeRoot = await mkdtemp(
        path.join(os.tmpdir(), "shelra-agent-eval-probe-"),
      );
      try {
        probe = await probeAgentCapability(provider, modelLabel, signal, {
          root: probeRoot,
          environment: environmentInput(candidate),
        });
      } finally {
        await rm(probeRoot, { recursive: true, force: true });
      }
    } catch (error) {
      const reason = `Capability probe failed for ${modelLabel}: ${error instanceof Error ? error.message : String(error)}`;
      evaluatedModels.push({
        id: candidate.id,
        status: "failed",
        reason,
        journeys: EXPECTED_AGENT_JOURNEYS.map((id) =>
          unprovenJourney(id, "unproven", reason),
        ),
      });
      continue;
    }

    const measuredCandidate: ModelCandidate = {
      ...candidate,
      agentProbe: probe,
      quality: { ...candidate.quality, confidence: "measured" },
    };
    if (!probe.agenticCodingEligible) {
      const reason = `Model ${modelLabel} is ${probe.agentCapabilityClass}; full local matrix is UNPROVEN and no unsupported coding run is attempted. ${probe.notes.slice(0, 2).join(" ")}`;
      evaluatedModels.push({
        id: candidate.id,
        status: "skipped",
        reason,
        probe,
        journeys: EXPECTED_AGENT_JOURNEYS.map((id) =>
          unprovenJourney(id, "skipped", reason),
        ),
      });
      continue;
    }

    let representative: AgentJourneyResult;
    try {
      representative = await runLocalRepresentative(
        measuredCandidate,
        provider,
        signal,
      );
    } catch (error) {
      const reason = `Representative local journey failed for ${modelLabel}: ${error instanceof Error ? error.message : String(error)}`;
      representative = {
        ...unprovenJourney("one-file-modification", "unproven", reason),
        status: "failed",
        reason,
      };
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
    });
  }

  const allJourneys = evaluatedModels.flatMap((model) => model.journeys);
  const summary = summarizeAgentEvaluation(allJourneys);
  return {
    policy: "local_only_no_download_no_paid_fallback",
    discoveredModels: discovered.length,
    evaluatedModels,
    aggregateStatus:
      discovered.length === 0 ? "UNPROVEN" : summary.aggregateStatus,
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

async function main(): Promise<void> {
  const local = hasFlag("--local") || hasFlag("--local-only");
  const deterministic = !hasFlag("--local-only");
  const json = hasFlag("--json");
  const summaryOnly = hasFlag("--summary");
  const maxModels = positiveInteger(
    parseFlag("--max-models") ?? process.env.SHELRA_EVAL_MAX_LOCAL_MODELS,
    DEFAULT_MAX_LOCAL_MODELS,
  );
  const provenance = await buildProvenance();
  const output: EvaluationOutput = { schemaVersion: 1, provenance };

  if (deterministic)
    output.deterministic = await runDeterministicAgentEvaluation();

  if (local) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      output.local = await evaluateLocalModels(controller.signal, maxModels);
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
