import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  commandAvailable,
  openControlPlane,
  type ControlPlane,
} from "./control-plane.js";
import { persistRepositorySettings } from "../config/settings.js";
import type { CapabilityResult } from "../shared/types.js";

function mark(value: boolean): string {
  return value ? "[ok]" : "[ ]";
}

function closeQuietly(controlPlane: ControlPlane): void {
  controlPlane.close();
}

function capabilityMark(value: boolean | undefined): string {
  return value === undefined ? "[?]" : value ? "PASS" : "FAIL";
}

function capabilityResultMark(result: CapabilityResult | undefined): string {
  if (!result || result.status === "unmeasured") return "[?]";
  return result.status === "pass" ? "PASS" : "FAIL";
}

function measuredCapability(
  result: CapabilityResult | undefined,
  fallback: boolean | undefined,
): string {
  return result ? capabilityResultMark(result) : capabilityMark(fallback);
}

export function agentDoctorLines(
  models: readonly import("../shared/types.js").ModelCandidate[],
): string[] {
  const local =
    models.find(
      (model) => model.source === "local" && model.providerId !== "llmfit",
    ) ?? models.find((model) => model.source === "local");
  if (!local)
    return [
      "LocalCode Agent Diagnostics",
      "",
      "Model                         NOT FOUND",
      "Autonomous coding             NOT READY",
    ];
  const probe = local.agentProbe;
  const environment = probe?.environment;
  const contextLength =
    environment?.contextLength ?? local.capabilities.maxContext;
  return [
    "LocalCode Agent Diagnostics",
    "",
    `Model                         ${local.displayName}`,
    `Model ID                     ${local.modelId ?? local.displayName}`,
    `Runtime                       ${local.local?.runtime ?? local.providerId}`,
    `Quantization                  ${local.local?.quant ?? "unknown"}`,
    `Context                       ${contextLength ?? "unknown"}`,
    `Probe version                 ${probe?.probeVersion ?? "unknown"}`,
    `Generation                    ${environment ? `temperature=${environment.generation.temperature} maxOutputTokens=${environment.generation.maxOutputTokens}` : "unknown"}`,
    `Capability                    ${probe?.agentCapabilityClass ?? "UNPROBED"}`,
    "",
    `Conversation                  ${measuredCapability(probe?.profile?.conversation, probe?.conversation)}`,
    `No-tool discipline            ${measuredCapability(probe?.profile?.noToolDiscipline, probe?.conversation)}`,
    `Repository read               ${capabilityMark(probe?.readTool)}`,
    `Tool selection                ${measuredCapability(probe?.profile?.toolSelection, probe?.readTool)}`,
    `Arguments                     ${measuredCapability(probe?.profile?.toolArguments, probe?.readTool)}`,
    `Recovery                      ${capabilityResultMark(probe?.profile?.errorRecovery)}`,
    `Multi-turn                    ${measuredCapability(probe?.profile?.multiTurnTools, probe?.multiTurnTools)}`,
    `Editing                       ${capabilityResultMark(probe?.profile?.editReliability)}`,
    `Test iteration               ${capabilityResultMark(probe?.profile?.verificationBehavior)}`,
    `Verification                 ${capabilityResultMark(probe?.profile?.verificationBehavior)}`,
    "",
    `Autonomous coding             ${probe?.agentCapabilityClass === "advanced_coding_agent" ? "READY" : "NOT READY"}`,
  ];
}

export async function runAgentDoctor(root = process.cwd()): Promise<void> {
  const controlPlane = await openControlPlane(root);
  try {
    const result = await controlPlane.discoverModels(
      AbortSignal.timeout(30_000),
      { probeLocalCapabilities: true },
    );
    console.log(agentDoctorLines(result.models).join("\n"));
  } finally {
    closeQuietly(controlPlane);
  }
}

