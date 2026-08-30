import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadProtectedAcceptanceOracle } from "../../src/evals/held-out.js";
import { parsePublicEvaluationCase } from "../../src/evals/schema.js";

test("protected acceptance loads from an external digest-bound oracle without entering the public case", async () => {
  const protectedRoot = await mkdtemp(
    path.join(os.tmpdir(), "shelra-protected-eval-"),
  );
  const oracle = {
    schemaVersion: 1 as const,
    id: "oracle-private-v1",
    caseId: "private-repair",
    caseRevision: "v1",
    payload: {
      expectedValue: "__PROTECTED_GOLD__",
      verifierId: "private-behavior-verifier",
    },
  };
  const serialized = `${JSON.stringify(oracle, null, 2)}\n`;
  const digest = createHash("sha256").update(serialized).digest("hex");

  try {
    await writeFile(
      path.join(protectedRoot, "oracle-private-v1.json"),
      serialized,
      "utf8",
    );
    const evaluationCase = parsePublicEvaluationCase({
      schemaVersion: 1,
      caseId: "private-repair",
      revision: "v1",
      title: "Private repair",
      family: "micro",
      capabilityTarget: "C2",
      origin: "local_real",
      workspaceFixture: {
        source: "fixture:private-v1",
        digest: "f".repeat(64),
      },
      objective: "Repair the observed behavior.",
      policy: {
        writeAuthority: "bounded",
        networkAuthority: "none",
        commandPolicy: "fixture_verifiers_only",
      },
      budgets: {
        actions: 8,
        inputTokens: null,
        outputTokens: 512,
        wallClockMs: 60_000,
      },
      visibleAcceptance: [],
      protectedAcceptanceRef: {
        id: "oracle-private-v1",
        sha256: digest,
      },
      tags: ["held-out"],
    });

    const loaded = await loadProtectedAcceptanceOracle(
      evaluationCase,
      protectedRoot,
    );

    expect(loaded).toEqual(oracle);
    expect(JSON.stringify(evaluationCase)).not.toContain("__PROTECTED_GOLD__");
  } finally {
    await rm(protectedRoot, { recursive: true, force: true });
  }
});

test("protected acceptance rejects a symlinked or junctioned oracle root", async () => {
  const parent = await mkdtemp(
    path.join(os.tmpdir(), "shelra-protected-link-"),
  );
  const realRoot = path.join(parent, "real");
  const linkedRoot = path.join(parent, "linked");
  const oracle = {
    schemaVersion: 1 as const,
    id: "oracle-linked-v1",
    caseId: "linked-repair",
    caseRevision: "v1",
    payload: { expectedValue: "__PROTECTED_GOLD__" },
  };
  const serialized = `${JSON.stringify(oracle, null, 2)}\n`;
  const digest = createHash("sha256").update(serialized).digest("hex");
  const evaluationCase = parsePublicEvaluationCase({
    schemaVersion: 1,
    caseId: "linked-repair",
    revision: "v1",
    title: "Linked private repair",
    family: "security",
    capabilityTarget: "C2",
    origin: "local_real",
    workspaceFixture: {
      source: "fixture:linked-v1",
      digest: "e".repeat(64),
    },
    objective: "Repair the observed behavior.",
    policy: {
      writeAuthority: "bounded",
      networkAuthority: "none",
      commandPolicy: "fixture_verifiers_only",
    },
    budgets: {
      actions: 8,
      inputTokens: null,
      outputTokens: 512,
      wallClockMs: 60_000,
    },
    visibleAcceptance: [],
    protectedAcceptanceRef: {
      id: oracle.id,
      sha256: digest,
    },
    tags: ["held-out", "security"],
  });

  try {
    await mkdir(realRoot);
    await writeFile(
      path.join(realRoot, `${oracle.id}.json`),
      serialized,
      "utf8",
    );
    await symlink(
      realRoot,
      linkedRoot,
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(
      loadProtectedAcceptanceOracle(evaluationCase, linkedRoot),
    ).rejects.toThrow("protected acceptance root must not be a symbolic link");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
