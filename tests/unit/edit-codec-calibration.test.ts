import { expect, test } from "bun:test";
import {
  applyEditCodec,
  calibrateEditCodecs,
  encodeEditCodec,
  evaluateEditCodecCase,
  type EditCodecFailureResponse,
  type EditCodecResponse,
  type EditProbeCase,
} from "../../src/driver/edit-codec-calibration.js";

const patch = {
  path: "src/value.ts",
  before: "export const value = 1;\n",
  after: "export const value = 2;\n",
};

const codecs = [
  "whole_file",
  "search_replace",
  "unified_diff",
  "structured_patch",
] as const;

test("all supported edit codecs normalize to the expected content", () => {
  for (const codec of codecs) {
    const response = encodeEditCodec(codec, patch);
    const result = applyEditCodec(response, patch.before);

    expect(result.applied).toBe(true);
    expect(result.content).toBe(patch.after);
    expect(result.parseValid).toBe(true);
    expect(result.schemaValid).toBe(true);
  }
});

test("malformed codecs fail host validation without applying content", () => {
  const malformed: EditCodecResponse = {
    codec: "structured_patch",
    path: patch.path,
    payload: '{"path":"src/value.ts","operations":[{"start":9}]}',
  };
  const result = applyEditCodec(malformed, patch.before);

  expect(result.applied).toBe(false);
  expect(result.parseValid).toBe(true);
  expect(result.schemaValid).toBe(false);
  expect(result.content).toBeUndefined();
});

test("stale edit state is rejected before any codec can mutate", () => {
  const response = encodeEditCodec("search_replace", patch);
  const result = applyEditCodec(response, "export const value = 9;\n");

  expect(result.applied).toBe(false);
  expect(result.staleEdit).toBe(true);
  expect(result.errorClass).toBe("STALE_EDIT");
});

test("an edit without a before-state digest cannot mutate", () => {
  const result = applyEditCodec(
    {
      codec: "whole_file",
      path: patch.path,
      payload: patch.after,
    },
    patch.before,
  );

  expect(result.applied).toBe(false);
  expect(result.parseValid).toBe(true);
  expect(result.schemaValid).toBe(false);
});

test("target path and codec identity are bound to the probe slot", () => {
  const wrongPath = evaluateEditCodecCase(
    {
      id: "wrong-path",
      path: patch.path,
      before: patch.before,
      expectedAfter: patch.after,
      responses: {
        whole_file: encodeEditCodec("whole_file", {
          ...patch,
          path: "src/other.ts",
        }),
      },
    },
    "whole_file",
  );
  const wrongCodec = evaluateEditCodecCase(
    {
      id: "wrong-codec",
      path: patch.path,
      before: patch.before,
      expectedAfter: patch.after,
      responses: {
        whole_file: encodeEditCodec("search_replace", patch),
      },
    },
    "whole_file",
  );

  expect(wrongPath.applySuccess).toBe(false);
  expect(wrongPath.errorClass).toBe("INVALID_EDIT");
  expect(wrongCodec.applySuccess).toBe(false);
  expect(wrongCodec.errorClass).toBe("INVALID_EDIT");
});

test("Windows drive-relative, colon, and control-character paths are denied", () => {
  for (const unsafePath of [
    "C:outside.txt",
    "C:\\outside.txt",
    "src:other.ts",
    "src/\u0000.ts",
  ]) {
    const response = encodeEditCodec("whole_file", {
      ...patch,
      path: unsafePath,
    });
    const result = applyEditCodec(response, patch.before);

    expect(result.applied).toBe(false);
    expect(result.errorClass).toBe("INVALID_EDIT");
  }
});

test("malformed expected-before digests fail schema validation", () => {
  const response = encodeEditCodec("whole_file", patch);
  response.expectedBeforeDigest = "not-a-sha";
  const result = applyEditCodec(response, patch.before);

  expect(result.applied).toBe(false);
  expect(result.parseValid).toBe(true);
  expect(result.schemaValid).toBe(false);
  expect(result.errorClass).toBe("INVALID_EDIT");
});

test("structured patches validate their nested digest against the outer digest", () => {
  const response = encodeEditCodec("structured_patch", patch);
  const payload = JSON.parse(response.payload!) as Record<string, unknown>;
  payload.expectedBeforeDigest = "not-a-sha";
  response.payload = JSON.stringify(payload);
  const result = applyEditCodec(response, patch.before);

  expect(result.applied).toBe(false);
  expect(result.parseValid).toBe(true);
  expect(result.schemaValid).toBe(false);
  expect(result.errorClass).toBe("INVALID_EDIT");
});

