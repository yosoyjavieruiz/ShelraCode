import type { InstructionFile } from "./repository-snapshot.js";
import {
  loadInstructionBodies,
  selectScopedInstructionMetadata,
  type LoadedInstruction,
} from "../instructions/instruction-loader.js";
import {
  instructionPrecedence,
  isTrustedPolicySource,
  type InstructionSource,
  type TrustedInstruction,
} from "../instructions/trust-policy.js";

export {
  loadInstructionBodies,
  selectScopedInstructionMetadata,
} from "../instructions/instruction-loader.js";
export type {
  InstructionMetadata,
  LoadedInstruction,
} from "../instructions/instruction-loader.js";

export interface InstructionComposition {
  instructions: TrustedInstruction[];
  sourceIds: string[];
  text: string;
}

export interface InstructionCompositionInput {
  system?: readonly InstructionSource[];
  project?: readonly (LoadedInstruction | InstructionSource)[];
  user?: readonly InstructionSource[];
  memory?: readonly InstructionSource[];
  /** Repository files and tool output are evidence, never policy. */
  repositoryData?: readonly InstructionSource[];
}

function asTrustedSource(
  source: InstructionSource | undefined,
): TrustedInstruction | undefined {
  if (!source || !isTrustedPolicySource(source)) return undefined;
  const text = source.text.trim();
  const sourceId = source.source.trim();
  if (!text || !sourceId) return undefined;
  const scopeDepth = source.scope
    ? source.scope === "."
      ? 0
      : source.scope.split("/").filter(Boolean).length
    : 0;
  return {
    ...source,
    source: sourceId,
    sourceId,
    text,
    precedence:
      source.precedence ?? instructionPrecedence(source.trust, scopeDepth),
  };
}

/**
 * Compose only host-approved policy sources. The list is ordered from broad
 * to specific so a model can see a nested project rule after its parent; the
 * numeric precedence is retained for host-side conflict handling.
 */
export function composeTrustedInstructions(
  input: InstructionCompositionInput,
): InstructionComposition {
  const project = (input.project ?? []).map((item) =>
    "content" in item
      ? asTrustedSource({
          source: item.sourceId,
          text: item.content,
          trust: item.trust,
          kind: item.kind,
          scope: item.scope,
          precedence: item.precedence,
        })
      : asTrustedSource(item),
  );
  const candidates = [
    ...(input.system ?? []).map(asTrustedSource),
    ...project,
    ...(input.user ?? []).map(asTrustedSource),
    ...(input.memory ?? []).map(asTrustedSource),
    // Deliberately call the filter: repositoryData entries are ignored
    // because trust === "repository".
    ...(input.repositoryData ?? []).map(asTrustedSource),
  ].filter((item): item is TrustedInstruction => Boolean(item));
  const trustOrder: Record<TrustedInstruction["trust"], number> = {
    system: 0,
    project: 1,
    user: 2,
    memory: 3,
  };
  const instructions = candidates.sort((left, right) => {
    const trustDifference = trustOrder[left.trust] - trustOrder[right.trust];
    if (trustDifference !== 0) return trustDifference;
    if (left.trust === "project" && right.trust === "project") {
      const depth = (scope: string | undefined) =>
        scope && scope !== "." ? scope.split("/").filter(Boolean).length : 0;
      return depth(left.scope) - depth(right.scope);
    }
    return left.sourceId.localeCompare(right.sourceId);
  });
  return {
    instructions,
    sourceIds: instructions.map((item) => item.sourceId),
    text: instructions
      .map((item) => `[${item.trust}] [${item.sourceId}] ${item.text}`)
      .join("\n"),
  };
}

export async function loadScopedInstructions(
  root: string,
  files: readonly InstructionFile[],
  targetPaths: readonly string[],
  signal?: AbortSignal,
): Promise<LoadedInstruction[]> {
  const metadata = selectScopedInstructionMetadata(files, targetPaths);
  return loadInstructionBodies(root, metadata, signal);
}
