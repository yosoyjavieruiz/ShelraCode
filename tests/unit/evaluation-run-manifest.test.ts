import { expect, test } from "bun:test";
import {
  digestEvaluationRunManifest,
  parseEvaluationRunManifest,
} from "../../src/evals/schema.js";
import {
  evaluationRunManifestFixture,
  observed,
  unknown,
} from "../support/evaluation-fixtures.js";

test("run manifest preserves exact observations and explicit unknown identity fields", () => {
  const manifest = parseEvaluationRunManifest(evaluationRunManifestFixture());

  expect(manifest.model.quantization).toEqual(observed("Q6_K"));
  expect(manifest.model.artifactSha256).toEqual(unknown("not_exposed"));
  expect(manifest.runtime.contextConfiguration).toEqual({
    catalogMaxTokens: 32_768,
    loadedContextTokens: 16_384,
  });
  expect(digestEvaluationRunManifest(manifest)).toMatch(/^[a-f0-9]{64}$/);
});
