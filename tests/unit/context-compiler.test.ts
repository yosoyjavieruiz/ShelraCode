import { expect, test } from "bun:test";
import {
  compileContextPacket,
  compileDecisionContext,
  renderContextPacket,
} from "../../src/context/context-compiler.js";

test("compiles a bounded packet with high-relevance evidence first", () => {
  const packet = compileContextPacket({
    objective: "Update the session refresh behavior.",
    constraints: ["Preserve the public API."],
    evidence: [
      { source: "low.txt", kind: "file", summary: "low", relevance: 0.2 },
      {
        source: "src/session.ts",
        kind: "symbol",
        summary: "refreshSession owns the token refresh path.",
        relevance: 1,
      },
    ],
    legalActions: ["ReadFile", "ApplyPatch"],
    tokenBudget: 512,
  });

  const rendered = renderContextPacket(packet);
  expect(rendered.length).toBeLessThanOrEqual(2_048);
  expect(rendered.indexOf("src/session.ts")).toBeLessThan(
    rendered.indexOf("low.txt"),
  );
  expect(rendered).toContain("Update the session refresh behavior.");
  expect(rendered).toContain("ApplyPatch");
});

test("rejects an invalid packet budget or empty objective", () => {
  expect(() =>
    compileContextPacket({ objective: "", tokenBudget: 512 }),
  ).toThrow(/objective/i);
  expect(() =>
    compileContextPacket({ objective: "Inspect", tokenBudget: 255 }),
  ).toThrow(/tokenBudget/i);
});

test("compiles a fresh decision context from bounded, relevant sources", () => {
  const packet = compileDecisionContext({
    objective: "Fix the parser",
    subtask: "Inspect the parser and its tests",
    constraints: ["preserve the public API"],
    instructions: [{ source: "AGENTS.md", text: "run the focused tests" }],
    memory: [],
    evidence: [{ source: "src/parser.ts", summary: "parser symbol" }],
    observations: [
      { source: "old-tool", text: "unrelated-large-output".repeat(2_000) },
      { source: "ReadFile", text: "export function parse(input: string)" },
    ],
    legalActions: ["ReadFile", "SearchText"],
    tokenBudget: 2_000,
  });

  expect(packet.text).toContain("Fix the parser");
  expect(packet.text).toContain("src/parser.ts");
  expect(packet.text).toContain("export function parse");
  expect(packet.text).not.toContain("unrelated-large-output");
  expect(packet.sourceIds).toContain("src/parser.ts");
  expect(packet.sourceIds).toContain("ReadFile");
  expect(packet.omittedSections).toContain("observations:budget");
});
