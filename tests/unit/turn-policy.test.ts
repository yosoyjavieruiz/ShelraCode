import { expect, test } from "bun:test";
import { analyzeTask } from "../../src/router/task-analysis.js";
import {
  resolveTurnMode,
  resolveTurnPolicy,
  resolveTurnPolicyForObjective,
} from "../../src/agent/turn-policy.js";

function policyFor(objective: string) {
  const mode = resolveTurnMode(objective, analyzeTask(objective));
  return { mode, policy: resolveTurnPolicy(mode) };
}

test("a plain greeting resolves to conversation mode with zero tools", () => {
  const { mode, policy } = policyFor("Hello");
  expect(mode).toBe("conversation");
  expect(policy.allowedTools).toEqual([]);
  expect(policy.repositoryRead).toBe(false);
  expect(policy.repositoryWrite).toBe(false);
  expect(policy.shell).toBe(false);
  expect(policy.toolChoice).toBe("none");
});

test("greeting detection is case-insensitive", () => {
  expect(policyFor("hOLA").mode).toBe("conversation");
});

test("Spanish repository fact questions keep host context and disable tools", () => {
  const objective = "¿Qué lenguaje de programación usa este proyecto?";
  const mode = resolveTurnMode(objective, analyzeTask(objective));
  const policy = resolveTurnPolicyForObjective(mode, objective);

  expect(mode).toBe("workspace_question");
  expect(policy.repositoryRead).toBe(true);
  expect(policy.allowedTools).toEqual([]);
  expect(policy.toolChoice).toBe("none");
});

test("thanks and capability small-talk resolve to conversation mode", () => {
  expect(policyFor("Thanks!").mode).toBe("conversation");
  expect(policyFor("What can you do?").mode).toBe("conversation");
});

test("a general knowledge question resolves to knowledge mode with zero tools", () => {
  const { mode, policy } = policyFor("What is GGUF?");
  expect(mode).toBe("knowledge");
  expect(policy.allowedTools).toEqual([]);
  expect(policy.toolChoice).toBe("none");
});

test("a repository question resolves to workspace_question with read-only tools", () => {
  const { mode, policy } = policyFor("What framework does this project use?");
  expect(mode).toBe("workspace_question");
  expect(policy.allowedTools).toContain("ReadFile");
  expect(policy.allowedTools).not.toContain("EditFile");
  expect(policy.allowedTools).not.toContain("WriteFile");
  expect(policy.allowedTools).not.toContain("Shell");
  expect(policy.repositoryRead).toBe(true);
  expect(policy.repositoryWrite).toBe(false);
  expect(policy.shell).toBe(false);
  expect(policy.toolChoice).toBe("auto");
});

test("a direct language fact keeps host context but disables model workspace tools", () => {
  const objective = "What programming language is this project written in?";
  const mode = resolveTurnMode(objective, analyzeTask(objective));
  const policy = resolveTurnPolicyForObjective(mode, objective);

  expect(mode).toBe("workspace_question");
  expect(policy.repositoryRead).toBe(true);
  expect(policy.allowedTools).toEqual([]);
  expect(policy.toolChoice).toBe("none");
  expect(policy.systemPromptProfile).toBe("workspace");
});

test("a runtime implementation location question keeps repository read tools", () => {
  const objective = "Where is the runtime implemented in this project?";
  const mode = resolveTurnMode(objective, analyzeTask(objective));
  const policy = resolveTurnPolicyForObjective(mode, objective);

  expect(mode).toBe("workspace_question");
  expect(policy.allowedTools).toContain("SearchText");
  expect(policy.toolChoice).toBe("auto");
});

test("a read-a-file request resolves to workspace_question mode", () => {
  const { mode } = policyFor("Read package.json and tell me the project name.");
  expect(mode).toBe("workspace_question");
});

test("a coding task resolves to coding mode with the mutation toolset", () => {
  const { mode, policy } = policyFor("Fix this bug and run the tests.");
  expect(mode).toBe("coding");
  expect(policy.allowedTools).toContain("ReadFile");
  expect(policy.allowedTools).toContain("EditFile");
  expect(policy.allowedTools).toContain("CreateFile");
  expect(policy.allowedTools).toContain("DeleteFile");
  expect(policy.allowedTools).toContain("Shell");
  expect(policy.allowedTools).toContain("RunTests");
  expect(policy.repositoryRead).toBe(true);
  expect(policy.repositoryWrite).toBe(true);
  expect(policy.shell).toBe(true);
  expect(policy.toolChoice).toBe("required");
});

test("a feature-plus-tests request resolves to coding mode", () => {
  expect(
    policyFor("Add a sum function, create tests, and run them.").mode,
  ).toBe("coding");
});

test("a plan request stays read-only and exposes repository evidence", () => {
  const { mode, policy } = policyFor(
    "Analyze how to add OAuth to this project and give me a plan. Do not modify anything.",
  );
  expect(mode).toBe("plan");
  expect(policy.repositoryRead).toBe(true);
  expect(policy.repositoryWrite).toBe(false);
  expect(policy.shell).toBe(false);
  expect(policy.allowedTools).toContain("SearchText");
  expect(policy.allowedTools).not.toContain("EditFile");
  expect(policy.allowedTools).not.toContain("WriteFile");
  expect(policy.allowedTools).not.toContain("CreateFile");
  expect(policy.allowedTools).not.toContain("DeleteFile");
});

test("a review request remains read-only even when it mentions possible bugs", () => {
  const { mode, policy } = policyFor(
    "Review src/agent/loop.ts for possible bugs. Do not modify it.",
  );
  expect(mode).toBe("review");
  expect(policy.repositoryRead).toBe(true);
  expect(policy.repositoryWrite).toBe(false);
  expect(policy.allowedTools).not.toContain("EditFile");
  expect(policy.allowedTools).not.toContain("WriteFile");
  expect(policy.allowedTools).not.toContain("Shell");
});

test("Spanish plan and review constraints remain read-only", () => {
  const plan = "Analiza cómo agregar OAuth al proyecto; no modifiques nada.";
  const planMode = resolveTurnMode(plan, analyzeTask(plan));
  expect(planMode).toBe("plan");
  expect(resolveTurnPolicy(planMode).repositoryWrite).toBe(false);

  const review = "Revisa auth.ts; solo lectura, no edites.";
  const reviewMode = resolveTurnMode(review, analyzeTask(review));
  expect(reviewMode).toBe("review");
  expect(resolveTurnPolicy(reviewMode).repositoryWrite).toBe(false);
});

test("an explicit command is handled by the command policy", () => {
  const { mode, policy } = policyFor("Run the project tests.");
  expect(mode).toBe("command");
  expect(policy.repositoryWrite).toBe(false);
  expect(policy.allowedTools).toContain("RunTests");
  expect(policy.toolChoice).toBe("required");
});
