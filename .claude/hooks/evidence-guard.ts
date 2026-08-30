#!/usr/bin/env bun
/**
 * evidence-guard (PreToolUse: Write|Edit)
 *
 * Enforces the evidence-first rule (audit charter §16/§42): a HIGH/CRITICAL
 * (P0/P1) finding written into docs/audit/ must carry an `evidence:` field.
 * Prevents unsupported severe claims. Deterministic; conservative to avoid
 * false positives (only fires when a severity marker is clearly present).
 *
 * Contract:
 *   stdin  = JSON { tool_input: { file_path, content? | new_string? }, cwd? }
 *   exit 0 = allow (also used for warnings, printed to stderr)
 *   exit 2 = block; stderr shown to the agent
 *
 * Override: SHELRA_ALLOW_UNVERIFIED=1
 */

import path from "node:path";

function allow(msg?: string): never {
  if (msg) process.stderr.write(msg + "\n");
  process.exit(0);
}

function block(reason: string): never {
  process.stderr.write(
    `BLOCKED by evidence-guard.\n${reason}\n` +
      `Every P0/P1/HIGH/CRITICAL finding needs an \`evidence:\` block ` +
      `(source_files, source_lines, tests, or runtime_trace). Add it, or ` +
      `downgrade severity, or re-run with SHELRA_ALLOW_UNVERIFIED=1.\n`,
  );
  process.exit(2);
}

async function main(): Promise<void> {
  if (process.env.SHELRA_ALLOW_UNVERIFIED === "1") allow();

  let payload: { tool_input?: Record<string, unknown>; cwd?: string } | null;
  try {
    payload = JSON.parse(await Bun.stdin.text());
  } catch {
    allow();
  }

  const input = payload?.tool_input ?? {};
  const rawPath = input.file_path as string | undefined;
  if (!rawPath) allow();

  const cwd = payload?.cwd ?? process.cwd();
  const abs = path.isAbsolute(rawPath) ? rawPath : path.resolve(cwd, rawPath);
  const rel = path.relative(cwd, abs).split(path.sep).join("/");

  // Only govern the audit findings surface.
  if (!rel.startsWith("docs/audit/")) allow();

  const content =
    (input.content as string | undefined) ??
    (input.new_string as string | undefined) ??
    "";
  if (!content) allow();

  const hasSevereFinding = /severity:\s*(p0|p1|critical|high)\b/i.test(content);
  if (!hasSevereFinding) allow();

  const hasEvidence = /(^|\n)\s*evidence\s*:/i.test(content);
  if (!hasEvidence) {
    block(`A P0/P1/HIGH/CRITICAL severity is declared without an evidence block in ${rel}.`);
  }
  allow();
}

await main();
