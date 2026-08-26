import { expect, test } from "bun:test";
import {
  isCapabilityProbeCurrent,
  isCapabilityProbeFailure,
} from "../../src/agent/capability-cache.js";
import type { ModelCandidate } from "../../src/shared/types.js";

const hardware = {
  os: "win32",
  platform: "win32",
  arch: "x64",
  cpuModel: "fixture CPU",
  cpuCores: 8,
  memoryGb: 16,
  accelerator: "fixture GPU",
};

const candidate: ModelCandidate = {
  id: "lm-studio/model-wire-id",
  providerId: "lm-studio",
  modelId: "model-wire-id",
  displayName: "Model Label",
  source: "local",
  capabilities: {
    tools: true,
    structuredOutput: true,
    reasoning: false,
    vision: false,
    maxContext: 32_768,
  },
  free: { status: "verified_free" },
  privacy: { classification: "local", retentionKnown: true },
  quality: { confidence: "measured" },
  health: { state: "healthy" },
  local: { runtime: "lm-studio", quant: "Q4_K_M" },
};

const probe: NonNullable<ModelCandidate["agentProbe"]> = {
  probeVersion: 11,
  conversation: true,
  readTool: true,
  multiTurnTools: true,
  agenticCodingEligible: true,
  agentCapabilityClass: "coding_agent",
  environment: {
    modelId: "model-wire-id",
    runtimeId: "lm-studio",
    task: "capability-probe",
    quantization: "Q4_K_M",
    contextLength: 32_768,
    generation: { temperature: 0, maxOutputTokens: 512 },
    hardware,
  },
  notes: [],
};

test("capability cache accepts an exact model/runtime/hardware match", () => {
  expect(isCapabilityProbeCurrent(candidate, probe, hardware)).toBe(true);
});

test("capability cache rejects changed quantization, context, or hardware", () => {
  expect(
    isCapabilityProbeCurrent(
      { ...candidate, local: { runtime: "lm-studio", quant: "Q8_0" } },
      probe,
      hardware,
    ),
  ).toBe(false);
  expect(
    isCapabilityProbeCurrent(
      {
        ...candidate,
        capabilities: { ...candidate.capabilities, maxContext: 16_384 },
      },
      probe,
      hardware,
    ),
  ).toBe(false);
  expect(
    isCapabilityProbeCurrent(candidate, probe, { ...hardware, memoryGb: 32 }),
  ).toBe(false);
});

test("capability cache rejects legacy probes without reproducibility metadata", () => {
  expect(
    isCapabilityProbeCurrent(candidate, {
      ...probe,
      environment: undefined,
    }),
  ).toBe(false);
});

test("capability cache never treats a transport failure as model behavior", () => {
  const failed = {
    ...probe,
    notes: ["Capability probe failed: The operation timed out."],
  };

  expect(isCapabilityProbeFailure(failed)).toBe(true);
  expect(isCapabilityProbeCurrent(candidate, failed, hardware)).toBe(false);
});
