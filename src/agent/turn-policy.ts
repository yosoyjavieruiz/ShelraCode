import type { TaskAnalysis, TaskClass } from "../shared/types.js";
import { isDirectRepositoryFactQuestion } from "../shared/repository-facts.js";

/**
 * The host classifies a turn before creating a model request. The model never
 * gets to widen this policy by asking for another tool.
 */
export type TurnMode =
  | "conversation"
  | "knowledge"
  | "workspace_question"
  | "plan"
  | "review"
  | "coding"
  | "command";

export type SystemPromptProfile = "minimal" | "workspace" | "coding";

export interface TurnPolicy {
  mode: TurnMode;
  repositoryRead: boolean;
  repositoryWrite: boolean;
  shell: boolean;
  network: boolean;
  allowedTools: readonly string[];
  /** @deprecated Use allowedTools. Kept for existing callers during migration. */
  toolNames: readonly string[];
  toolChoice: "none" | "auto" | "required";
  systemPromptProfile: SystemPromptProfile;
}

const READ_ONLY_TOOL_NAMES = [
  "ReadFile",
  "GlobFiles",
  "ListFiles",
  "SearchText",
  "GitStatus",
  "GitDiff",
] as const;

const CODING_TOOL_NAMES = [
  ...READ_ONLY_TOOL_NAMES,
  "WriteFile",
  "CreateFile",
  "EditFile",
  "DeleteFile",
  "Shell",
  "RunTests",
] as const;

const COMMAND_TOOL_NAMES = ["RunTests", "GitStatus", "GitDiff"] as const;

const CODING_TASK_CLASSES = new Set<TaskClass>([
  "SMALL_EDIT",
  "MULTI_FILE_EDIT",
  "TEST_GENERATION",
  "DEBUGGING",
  "REFACTOR",
]);

