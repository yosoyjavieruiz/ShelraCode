import type {
  AgentProbeHardwareSnapshot,
  ModelCandidate,
} from "../shared/types.js";

/**
 * A provider/runtime failure is not behavioral evidence that a model is
 * chat-only. Keep this distinction explicit so a timeout cannot poison the
 * capability cache and make a previously usable local model disappear from
 * routing.
 */
export function isCapabilityProbeFailure(
  probe: ModelCandidate["agentProbe"] | undefined,
): boolean {
  return (
    probe?.notes.some((note) => note.startsWith("Capability probe failed:")) ??
    false
  );
}

const HARDWARE_FIELDS: Array<keyof AgentProbeHardwareSnapshot> = [
  "os",
  "platform",
  "arch",
  "cpuModel",
  "cpuCores",
  "memoryGb",
  "accelerator",
  "storageFreeGb",
];

function sameOptional(
  expected: string | number | undefined,
  actual: string | number | undefined,
): boolean {
  return expected === actual;
}

function sameHardware(
  expected: AgentProbeHardwareSnapshot | undefined,
  actual: AgentProbeHardwareSnapshot,
): boolean {
  if (!expected) return false;
  return HARDWARE_FIELDS.every((field) => expected[field] === actual[field]);
}

/**
 * A capability result is reusable only when it describes the exact discovered
 * model/runtime/environment. Probe version and age are checked by the caller;
 * this function prevents a same-id quantization or hardware change from
 * silently reusing stale evidence.
 */
export function isCapabilityProbeCurrent(
  candidate: ModelCandidate,
  probe: ModelCandidate["agentProbe"] | undefined,
  hardware?: AgentProbeHardwareSnapshot,
): boolean {
  if (isCapabilityProbeFailure(probe)) return false;
  const environment = probe?.environment;
  if (!environment) return false;

  const modelId = candidate.modelId ?? candidate.displayName;
  if (
    environment.modelId !== modelId ||
    environment.runtimeId !== candidate.providerId ||
    environment.task !== "capability-probe" ||
    environment.generation.temperature !== 0 ||
    environment.generation.maxOutputTokens !== 512
  )
    return false;

  const local = candidate.local;
  if (
    !sameOptional(local?.modelRevision, environment.modelRevision) ||
    !sameOptional(local?.quant, environment.quantization) ||
    !sameOptional(
      candidate.capabilities.maxContext,
      environment.contextLength,
    ) ||
    !sameOptional(local?.runtimeVersion, environment.runtimeVersion) ||
    !sameOptional(local?.chatTemplate, environment.chatTemplate) ||
    !sameOptional(local?.toolParser, environment.toolParser)
  )
    return false;

  return hardware === undefined || sameHardware(environment.hardware, hardware);
}