export async function runDoctor(root = process.cwd()): Promise<void> {
  const controlPlane = await openControlPlane(root);
  try {
    const [hardware, runtimes, git, rg] = await Promise.all([
      controlPlane.inspectHardware(),
      controlPlane.discoverRuntimes(AbortSignal.timeout(1_000)),
      commandAvailable("git"),
      commandAvailable("rg"),
    ]);
    const providerHealth = await Promise.all(
      controlPlane.providers.adapters.map(
        async (provider) =>
          [
            provider.id,
            await provider.health(AbortSignal.timeout(1_500)),
          ] as const,
      ),
    );
    const healthByProvider = new Map(providerHealth);
    console.log("LocalCode Doctor\n");
    console.log(
      `Terminal     ${process.stdout.isTTY ? "interactive" : "non-interactive"} (${process.stdout.columns ?? "?"} columns)`,
    );
    console.log(`OS           ${hardware.profile.os}`);
    console.log(
      `CPU          ${hardware.profile.cpuModel} (${hardware.profile.cpuCores} cores)`,
    );
    console.log(`Memory       ${hardware.profile.memoryGb} GB`);
    console.log(`Accelerator  ${hardware.profile.accelerator}`);
    console.log(
      `llmfit       ${mark(hardware.llmfitAvailable)} ${hardware.llmfitAvailable ? "available" : "fallback detection"}`,
    );
    console.log(`Git          ${mark(git)} ${git ? "available" : "missing"}`);
    console.log(
      `ripgrep      ${mark(rg)} ${rg ? "available" : "missing; fallback file search will be used"}`,
    );
    console.log(`SQLite       ${mark(true)} ${controlPlane.statePath}`);
    console.log("\nLocal runtimes");
    for (const runtime of runtimes.detections) {
      console.log(
        `  ${mark(runtime.installed)} ${runtime.displayName}${runtime.endpoint ? ` - ${runtime.endpoint}` : ""}`,
      );
    }
    console.log("\nProviders");
    for (const provider of controlPlane.providers.statuses) {
      const health = healthByProvider.get(provider.id);
      console.log(
        `  ${mark(provider.configured)} ${provider.displayName} - ${provider.configured ? provider.freeStatus : "not configured"} - ${health?.state ?? "not probed"} - ${provider.note}`,
      );
    }
  } finally {
    closeQuietly(controlPlane);
  }
}

export async function runModels(root = process.cwd()): Promise<void> {
  const controlPlane = await openControlPlane(root);
  try {
    const result = await controlPlane.discoverModels(
      AbortSignal.timeout(2_000),
    );
    console.log("LocalCode Models\n");
    console.log("Recommended for coding");
    if (result.recommendations.length === 0)
      console.log(
        "  [ ] No llmfit recommendations; install llmfit or inspect local runtimes.",
      );
    for (const model of result.recommendations) {
      console.log(
        `  ${model.fit ?? "FIT"}  ${model.displayName} - ${model.runtime ?? "runtime unknown"}${model.estimatedMemoryGb ? ` - ${model.estimatedMemoryGb} GB` : ""}`,
      );
    }
    console.log("\nDetected local models");
    const local = result.models.filter((model) => model.source === "local");
    if (local.length === 0)
      console.log("  [ ] No reachable local model endpoint.");
    for (const model of local)
      console.log(
        `  [ok] ${model.displayName} - ${model.local?.runtime ?? model.providerId} - ${model.health.state}`,
      );
    const cloud = result.models.filter((model) => model.source !== "local");
    if (cloud.length > 0) {
      console.log("\nCloud catalog");
      for (const model of cloud)
        console.log(
          `  ${model.free.status.toUpperCase()}  ${model.providerId} / ${model.displayName} - ${model.privacy.classification}`,
        );
    }
  } finally {
    closeQuietly(controlPlane);
  }
}

export async function runProviders(root = process.cwd()): Promise<void> {
  const controlPlane = await openControlPlane(root);
  try {
    console.log("LocalCode Providers\n");
    for (const provider of controlPlane.providers.statuses) {
      console.log(
        `${provider.configured ? "[ok]" : "[ ]"} ${provider.displayName}`,
      );
      console.log(`  endpoint    ${provider.endpoint}`);
      console.log(`  configured  ${provider.configured ? "yes" : "no"}`);
      console.log(`  free state  ${provider.freeStatus}`);
      console.log(`  privacy     ${provider.privacy}`);
      const adapter = controlPlane.providers.adapters.find(
        (candidate) => candidate.id === provider.id,
      );
      const health = adapter
        ? await adapter.health(AbortSignal.timeout(1_500))
        : undefined;
      console.log(
        `  health      ${health?.state ?? "not configured"}${health?.latencyMs === undefined ? "" : ` (${health.latencyMs} ms)`}`,
      );
      console.log(`  note        ${provider.note}\n`);
    }
  } finally {
    closeQuietly(controlPlane);
  }
}

