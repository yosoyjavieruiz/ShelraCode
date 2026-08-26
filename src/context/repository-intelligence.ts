import { readFile } from "node:fs/promises";
import path from "node:path";
import { isNeverRemotePath, normalizePath } from "../privacy/policy.js";

export type RepositorySymbolKind =
  | "class"
  | "function"
  | "interface"
  | "type"
  | "constant"
  | "method"
  | "module";

export interface RepositorySymbol {
  name: string;
  path: string;
  kind: RepositorySymbolKind;
  line: number;
  exported: boolean;
  signature?: string;
}

export interface RepositoryImport {
  path: string;
  source: string;
  line: number;
  names: string[];
  resolvedPath?: string;
}

export interface RepositoryReference {
  name: string;
  path: string;
  line: number;
  kind: "import" | "usage";
  targetPath?: string;
}

export interface RelatedRepositoryTest {
  sourcePath: string;
  testPath: string;
  score: number;
}

export interface RepositoryIntelligence {
  indexedFiles: string[];
  symbols: RepositorySymbol[];
  imports: RepositoryImport[];
  references: RepositoryReference[];
  relatedTests: RelatedRepositoryTest[];
  indexedAt: string;
  truncated: boolean;
}

export interface RepositoryIntelligenceOptions {
  root: string;
  files: readonly string[];
  signal?: AbortSignal;
  maxFiles?: number;
  maxSymbols?: number;
  maxImports?: number;
  maxReferences?: number;
}

export interface RepositoryIntelligenceSelection {
  files: string[];
  symbols: RepositorySymbol[];
  imports: RepositoryImport[];
  references: RepositoryReference[];
  relatedTests: RelatedRepositoryTest[];
  sourceIds: string[];
}

interface IndexedFile {
  path: string;
  content: string;
}

const INDEXABLE_EXTENSIONS = new Set([
  ".c",
  ".cc",
  ".cpp",
  ".cs",
  ".go",
  ".h",
  ".hpp",
  ".java",
  ".js",
  ".jsx",
  ".kt",
  ".kts",
  ".mjs",
  ".php",
  ".py",
  ".rb",
  ".rs",
  ".swift",
  ".ts",
  ".tsx",
]);

const DEFAULT_MAX_FILES = 256;
const DEFAULT_MAX_SYMBOLS = 2_000;
const DEFAULT_MAX_IMPORTS = 1_000;
const DEFAULT_MAX_REFERENCES = 2_000;
const MAX_SOURCE_CHARS = 256_000;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new DOMException("Repository intelligence aborted", "AbortError");
}

function safeRelativePath(root: string, value: string): string | undefined {
  const normalized = normalizePath(value);
  if (!normalized || normalized === "." || path.isAbsolute(normalized))
    return undefined;
  const rootAbsolute = path.resolve(root);
  const candidate = path.resolve(rootAbsolute, normalized);
  const relative = path.relative(rootAbsolute, candidate);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  )
    return undefined;
  const result = normalizePath(relative);
  return isNeverRemotePath(result) ? undefined : result;
}

function extensionOf(relativePath: string): string {
  return path.posix.extname(relativePath).toLowerCase();
}

function isIndexablePath(relativePath: string): boolean {
  return INDEXABLE_EXTENSIONS.has(extensionOf(relativePath));
}

function isCommentOnly(line: string, extension: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if ([".py", ".rb", ".php", ".sh"].includes(extension))
    return trimmed.startsWith("#");
  return (
    trimmed.startsWith("//") ||
    trimmed.startsWith("/*") ||
    trimmed.startsWith("*")
  );
}

function declaration(
  name: string,
  relativePath: string,
  kind: RepositorySymbolKind,
  line: number,
  sourceLine: string,
  exported: boolean,
): RepositorySymbol {
  return {
    name,
    path: relativePath,
    kind,
    line,
    exported,
    signature: sourceLine.trim().slice(0, 240),
  };
}

