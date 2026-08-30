import { expect, test } from "bun:test";
import {
  calibrateActionProtocols,
  encodeProtocolAction,
  evaluateProtocolProbeCase,
  parseProtocolAction,
  type ArgumentSchema,
  type ProtocolAction,
  type ProtocolProbeCase,
  type TextProtocolResponse,
} from "../../src/driver/protocol-calibration.js";

const expected = {
  name: "repo.read",
  arguments: { path: "src/index.ts" },
};

const legalActions = ["repo.search", "repo.read"];

function encodedText(
  protocol: "constrained_json" | "xml_system_tools",
  action: ProtocolAction,
): string {
  const encoded = encodeProtocolAction(
    protocol,
    action,
  ) as TextProtocolResponse;
  return encoded.text;
}

test("protocol parser normalizes native, JSON, XML, and text actions", () => {
  for (const protocol of [
    "native_function",
    "constrained_json",
    "xml_system_tools",
    "text_action_grammar",
  ] as const) {
    const encoded = encodeProtocolAction(protocol, expected);
    const parsed = parseProtocolAction(protocol, encoded, legalActions);

    expect(parsed.parseValid).toBe(true);
    expect(parsed.schemaValid).toBe(true);
    expect(parsed.legalAction).toBe(true);
    expect(parsed.action).toEqual(expected);
  }
});

test("valid syntax with a wrong action is a semantic failure", () => {
  const result = parseProtocolAction(
    "constrained_json",
    encodeProtocolAction("constrained_json", {
      name: "repo.search",
      arguments: { query: "index" },
    }),
    legalActions,
  );

  expect(result.parseValid).toBe(true);
  expect(result.schemaValid).toBe(true);
  expect(result.legalAction).toBe(true);
  expect(result.action).not.toEqual(expected);
  expect(result.semanticActionCorrect).toBeUndefined();
});

test("malformed and illegal protocol output fails before execution", () => {
  const malformed = parseProtocolAction(
    "constrained_json",
    '{"name":"repo.read","arguments":',
    legalActions,
  );
  const illegal = parseProtocolAction(
    "text_action_grammar",
    'ACTION shell.exec {"command":"whoami"}',
    legalActions,
  );

  expect(malformed.parseValid).toBe(false);
  expect(malformed.schemaValid).toBe(false);
  expect(illegal.parseValid).toBe(true);
  expect(illegal.schemaValid).toBe(true);
  expect(illegal.legalAction).toBe(false);
});

test("valid protocol syntax is distinct from an invalid action schema", () => {
  const result = parseProtocolAction("constrained_json", "[]", legalActions);

  expect(result.parseValid).toBe(true);
  expect(result.schemaValid).toBe(false);
  expect(result.legalAction).toBe(false);
});

test("legal actions still require an action-specific argument schema", () => {
  const argumentSchemas: Record<string, ArgumentSchema> = {
    "repo.read": { path: "string" },
  };
  const probe: ProtocolProbeCase = {
    id: "invalid-read-arguments",
    legalActions,
    expected,
    argumentSchemas,
    responses: {
      constrained_json: {
        kind: "text",
        text: encodedText("constrained_json", {
          name: "repo.read",
          arguments: {},
        }),
      },
    },
  };
  const result = evaluateProtocolProbeCase(probe, "constrained_json");

  expect(result.parseValid).toBe(true);
  expect(result.schemaValid).toBe(true);
  expect(result.legalAction).toBe(true);
  expect(result.argumentsValid).toBe(false);
  expect(result.semanticActionCorrect).toBe(false);

  const inferred = evaluateProtocolProbeCase(
    {
      id: "inferred-invalid-read-arguments",
      legalActions,
      expected,
      responses: {
        native_function: {
          kind: "native",
          toolCalls: [{ name: "repo.read", arguments: "{}" }],
        },
      },
    },
    "native_function",
  );
  expect(inferred.argumentsValid).toBe(false);
});

test("probe scoring separates parse validity, semantic correctness, and false success", () => {
  const probe: ProtocolProbeCase = {
    id: "read-index",
    legalActions,
    expected,
    responses: {
      constrained_json: {
        kind: "text",
        text: encodedText("constrained_json", expected),
        environmentSuccess: true,
        verificationSuccess: true,
      },
      xml_system_tools: {
        kind: "text",
        text: encodedText("xml_system_tools", {
          name: "repo.search",
          arguments: { query: "index" },
        }),
        claimedCompletion: true,
        verificationSuccess: false,
      },
    },
  };

  const good = evaluateProtocolProbeCase(probe, "constrained_json");
  const wrong = evaluateProtocolProbeCase(probe, "xml_system_tools");

  expect(good.parseValid).toBe(true);
  expect(good.semanticActionCorrect).toBe(true);
  expect(good.environmentSuccess).toBe(true);
  expect(good.verificationSuccess).toBe(true);
  expect(good.falseSuccess).toBe(false);
  expect(wrong.parseValid).toBe(true);
  expect(wrong.semanticActionCorrect).toBe(false);
  expect(wrong.falseSuccess).toBe(true);
});

