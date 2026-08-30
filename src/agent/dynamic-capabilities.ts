import { exactModelIdentityDigest } from "../driver/profile.js";
import type {
  ActionProtocol,
  CapabilityLevel,
  ModelDriverProfile,
} from "../driver/profile.js";
import type {
  LoadedSkill,
  SkillMetadata,
} from "../instructions/skill-loader.js";
import type {
  PairedCapabilityDecision,
  PairedCapabilityEvidence,
  PairedCapabilityEvaluationReport,
} from "../evals/paired-capability.js";
import {
  isPairedCapabilityDecision,
  verifyPairedCapabilityEvaluationReport,
} from "../evals/paired-capability.js";

export type CapabilityKind =
  | "skill"
  | "context_provider"
  | "repository_intelligence"
  | "verifier"
  | "expert"
  | "subagent"
  | "retrieval";

export type CapabilityActivationMode = "disabled" | "opt_in" | "auto";

export interface CapabilityTaskContext {
  tags?: readonly string[];
  languages?: readonly string[];
  frameworks?: readonly string[];
  requiredCapabilities?: readonly string[];
}

export interface CapabilityActivationMetadata {
  taskTags: string[];
  languages: string[];
  frameworks: string[];
  requiredCapabilities: string[];
}

export interface CapabilityCompatibility {
  minCapabilityLevel: CapabilityLevel;
  driverProtocols: Exclude<ActionProtocol, "unselected">[];
}

export interface CapabilityAuthority {
  mayWrite: boolean;
  mayExecute: boolean;
  mayNetwork: boolean;
}

export interface CapabilityEvidence {
  pairedEvaluationId: string | null;
  decision: PairedCapabilityDecision | null;
  driverProfileId: string | null;
  driverIdentityDigest: string | null;
  configurationDigest: string | null;
  evaluatedAt: string | null;
}

/** Metadata only. Bodies and executable handlers stay outside the registry. */
export interface DynamicCapability {
  id: string;
  version: string;
  kind: CapabilityKind;
  description: string;
  activation: CapabilityActivationMetadata;
  compatibility: CapabilityCompatibility;
  evidence: CapabilityEvidence;
  authority: CapabilityAuthority;
}

export type CapabilityActivationReasonCode =
  | "enabled_by_opt_in"
  | "paired_evidence_verified"
  | "disabled_by_policy"
  | "unknown_capability"
  | "profile_required"
  | "profile_not_certified"
  | "profile_identity_invalid"
  | "profile_expired"
  | "capability_incompatible"
  | "task_not_compatible"
  | "missing_required_capability"
  | "missing_paired_evidence"
  | "paired_evaluation_not_positive"
  | "driver_profile_mismatch"
  | "configuration_mismatch"
  | "authority_exceeds_profile";

export interface CapabilityActivationDecision {
  capabilityId: string;
  active: boolean;
  mode: CapabilityActivationMode;
  reasonCode: CapabilityActivationReasonCode;
  reason: string;
  authority: CapabilityAuthority;
}

export interface CapabilityResolutionInput {
  mode?: CapabilityActivationMode;
  profile?: ModelDriverProfile;
  /** Exact tool/context/runtime configuration used by the paired evidence. */
  configurationDigest?: string;
  task?: CapabilityTaskContext;
  now?: Date;
}

const CAPABILITY_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/u;
const CAPABILITY_VERSION = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/u;
const CAPABILITY_LEVELS: readonly CapabilityLevel[] = [
  "C0",
  "C1",
  "C2",
  "C3",
  "C4",
  "C5",
  "C6",
];
const CAPABILITY_KINDS: readonly CapabilityKind[] = [
  "skill",
  "context_provider",
  "repository_intelligence",
  "verifier",
  "expert",
  "subagent",
  "retrieval",
];
const DRIVER_PROTOCOLS: readonly Exclude<ActionProtocol, "unselected">[] = [
  "native_function",
  "constrained_json",
  "xml_system_tools",
  "text_action_grammar",
];

function rank(level: CapabilityLevel): number {
  return CAPABILITY_LEVELS.indexOf(level);
}

function normalizedStrings(values: readonly string[] | undefined): string[] {
  return [
    ...new Set(
      (values ?? [])
        .filter((value) => typeof value === "string")
        .map((value) => value.trim().toLowerCase())
        .filter((value) => value.length > 0),
    ),
  ].sort();
}

function hasIntersection(
  required: readonly string[],
  actual: readonly string[],
): boolean {
  if (required.length === 0) return true;
  const values = new Set(actual);
  return required.some((value) => values.has(value));
}

