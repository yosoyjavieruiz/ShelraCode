import { expect, test } from "bun:test";
import { agentDoctorLines } from "../../src/cli/commands.js";
import type { ModelCandidate } from "../../src/shared/types.js";

const model: ModelCandidate = {
  id: "lm-studio/qwen",
  providerId: "lm-studio",
  displayName: "qwen",
  source: "local",
  capabilities: {
    tools: true,
    structuredOutput: true,
    reasoning: false,
    vision: false,
  },
  free: { status: "verified_free" },
  privacy: { classification: "local", retentionKnown: true },
  quality: { confidence: "measured" },
  health: { state: "healthy" },
  local: { runtime: "lm-studio", quant: "Q5_K_M" },
  agentProbe: {
    profile: {
      modelId: "qwen",
      runtimeId: "lm-studio",
      conversation: { status: "pass", notes: [] },
      noToolDiscipline: { status: "pass", notes: [] },
      toolSelection: { status: "pass", notes: [] },
      toolArguments: { status: "pass", notes: [] },
      multiTurnTools: { status: "pass", notes: [] },
      errorRecovery: { status: "unmeasured", notes: [] },
      repositoryReasoning: { status: "unmeasured", notes: [] },
      editReliability: { status: "pass", notes: [] },
      verificationBehavior: { status: "pass", notes: [] },
      overall: "coding_agent",
    },
    conversation: true,
    readTool: true,
    multiTurnTools: true,
    agenticCodingEligible: true,
    agentCapabilityClass: "coding_agent",
    notes: [],
  },
};

test("agent doctor reports measured capability and unmeasured release gates", () => {
  const output = agentDoctorLines([model]).join("\n");
  expect(output).toContain("Capability                    coding_agent");
  expect(output).toContain("Conversation                  PASS");
  expect(output).toContain("Editing                       PASS");
  expect(output).toContain("Recovery                      [?]");
  expect(output).toContain("Autonomous coding             NOT READY");
});

test("agent doctor does not claim readiness when no local model exists", () => {
  expect(agentDoctorLines([]).join("\n")).toContain(
    "Autonomous coding             NOT READY",
  );
});

test("agent doctor surfaces the wire identity and reproducibility metadata", () => {
  const measuredModel: ModelCandidate = {
    ...model,
    modelId: "qwen-wire-id",
    agentProbe: {
      ...model.agentProbe!,
      probeVersion: 11,
      environment: {
        modelId: "qwen-wire-id",
        runtimeId: "lm-studio",
        task: "capability-probe",
        quantization: "Q5_K_M",
        contextLength: 32_768,
        generation: { temperature: 0, maxOutputTokens: 512 },
      },
    },
  };

  const output = agentDoctorLines([measuredModel]).join("\n");

  expect(output).toContain("Model ID                     qwen-wire-id");
  expect(output).toContain("Context                       32768");
  expect(output).toContain("Probe version                 11");
  expect(output).toContain(
    "Generation                    temperature=0 maxOutputTokens=512",
  );
});

test("agent doctor prefers an executable runtime model over an llmfit recommendation", () => {
  const recommendation: ModelCandidate = {
    ...model,
    id: "llmfit/recommended-coder",
    providerId: "llmfit",
    displayName: "recommended-coder",
    local: { runtime: "llmfit" },
    agentProbe: undefined,
  };

  const output = agentDoctorLines([recommendation, model]).join("\n");

  expect(output).toContain("Model                         qwen");
  expect(output).not.toContain("recommended-coder");
});
