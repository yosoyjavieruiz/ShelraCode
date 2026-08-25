import { access, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { LocalCodeLogger } from "../shared/logging.js";

export interface ProjectCommands {
  test?: string[];
  typecheck?: string[];
  lint?: string[];
  build?: string[];
  format?: string[];
}

type CommandStage = keyof ProjectCommands;

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stageForScript(name: string): CommandStage | undefined {
  const normalized = name.toLowerCase();
  if (normalized === "test" || normalized.startsWith("test:")) return "test";
  if (
    normalized === "typecheck" ||
    normalized === "type-check" ||
    normalized === "check-types" ||
    normalized === "check"
  )
    return "typecheck";
  if (normalized === "lint" || normalized.startsWith("lint:")) return "lint";
  if (normalized === "build" || normalized.startsWith("build:")) return "build";
  if (normalized === "format" || normalized.startsWith("format:"))
    return "format";
  return undefined;
}

function addCommand(
  result: ProjectCommands,
  stage: CommandStage,
  command: string,
): void {
  const normalized = command.trim();
  if (!normalized) return;
  const values = result[stage] ?? [];
  if (!values.includes(normalized)) values.push(normalized);
  result[stage] = values;
}

async function readOptional(
  root: string,
  name: string,
): Promise<string | undefined> {
  try {
    return await readFile(path.join(root, name), "utf8");
  } catch {
    return undefined;
  }
}

function addNamedTargets(
  result: ProjectCommands,
  content: string,
  runner: string,
): void {
  const targetPattern = /^\s*([A-Za-z][A-Za-z0-9_.-]*):(?:\s|$)/gim;
  for (const match of content.matchAll(targetPattern)) {
    const name = match[1];
    if (!name) continue;
    const stage = stageForScript(name);
    if (stage) addCommand(result, stage, `${runner} ${name}`);
  }
}

function documentedCommand(line: string): [CommandStage, string] | undefined {
  const normalized = line
    .trim()
    .replace(/^[-*]\s+/u, "")
    .replace(/^`|`$/gu, "");
  if (
    !normalized ||
    /[;&|<>]/u.test(normalized) ||
    /(?:--watch|--interactive|--fix|--write|--serve|publish)\b/iu.test(
      normalized,
    )
  )
    return undefined;

  const packageMatch = normalized.match(
    /^(?:bun|npm|pnpm|yarn)\s+(?:run\s+)?(test(?::[A-Za-z0-9_.-]+)?|typecheck|type-check|check-types|check|lint|build(?::[A-Za-z0-9_.-]+)?)\b(?:\s+[^\s`]+)*$/iu,
  );
  if (packageMatch?.[1]) {
    const stage = stageForScript(packageMatch[1]);
    if (stage) return [stage, normalized];
  }

  const standardMatch = normalized.match(
    /^(make|just|task)\s+(test(?::[A-Za-z0-9_.-]+)?|typecheck|type-check|check-types|check|lint|build(?::[A-Za-z0-9_.-]+)?)$/iu,
  );
  if (standardMatch?.[2]) {
    const stage = stageForScript(standardMatch[2]);
    if (stage) return [stage, normalized];
  }

  if (/^cargo\s+test(?:\s+[^\s`]+)*$/iu.test(normalized))
    return ["test", normalized];
  if (/^cargo\s+check(?:\s+[^\s`]+)*$/iu.test(normalized))
    return ["typecheck", normalized];
  if (/^cargo\s+build(?:\s+[^\s`]+)*$/iu.test(normalized))
    return ["build", normalized];
  if (/^go\s+test\s+[^\s`]+$/iu.test(normalized)) return ["test", normalized];
  if (/^go\s+build\s+[^\s`]+$/iu.test(normalized)) return ["build", normalized];
  if (/^dotnet\s+test(?:\s+[^\s`]+)*$/iu.test(normalized))
    return ["test", normalized];
  if (/^dotnet\s+build(?:\s+[^\s`]+)*$/iu.test(normalized))
    return ["build", normalized];
  if (/^mvn\s+(?:test|verify|package)(?:\s+[^\s`]+)*$/iu.test(normalized))
    return [normalized.includes("test") ? "test" : "build", normalized];
  if (/^(?:\.\\)?gradlew(?:\.bat)?\s+test(?:\s+[^\s`]+)*$/iu.test(normalized))
    return ["test", normalized];
  if (/^(?:\.\\)?gradlew(?:\.bat)?\s+build(?:\s+[^\s`]+)*$/iu.test(normalized))
    return ["build", normalized];
  return undefined;
}

function addDocumentedCommands(result: ProjectCommands, content: string): void {
  for (const line of content.split(/\r?\n/u)) {
    const command = documentedCommand(line);
    if (command) addCommand(result, command[0], command[1]);
  }
}

async function addStandardProjectEvidence(
  root: string,
  result: ProjectCommands,
): Promise<void> {
  const makefile = await readOptional(root, "Makefile");
  if (makefile) addNamedTargets(result, makefile, "make");

  const justfile = await readOptional(root, "justfile");
  if (justfile) addNamedTargets(result, justfile, "just");

  const taskfile = await readOptional(root, "Taskfile.yml");
  if (taskfile) addNamedTargets(result, taskfile, "task");

  const cargo = await readOptional(root, "Cargo.toml");
  if (cargo) {
    addCommand(result, "test", "cargo test");
    addCommand(result, "typecheck", "cargo check");
    addCommand(result, "build", "cargo build");
  }

  const goModule = await readOptional(root, "go.mod");
  if (goModule) {
    addCommand(result, "test", "go test ./...");
    addCommand(result, "build", "go build ./...");
  }

  const pom = await readOptional(root, "pom.xml");
  if (pom) {
    addCommand(result, "test", "mvn test");
    addCommand(result, "build", "mvn package -DskipTests");
  }

  const gradleFile =
    (await readOptional(root, "build.gradle")) ??
    (await readOptional(root, "build.gradle.kts"));
  if (gradleFile) {
    const gradleRunner = await access(path.join(root, "gradlew.bat"))
      .then(() => ".\\gradlew.bat")
      .catch(() => "gradle");
    addCommand(result, "test", `${gradleRunner} test`);
    addCommand(result, "build", `${gradleRunner} build`);
  }

  const dotnetProject = await readOptional(root, "Directory.Build.props");
  const dotnetFiles = [".sln", ".csproj"];
  let hasDotnetProject = Boolean(dotnetProject);
  if (!hasDotnetProject) {
    try {
      const names = await readdir(root);
      hasDotnetProject = names.some((name) =>
        dotnetFiles.some((suffix) => name.endsWith(suffix)),
      );
    } catch {
      hasDotnetProject = false;
    }
  }
  if (hasDotnetProject) {
    addCommand(result, "test", "dotnet test");
    addCommand(result, "build", "dotnet build");
  }

  for (const name of ["AGENTS.md", "README.md", "README"]) {
    const documentation = await readOptional(root, name);
    if (documentation) addDocumentedCommands(result, documentation);
  }
  try {
    const workflowDirectory = path.join(root, ".github", "workflows");
    for (const name of await readdir(workflowDirectory)) {
      if (!/\.(?:yaml|yml)$/iu.test(name)) continue;
      const workflow = await readOptional(
        root,
        path.join(".github", "workflows", name),
      );
      if (workflow) addDocumentedCommands(result, workflow);
    }
  } catch {
    // CI evidence is optional and absent in most local repositories.
  }
}

export async function discoverProjectCommands(
  root: string,
  logger?: LocalCodeLogger,
): Promise<ProjectCommands> {
  logger?.debug("verification.commands.started", {});
  const result: ProjectCommands = {};
  try {
    const parsed: unknown = JSON.parse(
      await readFile(path.join(root, "package.json"), "utf8"),
    );
    const scripts = record(record(parsed)?.scripts);
    if (scripts) {
      for (const [name, command] of Object.entries(scripts)) {
        if (typeof command !== "string" || !command.trim()) continue;
        const stage = stageForScript(name);
        if (!stage) continue;
        addCommand(result, stage, command);
      }
    }
  } catch {
    // A project without package.json simply has no package-script evidence.
  }
  await addStandardProjectEvidence(root, result);
  logger?.info("verification.commands.discovered", {
    testCount: result.test?.length ?? 0,
    typecheckCount: result.typecheck?.length ?? 0,
    lintCount: result.lint?.length ?? 0,
    buildCount: result.build?.length ?? 0,
    formatCount: result.format?.length ?? 0,
  });
  return result;
}
