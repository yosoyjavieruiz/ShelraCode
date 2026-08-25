type SmokeCase = { label: string; command: string[] };

const entrypoints = [
  { label: "source", entry: "src/index.ts" },
  { label: "bundle", entry: "dist/index.js" },
];

const cases: SmokeCase[] = entrypoints.flatMap(({ label, entry }) => [
  { label: `${label} help`, command: ["run", entry, "--help"] },
  { label: `${label} version`, command: ["run", entry, "--version"] },
  { label: `${label} doctor`, command: ["run", entry, "doctor"] },
]);

for (const smoke of cases) {
  const proc = Bun.spawn(
    [process.execPath, "--conditions=browser", ...smoke.command],
    {
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `${smoke.label} smoke failed (${exitCode}): ${stderr || stdout}`,
    );
  }

  console.log(`${smoke.label}: ${stdout.trim().split("\n")[0] ?? "ok"}`);
}
