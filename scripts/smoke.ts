const commands = [
  ["help", ["--help"]],
  ["version", ["--version"]],
  ["doctor", ["doctor"]],
] as const;

for (const [label, args] of commands) {
  const proc = Bun.spawn([process.execPath, "run", "src/index.ts", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(`${label} smoke failed (${exitCode}): ${stderr || stdout}`);
  }

  console.log(`${label}: ${stdout.trim().split("\n")[0] ?? "ok"}`);
}
