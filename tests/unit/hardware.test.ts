import { describe, expect, test } from "bun:test";
import { LlmfitHardwareIntelligence } from "../../src/hardware/llmfit.js";

describe("llmfit hardware adapter", () => {
  test("parses machine-readable system and coding recommendations", async () => {
    const adapter = new LlmfitHardwareIntelligence(async (_command, args) => {
      if (args[1] === "system") {
        return {
          exitCode: 0,
          stdout: JSON.stringify({
            system: {
              cpu_model: "Test CPU",
              memory_gb: 32,
              accelerator: "Test GPU",
            },
          }),
          stderr: "",
          stdoutTruncated: false,
          stderrTruncated: false,
          isolation: {
            applicationPolicy: "enforced",
            osEnforced: false,
            networkEnforced: false,
            mechanism: "none",
            reason: "fixture",
          },
        };
      }
      return {
        exitCode: 0,
        stdout: JSON.stringify({
          recommendations: [{ id: "qwen", fit: "BEST", memory_gb: 8 }],
        }),
        stderr: "",
        stdoutTruncated: false,
        stderrTruncated: false,
        isolation: {
          applicationPolicy: "enforced",
          osEnforced: false,
          networkEnforced: false,
          mechanism: "none",
          reason: "fixture",
        },
      };
    });

    const inspection = await adapter.inspect();
    const recommendations = await adapter.recommendCodingModels();

    expect(inspection.source).toBe("llmfit");
    expect(inspection.profile.cpuModel).toBe("Test CPU");
    expect(recommendations[0]?.fit).toBe("BEST");
  });

  test("falls back when llmfit is unavailable", async () => {
    const adapter = new LlmfitHardwareIntelligence(async () => {
      throw new Error("not found");
    });
    const inspection = await adapter.inspect();
    expect(inspection.source).toBe("basic");
    expect(inspection.llmfitAvailable).toBe(false);
  });
});
