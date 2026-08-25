import type {
  ModelCandidate,
  PrivacyClass,
  RepositoryPrivacy,
} from "../shared/types.js";

export type SecretKind =
  "api_key" | "private_key" | "bearer_token" | "password_assignment";

export interface SecretFinding {
  kind: SecretKind;
  line: number;
  confidence: "high";
}

const neverRemotePatterns: RegExp[] = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)credentials?(?:\.|$)/i,
  /(^|\/)secrets?(?:\.|$)/i,
  /(^|\/)passwords?(?:\.|$)/i,
  /(^|\/)tokens?(?:\.|$)/i,
  /(^|\/)id_rsa[^/]*$/i,
  /\.(?:pem|key|p12|pfx)$/i,
  /(^|\/)\.aws\//i,
  /(^|\/)\.ssh\//i,
];

export function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isNeverRemotePath(path: string): boolean {
  const normalized = normalizePath(path);
  return neverRemotePatterns.some((pattern) => pattern.test(normalized));
}

function lineNumber(source: string, index: number): number {
  return source.slice(0, index).split("\n").length;
}

export function scanSecrets(source: string): SecretFinding[] {
  const findings: SecretFinding[] = [];
  const patterns: Array<[SecretKind, RegExp]> = [
    ["private_key", /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
    [
      "api_key",
      /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|AIza[A-Za-z0-9_-]{30,}|AKIA[0-9A-Z]{16})\b/g,
    ],
    ["bearer_token", /\bBearer\s+[A-Za-z0-9._-]{20,}/gi],
    [
      "password_assignment",
      /\b(?:api[_-]?key|access[_-]?token|secret|password)\s*[:=]\s*["'][^"']{12,}["']/gi,
    ],
  ];

  for (const [kind, pattern] of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match.index === undefined) continue;
      findings.push({
        kind,
        line: lineNumber(source, match.index),
        confidence: "high",
      });
    }
  }

  return findings.sort((left, right) => left.line - right.line);
}

export function classifyRepositoryPrivacy(
  value: string | undefined,
): RepositoryPrivacy {
  switch (value) {
    case "local_only":
    case "private_zdr_only":
    case "private":
    case "trusted_cloud":
    case "public_free":
      return value;
    default:
      return "private";
  }
}

export function allowsCandidate(
  policy: RepositoryPrivacy,
  candidate: ModelCandidate,
): { allowed: boolean; reason?: string } {
  const privacy = candidate.privacy;

  if (candidate.source === "local" || privacy.classification === "local") {
    return { allowed: true };
  }

  if (privacy.classification === "unknown" || !privacy.retentionKnown) {
    return { allowed: false, reason: "provider privacy is unverified" };
  }

  if (policy === "local_only") {
    return { allowed: false, reason: "repository policy is local-only" };
  }

  if (policy === "private_zdr_only") {
    const compliant =
      privacy.classification === "zdr_capable" &&
      privacy.zdrAvailable === true &&
      privacy.trainsOnInputs === false;
    return compliant
      ? { allowed: true }
      : { allowed: false, reason: "repository policy requires verified ZDR" };
  }

  if (policy === "private") {
    const compliant =
      (privacy.classification === "zdr_capable" ||
        privacy.classification === "private_allowed") &&
      privacy.trainsOnInputs === false;
    return compliant
      ? { allowed: true }
      : {
          allowed: false,
          reason: "private repository policy blocks this provider",
        };
  }

  if (policy === "trusted_cloud") {
    const compliant =
      privacy.classification === "zdr_capable" ||
      privacy.classification === "private_allowed";
    return compliant
      ? { allowed: true }
      : { allowed: false, reason: "trusted cloud policy blocks this provider" };
  }

  return candidate.source === "free_cloud"
    ? { allowed: true }
    : {
        allowed: false,
        reason: "public-free policy requires a free cloud route",
      };
}

export function privacyClassLabel(value: PrivacyClass): string {
  return value.replaceAll("_", " ");
}
