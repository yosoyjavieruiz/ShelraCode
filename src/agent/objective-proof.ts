import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { ContextEvidence, AgentTaskLedger } from "./task-state.js";
import type {
  AcceptanceCriterion,
  ArtifactExpectation,
  Deliverable,
  EvidenceRequirement,
  TaskContract,
} from "./task-contract.js";
import { isGreenfieldObjective } from "./task-contract.js";
import { assertWorkspacePath } from "../shared/paths.js";

export type ObjectiveProofStatus =
  "unproven" | "proven" | "failed" | "not_applicable";

export type ObjectiveProofKind = "deliverable" | "criterion" | "evidence";

export interface ObjectiveProof {
  id: string;
  requirementId: string;
  kind: ObjectiveProofKind;
  source: string;
  summary: string;
  observedAt: string;
  status: ObjectiveProofStatus;
  revision?: string;
}

export interface ObjectiveProofGap {
  requirementId: string;
  description: string;
  kind: ObjectiveProofKind;
  reason: string;
  nextAction: string;
}

export interface ObjectiveArtifactFact {
  path: string;
  exists: boolean;
  revision?: string;
  /** Bounded text read by the host for explicit content expectations. */
  content?: string;
  /** A conservative explanation when existence or content could not be read. */
  inspectionError?: string;
}

const MAX_OBJECTIVE_ARTIFACTS = 16;
const MAX_OBJECTIVE_ARTIFACT_CHARS = 64_000;

export interface ObjectiveProofAssessment {
  pass: boolean;
  confidence: number;
  proofs: ObjectiveProof[];
  missingRequirements: ObjectiveProofGap[];
  nextActions: string[];
}

