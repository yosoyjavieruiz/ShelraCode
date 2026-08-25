import { describe, expect, test } from "bun:test";
import {
  classifyRepositoryPrivacy,
  isNeverRemotePath,
  scanSecrets,
} from "../../src/privacy/policy.js";

describe("privacy policy", () => {
  test("blocks credential-shaped paths regardless of nesting", () => {
    expect(isNeverRemotePath("src/.env.local")).toBe(true);
    expect(isNeverRemotePath("config/customer.pem")).toBe(true);
    expect(
      isNeverRemotePath("C:/Users/dev/.ssh/id_rsa".replaceAll("\\", "/")),
    ).toBe(true);
    expect(isNeverRemotePath("src/public.ts")).toBe(false);
  });

  test("finds high-confidence secret patterns", () => {
    const findings = scanSecrets(
      "export const key = 'sk-live-123456789012345678901234567890';\n-----BEGIN PRIVATE KEY-----",
    );

    expect(findings.some((finding) => finding.kind === "api_key")).toBe(true);
    expect(findings.some((finding) => finding.kind === "private_key")).toBe(
      true,
    );
  });

  test("keeps repository defaults conservative", () => {
    expect(classifyRepositoryPrivacy(undefined)).toBe("private");
    expect(classifyRepositoryPrivacy("public_free")).toBe("public_free");
  });
});