function parseTypeScriptDeclarations(
  line: string,
  relativePath: string,
  lineNumber: number,
): RepositorySymbol | undefined {
  const exported = /^\s*export\b/u.test(line);
  const functionMatch = line.match(
    /^\s*(?:export\s+)?(?:declare\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/u,
  );
  if (functionMatch?.[1])
    return declaration(
      functionMatch[1],
      relativePath,
      "function",
      lineNumber,
      line,
      exported,
    );
  const classMatch = line.match(
    /^\s*(?:export\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/u,
  );
  if (classMatch?.[1])
    return declaration(
      classMatch[1],
      relativePath,
      "class",
      lineNumber,
      line,
      exported,
    );
  const interfaceMatch = line.match(
    /^\s*(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/u,
  );
  if (interfaceMatch?.[1])
    return declaration(
      interfaceMatch[1],
      relativePath,
      "interface",
      lineNumber,
      line,
      exported,
    );
  const typeMatch = line.match(/^\s*(?:export\s+)?type\s+([A-Za-z_$][\w$]*)/u);
  if (typeMatch?.[1])
    return declaration(
      typeMatch[1],
      relativePath,
      "type",
      lineNumber,
      line,
      exported,
    );
  const constantMatch = line.match(
    /^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/u,
  );
  if (constantMatch?.[1])
    return declaration(
      constantMatch[1],
      relativePath,
      "constant",
      lineNumber,
      line,
      exported,
    );
  return undefined;
}

function parsePythonDeclarations(
  line: string,
  relativePath: string,
  lineNumber: number,
): RepositorySymbol | undefined {
  const functionMatch = line.match(/^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)/u);
  if (functionMatch?.[1])
    return declaration(
      functionMatch[1],
      relativePath,
      "function",
      lineNumber,
      line,
      !line.match(/^\s*_/u),
    );
  const classMatch = line.match(/^\s*class\s+([A-Za-z_]\w*)/u);
  if (classMatch?.[1])
    return declaration(
      classMatch[1],
      relativePath,
      "class",
      lineNumber,
      line,
      !classMatch[1].startsWith("_"),
    );
  return undefined;
}

function parseGoDeclarations(
  line: string,
  relativePath: string,
  lineNumber: number,
): RepositorySymbol | undefined {
  const functionMatch = line.match(
    /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/u,
  );
  if (functionMatch?.[1])
    return declaration(
      functionMatch[1],
      relativePath,
      "function",
      lineNumber,
      line,
      /^[A-Z]/u.test(functionMatch[1]),
    );
  const typeMatch = line.match(/^\s*type\s+([A-Za-z_]\w*)/u);
  if (typeMatch?.[1])
    return declaration(
      typeMatch[1],
      relativePath,
      "type",
      lineNumber,
      line,
      /^[A-Z]/u.test(typeMatch[1]),
    );
  return undefined;
}

function parseRustDeclarations(
  line: string,
  relativePath: string,
  lineNumber: number,
): RepositorySymbol | undefined {
  const match = line.match(
    /^\s*(?:pub\s+)?(?:async\s+)?(fn|struct|enum|trait|type|const)\s+([A-Za-z_]\w*)/u,
  );
  if (!match?.[1] || !match[2]) return undefined;
  const kind: RepositorySymbolKind =
    match[1] === "fn"
      ? "function"
      : match[1] === "const"
        ? "constant"
        : match[1] === "type"
          ? "type"
          : match[1] === "trait"
            ? "interface"
            : "class";
  return declaration(
    match[2],
    relativePath,
    kind,
    lineNumber,
    line,
    /^\s*pub\b/u.test(line),
  );
}

function parseGenericDeclarations(
  line: string,
  relativePath: string,
  lineNumber: number,
): RepositorySymbol | undefined {
  const match = line.match(
    /^\s*(?:public\s+|private\s+|protected\s+|internal\s+|static\s+)*(class|interface|struct|enum)\s+([A-Za-z_]\w*)/u,
  );
  if (!match?.[1] || !match[2]) return undefined;
  return declaration(
    match[2],
    relativePath,
    match[1] === "interface" ? "interface" : "class",
    lineNumber,
    line,
    /\bpublic\b/u.test(line),
  );
}

function parseDeclaration(
  line: string,
  relativePath: string,
  lineNumber: number,
): RepositorySymbol | undefined {
  const extension = extensionOf(relativePath);
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(extension))
    return parseTypeScriptDeclarations(line, relativePath, lineNumber);
  if ([".py", ".rb", ".php"].includes(extension))
    return parsePythonDeclarations(line, relativePath, lineNumber);
  if (extension === ".go")
    return parseGoDeclarations(line, relativePath, lineNumber);
  if (extension === ".rs")
    return parseRustDeclarations(line, relativePath, lineNumber);
  return parseGenericDeclarations(line, relativePath, lineNumber);
}

function importedNames(clause: string): string[] {
  const names: string[] = [];
  const brace = clause.match(/\{([\s\S]*?)\}/u);
  if (brace?.[1]) {
    for (const item of brace[1].split(",")) {
      const name = item
        .replace(/^\s*type\s+/u, "")
        .split(/\s+as\s+/iu)[0]
        ?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/u.test(name)) names.push(name);
    }
  }
  const namespace = clause.match(/\*\s+as\s+([A-Za-z_$][\w$]*)/u)?.[1];
  if (namespace) names.push(namespace);
  const defaultClause = clause.split("{")[0]?.replace(/\*\s+as\s+[^,]+/u, "");
  const defaultName = defaultClause
    ?.split(",")[0]
    ?.replace(/^\s*type\s+/u, "")
    ?.trim();
  if (defaultName && /^[A-Za-z_$][\w$]*$/u.test(defaultName))
    names.push(defaultName);
  return [...new Set(names)];
}