test("search-replace ambiguity is observable and never silently widened", () => {
  const current = "const value = 1;\nconst value = 2;\n";
  const response = encodeEditCodec("search_replace", {
    path: patch.path,
    before: current,
    after: current.replaceAll("value", "result"),
    searchReplace: { search: "value", replace: "result" },
  });
  const result = applyEditCodec(response, current);

  expect(result.applied).toBe(false);
  expect(result.errorClass).toBe("AMBIGUOUS_EDIT");
});

test("semantic correctness and token cost are separate from apply success", () => {
  const probe: EditProbeCase = {
    id: "value-edit",
    path: patch.path,
    before: patch.before,
    expectedAfter: patch.after,
    responses: {
      whole_file: encodeEditCodec("whole_file", patch),
      search_replace: encodeEditCodec("search_replace", {
        ...patch,
        searchReplace: { search: "1", replace: "3" },
      }),
    },
  };
  const whole = evaluateEditCodecCase(probe, "whole_file");
  const wrong = evaluateEditCodecCase(probe, "search_replace");

  expect(whole.applySuccess).toBe(true);
  expect(whole.semanticCorrect).toBe(true);
  expect(whole.tokenCount).toBeGreaterThan(0);
  expect(wrong.applySuccess).toBe(true);
  expect(wrong.semanticCorrect).toBe(false);
});

test("codec calibration compares paired cases and preserves unpaired observations", () => {
  const cases: EditProbeCase[] = [
    {
      id: "easy",
      path: patch.path,
      before: patch.before,
      expectedAfter: patch.after,
      responses: {
        search_replace: encodeEditCodec("search_replace", patch),
        unified_diff: encodeEditCodec("unified_diff", patch),
      },
    },
    {
      id: "hard",
      path: patch.path,
      before: patch.before,
      expectedAfter: patch.after,
      responses: {
        search_replace: {
          codec: "search_replace",
          path: patch.path,
          payload: "not-json",
        },
      },
    },
  ];
  const report = calibrateEditCodecs(cases, ["search_replace", "unified_diff"]);

  expect(report.selectionStatus).toBe("winner_selected");
  expect(report.pairedCaseCount).toBe(1);
  expect(
    report.results.find((item) => item.codec === "search_replace")?.caseCount,
  ).toBe(2);
  expect(
    report.results.find((item) => item.codec === "search_replace")
      ?.pairedCaseCount,
  ).toBe(1);
  expect(
    report.results.find((item) => item.codec === "search_replace")?.pairedCases,
  ).toHaveLength(1);
  expect(
    report.results.find((item) => item.codec === "unified_diff")?.caseCount,
  ).toBe(1);
});

test("a codec with no response remains unsupported", () => {
  const report = calibrateEditCodecs(
    [
      {
        id: "one",
        path: patch.path,
        before: patch.before,
        expectedAfter: patch.after,
        responses: { whole_file: encodeEditCodec("whole_file", patch) },
      },
    ],
    ["whole_file", "structured_patch"],
  );

  expect(
    report.results.find((item) => item.codec === "whole_file")?.status,
  ).toBe("measured");
  expect(
    report.results.find((item) => item.codec === "structured_patch")?.status,
  ).toBe("unsupported");
});

test("typed attempted codec failures remain measured", () => {
  const response: EditCodecFailureResponse = {
    kind: "failure",
    codec: "whole_file",
    path: patch.path,
    failureClass: "TIMEOUT",
    message: "runtime timed out",
  };
  const report = calibrateEditCodecs(
    [
      {
        id: "timeout",
        path: patch.path,
        before: patch.before,
        expectedAfter: patch.after,
        responses: { whole_file: response },
      },
    ],
    ["whole_file", "search_replace"],
  );
  const result = report.results.find((item) => item.codec === "whole_file");

  expect(result?.status).toBe("measured");
  expect(result?.caseCount).toBe(1);
  expect(result?.cases[0]?.attemptedFailure).toBe(true);
  expect(
    report.results.find((item) => item.codec === "search_replace")?.status,
  ).toBe("unsupported");
});

test("stale rejection rate uses only stale-expected cases", () => {
  const report = calibrateEditCodecs(
    [
      {
        id: "stale",
        path: patch.path,
        before: patch.before,
        currentContent: "export const value = 9;\n",
        expectedAfter: patch.after,
        responses: { whole_file: encodeEditCodec("whole_file", patch) },
      },
      {
        id: "fresh",
        path: patch.path,
        before: patch.before,
        expectedAfter: patch.after,
        responses: { whole_file: encodeEditCodec("whole_file", patch) },
      },
    ],
    ["whole_file"],
  );

  expect(report.results[0]?.staleExpectedCaseCount).toBe(1);
  expect(report.results[0]?.staleRejectionRate).toBe(1);
});
