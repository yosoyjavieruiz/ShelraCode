#!/usr/bin/env bun
/**
 * production-modification-guard (PreToolUse: Write|Edit|MultiEdit|NotebookEdit)
 *
 * Enforces AUDIT_MODE discipline (audit charter §16/§18): while the audit is
 * active, edits to ShelraCode PRODUCT source are forbidden. Writes to the audit
 * surface (.claude/, docs/, specs/) are always allowed.
 *
 * Deterministic only. It validates paths — it does not reason about intent.
 *
 * Contract:
 *   stdin  = JSON { tool_name, tool_input: { file_path?, notebook_path? }, cwd? }
 *   exit 0 = allow
 *   exit 2 = block; stderr message is shown to the agent
 *
 * Controls (env):
 *   SHELRA_AUDIT_MODE=true   -> guard is active (blocks product writes)
 *   SHELRA_ALLOW_PROD=1      -> explicit, authorized override (allows one/any)
 */

import path from "node:path";

const BLOCKED_PREFIXES = ["src/", "scripts/", "tests/"];
const BLOCKED_FILES = new Set([
  "package.json",
  "tsconfig.json",
  "bunfig.toml",
  "bun.lock",
  "package-lock.json",
  ".env",
]);

function allow(): never {
  process.exit(0);
}

function block(reason: string): never {
  process.stderr.write(
    `BLOCKED by production-modification-guard (AUDIT_MODE).\n${reason}\n` +
      `The audit must not change product behavior. Write findings/specs under ` +
      `docs/audit/ or specs/ instead. If this change is explicitly authorized, ` +
      `re-run with SHELRA_ALLOW_PROD=1.\n`,
  );
  process.exit(2);
}

async function main(): Promise<void> {
  if (process.env.SHELRA_AUDIT_MODE !== "true") allow();
  if (process.env.SHELRA_ALLOW_PROD === "1") allow();

  let payload: unknown;
  try {
    payload = JSON.parse(await Bun.stdin.text());
  } catch {
    // Fail open on malformed input rather than trapping the session.
    allow();
  }

  const input = (payload as { tool_input?: Record<string, unknown> } | null)
    ?.tool_input;
  const rawPath =
    (input?.file_path as string | undefined) ??
    (input?.notebook_path as string | undefined);
  if (!rawPath) allow();

  const cwd = ((payload as { cwd?: string } | null)?.cwd ?? process.cwd());
  const abs = path.isAbsolute(rawPath) ? rawPath : path.resolve(cwd, rawPath);
  const rel = path.relative(cwd, abs).split(path.sep).join("/");

  // Outside the repo, or clearly on the audit surface -> not our concern.
  if (rel.startsWith("..")) allow();
  const base = rel.split("/").pop() ?? rel;

  if (BLOCKED_FILES.has(base)) {
    block(`Target is a protected manifest: ${rel}`);
  }
  for (const prefix of BLOCKED_PREFIXES) {
    if (rel === prefix.slice(0, -1) || rel.startsWith(prefix)) {
      block(`Target is product source: ${rel}`);
    }
  }
  allow();
}

await main();