function cloneCapability(capability: DynamicCapability): DynamicCapability {
  return {
    ...capability,
    activation: {
      taskTags: [...capability.activation.taskTags],
      languages: [...capability.activation.languages],
      frameworks: [...capability.activation.frameworks],
      requiredCapabilities: [...capability.activation.requiredCapabilities],
    },
    compatibility: {
      minCapabilityLevel: capability.compatibility.minCapabilityLevel,
      driverProtocols: [...capability.compatibility.driverProtocols],
    },
    evidence: { ...capability.evidence },
    authority: { ...capability.authority },
  };
}

function normalizeCapability(capability: DynamicCapability): DynamicCapability {
  if (!CAPABILITY_ID.test(capability.id.trim()))
    throw new Error("Capability id must be a safe opaque identifier.");
  if (!CAPABILITY_VERSION.test(capability.version.trim()))
    throw new Error("Capability version must be a safe opaque identifier.");
  if (!capability.description.trim())
    throw new Error("Capability description must be non-empty.");
  if (!CAPABILITY_KINDS.includes(capability.kind))
    throw new Error("Capability kind is invalid.");
  if (!CAPABILITY_LEVELS.includes(capability.compatibility.minCapabilityLevel))
    throw new Error("Capability minimum level is invalid.");
  const driverProtocols = [
    ...new Set(capability.compatibility.driverProtocols),
  ];
  if (!driverProtocols.every((protocol) => DRIVER_PROTOCOLS.includes(protocol)))
    throw new Error("Capability driver protocol is invalid.");
  for (const [field, value] of Object.entries(capability.authority))
    if (typeof value !== "boolean")
      throw new Error(`Capability authority ${field} must be boolean.`);
  const evidence = capability.evidence;
  if (
    evidence.pairedEvaluationId !== null ||
    evidence.decision !== null ||
    evidence.driverProfileId !== null ||
    evidence.driverIdentityDigest !== null ||
    evidence.configurationDigest !== null ||
    evidence.evaluatedAt !== null
  )
    throw new Error(
      "Capability registration accepts metadata only; record host-owned evidence through recordPairedEvaluation.",
    );
  return {
    ...capability,
    id: capability.id.trim(),
    version: capability.version.trim(),
    description: capability.description.trim().slice(0, 500),
    activation: {
      taskTags: normalizedStrings(capability.activation.taskTags),
      languages: normalizedStrings(capability.activation.languages),
      frameworks: normalizedStrings(capability.activation.frameworks),
      requiredCapabilities: normalizedStrings(
        capability.activation.requiredCapabilities,
      ),
    },
    compatibility: {
      minCapabilityLevel: capability.compatibility.minCapabilityLevel,
      driverProtocols,
    },
    evidence: { ...evidence },
    authority: { ...capability.authority },
  };
}

function inactive(
  capabilityId: string,
  mode: CapabilityActivationMode,
  reasonCode: CapabilityActivationReasonCode,
  reason: string,
  authority: CapabilityAuthority = {
    mayWrite: false,
    mayExecute: false,
    mayNetwork: false,
  },
): CapabilityActivationDecision {
  return { capabilityId, active: false, mode, reasonCode, reason, authority };
}

function profileCompatible(
  capability: DynamicCapability,
  profile: ModelDriverProfile,
  now: Date,
): CapabilityActivationDecision | undefined {
  if (profile.status !== "certified")
    return inactive(
      capability.id,
      "auto",
      "profile_not_certified",
      "Only a certified exact Driver profile may activate a capability.",
    );
  try {
    if (exactModelIdentityDigest(profile.identity) !== profile.identityDigest)
      return inactive(
        capability.id,
        "auto",
        "profile_identity_invalid",
        "The certified Driver profile identity digest is invalid.",
      );
  } catch {
    return inactive(
      capability.id,
      "auto",
      "profile_identity_invalid",
      "The certified Driver profile identity cannot be verified.",
    );
  }
  if (profile.expiresAt && Date.parse(profile.expiresAt) <= now.getTime())
    return inactive(
      capability.id,
      "auto",
      "profile_expired",
      "The certified Driver profile has expired.",
    );
  if (
    rank(profile.capabilityLevel) <
    rank(capability.compatibility.minCapabilityLevel)
  )
    return inactive(
      capability.id,
      "auto",
      "capability_incompatible",
      `Driver capability ${profile.capabilityLevel} is below ${capability.compatibility.minCapabilityLevel}.`,
    );
  if (
    capability.compatibility.driverProtocols.length > 0 &&
    !capability.compatibility.driverProtocols.includes(
      profile.protocol as Exclude<ActionProtocol, "unselected">,
    )
  )
    return inactive(
      capability.id,
      "auto",
      "capability_incompatible",
      `Driver protocol ${profile.protocol} is not certified for this capability.`,
    );
  if (capability.authority.mayWrite && profile.writeAuthority === "none")
    return inactive(
      capability.id,
      "auto",
      "authority_exceeds_profile",
      "The capability requests write authority the Driver does not have.",
    );
  if (capability.authority.mayNetwork && profile.networkAuthority === "none")
    return inactive(
      capability.id,
      "auto",
      "authority_exceeds_profile",
      "The capability requests network authority the Driver does not have.",
    );
  if (capability.authority.mayExecute && rank(profile.capabilityLevel) < 3)
    return inactive(
      capability.id,
      "auto",
      "authority_exceeds_profile",
      "The capability requests execution authority above the Driver level.",
    );
  return undefined;
}

