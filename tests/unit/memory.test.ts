import { expect, test } from "bun:test";
import {
  createTaskEpisodeMemoryFact,
  memoryFactId,
  selectRelevantMemory,
} from "../../src/shared/memory.js";

test("memory selection is bounded, relevant and revision-aware", () => {
  const facts = [
    {
      id: memoryFactId("repo", "semantic", "auth"),
      repository: "repo",
      kind: "semantic" as const,
      fact: "Authentication lives under src/auth.",
      evidence: [{ source: "src/auth/index.ts", revision: "current" }],
      provenance: "observed" as const,
      confidence: 0.9,
      scope: ["auth"],
      tags: ["authentication"],
      createdAt: "2026-08-25T00:00:00.000Z",
      lastValidatedAt: "2026-08-25T00:00:00.000Z",
    },
    {
      id: memoryFactId("repo", "semantic", "stale"),
      repository: "repo",
      kind: "semantic" as const,
      fact: "The old auth implementation lived under legacy/auth.",
      evidence: [{ source: "legacy/auth.ts", revision: "old" }],
      provenance: "observed" as const,
      confidence: 1,
      scope: ["auth"],
      tags: ["authentication"],
      createdAt: "2026-08-25T00:00:00.000Z",
      lastValidatedAt: "2026-08-25T00:00:00.000Z",
    },
  ];

  expect(
    selectRelevantMemory(facts, "debug authentication", "current", 1),
  ).toEqual([facts[0]!]);
});

test("does not treat unversioned or mixed-revision observed facts as current", () => {
  const facts = [
    {
      id: memoryFactId("repo", "semantic", "unversioned"),
      repository: "repo",
      kind: "semantic" as const,
      fact: "The parser lives under src/parser.ts.",
      evidence: [{ source: "src/parser.ts" }],
      provenance: "observed" as const,
      confidence: 1,
      scope: ["parser"],
      tags: ["parser"],
      createdAt: "2026-08-25T00:00:00.000Z",
      lastValidatedAt: "2026-08-25T00:00:00.000Z",
    },
    {
      id: memoryFactId("repo", "semantic", "mixed"),
      repository: "repo",
      kind: "semantic" as const,
      fact: "The parser also has a legacy implementation.",
      evidence: [
        { source: "src/parser.ts", revision: "current" },
        { source: "legacy/parser.ts", revision: "old" },
      ],
      provenance: "observed" as const,
      confidence: 1,
      scope: ["parser"],
      tags: ["parser"],
      createdAt: "2026-08-25T00:00:00.000Z",
      lastValidatedAt: "2026-08-25T00:00:00.000Z",
    },
  ];

  expect(selectRelevantMemory(facts, "parser", "current")).toEqual([]);
});

test("rehydrates pinned relevant memory before lexical ranking without bypassing freshness", () => {
  const pinned = {
    id: memoryFactId("repo", "episodic", "prior-task"),
    repository: "repo",
    kind: "episodic" as const,
    fact: "The parser task previously confirmed the fixture convention.",
    evidence: [{ source: "tests/parser.test.ts", revision: "old" }],
    provenance: "observed" as const,
    confidence: 1,
    scope: ["parser"],
    tags: ["fixture"],
    createdAt: "2026-08-25T00:00:00.000Z",
    lastValidatedAt: "2026-08-25T00:00:00.000Z",
  };
  const unrelated = {
    ...pinned,
    id: memoryFactId("repo", "episodic", "unrelated"),
    fact: "The billing task uses a separate fixture convention.",
    evidence: [{ source: "tests/billing.test.ts", revision: "current" }],
    scope: ["billing"],
    tags: ["billing"],
  };

  expect(
    selectRelevantMemory([pinned, unrelated], "parser", "current", 1, [
      pinned.id,
    ]),
  ).toEqual([unrelated]);
  expect(
    selectRelevantMemory([pinned, unrelated], "parser", "old", 1, [pinned.id]),
  ).toEqual([pinned]);
});

test("episodic memory redacts sensitive-looking objective content", () => {
  const fact = createTaskEpisodeMemoryFact({
    repository: "repo",
    taskId: "task-secret",
    objective: "Repair auth with api_key=super-secret-value",
    status: "failed",
    phase: "blocked",
    verified: false,
    filesChanged: [".env", "src/auth.ts"],
    verification: [{ command: "bun test", status: "failed" }],
  });

  expect(fact.fact).not.toContain("super-secret-value");
  expect(fact.fact).not.toContain(".env");
  expect(fact.fact).toContain("src/auth.ts");
});
