import { expect, test } from "bun:test";
import {
  createExactModelIdentity,
  createUncalibratedDriverProfile,
  type ModelDriverProfile,
} from "../../src/driver/profile.js";
import {
  revalidateTaskRuntimeDriverReference,
  type TaskRuntimeRouteIdentity,
} from "../../src/agent/task-runtime-state.js";
import type { ModelCandidate } from "../../src/shared/types.js";

const identity = createExactModelIdentity({
  providerFamily: "lm-studio",
  modelId: "fixture-coder",
  artifactId: "fixture-artifact-v1",
  runtime: "lm-studio",
  runtimeVersion: "0.3.20",
  endpointProtocol: "openai-compatible",
  quantization: "Q4_K_M",
  chatTemplate: "chat-template-v1",
  toolTemplate: "tool-template-v1",
  contextConfiguration: { contextLength: 8_192 },
  samplingConfiguration: { temperature: 0.2 },
  operatingSystem: "win32",
  createdAt: "2026-08-29T00:00:00.000Z",
});

const baseProfile = createUncalibratedDriverProfile(identity);
const profile: ModelDriverProfile = {
  ...baseProfile,
  status: "certified",
  capabilityLevel: "C2",
  writeAuthority: "bounded",
  protocol: "constrained_json",
  editCodec: "structured_patch",
};

const candidate: ModelCandidate = {
  id: "lm-studio/fixture-coder",
  providerId: "lm-studio",
  modelId: "fixture-coder",
  displayName: "Fixture coder",
  source: "local",
  capabilities: {
    tools: true,
    structuredOutput: true,
    reasoning: false,
    vision: false,
  },
  free: { status: "verified_free" },
  privacy: {
    classification: "local",
    retentionKnown: true,
    trainsOnInputs: false,
  },
  quality: { confidence: "measured" },
  health: { state: "healthy" },
  local: {
    runtime: "lm-studio",
    runtimeVersion: "0.3.20",
    quant: "Q4_K_M",
    artifactId: "fixture-artifact-v1",
    chatTemplate: "chat-template-v1",
    toolParser: "tool-template-v1",
  },
};

const route: TaskRuntimeRouteIdentity = {
  candidateId: candidate.id,
  providerId: candidate.providerId,
  modelId: candidate.modelId,
  runtimeId: candidate.local?.runtime,
  driverProfileId: profile.id,
  driverIdentityDigest: profile.identityDigest,
  configurationDigest: "config-v1",
};

test("revalidates an exact Driver reference against the current host facts", () => {
  expect(
    revalidateTaskRuntimeDriverReference(
      route,
      profile,
      candidate,
      "config-v1",
    ),
  ).toEqual({
    driverProfileId: profile.id,
    driverIdentityDigest: profile.identityDigest,
    configurationDigest: "config-v1",
  });
});

test("drops exact authority when profile, configuration, or runtime facts change", () => {
  expect(
    revalidateTaskRuntimeDriverReference(
      route,
      undefined,
      candidate,
      "config-v1",
    ),
  ).toBeUndefined();
  expect(
    revalidateTaskRuntimeDriverReference(route, profile, candidate, undefined),
  ).toBeUndefined();
  expect(
    revalidateTaskRuntimeDriverReference(
      route,
      profile,
      candidate,
      "config-v2",
    ),
  ).toBeUndefined();
  expect(
    revalidateTaskRuntimeDriverReference(
      route,
      { ...profile, status: "invalidated" },
      candidate,
      "config-v1",
    ),
  ).toBeUndefined();
  expect(
    revalidateTaskRuntimeDriverReference(
      route,
      profile,
      {
        ...candidate,
        local: { ...candidate.local!, runtimeVersion: "0.3.21" },
      },
      "config-v1",
    ),
  ).toBeUndefined();
});
