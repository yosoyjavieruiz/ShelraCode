const ASSIGNMENT_SECRET =
  /\b(?:x[_-]?api[_-]?key|aws[_-]?(?:access[_-]?key[_-]?id|secret[_-]?access[_-]?key)|client[_-]?secret|api[_-]?key|access[_-]?token|refresh[_-]?token|authorization|token|secret|password|passwd|credential|cookie)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s&]+)/giu;
const REDACTED = "[REDACTED]";

function isSecretKey(key: string): boolean {
  const normalized = key.replace(/[^A-Za-z0-9]/gu, "").toLowerCase();
  return /^(?:x?apikey|authorization|proxyauthorization|token|accesstoken|refreshtoken|sessiontoken|idtoken|authtoken|secret|clientsecret|oauthclientsecret|password|passwd|credential|credentials|cookie|setcookie|privatekey|awsaccesskeyid|awssecretaccesskey|secretaccesskey)$/u.test(
    normalized,
  );
}

function redactString(value: string): string {
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/giu, `$1${REDACTED}`)
    .replace(/([?&](?:token|api_key|secret)=)[^&\s]+/giu, `$1${REDACTED}`)
    .replace(/\b(?:sk|gh[pousr]|AIza)[-_A-Za-z0-9]{16,}\b/gu, REDACTED)
    .replace(/\bAKIA[0-9A-Z]{16}\b/gu, REDACTED)
    .replace(
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/gu,
      REDACTED,
    )
    .replace(ASSIGNMENT_SECRET, REDACTED);
}

function redactReplayValue(
  value: unknown,
  key = "",
  seen = new WeakSet<object>(),
): unknown {
  if (isSecretKey(key)) return REDACTED;
  if (typeof value === "string") return redactString(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[Circular]";
  seen.add(value);
  const redacted = Array.isArray(value)
    ? value.map((entry) => redactReplayValue(entry, "", seen))
    : Object.fromEntries(
        Object.entries(value).map(([entryKey, entryValue]) => [
          entryKey,
          redactReplayValue(entryValue, entryKey, seen),
        ]),
      );
  seen.delete(value);
  return redacted;
}

/**
 * Redacts evaluation evidence before it becomes persistable while preserving
 * complete response frames needed for deterministic replay.
 */
export function redactEvaluationValue(value: unknown): unknown {
  return redactReplayValue(value);
}