function parseImports(
  line: string,
  relativePath: string,
  lineNumber: number,
): RepositoryImport | undefined {
  const extension = extensionOf(relativePath);
  if ([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(extension)) {
    const fromMatch = line.match(
      /^\s*(?:import|export)\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/u,
    );
    if (fromMatch?.[1] && fromMatch[2])
      return {
        path: relativePath,
        source: fromMatch[2],
        line: lineNumber,
        names: importedNames(fromMatch[1]),
      };
    const sideEffectMatch = line.match(/^\s*import\s+["']([^"']+)["']/u);
    if (sideEffectMatch?.[1])
      return {
        path: relativePath,
        source: sideEffectMatch[1],
        line: lineNumber,
        names: [],
      };
    const requireMatch = line.match(/\brequire\s*\(\s*["']([^"']+)["']\s*\)/u);
    if (requireMatch?.[1])
      return {
        path: relativePath,
        source: requireMatch[1],
        line: lineNumber,
        names: [],
      };
    return undefined;
  }
  if ([".py", ".rb", ".php"].includes(extension)) {
    const fromMatch = line.match(
      /^\s*from\s+([.A-Za-z0-9_]+)\s+import\s+(.+)$/u,
    );
    if (fromMatch?.[1] && fromMatch[2])
      return {
        path: relativePath,
        source: fromMatch[1],
        line: lineNumber,
        names: fromMatch[2]
          .split(",")
          .map((name) => name.trim().split(/\s+as\s+/iu)[0] ?? "")
          .filter((name) => /^[A-Za-z_]\w*$/u.test(name)),
      };
    const importMatch = line.match(/^\s*import\s+([.A-Za-z0-9_]+)/u);
    if (importMatch?.[1])
      return {
        path: relativePath,
        source: importMatch[1],
        line: lineNumber,
        names: [],
      };
  }
  if (extension === ".go") {
    const quoted = line.match(/^\s*import\s+["']([^"']+)["']/u);
    if (quoted?.[1])
      return {
        path: relativePath,
        source: quoted[1],
        line: lineNumber,
        names: [],
      };
  }
  return undefined;
}

function relativeModuleCandidates(importer: string, source: string): string[] {
  if (!source.startsWith(".")) return [];
  const importerDirectory = path.posix.dirname(importer);
  const base = normalizePath(path.posix.join(importerDirectory, source));
  const extension = extensionOf(base);
  const candidates = [base];
  if (!extension) {
    candidates.push(
      ...[
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
        ".py",
        ".go",
        ".rs",
      ].map((suffix) => `${base}${suffix}`),
      ...[
        ".ts",
        ".tsx",
        ".js",
        ".jsx",
        ".mjs",
        ".cjs",
        ".py",
        ".go",
        ".rs",
      ].map((suffix) => `${base}/index${suffix}`),
    );
  }
  return [...new Set(candidates)];
}

function resolveImport(
  importer: string,
  source: string,
  knownFiles: ReadonlySet<string>,
): string | undefined {
  return relativeModuleCandidates(importer, source).find((candidate) =>
    knownFiles.has(normalizePath(candidate)),
  );
}

function sourceStem(relativePath: string): string {
  return (relativePath.split("/").pop() ?? relativePath)
    .replace(/\.(?:test|spec)\.[^.]+$/iu, "")
    .replace(/\.[^.]+$/u, "")
    .toLowerCase();
}

function isTestFile(relativePath: string): boolean {
  const normalized = relativePath.toLowerCase();
  return (
    /(^|\/)(?:test|tests|spec|specs|__tests__)\//u.test(normalized) ||
    /(?:\.test|\.spec|_test)\.[^.]+$/u.test(normalized)
  );
}

function relatedTestPairs(
  files: readonly IndexedFile[],
  imports: readonly RepositoryImport[],
): RelatedRepositoryTest[] {
  const sourceFiles = files.filter((file) => !isTestFile(file.path));
  const testFiles = files.filter((file) => isTestFile(file.path));
  const result: RelatedRepositoryTest[] = [];
  for (const test of testFiles) {
    const directTargets = new Set(
      imports
        .filter((item) => item.path === test.path && item.resolvedPath)
        .map((item) => item.resolvedPath as string),
    );
    for (const source of sourceFiles) {
      const direct = directTargets.has(source.path);
      const sameStem = sourceStem(source.path) === sourceStem(test.path);
      if (!direct && !sameStem) continue;
      result.push({
        sourcePath: source.path,
        testPath: test.path,
        score: direct ? 100 : 70,
      });
    }
  }
  return result.sort(
    (left, right) =>
      right.score - left.score ||
      left.sourcePath.localeCompare(right.sourcePath) ||
      left.testPath.localeCompare(right.testPath),
  );
}

function objectiveTerms(objective: string): string[] {
  return objective
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .split(/[^a-z0-9_]+/u)
    .filter((term) => term.length >= 4)
    .slice(0, 12);
}

function fileScore(
  relativePath: string,
  objective: string,
  explicit: ReadonlySet<string>,
  symbols: readonly RepositorySymbol[],
): number {
  if (explicit.has(relativePath)) return 1_000;
  const terms = objectiveTerms(objective);
  const haystack = `${relativePath} ${symbols
    .filter((symbol) => symbol.path === relativePath)
    .map((symbol) => symbol.name)
    .join(" ")}`.toLowerCase();
  return terms.filter((term) => haystack.includes(term)).length * 100;
}

export async function buildRepositoryIntelligence(
  options: RepositoryIntelligenceOptions,
): Promise<RepositoryIntelligence> {
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxSymbols = options.maxSymbols ?? DEFAULT_MAX_SYMBOLS;
  const maxImports = options.maxImports ?? DEFAULT_MAX_IMPORTS;
  const maxReferences = options.maxReferences ?? DEFAULT_MAX_REFERENCES;
  if (maxFiles <= 0 || maxSymbols <= 0 || maxImports <= 0 || maxReferences <= 0)
    throw new Error("repository intelligence limits must be positive");

  const candidatePaths = [
    ...new Set(
      options.files
        .map((file) => safeRelativePath(options.root, file))
        .filter((file): file is string => Boolean(file))
        .filter(isIndexablePath),
    ),
  ].sort((left, right) => left.localeCompare(right));
  const selectedPaths = candidatePaths.slice(0, maxFiles);
  const indexedFiles: IndexedFile[] = [];
  for (const relativePath of selectedPaths) {
    throwIfAborted(options.signal);
    try {
      const content = (
        await readFile(path.join(options.root, relativePath), "utf8")
      ).slice(0, MAX_SOURCE_CHARS);
      indexedFiles.push({ path: relativePath, content });
    } catch {
      // Files can disappear or be binary between discovery and indexing.
    }
  }

  const symbols: RepositorySymbol[] = [];
  const imports: RepositoryImport[] = [];
  for (const file of indexedFiles) {
    throwIfAborted(options.signal);
    const lines = file.content.split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      if (isCommentOnly(line, extensionOf(file.path))) continue;
      if (symbols.length < maxSymbols) {
        const parsed = parseDeclaration(line, file.path, index + 1);
        if (parsed) symbols.push(parsed);
      }
      if (imports.length < maxImports) {
        const parsedImport = parseImports(line, file.path, index + 1);
        if (parsedImport) imports.push(parsedImport);
      }
    }
  }

  const knownFiles = new Set(indexedFiles.map((file) => file.path));
  for (const item of imports) {
    const resolvedPath = resolveImport(item.path, item.source, knownFiles);
    if (resolvedPath) item.resolvedPath = resolvedPath;
  }

  const symbolsByPathAndName = new Map<string, RepositorySymbol>();
  for (const symbol of symbols)
    symbolsByPathAndName.set(`${symbol.path}\0${symbol.name}`, symbol);
  const references: RepositoryReference[] = [];
  for (const item of imports) {
    if (references.length >= maxReferences) break;
    for (const name of item.names) {
      if (references.length >= maxReferences) break;
      const target = item.resolvedPath
        ? symbolsByPathAndName.get(`${item.resolvedPath}\0${name}`)
        : undefined;
      references.push({
        name,
        path: item.path,
        line: item.line,
        kind: "import",
        ...(target
          ? { targetPath: target.path }
          : item.resolvedPath
            ? { targetPath: item.resolvedPath }
            : {}),
      });
      if (!target || references.length >= maxReferences) continue;
      const importer = indexedFiles.find((file) => file.path === item.path);
      if (!importer) continue;
      const usagePattern = new RegExp(
        `\\b${name.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\b`,
        "gu",
      );
      for (const match of importer.content.matchAll(usagePattern)) {
        if (references.length >= maxReferences) break;
        const line = importer.content
          .slice(0, match.index ?? 0)
          .split("\n").length;
        if (line === item.line) continue;
        references.push({
          name,
          path: item.path,
          line,
          kind: "usage",
          targetPath: target.path,
        });
      }
    }
  }

  const resolvedImports = imports;
  const relatedTests = relatedTestPairs(indexedFiles, resolvedImports);
  return {
    indexedFiles: indexedFiles.map((file) => file.path),
    symbols,
    imports: resolvedImports,
    references,
    relatedTests,
    indexedAt: new Date().toISOString(),
    truncated: candidatePaths.length > selectedPaths.length,
  };
}