test("calibration compares available protocols and selects the measured winner", () => {
  const cases: ProtocolProbeCase[] = [
    {
      id: "read-index",
      legalActions,
      expected,
      responses: {
        constrained_json: {
          kind: "text",
          text: encodedText("constrained_json", expected),
          environmentSuccess: true,
          verificationSuccess: true,
        },
        xml_system_tools: {
          kind: "text",
          text: encodedText("xml_system_tools", expected),
          environmentSuccess: true,
          verificationSuccess: false,
        },
      },
    },
    {
      id: "search-index",
      legalActions,
      expected: { name: "repo.search", arguments: { query: "index" } },
      responses: {
        constrained_json: {
          kind: "text",
          text: encodedText("constrained_json", {
            name: "repo.search",
            arguments: { query: "index" },
          }),
          environmentSuccess: true,
          verificationSuccess: true,
        },
        xml_system_tools: {
          kind: "text",
          text: "<tool_call>{bad xml json}</tool_call>",
        },
      },
    },
  ];

  const report = calibrateActionProtocols(cases, [
    "constrained_json",
    "xml_system_tools",
    "native_function",
  ]);

  expect(report.comparedProtocolCount).toBe(2);
  expect(report.selectionStatus).toBe("winner_selected");
  expect(report.winner).toBe("constrained_json");
  expect(
    report.results.find((item) => item.protocol === "native_function")?.status,
  ).toBe("unsupported");
  expect(
    report.results.find((item) => item.protocol === "constrained_json")
      ?.semanticActionAccuracy,
  ).toBe(1);
});

test("one supported protocol is measured but not promoted as a comparison winner", () => {
  const report = calibrateActionProtocols(
    [
      {
        id: "single",
        legalActions,
        expected,
        responses: {
          constrained_json: {
            kind: "text",
            text: encodedText("constrained_json", expected),
          },
        },
      },
    ],
    ["constrained_json", "xml_system_tools"],
  );

  expect(report.comparedProtocolCount).toBe(1);
  expect(report.selectionStatus).toBe("insufficient_comparison");
  expect(report.winner).toBeUndefined();
});

test("comparison uses the paired case intersection, not unequal protocol coverage", () => {
  const pairedCases: ProtocolProbeCase[] = [
    {
      id: "easy",
      legalActions,
      expected,
      responses: {
        constrained_json: {
          kind: "text",
          text: encodedText("constrained_json", expected),
          environmentSuccess: true,
          verificationSuccess: true,
        },
        xml_system_tools: {
          kind: "text",
          text: encodedText("xml_system_tools", expected),
          environmentSuccess: true,
          verificationSuccess: false,
        },
      },
    },
    {
      id: "hard",
      legalActions,
      expected,
      responses: {
        constrained_json: {
          kind: "text",
          text: "not-json",
        },
      },
    },
  ];
  const report = calibrateActionProtocols(pairedCases, [
    "constrained_json",
    "xml_system_tools",
  ]);

  expect(report.selectionStatus).toBe("winner_selected");
  expect(report.pairedCaseCount).toBe(1);
  expect(
    report.results.find((item) => item.protocol === "constrained_json")
      ?.caseCount,
  ).toBe(2);
  expect(
    report.results.find((item) => item.protocol === "constrained_json")
      ?.pairedCaseCount,
  ).toBe(1);
  expect(
    report.results.find((item) => item.protocol === "constrained_json")
      ?.pairedCases,
  ).toHaveLength(1);
  expect(
    report.results.find((item) => item.protocol === "xml_system_tools")
      ?.caseCount,
  ).toBe(1);
  expect(
    report.results.find((item) => item.protocol === "xml_system_tools")
      ?.pairedCaseCount,
  ).toBe(1);
});

test("an explicit attempted protocol failure is measured, not mislabeled unsupported", () => {
  const report = calibrateActionProtocols(
    [
      {
        id: "timeout",
        legalActions,
        expected,
        responses: {
          constrained_json: {
            kind: "failure",
            failureClass: "TIMEOUT",
            message: "provider timed out",
          },
        },
      },
    ],
    ["constrained_json", "xml_system_tools"],
  );

  const constrained = report.results.find(
    (item) => item.protocol === "constrained_json",
  );
  expect(constrained?.status).toBe("measured");
  expect(constrained?.caseCount).toBe(1);
  expect(constrained?.cases[0]?.parseValid).toBe(false);
  expect(
    report.results.find((item) => item.protocol === "xml_system_tools")?.status,
  ).toBe("unsupported");
});

test("an exact paired tie remains unpromoted", () => {
  const report = calibrateActionProtocols(
    [
      {
        id: "tie",
        legalActions,
        expected,
        responses: {
          constrained_json: {
            kind: "text",
            text: encodedText("constrained_json", expected),
            environmentSuccess: true,
            verificationSuccess: true,
          },
          xml_system_tools: {
            kind: "text",
            text: encodedText("xml_system_tools", expected),
            environmentSuccess: true,
            verificationSuccess: true,
          },
        },
      },
    ],
    ["constrained_json", "xml_system_tools"],
  );

  expect(report.selectionStatus).toBe("insufficient_comparison");
  expect(report.winner).toBeUndefined();
});