function taskCompatible(
  capability: DynamicCapability,
  task: CapabilityTaskContext,
): CapabilityActivationDecision | undefined {
  const tags = normalizedStrings(task.tags);
  const languages = normalizedStrings(task.languages);
  const frameworks = normalizedStrings(task.frameworks);
  const required = normalizedStrings(task.requiredCapabilities);
  if (!hasIntersection(capability.activation.taskTags, tags))
    return inactive(
      capability.id,
      "auto",
      "task_not_compatible",
      "The current task does not match the capability task tags.",
    );
  if (!hasIntersection(capability.activation.languages, languages))
    return inactive(
      capability.id,
      "auto",
      "task_not_compatible",
      "The current task does not match the capability languages.",
    );
  if (!hasIntersection(capability.activation.frameworks, frameworks))
    return inactive(
      capability.id,
      "auto",
      "task_not_compatible",
      "The current task does not match the capability frameworks.",
    );
  if (
    !capability.activation.requiredCapabilities.every((item) =>
      required.includes(item),
    )
  )
    return inactive(
      capability.id,
      "auto",
      "missing_required_capability",
      "A required capability is not available for this task.",
    );
  return undefined;
}

function emptyEvidence(): DynamicCapability["evidence"] {
  return {
    pairedEvaluationId: null,
    decision: null,
    driverProfileId: null,
    driverIdentityDigest: null,
    configurationDigest: null,
    evaluatedAt: null,
  };
}

function skillToCapability(skill: SkillMetadata): DynamicCapability {
  return {
    id: skill.id,
    version: skill.version,
    kind: "skill",
    description: skill.description,
    activation: {
      taskTags: skill.activation.taskTags,
      languages: skill.activation.languages,
      frameworks: skill.activation.frameworks,
      requiredCapabilities: skill.activation.requiredCapabilities,
    },
    compatibility: {
      minCapabilityLevel: skill.compatibility.minCapabilityLevel,
      driverProtocols: skill.compatibility.driverProtocols,
    },
    // Repository-authored frontmatter is a claim, never host-owned evidence.
    // A Shelra Lab report must be recorded through recordPairedEvaluation.
    evidence: emptyEvidence(),
    authority: { ...skill.authority },
  };
}

export function skillCapability(skill: SkillMetadata): DynamicCapability {
  return skillToCapability(skill);
}

export class CapabilityRegistry {
  private readonly capabilities = new Map<string, DynamicCapability>();

  constructor(capabilities: readonly DynamicCapability[] = []) {
    for (const capability of capabilities) this.register(capability);
  }

  register(capability: DynamicCapability): void {
    const normalized = normalizeCapability(capability);
    if (this.capabilities.has(normalized.id))
      throw new Error(`Capability is already registered: ${normalized.id}`);
    this.capabilities.set(normalized.id, normalized);
  }

  registerSkill(skill: SkillMetadata): void {
    this.register(skillToCapability(skill));
  }

  get(id: string): DynamicCapability | undefined {
    const capability = this.capabilities.get(id);
    return capability ? cloneCapability(capability) : undefined;
  }

  list(): DynamicCapability[] {
    return [...this.capabilities.values()]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map(cloneCapability);
  }

  private recordPairedEvidence(
    capabilityId: string,
    evidence: PairedCapabilityEvidence,
  ): void {
    const capability = this.capabilities.get(capabilityId);
    if (!capability) throw new Error(`Unknown capability: ${capabilityId}`);
    if (!CAPABILITY_ID.test(evidence.evaluationId.trim()))
      throw new Error("Paired evidence evaluation id is required.");
    if (!isPairedCapabilityDecision(evidence.decision))
      throw new Error("Paired evidence decision is invalid.");
    if (!CAPABILITY_ID.test(evidence.driverProfileId.trim()))
      throw new Error("Paired evidence Driver profile id is required.");
    if (evidence.driverIdentityDigest.trim().length === 0)
      throw new Error("Paired evidence Driver identity digest is required.");
    if (evidence.configurationDigest.trim().length === 0)
      throw new Error("Paired evidence configuration digest is required.");
    if (
      !evidence.evaluatedAt.trim() ||
      Number.isNaN(Date.parse(evidence.evaluatedAt))
    )
      throw new Error("Paired evidence evaluatedAt must be an ISO timestamp.");
    this.capabilities.set(capabilityId, {
      ...capability,
      evidence: {
        pairedEvaluationId: evidence.evaluationId,
        decision: evidence.decision,
        driverProfileId: evidence.driverProfileId,
        driverIdentityDigest: evidence.driverIdentityDigest,
        configurationDigest: evidence.configurationDigest,
        evaluatedAt: evidence.evaluatedAt,
      },
    });
  }

