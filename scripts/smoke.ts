import path from "node:path";

type SmokeCase = { label: string; command: string[] };

const projectRoot = path.resolve(import.meta.dir, "..");
const entrypoints = [
  {
    label: "source",
    command: (args: string[]) => [
      process.execPath,
      "--conditions=browser",
      "run",
      path.join(projectRoot, "src", "index.ts"),
      ...args,
    ],
  },
  {
    label: "bundle",
    command: (args: string[]) => [
      process.execPath,
      "--conditions=browser",
      "run",
      path.join(projectRoot, "dist", "index.js"),
      ...args,
    ],
  },
];

const standalonePath = path.join(
  projectRoot,
  "dist",
  process.platform === "win32" ? "shelra.exe" : "shelra",
);
if (await Bun.file(standalonePath).exists()) {
  entrypoints.push({
    label: "standalone",
    command: (args: string[]) => [standalonePath, ...args],
  });
}

const cases: SmokeCase[] = entrypoints.flatMap(({ label, command }) => [
  { label: `${label} help`, command: command(["--help"]) },
  { label: `${label} version`, command: command(["--version"]) },
  { label: `${label} doctor`, command: command(["doctor"]) },
]);

cases.push({
  label: "deterministic agent evaluation",
  command: [
    process.execPath,
    "--conditions=browser",
    "run",
    path.join(projectRoot, "scripts", "evaluate-agent.ts"),
    "--deterministic",
    "--summary",
  ],
});

for (const smoke of cases) {
  const proc = Bun.spawn(smoke.command, {
    cwd: projectRoot,
    stdout: "pipe",
    stderr: "pipe",
  });
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