function normalizePath(value: string): string {
  return value.trim().replaceAll("\\", "/").replace(/^\.\//u, "").toLowerCase();
}

function pathMatches(left: string, right: string): boolean {
  return normalizePath(left) === normalizePath(right);
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function latestVerification(ledger: AgentTaskLedger, command: string) {
  return [...ledger.verificationRuns]
    .reverse()
    .find((run) => run.command === command);
}

function hasFreshRelevantEvidence(
  evidence: readonly ContextEvidence[],
): boolean {
  return evidence.some(
    (item) =>
      Number.isFinite(item.relevance) &&
      item.relevance >= 0.5 &&
      Number.isFinite(item.freshness) &&
      item.freshness > 0,
  );
}

function hasSuccessfulAction(
  ledger: AgentTaskLedger,
  kind: "read" | "write" | "review",
  target?: string,
): boolean {
  return ledger.actions.some(
    (action) =>
      action.kind === kind &&
      action.status === "succeeded" &&
      (target === undefined || pathMatches(action.target, target)),
  );
}

function artifactFact(
  facts: readonly ObjectiveArtifactFact[],
  target: string,
): ObjectiveArtifactFact | undefined {
  return facts.find((fact) => pathMatches(fact.path, target));
}

function normalizeArtifactText(value: string): string {
  return value.replace(/\r\n?/gu, "\n").replace(/\n$/u, "");
}

function artifactExpectationPasses(
  content: string,
  expectation: ArtifactExpectation,
): boolean {
  const actual = normalizeArtifactText(content);
  const expected = normalizeArtifactText(expectation.value);
  if (expectation.type === "exact_text") return actual === expected;
  if (expectation.type === "contains_text") return actual.includes(expected);
  if (expectation.type === "declares_symbol")
    return hasDeclaredSymbol(actual, expectation.value);
  if (expectation.type === "exported_symbol")
    return hasExportedSymbol(actual, expectation.value);
  return !actual.includes(expected);
}

function artifactExpectationDescription(
  expectation: ArtifactExpectation,
): string {
  if (expectation.type === "exact_text")
    return `exact content ${JSON.stringify(expectation.value)}`;
  if (expectation.type === "contains_text")
    return `content containing ${JSON.stringify(expectation.value)}`;
  if (expectation.type === "declares_symbol")
    return `declared symbol ${JSON.stringify(expectation.value)}`;
  if (expectation.type === "exported_symbol")
    return `exported symbol ${JSON.stringify(expectation.value)}`;
  return `content excluding ${JSON.stringify(expectation.value)}`;
}

function escapedRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * Conservative declaration evidence for common source languages. This is a
 * syntax-level host check, not an AST or type checker: it only accepts a
 * declaration at a line/statement boundary and therefore does not let a
 * comment or a quoted sentence satisfy a symbol requirement.
 */
function hasDeclaredSymbol(content: string, symbol: string): boolean {
  const name = escapedRegExp(symbol);
  const patterns = [
    new RegExp(
      `(?:^|[\\r\\n;{}])\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\s+${name}\\b`,
      "mu",
    ),
    new RegExp(
      `(?:^|[\\r\\n;{}])\\s*(?:export\\s+)?(?:declare\\s+)?(?:class|interface|type|enum|const|let|var)\\s+${name}\\b`,
      "mu",
    ),
    new RegExp(`^\\s*(?:async\\s+)?def\\s+${name}\\b`, "mu"),
    new RegExp(`^\\s*class\\s+${name}\\b`, "mu"),
    new RegExp(
      `^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?fn\\s+${name}\\b`,
      "mu",
    ),
    new RegExp(
      `^\\s*func\\s+(?:\\([^)]*\\)\\s*)?${name}\\b`,
      "mu",
    ),
    new RegExp(`^\\s*(?:struct|trait)\\s+${name}\\b`, "mu"),
  ];
  return patterns.some((pattern) => pattern.test(content));
}

function hasExportedSymbol(content: string, symbol: string): boolean {
  if (!hasDeclaredSymbol(content, symbol)) return false;
  const name = escapedRegExp(symbol);
  return [
    new RegExp(
      `(?:^|[\\r\\n;{}])\\s*export\\s+(?:default\\s+)?(?:async\\s+)?(?:function|class|interface|type|enum|const|let|var)\\s+${name}\\b`,
      "mu",
    ),
    new RegExp(
      `(?:^|[\\r\\n;{}])\\s*export\\s*\\{[^}]*\\b${name}\\b[^}]*\\}`,
      "mu",
    ),
  ].some((pattern) => pattern.test(content));
}

function missingArtifactFact(
  relativePath: string,
  error: unknown,
): ObjectiveArtifactFact {
  const code =
    error && typeof error === "object" && "code" in error
      ? String((error as { code?: unknown }).code)
      : undefined;
  if (code === "ENOENT" || code === "ENOTDIR")
    return { path: relativePath, exists: false };
  return {
    path: relativePath,
    exists: false,
    inspectionError:
      error instanceof Error
        ? error.message
        : "Host artifact inspection failed.",
  };
}

/**
 * Read only the concrete deliverable files needed by the objective proof.
 * This is deliberately host-owned and bounded: model prose never supplies
 * artifact content, and an unreadable/oversized/binary file cannot satisfy an
 * explicit content expectation.
 */
export async function inspectObjectiveArtifacts(
  root: string,
  contract: TaskContract,
  signal?: AbortSignal,
): Promise<ObjectiveArtifactFact[]> {
  const targets = unique(
    contract.deliverables.flatMap(
      (deliverable) => deliverable.targetPaths ?? [],
    ),
  ).slice(0, MAX_OBJECTIVE_ARTIFACTS);
  const absoluteRoot = path.resolve(root);
  const facts: ObjectiveArtifactFact[] = [];
  for (const target of targets) {
    if (signal?.aborted) break;
    const relativePath = target.replaceAll("\\", "/");
    try {
      const absolutePath = await assertWorkspacePath(
        absoluteRoot,
        relativePath,
      );
      const metadata = await stat(absolutePath);
      if (!metadata.isFile()) {
        facts.push({
          path: relativePath,
          exists: true,
          inspectionError: "The target is not a regular file.",
        });
        continue;
      }
      if (metadata.size > MAX_OBJECTIVE_ARTIFACT_CHARS) {
        facts.push({
          path: relativePath,
          exists: true,
          inspectionError: `The file exceeds the ${MAX_OBJECTIVE_ARTIFACT_CHARS}-character host inspection bound.`,
        });
        continue;
      }
      const content = await readFile(absolutePath, "utf8");
      if (content.includes("\0")) {
        facts.push({
          path: relativePath,
          exists: true,
          inspectionError: "Binary content is not eligible for text proof.",
        });
        continue;
      }
      facts.push({
        path: relativePath,
        exists: true,
        content,
      });
    } catch (error) {
      facts.push(missingArtifactFact(relativePath, error));
    }
  }
  return facts;
}

function addProof(
  proofs: ObjectiveProof[],
  input: Omit<ObjectiveProof, "id">,
): void {
  proofs.push({ ...input, id: `${input.kind}:${input.requirementId}` });
}

function addGap(gaps: ObjectiveProofGap[], input: ObjectiveProofGap): void {
  if (!gaps.some((gap) => gap.requirementId === input.requirementId))
    gaps.push(input);
}

function assessDeliverable(
  deliverable: Deliverable,
  contract: TaskContract,
  ledger: AgentTaskLedger,
  proofs: ObjectiveProof[],
  gaps: ObjectiveProofGap[],
  facts: readonly ObjectiveArtifactFact[],
): boolean {
  const targets = unique(deliverable.targetPaths ?? []);
  if (targets.length === 0) {
    const hostCriteriaProven =
      ledger.successCriteria.length > 0 &&
      ledger.successCriteria
        .filter((criterion) => criterion.required)
        .every((criterion) => criterion.satisfied);
    const hostObservedOutcome = contract.permissions.repositoryWrite
      ? ledger.filesChanged.length > 0
      : ledger.evidence.length > 0;
    if (hostCriteriaProven && hostObservedOutcome) {
      addProof(proofs, {
        requirementId: deliverable.id,
        kind: "deliverable",
        source: "host:success-criteria",
        summary:
          "The host verifier approved the unscoped outcome after observing the task result.",
        observedAt: ledger.updatedAt,
        status: "proven",
      });
      return true;
    }
    addProof(proofs, {
      requirementId: deliverable.id,
      kind: "deliverable",
      source: "host-proof",
      summary: "No host-verifiable artifact target was declared.",
      observedAt: ledger.updatedAt,
      status: "unproven",
    });
    if (deliverable.required)
      addGap(gaps, {
        requirementId: deliverable.id,
        description: deliverable.description,
        kind: "deliverable",
        reason: "The deliverable has no host-verifiable target or proof.",
        nextAction:
          "Declare or discover the concrete artifact and provide host evidence before completion.",
      });
    return false;
  }

  let complete = true;
  for (const target of targets) {
    const read = hasSuccessfulAction(ledger, "read", target);
    const changed = hasSuccessfulAction(ledger, "write", target);
    const fact = artifactFact(facts, target);
    const expectedMutation = contract.permissions.repositoryWrite;
    const greenfieldCreate =
      expectedMutation && changed && isGreenfieldObjective(contract.objective);
    const inspected = read || greenfieldCreate;
    let status: ObjectiveProofStatus = "proven";
    let reason = "";
    let nextAction = "";
    if (!inspected) {
      status = "unproven";
      reason = "The target was not inspected by a successful host action.";
      nextAction = `Read ${target} before relying on its completion evidence.`;
    } else if (expectedMutation && !changed) {
      status = "unproven";
      reason = "The requested writable target has no successful mutation.";
      nextAction = `Apply and verify the requested change in ${target}.`;
    } else if (!fact) {
      status = "unproven";
      reason =
        "The host did not return a bounded artifact fact for the explicit target.";
      nextAction = `Inspect ${target} with the host artifact verifier before completion.`;
    } else if (!fact.exists) {
      status = "failed";
      reason = fact.inspectionError
        ? `The host could not inspect the target: ${fact.inspectionError}`
        : "The host artifact fact says the target does not exist.";
      nextAction = fact.inspectionError
        ? `Make ${target} readable inside the workspace, then verify the artifact again.`
        : `Restore or create ${target}, then verify the artifact again.`;
    }
    const expectations = deliverable.artifactExpectations ?? [];
    if (status === "proven" && expectations.length > 0) {
      if (fact?.content === undefined) {
        status = "unproven";
        reason = fact?.inspectionError
          ? `The host cannot prove the ${artifactExpectationDescription(expectations[0]!)} because ${fact.inspectionError}`
          : "Host content evidence is unavailable for the explicit artifact expectation.";
        nextAction = `Read ${target} as text and verify the requested artifact content before completion.`;
      } else {
        const failedExpectation = expectations.find(
          (expectation) =>
            !artifactExpectationPasses(fact.content!, expectation),
        );
        if (failedExpectation) {
          status = "failed";
          reason = `The target does not satisfy the requested ${artifactExpectationDescription(failedExpectation)}.`;
          nextAction = `Repair ${target} so its content satisfies the explicit artifact expectation, then verify again.`;
        }
      }
    }
    addProof(proofs, {
      requirementId: deliverable.id,
      kind: "deliverable",
      source: target,
      summary:
        status === "proven"
          ? `Host evidence covers ${target}${
              expectations.length > 0
                ? ` and ${expectations.map(artifactExpectationDescription).join(", ")}`
                : ""
            }.`
          : reason,
      observedAt: ledger.updatedAt,
      status,
      ...(fact?.revision ? { revision: fact.revision } : {}),
    });
    if (status !== "proven") {
      complete = false;
      if (deliverable.required)
        addGap(gaps, {
          requirementId: deliverable.id,
          description: deliverable.description,
          kind: "deliverable",
          reason,
          nextAction,
        });
    }
  }
  return complete;
}

function assessProjectCriterion(
  criterion: AcceptanceCriterion,
  contract: TaskContract,
  ledger: AgentTaskLedger,
  proofs: ObjectiveProof[],
  gaps: ObjectiveProofGap[],
): boolean {
  const commands = contract.repositoryScope.explicitCommands;
  if (
    contract.verificationIntent.projectChecks === "not_required" &&
    commands.length === 0
  ) {
    addProof(proofs, {
      requirementId: criterion.id,
      kind: "criterion",
      source: "contract",
      summary:
        "The contract explicitly marks project verification as not required.",
      observedAt: ledger.updatedAt,
      status: "not_applicable",
    });
    return true;
  }
  let complete = true;
  for (const command of commands) {
    const run = latestVerification(ledger, command);
    const passed = run?.status === "passed" && run.exitCode === 0;
    addProof(proofs, {
      requirementId: criterion.id,
      kind: "criterion",
      source: command,
      summary: passed
        ? `Verification passed: ${command}`
        : `Verification has not passed: ${command}`,
      observedAt: run?.completedAt ?? ledger.updatedAt,
      status: passed ? "proven" : run ? "failed" : "unproven",
    });
    if (!passed) complete = false;
  }
  if (commands.length === 0) complete = false;
  if (!complete && criterion.required)
    addGap(gaps, {
      requirementId: criterion.id,
      description: criterion.description,
      kind: "criterion",
      reason:
        commands.length === 0
          ? "The contract requires project verification but declares no command."
          : "At least one required verification command is missing or failed.",
      nextAction:
        "Run the host-selected verification command and repair failures.",
    });
  return complete;
}

function assessCriterion(
  criterion: AcceptanceCriterion,
  contract: TaskContract,
  ledger: AgentTaskLedger,
  deliverablesProven: boolean,
  proofs: ObjectiveProof[],
  gaps: ObjectiveProofGap[],
): boolean {
  if (criterion.verificationClass === "project")
    return assessProjectCriterion(criterion, contract, ledger, proofs, gaps);
  if (criterion.verificationClass === "review") {
    const passed = hasSuccessfulAction(ledger, "review");
    addProof(proofs, {
      requirementId: criterion.id,
      kind: "criterion",
      source: "ledger:review",
      summary: passed
        ? "The host recorded a successful final review."
        : "The host has not recorded a successful final review.",
      observedAt: ledger.updatedAt,
      status: passed ? "proven" : "unproven",
    });
    if (!passed && criterion.required)
      addGap(gaps, {
        requirementId: criterion.id,
        description: criterion.description,
        kind: "criterion",
        reason: "Final review evidence is missing.",
        nextAction:
          "Run the host final diff/user-work review before completion.",
      });
    return passed;
  }
  const passed = deliverablesProven;
  addProof(proofs, {
    requirementId: criterion.id,
    kind: "criterion",
    source: "host-proof:deliverables",
    summary: passed
      ? "All required host-verifiable deliverables are proven."
      : "One or more required deliverables remain unproven.",
    observedAt: ledger.updatedAt,
    status: passed ? "proven" : "unproven",
  });
  if (!passed && criterion.required)
    addGap(gaps, {
      requirementId: criterion.id,
      description: criterion.description,
      kind: "criterion",
      reason: "The objective criterion depends on unproven deliverables.",
      nextAction:
        "Complete every required deliverable and collect host evidence.",
    });
  return passed;
}

function assessEvidenceRequirement(
  requirement: EvidenceRequirement,
  contract: TaskContract,
  ledger: AgentTaskLedger,
  evidence: readonly ContextEvidence[],
  proofs: ObjectiveProof[],
  gaps: ObjectiveProofGap[],
): boolean {
  let passed = false;
  let status: ObjectiveProofStatus = "unproven";
  let source = "host-evidence";
  let summary = "Required evidence has not been recorded.";
  if (requirement.kind === "repository") {
    passed = hasFreshRelevantEvidence(evidence);
    source = "ledger:evidence";
    summary = passed
      ? "Fresh relevant repository evidence is recorded."
      : "Fresh relevant repository evidence is missing.";
  } else if (requirement.kind === "scope") {
    const greenfield = isGreenfieldObjective(contract.objective);
    passed = contract.repositoryScope.explicitPaths.every(
      (target) =>
        hasSuccessfulAction(ledger, "read", target) ||
        (greenfield && hasSuccessfulAction(ledger, "write", target)),
    );
    source = "ledger:scope";
    summary = passed
      ? "Every explicit scope target was read successfully."
      : "One or more explicit scope targets were not read successfully.";
  } else if (requirement.kind === "verification") {
    passed = contract.repositoryScope.explicitCommands.every((command) => {
      const run = latestVerification(ledger, command);
      return run?.status === "passed" && run.exitCode === 0;
    });
    source = "ledger:verification";
    summary = passed
      ? "Every required verification command passed."
      : "One or more required verification commands did not pass.";
  } else if (requirement.kind === "review") {
    passed = hasSuccessfulAction(ledger, "review");
    source = "ledger:review";
    summary = passed
      ? "Final review evidence is recorded."
      : "Final review evidence is missing.";
  }
  status = passed ? "proven" : "unproven";
  addProof(proofs, {
    requirementId: requirement.id,
    kind: "evidence",
    source,
    summary,
    observedAt: ledger.updatedAt,
    status,
  });
  if (!passed && requirement.required)
    addGap(gaps, {
      requirementId: requirement.id,
      description: requirement.description,
      kind: "evidence",
      reason: summary,
      nextAction: "Collect the required host evidence before completion.",
    });
  return passed;
}

/**
 * Assess the objective exclusively from host-owned facts. In particular,
 * assistant prose and a successful tool response are not completion proof.
 */
export function assessObjectiveProof(
  contract: TaskContract,
  ledger: AgentTaskLedger,
  evidence: readonly ContextEvidence[],
  artifactFacts: readonly ObjectiveArtifactFact[] = [],
): ObjectiveProofAssessment {
  const proofs: ObjectiveProof[] = [];
  const missingRequirements: ObjectiveProofGap[] = [];
  const deliverablesProven = contract.deliverables
    .filter((deliverable) => deliverable.required)
    .every((deliverable) =>
      assessDeliverable(
        deliverable,
        contract,
        ledger,
        proofs,
        missingRequirements,
        artifactFacts,
      ),
    );
  for (const criterion of contract.acceptanceCriteria.filter(
    (item) => item.required,
  ))
    assessCriterion(
      criterion,
      contract,
      ledger,
      deliverablesProven,
      proofs,
      missingRequirements,
    );
  for (const requirement of contract.evidenceRequirements.filter(
    (item) => item.required,
  ))
    assessEvidenceRequirement(
      requirement,
      contract,
      ledger,
      evidence,
      proofs,
      missingRequirements,
    );
  const uniqueGaps = missingRequirements.filter(
    (gap, index, all) =>
      all.findIndex(
        (candidate) => candidate.requirementId === gap.requirementId,
      ) === index,
  );
  const pass = uniqueGaps.length === 0;
  const totalRequirements = Math.max(
    1,
    contract.deliverables.filter((item) => item.required).length +
      contract.acceptanceCriteria.filter((item) => item.required).length +
      contract.evidenceRequirements.filter((item) => item.required).length,
  );
  return {
    pass,
    confidence: pass
      ? 1
      : Math.max(0, 1 - uniqueGaps.length / totalRequirements),
    proofs,
    missingRequirements: uniqueGaps,
    nextActions: unique(uniqueGaps.map((gap) => gap.nextAction)).slice(0, 8),
  };
}