const GREETING_PATTERNS: RegExp[] = [
  /^(hola+|hi|hello+|hey+|hiya|yo|buenas|good morning|good afternoon|good evening)[!.,\s]*$/iu,
  /^(thanks?( you)?|thank you|thx|ty)[!.,\s]*$/iu,
  /^(how('?s| is| are) it going|how are you)[?!. ,\s]*$/iu,
  /^(what can you do|who are you)[?!. ,\s]*$/iu,
  /^(bye|goodbye|see you)[!.,\s]*$/iu,
  /^(ok(ay)?|great|cool|perfect)[!.,\s]*$/iu,
];

const REPO_REFERENCE_TERMS = [
  "project",
  "repository",
  "repo",
  "codebase",
  "this project",
  "this repo",
  "this codebase",
  "the codebase",
  "package.json",
  "agents.md",
  "this code",
  "this function",
  "the project",
  "the repository",
  "proyecto",
  "repositorio",
  "codigo",
  "codigo base",
  "este proyecto",
  "este repositorio",
  "este codigo",
];

function normalizeObjective(objective: string): string {
  return objective
    .trim()
    .replace(/^[?!¿¡]+/u, "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

export function isGreetingOrSmallTalk(objective: string): boolean {
  const normalized = normalizeObjective(objective);
  if (!normalized) return true;
  return GREETING_PATTERNS.some((pattern) => pattern.test(normalized));
}

function referencesRepository(objective: string): boolean {
  const lower = normalizeObjective(objective);
  return REPO_REFERENCE_TERMS.some((term) => lower.includes(term));
}

function explicitlyReadOnly(objective: string): boolean {
  const lower = normalizeObjective(objective);
  return (
    /\b(do not|don't|dont|never|without)\s+(modify|edit|change|write|mutate)/u.test(
      lower,
    ) ||
    /\b(read[- ]only|no changes?|no modifications?|no edits?)\b/u.test(lower) ||
    /\b(no|sin)\s+(modificar|modifiques|edites|escribas|cambios?)\b/u.test(
      lower,
    ) ||
    /\bsolo\s+lectura\b/u.test(lower)
  );
}

function requestsPlan(objective: string): boolean {
  const lower = normalizeObjective(objective);
  return (
    /\b(plan|planning|roadmap|strategy|propose|planifica|planificar|estrategia|propuesta)\b/u.test(
      lower,
    ) ||
    /\b(analy[sz]e|analysis|analiza|analizar)\s+(how|whether|the best way|como|si|la mejor manera)/u.test(
      lower,
    )
  );
}

function requestsReview(objective: string, analysis: TaskAnalysis): boolean {
  const lower = normalizeObjective(objective);
  return (
    /\b(review|audit|inspect|revisa|revisar|audita|auditar|inspecciona|inspeccionar)\b/u.test(
      lower,
    ) || analysis.class === "REVIEW"
  );
}

function policy(
  mode: TurnMode,
  values: Omit<TurnPolicy, "mode" | "allowedTools" | "toolNames"> & {
    allowedTools: readonly string[];
  },
): TurnPolicy {
  return {
    mode,
    ...values,
    toolNames: values.allowedTools,
  };
}

export function resolveTurnMode(
  objective: string,
  analysis: TaskAnalysis,
): TurnMode {
  if (isGreetingOrSmallTalk(objective)) return "conversation";

  // Explicit user constraints take precedence over lexical bug/edit terms.
  // "Review ... possible bugs; do not modify" must not become coding.
  if (requestsPlan(objective) && explicitlyReadOnly(objective)) return "plan";
  if (requestsReview(objective, analysis) && explicitlyReadOnly(objective))
    return "review";
  if (requestsPlan(objective)) return "plan";
  if (requestsReview(objective, analysis)) return "review";

  if (analysis.class === "COMMAND") return "command";
  if (CODING_TASK_CLASSES.has(analysis.class)) return "coding";
  if (analysis.class === "EXPLAIN")
    return referencesRepository(objective) ? "workspace_question" : "knowledge";
  if (analysis.class === "SEARCH" || analysis.class === "ARCHITECTURE")
    return "workspace_question";
  return "workspace_question";
}

export function resolveTurnPolicy(mode: TurnMode): TurnPolicy {
  switch (mode) {
    case "conversation":
      return policy(mode, {
        repositoryRead: false,
        repositoryWrite: false,
        shell: false,
        network: false,
        allowedTools: [],
        toolChoice: "none",
        systemPromptProfile: "minimal",
      });
    case "knowledge":
      return policy(mode, {
        repositoryRead: false,
        repositoryWrite: false,
        shell: false,
        network: false,
        allowedTools: [],
        toolChoice: "none",
        systemPromptProfile: "minimal",
      });
    case "workspace_question":
      return policy(mode, {
        repositoryRead: true,
        repositoryWrite: false,
        shell: false,
        network: false,
        allowedTools: READ_ONLY_TOOL_NAMES,
        toolChoice: "auto",
        systemPromptProfile: "workspace",
      });
    case "plan":
      return policy(mode, {
        repositoryRead: true,
        repositoryWrite: false,
        shell: false,
        network: false,
        allowedTools: READ_ONLY_TOOL_NAMES,
        toolChoice: "auto",
        systemPromptProfile: "workspace",
      });
    case "review":
      return policy(mode, {
        repositoryRead: true,
        repositoryWrite: false,
        shell: false,
        network: false,
        allowedTools: READ_ONLY_TOOL_NAMES,
        toolChoice: "auto",
        systemPromptProfile: "workspace",
      });
    case "coding":
      return policy(mode, {
        repositoryRead: true,
        repositoryWrite: true,
        shell: true,
        network: false,
        allowedTools: CODING_TOOL_NAMES,
        toolChoice: "required",
        systemPromptProfile: "coding",
      });
    case "command":
      return policy(mode, {
        repositoryRead: true,
        repositoryWrite: false,
        shell: true,
        network: false,
        allowedTools: COMMAND_TOOL_NAMES,
        toolChoice: "required",
        systemPromptProfile: "workspace",
      });
  }
}

export function resolveTurnPolicyForObjective(
  mode: TurnMode,
  objective: string,
): TurnPolicy {
  const base = resolveTurnPolicy(mode);
  if (
    mode !== "workspace_question" ||
    !isDirectRepositoryFactQuestion(objective)
  )
    return base;
  return {
    ...base,
    allowedTools: [],
    toolNames: [],
    toolChoice: "none",
  };
}
