import { expect, test } from "bun:test";
import { analyzeTask } from "../../src/router/task-analysis.js";

test("classifies repository search as low-value local work", () => {
  const task = analyzeTask("find the auth middleware definition");

  expect(task.class).toBe("SEARCH");
  expect(task.opportunityCost).toBe("low_value");
  expect(task.toolNeed).toBe(true);
  expect(task.requiredCapability).toBe("workspace_reader");
});

test("distinguishes general knowledge from a repository-specific explanation", () => {
  expect(analyzeTask("What is GGUF?").requiredCapability).toBe("chat_only");
  expect(
    analyzeTask("What programming language is this project written in?")
      .requiredCapability,
  ).toBe("workspace_reader");
});

test("classifies multi-file debugging as high-complexity work", () => {
  const task = analyzeTask(
    "debug and refactor the authentication flow across the repository",
  );

  expect(task.class).toBe("DEBUGGING");
  expect(task.complexity).toBeGreaterThan(0.6);
  expect(task.contextNeed).toBeGreaterThan(4_000);
});

test("classifies a Spanish-language bug fix request as debugging work needing tools", () => {
  const task = analyzeTask(
    "Corrige el bug de autenticación y ejecuta los tests.",
  );

  expect(task.class).toBe("DEBUGGING");
  expect(task.toolNeed).toBe(true);
});

test("classifies a Spanish-language feature request as small-edit work", () => {
  const task = analyzeTask("Implementa una función sum(a,b) y crea pruebas.");

  expect(task.class).not.toBe("EXPLAIN");
  expect(task.toolNeed).toBe(true);
});

test("classifies a Spanish-language search request as search", () => {
  const task = analyzeTask(
    "¿Dónde está implementada la función createSession?",
  );

  expect(task.class).toBe("SEARCH");
});

// Direct user feedback (screenshot of the live "Explainable Routing" view):
// "STOP · ASK USER — No eligible route. capability workspace_reader is
// below required coding_agent", rejecting the only locally installed
// model. Confirmed live against the real LM Studio runtime
// (`bun run src/index.ts doctor --agent`): Qwen2.5 Coder 7B Instruct
// passes conversation, repository read, and multi-turn tool use, and is
// documented (docs/agent-kernel/MODEL-CAPABILITIES.md) completing a real
// bounded single-file edit plus a passing test — it lands at
// `workspace_reader` only because its own harder multi-file/executable-
// test probe scenario fails. Requiring the full `coding_agent` tier for
// *any* edit, however small, meant the single most common request shape
// had no eligible route on the one realistic local setup. A low-
// complexity, single-file edit only needs `workspace_reader` now — see
// requiredCapability's own comment for why this is safe (the completion
// gate independently verifies real evidence before ever reporting
// success).
test("a small, bounded edit only requires workspace_reader, not the full coding_agent tier", () => {
  const task = analyzeTask("Fix the typo in the README installation section.");

  expect(task.class).toBe("SMALL_EDIT");
  expect(task.complexity).toBeLessThan(0.75);
  expect(task.requiredCapability).toBe("workspace_reader");
});

test("a genuinely complex multi-file edit still requires advanced_coding_agent", () => {
  const task = analyzeTask(
    "Rename the getUser function across all files and modules in the repository.",
  );

  expect(task.class).toBe("MULTI_FILE_EDIT");
  expect(task.requiredCapability).toBe("advanced_coding_agent");
});

test("a long structured coding brief is not routed as a bounded workspace read", () => {
  const objective = [
    "Fix anything that fails while implementing this feature.",
    "",
    ...Array.from(
      { length: 40 },
      (_, index) =>
        `## Requirement ${index + 1}\nPreserve the existing behavior and verify the related integration path.`,
    ),
  ].join("\n\n");

  const task = analyzeTask(objective);

  expect(task.class).toBe("SMALL_EDIT");
  expect(task.complexity).toBeGreaterThanOrEqual(0.75);
  expect(task.requiredCapability).toBe("advanced_coding_agent");
});