export async function runConfig(root = process.cwd()): Promise<void> {
  const controlPlane = await openControlPlane(root);
  try {
    console.log("LocalCode Configuration\n");
    console.log(`privacy          ${controlPlane.settings.privacy}`);
    console.log(`routing          ${controlPlane.settings.routingMode}`);
    console.log(`permission       ${controlPlane.settings.permissionMode}`);
    console.log(`state            ${controlPlane.statePath}`);
  } finally {
    closeQuietly(controlPlane);
  }
}

export async function runSetup(
  root = process.cwd(),
  args: string[] = [],
): Promise<void> {
  const controlPlane = await openControlPlane(root);
  try {
    let privacy = controlPlane.settings.privacy;
    let routing = controlPlane.settings.routingMode;
    const interactive = Boolean(
      input.isTTY && output.isTTY && !args.includes("--non-interactive"),
    );
    if (interactive) {
      const rl = createInterface({ input, output });
      try {
        const selectedPrivacy = (
          await rl.question(`Privacy policy [${privacy}]: `)
        ).trim();
        const selectedRouting = (
          await rl.question(`Routing mode [${routing}]: `)
        ).trim();
        if (
          [
            "local_only",
            "private_zdr_only",
            "private",
            "trusted_cloud",
            "public_free",
          ].includes(selectedPrivacy)
        )
          privacy = selectedPrivacy as typeof privacy;
        if (["strict-zero", "ask-before-paid"].includes(selectedRouting))
          routing = selectedRouting as typeof routing;
      } finally {
        rl.close();
      }
    }
    controlPlane.db.setSetting("privacy.policy", privacy);
    controlPlane.db.setSetting("routing.mode", routing);
    await persistRepositorySettings(root, { privacy, routingMode: routing });
    const hardware = await controlPlane.inspectHardware();
    const runtimes = await controlPlane.discoverRuntimes(
      AbortSignal.timeout(1_000),
    );
    const recommendations = await controlPlane.hardware.recommendCodingModels({
      useCase: "coding",
      limit: 3,
    });
    console.log("LocalCode Setup\n");
    console.log("Scanning this machine...\n");
    console.log("System");
    console.log(`  OS                ${hardware.profile.os}`);
    console.log(`  CPU               ${hardware.profile.cpuModel}`);
    console.log(`  Memory            ${hardware.profile.memoryGb} GB`);
    console.log(`  Accelerator       ${hardware.profile.accelerator}`);
    console.log(
      `  llmfit            ${hardware.llmfitAvailable ? "[ok] available" : "[ ] not installed; basic detection"}`,
    );
    console.log("\nLocal runtimes");
    for (const runtime of runtimes.detections)
      console.log(`  ${mark(runtime.installed)} ${runtime.displayName}`);
    console.log("\nRecommended for coding");
    if (recommendations.length === 0)
      console.log("  [ ] No recommendation available yet.");
    for (const recommendation of recommendations)
      console.log(
        `  ${recommendation.fit ?? "FIT"}  ${recommendation.displayName}`,
      );
    const providerHealth = await Promise.all(
      controlPlane.providers.statuses.map(async (provider) => {
        const adapter = controlPlane.providers.adapters.find(
          (candidate) => candidate.id === provider.id,
        );
        const health = adapter
          ? await adapter.health(AbortSignal.timeout(1_500))
          : undefined;
        return { provider, health };
      }),
    );
    console.log("\nCloud providers");
    for (const { provider, health } of providerHealth) {
      console.log(
        `  ${mark(provider.configured)} ${provider.displayName} - ${provider.configured ? (health?.state ?? "not probed") : "not configured"} - free ${provider.freeStatus} - privacy ${provider.privacy}`,
      );
    }
    console.log("\nRouting");
    console.log("  Local -> Verified Free Cloud -> Stop & Ask");
    console.log(`  Mode: ${routing}`);
    console.log("\nPrivacy");
    console.log(`  ${privacy.toUpperCase()}`);
    console.log("\nReady.");
  } finally {
    closeQuietly(controlPlane);
  }
}
