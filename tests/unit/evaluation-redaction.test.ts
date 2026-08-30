import { expect, test } from "bun:test";
import { redactEvaluationValue } from "../../src/evals/redaction.js";

test("evaluation redaction removes secrets without truncating replay-critical response frames", () => {
  const longFrame = `${"x".repeat(5_000)}__FRAME_END__`;
  const values = Array.from({ length: 75 }, (_, index) => `frame-${index}`);
  const sharedNotes = ["preserve shared replay evidence"];

  const redacted = redactEvaluationValue({
    authorization: "Bearer private-token-value",
    response: longFrame,
    values,
    message: "token=private-token-value",
    firstNotes: sharedNotes,
    secondNotes: sharedNotes,
  }) as {
    authorization: string;
    response: string;
    values: string[];
    message: string;
    firstNotes: string[];
    secondNotes: string[];
  };

  expect(redacted.authorization).toBe("[REDACTED]");
  expect(redacted.message).toBe("[REDACTED]");
  expect(redacted.response.endsWith("__FRAME_END__")).toBe(true);
  expect(redacted.response).toHaveLength(longFrame.length);
  expect(redacted.values).toHaveLength(75);
  expect(redacted.values.at(-1)).toBe("frame-74");
  expect(redacted.firstNotes).toEqual(sharedNotes);
  expect(redacted.secondNotes).toEqual(sharedNotes);
});

test("evaluation redaction removes common provider and cloud credential fields without hiding token budgets", () => {
  const redacted = redactEvaluationValue({
    headers: {
      "x-api-key": "common-secret-value-12345",
    },
    client_secret: "oauth-client-secret-67890",
    aws_access_key_id: "AKIAIOSFODNN7EXAMPLE",
    shell:
      "AWS_SECRET_ACCESS_KEY=aws-secret-value-12345 CLIENT_SECRET=oauth-shell-secret-67890",
    maxOutputTokens: 512,
  }) as {
    headers: Record<string, unknown>;
    client_secret: string;
    aws_access_key_id: string;
    shell: string;
    maxOutputTokens: number;
  };

  expect(redacted.headers["x-api-key"]).toBe("[REDACTED]");
  expect(redacted.client_secret).toBe("[REDACTED]");
  expect(redacted.aws_access_key_id).toBe("[REDACTED]");
  expect(redacted.shell).not.toContain("aws-secret-value-12345");
  expect(redacted.shell).not.toContain("oauth-shell-secret-67890");
  expect(redacted.maxOutputTokens).toBe(512);
  expect(JSON.stringify(redacted)).not.toContain("common-secret-value-12345");
  expect(JSON.stringify(redacted)).not.toContain("oauth-client-secret-67890");
  expect(JSON.stringify(redacted)).not.toContain("AKIAIOSFODNN7EXAMPLE");
});
