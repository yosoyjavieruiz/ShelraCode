import os from "node:os";
import { runCommand, type ProcessResult } from "../shared/process.js";
import type {
  HardwareInspection,
  HardwareIntelligence,
  LocalModelRecommendation,
  RecommendationOptions,
  SystemProfile,
} from "./types.js";
import type { LocalCodeLogger } from "../shared/logging.js";

type CommandRunner = (
  command: string,
  args: string[],
  signal?: AbortSignal,
) => Promise<ProcessResult>;

function basicProfile(): SystemProfile {
  const cpuModel = os.cpus()[0]?.model?.trim() || "Unknown CPU";
  const platform = process.platform;
  const accelerator =
    platform === "darwin"
      ? "Metal"
      : platform === "win32"
        ? "Unknown / DirectML possible"
        : "Unknown";
  return {
    os: `${platform} ${os.release()}`,
    platform,
    arch: process.arch,
    cpuModel,
    cpuCores: os.cpus().length,
    memoryGb: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
    accelerator,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout) as unknown;
  } catch {
    return undefined;
  }
}

function parseProfile(value: unknown, fallback: SystemProfile): SystemProfile {
  const root = asRecord(value);
  const system = asRecord(root?.system) ?? root;
  if (!system) return fallback;
  return {
    os:
      stringValue(system.os) ??
      stringValue(system.operating_system) ??
      fallback.os,
    platform: stringValue(system.platform) ?? fallback.platform,
    arch:
      stringValue(system.arch) ??
      stringValue(system.architecture) ??
      fallback.arch,
    cpuModel:
      stringValue(system.cpu_model) ??
      stringValue(system.cpu) ??
      fallback.cpuModel,
    cpuCores:
      numberValue(system.cpu_cores) ??
      numberValue(system.cores) ??
      fallback.cpuCores,
    memoryGb:
      numberValue(system.memory_gb) ??
      numberValue(system.ram_gb) ??
      fallback.memoryGb,
    accelerator:
      stringValue(system.accelerator) ??
      stringValue(system.gpu) ??
      fallback.accelerator,
    ...(numberValue(system.storage_free_gb) === undefined
      ? {}
      : { storageFreeGb: numberValue(system.storage_free_gb) }),
  };
}

function parseRecommendations(value: unknown): LocalModelRecommendation[] {
  const root = asRecord(value);
  const raw = Array.isArray(value)
    ? value
    : Array.isArray(root?.models)
      ? root.models
      : Array.isArray(root?.recommendations)
        ? root.recommendations
        : [];
  return raw.flatMap((entry): LocalModelRecommendation[] => {
    const model = asRecord(entry);
    if (!model) return [];
    const id =
      stringValue(model.id) ??
      stringValue(model.model) ??
      stringValue(model.name);
    if (!id) return [];
    return [
      {
        id,
        displayName:
          stringValue(model.display_name) ?? stringValue(model.name) ?? id,
        ...(stringValue(model.runtime)
          ? { runtime: stringValue(model.runtime) }
          : {}),
        ...(stringValue(model.quantization)
          ? { quantization: stringValue(model.quantization) }
          : {}),
        ...(numberValue(model.memory_gb) === undefined
          ? {}
          : { estimatedMemoryGb: numberValue(model.memory_gb) }),
        ...(numberValue(model.estimated_tps) === undefined
          ? {}
          : { estimatedTps: numberValue(model.estimated_tps) }),
        ...(numberValue(model.context) === undefined
          ? {}
          : { context: numberValue(model.context) }),
        ...(stringValue(model.fit) ? { fit: stringValue(model.fit) } : {}),
        ...(typeof model.tools === "boolean"
          ? { toolCapability: model.tools }
          : {}),
      },
    ];
  });
}

export class LlmfitHardwareIntelligence implements HardwareIntelligence {
  private readonly run: CommandRunner;
  private readonly logger?: LocalCodeLogger;

  constructor(run?: CommandRunner, logger?: LocalCodeLogger) {
    this.logger = logger?.child({ component: "hardware.llmfit" });
    this.run =
      run ??
      ((command, args, signal) =>
        runCommand(command, args, {
          signal,
          timeoutMs: 2_500,
          logger: this.logger,
        }));
  }

  async inspect(signal?: AbortSignal): Promise<HardwareInspection> {
    const fallback = basicProfile();
    this.logger?.debug("hardware.llmfit.inspect.started", {});
    try {
      const result = await this.run("llmfit", ["--json", "system"], signal);
      if (result.exitCode !== 0) {
        this.logger?.warn("hardware.llmfit.inspect.finished", {
          available: false,
          exitCode: result.exitCode,
        });
        return {
          profile: fallback,
          source: "basic",
          llmfitAvailable: false,
          message: "llmfit did not return a system profile",
        };
      }
      const inspection: HardwareInspection = {
        profile: parseProfile(parseJson(result.stdout), fallback),
        source: "llmfit",
        llmfitAvailable: true,
      };
      this.logger?.info("hardware.llmfit.inspect.finished", {
        available: true,
        exitCode: result.exitCode,
      });
      return inspection;
    } catch {
      this.logger?.warn("hardware.llmfit.inspect.finished", {
        available: false,
        errorType: "unavailable",
      });
      return {
        profile: fallback,
        source: "basic",
        llmfitAvailable: false,
        message: "llmfit is not installed or unavailable",
      };
    }
  }

  async recommendCodingModels(
    options: RecommendationOptions = {},
    signal?: AbortSignal,
  ): Promise<LocalModelRecommendation[]> {
    const limit = options.limit ?? 10;
    this.logger?.debug("hardware.llmfit.recommend.started", {
      useCase: options.useCase ?? "coding",
      limit,
    });
    try {
      const result = await this.run(
        "llmfit",
        [
          "recommend",
          "--json",
          "--use-case",
          options.useCase ?? "coding",
          "--limit",
          String(limit),
        ],
        signal,
      );
      if (result.exitCode !== 0) {
        this.logger?.warn("hardware.llmfit.recommend.finished", {
          count: 0,
          exitCode: result.exitCode,
        });
        return [];
      }
      const recommendations = parseRecommendations(
        parseJson(result.stdout),
      ).slice(0, limit);
      this.logger?.info("hardware.llmfit.recommend.finished", {
        count: recommendations.length,
        exitCode: result.exitCode,
      });
      return recommendations;
    } catch {
      this.logger?.warn("hardware.llmfit.recommend.finished", {
        count: 0,
        errorType: "unavailable",
      });
      return [];
    }
  }
}

export class BasicHardwareIntelligence implements HardwareIntelligence {
  async inspect(): Promise<HardwareInspection> {
    return {
      profile: basicProfile(),
      source: "basic",
      llmfitAvailable: false,
      message: "llmfit is not installed; basic detection is active",
    };
  }

  async recommendCodingModels(): Promise<LocalModelRecommendation[]> {
    return [];
  }
}
