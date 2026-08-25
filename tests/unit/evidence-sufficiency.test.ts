import { expect, test } from "bun:test";
import { evaluateEvidenceSufficiency } from "../../src/context/evidence-sufficiency.js";

test("conversation and knowledge do not require repository evidence", () => {
  expect(evaluateEvidenceSufficiency("conversation", 0)).toBe("SUFFICIENT");
  expect(evaluateEvidenceSufficiency("knowledge", 0)).toBe("SUFFICIENT");
});

test("repository work remains insufficient until evidence exists", () => {
  expect(evaluateEvidenceSufficiency("workspace_question", 0)).toBe(
    "INSUFFICIENT",
  );
  expect(evaluateEvidenceSufficiency("workspace_question", 1)).toBe(
    "SUFFICIENT",
  );
});

test("conflicting evidence cannot be treated as sufficient", () => {
  expect(evaluateEvidenceSufficiency("review", 4, true)).toBe("CONFLICTING");
});

test("repository work rejects evidence that is present but not relevant", () => {
  expect(
    evaluateEvidenceSufficiency("workspace_question", 1, false, [
      { relevance: 0.2, freshness: 1 },
    ]),
  ).toBe("INSUFFICIENT");
  expect(
    evaluateEvidenceSufficiency("workspace_question", 1, false, [
      { relevance: 0.8, freshness: 1 },
    ]),
  ).toBe("SUFFICIENT");
});
