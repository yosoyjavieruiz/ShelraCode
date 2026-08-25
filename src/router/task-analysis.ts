import type {
  AgentCapabilityClass,
  OpportunityCost,
  TaskAnalysis,
  TaskClass,
} from "../shared/types.js";

function requiredCapability(
  taskClass: TaskClass,
  complexity: number,
  repositoryQuestion: boolean,
): AgentCapabilityClass {
  if (taskClass === "EXPLAIN")
    return repositoryQuestion ? "workspace_reader" : "chat_only";
  if (
    taskClass === "SMALL_EDIT" ||
    taskClass === "TEST_GENERATION" ||
    taskClass === "DEBUGGING" ||
    taskClass === "REFACTOR" ||
    taskClass === "MULTI_FILE_EDIT"
  ) {
    if (
      complexity >= 0.75 ||
      taskClass === "REFACTOR" ||
      taskClass === "MULTI_FILE_EDIT"
    ) {
      return "advanced_coding_agent";
    }
    // Bounded, single-file work (a low-complexity SMALL_EDIT/
    // TEST_GENERATION/DEBUGGING) only needs `workspace_reader`, not the
    // full `coding_agent` tier. Live capability-probe evidence
    // (docs/agent-kernel/MODEL-CAPABILITIES.md) shows the router was
    // hard-blocking every edit task on real hardware: the local models
    // that install-and-run out of the box (Qwen2.5 Coder 1.5B/7B) both
    // pass conversation, repository read, and multi-turn tool use, but
    // land at `workspace_reader` because their own multi-file/executable-
    // test probe scenario fails — while the *product's actual promise* is
    // exactly small, bounded edits with a small local model, which the
    // same evidence documents these models CAN do (a real one-file edit
    // plus a passing test in a disposable fixture). Requiring the strict
    // `coding_agent` floor here meant `selectRoute` returned "No eligible
    // route" for the single most common request shape on the one
    // realistic local setup — an unconditional dead end, not a
    // capability-appropriate one. Safe to loosen precisely because the
    // completion gate (`completion-gate.ts`/`verifier.ts`) independently
    // verifies real evidence before ever reporting success — an attempt
    // that fails is reported as failed, never silently claimed done.
    // REFACTOR/MULTI_FILE_EDIT and high-complexity work above keep the
    // strict `advanced_coding_agent` floor unchanged: that is exactly the
    // territory the same evidence shows these models genuinely fail.
    return "workspace_reader";
  }
  return "workspace_reader";
}

function has(text: string, ...terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

export function analyzeTask(input: string): TaskAnalysis {
  const text = input
    .trim()
    .replace(/^[?!¿¡]+/u, "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  const repositoryQuestion = has(
    text,
    "project",
    "repository",
    "repo",
    "codebase",
    "package.json",
    "this code",
    "proyecto",
    "repositorio",
    "codigo",
    "codigo base",
  );
  let taskClass: TaskClass = "EXPLAIN";

  if (
    has(
      text,
      "dónde está",
      "donde esta",
      "dónde",
      "donde",
      "where is",
      "where's",
      "donde esta",
      "donde",
    )
  )
    taskClass = "SEARCH";
  else if (
    has(
      text,
      "debug",
      "failing",
      "failure",
      "broken",
      "error",
      "regression",
      "bug",
      "corrige",
      "corregir",
      "arregla",
      "arreglar",
      "falla",
      "fallo",
    )
  )
    taskClass = "DEBUGGING";
  else if (
    has(text, "refactor", "restructure", "migrate", "refactoriza", "migra")
  )
    taskClass = "REFACTOR";
  else if (
    has(text, "architecture", "design system", "trade-off", "arquitectura")
  )
    taskClass = "ARCHITECTURE";
  else if (
    has(text, "review", "audit", "security review", "revisa", "revisión")
  )
    taskClass = "REVIEW";
  else if (
    has(text, "test", "spec", "coverage", "prueba", "pruebas") &&
    has(
      text,
      "write",
      "add",
      "generate",
      "escribe",
      "añade",
      "agrega",
      "crea",
      "genera",
    )
  )
    taskClass = "TEST_GENERATION";
  else if (
    has(
      text,
      "edit",
      "change",
      "update",
      "rename",
      "implement",
      "fix",
      "cambia",
      "actualiza",
      "renombra",
      "implementa",
      "modifica",
    )
  ) {
    taskClass = has(text, "files", "modules", "across", "repository")
      ? "MULTI_FILE_EDIT"
      : "SMALL_EDIT";
  } else if (
    has(
      text,
      "find",
      "search",
      "grep",
      "locate",
      "list",
      "busca",
      "encuentra",
      "localiza",
    )
  )
    taskClass = "SEARCH";
  else if (
    has(
      text,
      "run",
      "execute",
      "format",
      "lint",
      "git status",
      "git diff",
      "ejecuta",
      "corre",
      "formatea",
    )
  )
    taskClass = "COMMAND";

  const lexicalComplexity =
    0.15 +
    (taskClass === "DEBUGGING" || taskClass === "REFACTOR" ? 0.45 : 0) +
    (taskClass === "ARCHITECTURE" || taskClass === "REVIEW" ? 0.35 : 0) +
    (has(text, "multi", "across", "repository", "all files") ? 0.2 : 0) +
    (text.length > 160 ? 0.1 : 0);
  // A long, structured brief is a long-horizon engineering task even when
  // lexical matching only sees one edit verb. Do not route it to a model
  // measured only as a workspace reader; the completion gate still decides
  // whether the work actually succeeded.
  const complexity = Math.min(
    1,
    Math.max(lexicalComplexity, text.length > 2_000 ? 0.8 : 0),
  );
  const contextNeed =
    taskClass === "SEARCH" || taskClass === "COMMAND"
      ? 1_500
      : taskClass === "EXPLAIN"
        ? 3_000
        : taskClass === "SMALL_EDIT"
          ? 4_000
          : taskClass === "TEST_GENERATION"
            ? 6_000
            : 8_000 + (complexity > 0.7 ? 4_000 : 0);
  const opportunityCost: OpportunityCost =
    taskClass === "SEARCH" || taskClass === "COMMAND" || taskClass === "EXPLAIN"
      ? "low_value"
      : taskClass === "ARCHITECTURE" ||
          taskClass === "REFACTOR" ||
          taskClass === "REVIEW"
        ? "high_value"
        : complexity > 0.85
          ? "critical"
          : "normal";

  return {
    class: taskClass,
    complexity,
    contextNeed,
    toolNeed: taskClass !== "EXPLAIN",
    risk:
      taskClass === "REVIEW" || taskClass === "ARCHITECTURE"
        ? 0.8
        : taskClass === "DEBUGGING"
          ? 0.7
          : 0.25,
    opportunityCost,
    requiredCapability: requiredCapability(
      taskClass,
      complexity,
      repositoryQuestion,
    ),
  };
}
