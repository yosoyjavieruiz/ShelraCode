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

test("classifies 'patch' and 'correct' as debugging/edit work, not a low-tier explanation", () => {
  expect(
    analyzeTask("Patch the race condition in the connection pool").class,
  ).toBe("DEBUGGING");
  expect(
    analyzeTask("Correct the off-by-one error in the loop bounds").class,
  ).toBe("DEBUGGING");
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

test("does not classify the Spanish no-edit verb as an English edit command", () => {
  const task = analyzeTask(
    "Lee el proyecto actual y dime que archivos existen. No edites nada.",
  );

  expect(task.class).toBe("EXPLAIN");
});

// The analysis target remains useful for score/context shaping, but it is not
// an eligibility floor. An accessible local model must be attempted when
// privacy, tools, permissions, and runtime health permit it; completion is
// decided later from host-owned verification evidence.
test("a small, bounded edit targets workspace_reader without requiring a hard floor", () => {
  const task = analyzeTask("Fix the typo in the README installation section.");

  expect(task.class).toBe("SMALL_EDIT");
  expect(task.complexity).toBeLessThan(0.75);
  expect(task.requiredCapability).toBe("workspace_reader");
});

test("a genuinely complex multi-file edit targets advanced_coding_agent", () => {
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
