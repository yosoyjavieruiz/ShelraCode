import type { ProjectCommands } from "../context/project-commands.js";

/** Verification stages that the host can discover and execute safely. */
export type VerificationStage = "test" | "typecheck" | "lint" | "build";

export interface VerificationCommand {
  stage: VerificationStage;
  command: string;
}

const HOST_VERIFICATION_ORDER: readonly VerificationStage[] = [
  "test",
  "typecheck",
  "lint",
  "build",
];

/**
 * Select one deterministic command per required verification stage. The host
 * owns this choice so the model cannot silently declare a coding task
 * verified after running only the first discovered test script.
 */
export function selectVerificationPlan(
  commands: ProjectCommands,
): VerificationCommand[] {
  return HOST_VERIFICATION_ORDER.flatMap((stage) => {
    const command = commands[stage]?.[0]?.trim();
    return command ? [{ stage, command }] : [];
  });
}

/**
 * Keep the historical singular field usable for direct runAgent callers while
 * making every new task use the same structured plan representation.
 */
export function normalizeVerificationPlan(
  commands: readonly VerificationCommand[] | undefined,
  legacyCommand: string | undefined,
): VerificationCommand[] {
  const candidates =
    commands && commands.length > 0
      ? commands
      : legacyCommand?.trim()
        ? [{ stage: "test" as const, command: legacyCommand.trim() }]
        : [];
  const seen = new Set<string>();
  return candidates.flatMap((candidate) => {
    const command = candidate.command.trim();
    if (!command) return [];
    const key = `${candidate.stage}:${command}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ stage: candidate.stage, command }];
  });
}