export function selectRelatedRepositoryEvidence(
  index: RepositoryIntelligence,
  objective: string,
  explicitPaths: readonly string[] = [],
): RepositoryIntelligenceSelection {
  const indexed = new Set(index.indexedFiles);
  const explicit = new Set(
    explicitPaths.map(normalizePath).filter((file) => indexed.has(file)),
  );
  const scores = new Map<string, number>();
  for (const file of index.indexedFiles) {
    const score = fileScore(file, objective, explicit, index.symbols);
    if (score > 0) scores.set(file, score);
  }

  const add = (file: string | undefined, score: number): void => {
    if (!file || !indexed.has(file)) return;
    scores.set(file, Math.max(scores.get(file) ?? 0, score));
  };
  for (const file of explicit) add(file, 1_000);
  for (const item of index.imports) {
    if (explicit.has(item.path)) add(item.resolvedPath, 700);
    if (item.resolvedPath && explicit.has(item.resolvedPath))
      add(item.path, 700);
  }
  for (const pair of index.relatedTests) {
    if (explicit.has(pair.sourcePath)) add(pair.testPath, 600);
    if (explicit.has(pair.testPath)) add(pair.sourcePath, 600);
  }

  const files = [...scores.entries()]
    .sort(
      (left, right) => right[1] - left[1] || left[0].localeCompare(right[0]),
    )
    .map(([file]) => file);
  const selected = new Set(files);
  return {
    files,
    symbols: index.symbols.filter((symbol) => selected.has(symbol.path)),
    imports: index.imports.filter((item) => selected.has(item.path)),
    references: index.references.filter((reference) =>
      selected.has(reference.path),
    ),
    relatedTests: index.relatedTests.filter(
      (pair) => selected.has(pair.sourcePath) || selected.has(pair.testPath),
    ),
    sourceIds: files,
  };
}