  recordPairedEvaluation(report: PairedCapabilityEvaluationReport): void {
    if (!report.valid || report.evidence === null)
      throw new Error(
        "Only a valid paired evaluation with exact evidence can be recorded.",
      );
    if (!verifyPairedCapabilityEvaluationReport(report))
      throw new Error("Paired evaluation evidence digest is invalid.");
    if (report.capabilityId.trim().length === 0)
      throw new Error("Paired evaluation capability id is required.");
    if (report.evidence.decision !== report.decision)
      throw new Error(
        "Paired evaluation evidence decision does not match report.",
      );
    if (report.automaticActivation !== (report.decision === "auto_enable"))
      throw new Error("Paired evaluation activation decision is inconsistent.");
    this.recordPairedEvidence(report.capabilityId, report.evidence);
  }

  resolve(
    id: string,
    input: CapabilityResolutionInput = {},
  ): CapabilityActivationDecision {
    const mode = input.mode ?? "disabled";
    const capability = this.capabilities.get(id);
    if (!capability)
      return inactive(
        id,
        mode,
        "unknown_capability",
        "Capability is not registered.",
      );
    if (mode === "disabled")
      return inactive(
        id,
        mode,
        "disabled_by_policy",
        "Capability activation is disabled by task policy.",
      );
    if (!input.profile)
      return inactive(
        id,
        mode,
        "profile_required",
        "An exact certified Driver profile is required.",
      );
    const profileDecision = profileCompatible(
      capability,
      input.profile,
      input.now ?? new Date(),
    );
    if (profileDecision) return { ...profileDecision, mode };
    const taskDecision = taskCompatible(capability, input.task ?? {});
    if (taskDecision) return { ...taskDecision, mode };
    if (mode === "opt_in")
      return {
        capabilityId: id,
        active: true,
        mode,
        reasonCode: "enabled_by_opt_in",
        reason:
          "The operator explicitly opted into this compatible capability.",
        authority: { ...capability.authority },
      };
    const evidence = capability.evidence;
    if (evidence.pairedEvaluationId === null)
      return inactive(
        id,
        mode,
        "missing_paired_evidence",
        "Automatic activation requires positive paired OFF/ON evidence.",
      );
    if (evidence.decision !== "auto_enable")
      return inactive(
        id,
        mode,
        "paired_evaluation_not_positive",
        "Paired evaluation did not demonstrate a safe measurable benefit.",
      );
    if (
      evidence.driverProfileId === null ||
      evidence.driverIdentityDigest === null ||
      evidence.configurationDigest === null ||
      evidence.evaluatedAt === null
    )
      return inactive(
        id,
        mode,
        "missing_paired_evidence",
        "Automatic activation requires complete exact-configuration evidence.",
      );
    if (
      evidence.driverProfileId !== input.profile.id ||
      evidence.driverIdentityDigest !== input.profile.identityDigest
    )
      return inactive(
        id,
        mode,
        "driver_profile_mismatch",
        "Paired evidence belongs to a different exact Driver profile.",
      );
    if (
      input.configurationDigest === undefined ||
      input.configurationDigest !== evidence.configurationDigest
    )
      return inactive(
        id,
        mode,
        "configuration_mismatch",
        "Paired evidence belongs to a different or unknown Driver configuration.",
      );
    return {
      capabilityId: id,
      active: true,
      mode,
      reasonCode: "paired_evidence_verified",
      reason:
        "Positive paired evidence matches the exact certified Driver profile.",
      authority: { ...capability.authority },
    };
  }

  resolveAll(
    input: CapabilityResolutionInput = {},
  ): CapabilityActivationDecision[] {
    return this.list().map((capability) => this.resolve(capability.id, input));
  }

  /**
   * Returns only host-approved active Skills. The body is loaded separately by
   * the context layer after this decision; the registry never stores content.
   */
  activeSkillIds(input: CapabilityResolutionInput = {}): string[] {
    return this.resolveAll(input)
      .filter((decision) => decision.active)
      .map((decision) => decision.capabilityId)
      .filter((id) => id.startsWith("skill:"));
  }

  activeSkillBodies(
    skills: readonly LoadedSkill[],
    input: CapabilityResolutionInput = {},
  ): LoadedSkill[] {
    const active = new Set(this.activeSkillIds(input));
    return skills.filter((skill) => active.has(skill.id));
  }
}
