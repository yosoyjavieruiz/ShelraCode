import path from "node:path";
import { isNeverRemotePath, normalizePath } from "../privacy/policy.js";
import type {
  RelatedRepositoryTest,
  RepositoryImport,
  RepositoryIntelligence,
  RepositoryReference,
  RepositorySymbol,
} from "./repository-intelligence.js";

export type RepositoryQuerySource = "deterministic" | "language-provider";

export interface RepositorySymbolQuery {
  name: string;
  path?: string;
  maxResults?: number;
}

export interface RepositoryPathQuery {
  path: string;
  maxResults?: number;
}

export interface RepositoryDiagnosticsQuery {
  path?: string;
  maxResults?: number;
}

export interface RepositoryDefinition extends RepositorySymbol {
  source: RepositoryQuerySource;
}

export interface RepositoryReferenceResult extends RepositoryReference {
  source: RepositoryQuerySource;
}

export interface RepositoryDependencyResult {
  path: string;
  importSource: string;
  line: number;
  names: string[];
  resolvedPath?: string;
  direction: "dependency" | "dependent";
  source: RepositoryQuerySource;
}

export interface RepositoryTestResult extends RelatedRepositoryTest {
  source: RepositoryQuerySource;
}

export interface RepositoryDiagnostic {
  path: string;
  line?: number;
  column?: number;
  severity: "error" | "warning" | "info";
  message: string;
  source: RepositoryQuerySource;
}

export interface RepositoryQueryResult<T> {
  items: T[];
  source: RepositoryQuerySource;
  degraded: boolean;
  warning?: string;
}

/**
 * Optional language-service boundary. Implementations return normalized
 * repository facts, never provider-specific objects. A provider can support
 * only the operations it can prove; unsupported operations use the
 * deterministic index fallback.
 */
export interface RepositoryLanguageProvider {
  findDefinition?: (
    query: RepositorySymbolQuery,
    signal?: AbortSignal,
  ) => Promise<readonly RepositorySymbol[]>;
  findReferences?: (
    query: RepositorySymbolQuery,
    signal?: AbortSignal,
  ) => Promise<readonly RepositoryReference[]>;
  findImplementations?: (
    query: RepositorySymbolQuery,
    signal?: AbortSignal,
  ) => Promise<readonly RepositorySymbol[]>;
  findCallers?: (
    query: RepositorySymbolQuery,
    signal?: AbortSignal,
  ) => Promise<readonly RepositoryReference[]>;
  findDependencies?: (
    query: RepositoryPathQuery,
    signal?: AbortSignal,
  ) => Promise<readonly RepositoryImport[]>;
  findDependents?: (
    query: RepositoryPathQuery,
    signal?: AbortSignal,
  ) => Promise<readonly RepositoryImport[]>;
  getDiagnostics?: (
    query: RepositoryDiagnosticsQuery,
    signal?: AbortSignal,
  ) => Promise<readonly Omit<RepositoryDiagnostic, "source">[]>;
}

export interface RepositoryQueryServiceOptions {
  index: RepositoryIntelligence;
  provider?: RepositoryLanguageProvider;
  signal?: AbortSignal;
}

export class RepositoryQueryInputError extends Error {
  readonly code = "INVALID_REPOSITORY_QUERY" as const;

  constructor(message: string) {
    super(message);
    this.name = "RepositoryQueryInputError";
  }
}

const DEFAULT_MAX_RESULTS = 64;
const MAX_RESULTS = 256;

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new DOMException("Repository query aborted", "AbortError");
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function maxResults(value: number | undefined): number {
  const result = value ?? DEFAULT_MAX_RESULTS;
  if (!Number.isInteger(result) || result <= 0 || result > MAX_RESULTS)
    throw new RepositoryQueryInputError(
      `maxResults must be an integer between 1 and ${MAX_RESULTS}.`,
    );
  return result;
}

function requiredName(value: string): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new RepositoryQueryInputError("A symbol name is required.");
  return value.trim();
}

function relativePath(value: string, field = "path"): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new RepositoryQueryInputError(`${field} is required.`);
  const normalized = normalizePath(value.trim());
  if (
    !normalized ||
    normalized === "." ||
    path.isAbsolute(normalized) ||
    normalized.split("/").includes("..") ||
    normalized.includes(":") ||
    /[\u0000-\u001F\u007F]/u.test(normalized) ||
    isNeverRemotePath(normalized)
  )
    throw new RepositoryQueryInputError(
      `${field} must be a safe repository path.`,
    );
  return normalized;
}

function symbolQuery(query: RepositorySymbolQuery): {
  name: string;
  path?: string;
  limit: number;
} {
  return {
    name: requiredName(query.name),
    ...(query.path === undefined ? {} : { path: relativePath(query.path) }),
    limit: maxResults(query.maxResults),
  };
}

function pathQuery(query: RepositoryPathQuery): {
  path: string;
  limit: number;
} {
  return {
    path: relativePath(query.path),
    limit: maxResults(query.maxResults),
  };
}

function diagnosticsQuery(query: RepositoryDiagnosticsQuery): {
  path?: string;
  limit: number;
} {
  return {
    ...(query.path === undefined ? {} : { path: relativePath(query.path) }),
    limit: maxResults(query.maxResults),
  };
}

function bounded<T>(items: readonly T[], limit: number): T[] {
  return [...items].slice(0, limit);
}

const REPOSITORY_SYMBOL_KINDS = new Set<RepositorySymbol["kind"]>([
  "class",
  "function",
  "interface",
  "type",
  "constant",
  "method",
  "module",
]);

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("provider returned a non-record repository fact");
  return value as Record<string, unknown>;
}

function providerText(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (typeof value !== "string" || value.trim().length === 0)
    throw new Error(`provider returned an invalid ${field}`);
  const result = value.trim();
  if (
    result.length > maxLength ||
    /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(result)
  )
    throw new Error(`provider returned an invalid ${field}`);
  return result;
}

function providerLine(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1)
    throw new Error(`provider returned an invalid ${field}`);
  return value;
}

function providerPath(value: unknown, field = "path"): string {
  if (typeof value !== "string")
    throw new Error(`provider returned an invalid ${field}`);
  try {
    return relativePath(value, field);
  } catch {
    throw new Error(`provider returned an invalid ${field}`);
  }
}

function optionalProviderPath(
  value: unknown,
  field: string,
): string | undefined {
  return value === undefined ? undefined : providerPath(value, field);
}

function normalizeProviderSymbol(value: unknown): RepositorySymbol {
  const item = record(value);
  const kind = item.kind;
  if (
    typeof kind !== "string" ||
    !REPOSITORY_SYMBOL_KINDS.has(kind as RepositorySymbol["kind"])
  )
    throw new Error("provider returned an invalid symbol kind");
  const signature =
    item.signature === undefined
      ? undefined
      : providerText(item.signature, "signature", 240);
  return {
    name: providerText(item.name, "symbol name", 256),
    path: providerPath(item.path),
    kind: kind as RepositorySymbol["kind"],
    line: providerLine(item.line, "symbol line"),
    exported:
      typeof item.exported === "boolean"
        ? item.exported
        : (() => {
            throw new Error("provider returned an invalid exported flag");
          })(),
    ...(signature === undefined ? {} : { signature }),
  };
}

function normalizeProviderReference(value: unknown): RepositoryReference {
  const item = record(value);
  if (item.kind !== "import" && item.kind !== "usage")
    throw new Error("provider returned an invalid reference kind");
  const targetPath = optionalProviderPath(item.targetPath, "targetPath");
  return {
    name: providerText(item.name, "reference name", 256),
    path: providerPath(item.path),
    line: providerLine(item.line, "reference line"),
    kind: item.kind,
    ...(targetPath === undefined ? {} : { targetPath }),
  };
}

function normalizeProviderImport(value: unknown): RepositoryImport {
  const item = record(value);
  if (!Array.isArray(item.names) || item.names.length > 128)
    throw new Error("provider returned invalid import names");
  const names = item.names.map((name) =>
    providerText(name, "import name", 256),
  );
  const resolvedPath = optionalProviderPath(item.resolvedPath, "resolvedPath");
  return {
    path: providerPath(item.path),
    source: providerText(item.source, "import source", 512),
    line: providerLine(item.line, "import line"),
    names,
    ...(resolvedPath === undefined ? {} : { resolvedPath }),
  };
}

function normalizeProviderDiagnostic(
  value: unknown,
): Omit<RepositoryDiagnostic, "source"> {
  const item = record(value);
  const severity = item.severity;
  if (severity !== "error" && severity !== "warning" && severity !== "info")
    throw new Error("provider returned an invalid diagnostic severity");
  const column =
    item.column === undefined
      ? undefined
      : providerLine(item.column, "diagnostic column");
  const line =
    item.line === undefined
      ? undefined
      : providerLine(item.line, "diagnostic line");
  return {
    path: providerPath(item.path),
    ...(line === undefined ? {} : { line }),
    ...(column === undefined ? {} : { column }),
    severity,
    message: providerText(item.message, "diagnostic message", 4_096),
  };
}

function definitionResult(
  symbol: RepositorySymbol,
  source: RepositoryQuerySource,
): RepositoryDefinition {
  return {
    name: symbol.name,
    path: symbol.path,
    kind: symbol.kind,
    line: symbol.line,
    exported: symbol.exported,
    ...(symbol.signature === undefined ? {} : { signature: symbol.signature }),
    source,
  };
}

function referenceResult(
  reference: RepositoryReference,
  source: RepositoryQuerySource,
): RepositoryReferenceResult {
  return {
    name: reference.name,
    path: reference.path,
    line: reference.line,
    kind: reference.kind,
    ...(reference.targetPath === undefined
      ? {}
      : { targetPath: reference.targetPath }),
    source,
  };
}

function dependencyResult(
  item: RepositoryImport,
  direction: "dependency" | "dependent",
  source: RepositoryQuerySource,
): RepositoryDependencyResult {
  return {
    path: item.path,
    importSource: item.source,
    line: item.line,
    names: [...item.names],
    ...(item.resolvedPath === undefined
      ? {}
      : { resolvedPath: item.resolvedPath }),
    direction,
    source: source,
  };
}

function testResult(
  item: RelatedRepositoryTest,
  source: RepositoryQuerySource,
): RepositoryTestResult {
  return {
    sourcePath: item.sourcePath,
    testPath: item.testPath,
    score: item.score,
    source,
  };
}

function diagnosticResult(
  item: Omit<RepositoryDiagnostic, "source">,
  source: RepositoryQuerySource,
): RepositoryDiagnostic {
  return {
    path: item.path,
    ...(item.line === undefined ? {} : { line: item.line }),
    ...(item.column === undefined ? {} : { column: item.column }),
    severity: item.severity,
    message: item.message,
    source,
  };
}

interface CombinedSignal {
  signal: AbortSignal | undefined;
  dispose: () => void;
}

function combineSignals(
  first: AbortSignal | undefined,
  second: AbortSignal | undefined,
): CombinedSignal {
  const signals = [
    ...new Set([first, second].filter(Boolean)),
  ] as AbortSignal[];
  if (signals.length === 0) return { signal: undefined, dispose: () => {} };
  if (signals.length === 1) return { signal: signals[0], dispose: () => {} };
  const controller = new AbortController();
  const onAbort = (): void => {
    if (!controller.signal.aborted) controller.abort();
  };
  for (const signal of signals) {
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    dispose: () => {
      for (const signal of signals)
        signal.removeEventListener("abort", onAbort);
    },
  };
}

export class RepositoryQueryService {
  private readonly index: RepositoryIntelligence;
  private readonly provider: RepositoryLanguageProvider | undefined;
  private readonly signal: AbortSignal | undefined;

  constructor(options: RepositoryQueryServiceOptions) {
    this.index = options.index;
    this.provider = options.provider;
    this.signal = options.signal;
  }

  private async providerOrFallback<TProvider, TResult>(
    operation: string,
    invoke:
      ((signal?: AbortSignal) => Promise<readonly TProvider[]>) | undefined,
    fallback: () => readonly TResult[],
    mapProvider: (items: readonly TProvider[]) => TResult[],
    limit: number,
    signal?: AbortSignal,
  ): Promise<RepositoryQueryResult<TResult>> {
    const combined = combineSignals(this.signal, signal);
    try {
      throwIfAborted(combined.signal);
      if (!invoke)
        return {
          items: bounded(fallback(), limit),
          source: "deterministic",
          degraded: false,
        };
      const values = await invoke(combined.signal);
      throwIfAborted(combined.signal);
      return {
        items: bounded(mapProvider(values), limit),
        source: "language-provider",
        degraded: false,
      };
    } catch (error) {
      if (combined.signal?.aborted) throwIfAborted(combined.signal);
      if (isAbortError(error)) throw error;
      return {
        items: bounded(fallback(), limit),
        source: "deterministic",
        degraded: true,
        warning: `Language provider failed for ${operation}; deterministic repository facts were used.`,
      };
    } finally {
      combined.dispose();
    }
  }

  private deterministicSymbols(query: {
    name: string;
    path?: string;
  }): RepositorySymbol[] {
    return this.index.symbols.filter(
      (symbol) =>
        symbol.name === query.name &&
        (query.path === undefined || symbol.path === query.path),
    );
  }

  findSymbol(
    query: RepositorySymbolQuery,
  ): RepositoryQueryResult<RepositorySymbol> {
    const normalized = symbolQuery(query);
    return {
      items: bounded(this.deterministicSymbols(normalized), normalized.limit),
      source: "deterministic",
      degraded: false,
    };
  }

  async findDefinition(
    query: RepositorySymbolQuery,
    signal?: AbortSignal,
  ): Promise<RepositoryQueryResult<RepositoryDefinition>> {
    const normalized = symbolQuery(query);
    const fallback = (): RepositoryDefinition[] =>
      bounded(
        this.deterministicSymbols(normalized).map((symbol) =>
          definitionResult(symbol, "deterministic"),
        ),
        normalized.limit,
      );
    return this.providerOrFallback(
      "findDefinition",
      this.provider?.findDefinition
        ? (providerSignal) =>
            this.provider!.findDefinition!(
              {
                name: normalized.name,
                ...(normalized.path ? { path: normalized.path } : {}),
                maxResults: normalized.limit,
              },
              providerSignal,
            )
        : undefined,
      fallback,
      (items) =>
        items.map((item) =>
          definitionResult(normalizeProviderSymbol(item), "language-provider"),
        ),
      normalized.limit,
      signal,
    );
  }

  async findReferences(
    query: RepositorySymbolQuery,
    signal?: AbortSignal,
  ): Promise<RepositoryQueryResult<RepositoryReferenceResult>> {
    const normalized = symbolQuery(query);
    const fallback = (): RepositoryReferenceResult[] => {
      const matches = this.index.references.filter(
        (reference) =>
          reference.name === normalized.name &&
          (normalized.path === undefined ||
            reference.targetPath === normalized.path ||
            reference.path === normalized.path),
      );
      return matches.map((reference) =>
        referenceResult(reference, "deterministic"),
      );
    };
    return this.providerOrFallback(
      "findReferences",
      this.provider?.findReferences
        ? (providerSignal) =>
            this.provider!.findReferences!(
              {
                name: normalized.name,
                ...(normalized.path ? { path: normalized.path } : {}),
                maxResults: normalized.limit,
              },
              providerSignal,
            )
        : undefined,
      fallback,
      (items) =>
        items.map((item) =>
          referenceResult(
            normalizeProviderReference(item),
            "language-provider",
          ),
        ),
      normalized.limit,
      signal,
    );
  }

  async findImplementations(
    query: RepositorySymbolQuery,
    signal?: AbortSignal,
  ): Promise<RepositoryQueryResult<RepositoryDefinition>> {
    const normalized = symbolQuery(query);
    return this.providerOrFallback(
      "findImplementations",
      this.provider?.findImplementations
        ? (providerSignal) =>
            this.provider!.findImplementations!(
              {
                name: normalized.name,
                ...(normalized.path ? { path: normalized.path } : {}),
                maxResults: normalized.limit,
              },
              providerSignal,
            )
        : undefined,
      () => [],
      (items) =>
        items.map((item) =>
          definitionResult(normalizeProviderSymbol(item), "language-provider"),
        ),
      normalized.limit,
      signal,
    ).then((result) =>
      result.items.length === 0 && !result.warning
        ? {
            ...result,
            degraded: !this.provider?.findImplementations,
            ...(this.provider?.findImplementations
              ? {}
              : {
                  warning:
                    "No language provider exposes implementation relations.",
                }),
          }
        : result,
    );
  }

  async findCallers(
    query: RepositorySymbolQuery,
    signal?: AbortSignal,
  ): Promise<RepositoryQueryResult<RepositoryReferenceResult>> {
    const normalized = symbolQuery(query);
    const fallback = (): RepositoryReferenceResult[] =>
      this.index.references
        .filter(
          (reference) =>
            reference.kind === "usage" &&
            reference.name === normalized.name &&
            (normalized.path === undefined ||
              reference.targetPath === normalized.path),
        )
        .map((reference) => referenceResult(reference, "deterministic"));
    return this.providerOrFallback(
      "findCallers",
      this.provider?.findCallers
        ? (providerSignal) =>
            this.provider!.findCallers!(
              {
                name: normalized.name,
                ...(normalized.path ? { path: normalized.path } : {}),
                maxResults: normalized.limit,
              },
              providerSignal,
            )
        : undefined,
      fallback,
      (items) =>
        items.map((item) =>
          referenceResult(
            normalizeProviderReference(item),
            "language-provider",
          ),
        ),
      normalized.limit,
      signal,
    );
  }

  async findDependencies(
    query: RepositoryPathQuery,
    signal?: AbortSignal,
  ): Promise<RepositoryQueryResult<RepositoryDependencyResult>> {
    const normalized = pathQuery(query);
    const fallback = (): RepositoryDependencyResult[] =>
      this.index.imports
        .filter((item) => item.path === normalized.path)
        .map((item) => dependencyResult(item, "dependency", "deterministic"));
    return this.providerOrFallback(
      "findDependencies",
      this.provider?.findDependencies
        ? (providerSignal) =>
            this.provider!.findDependencies!(
              { path: normalized.path, maxResults: normalized.limit },
              providerSignal,
            )
        : undefined,
      fallback,
      (items) =>
        items.map((item) =>
          dependencyResult(
            normalizeProviderImport(item),
            "dependency",
            "language-provider",
          ),
        ),
      normalized.limit,
      signal,
    );
  }

  async findDependents(
    query: RepositoryPathQuery,
    signal?: AbortSignal,
  ): Promise<RepositoryQueryResult<RepositoryDependencyResult>> {
    const normalized = pathQuery(query);
    const fallback = (): RepositoryDependencyResult[] =>
      this.index.imports
        .filter((item) => item.resolvedPath === normalized.path)
        .map((item) => dependencyResult(item, "dependent", "deterministic"));
    return this.providerOrFallback(
      "findDependents",
      this.provider?.findDependents
        ? (providerSignal) =>
            this.provider!.findDependents!(
              { path: normalized.path, maxResults: normalized.limit },
              providerSignal,
            )
        : undefined,
      fallback,
      (items) =>
        items.map((item) =>
          dependencyResult(
            normalizeProviderImport(item),
            "dependent",
            "language-provider",
          ),
        ),
      normalized.limit,
      signal,
    );
  }

  async findRelatedTests(
    query: RepositoryPathQuery,
  ): Promise<RepositoryQueryResult<RepositoryTestResult>> {
    const normalized = pathQuery(query);
    const items = this.index.relatedTests.filter(
      (pair) =>
        pair.sourcePath === normalized.path ||
        pair.testPath === normalized.path,
    );
    return {
      items: bounded(
        items.map((item) => testResult(item, "deterministic")),
        normalized.limit,
      ),
      source: "deterministic",
      degraded: false,
    };
  }

  async getDiagnostics(
    query: RepositoryDiagnosticsQuery = {},
    signal?: AbortSignal,
  ): Promise<RepositoryQueryResult<RepositoryDiagnostic>> {
    const normalized = diagnosticsQuery(query);
    return this.providerOrFallback(
      "getDiagnostics",
      this.provider?.getDiagnostics
        ? (providerSignal) =>
            this.provider!.getDiagnostics!(
              {
                ...(normalized.path ? { path: normalized.path } : {}),
                maxResults: normalized.limit,
              },
              providerSignal,
            )
        : undefined,
      () => [],
      (items) =>
        items.map((item) =>
          diagnosticResult(
            normalizeProviderDiagnostic(item),
            "language-provider",
          ),
        ),
      normalized.limit,
      signal,
    ).then((result) =>
      result.items.length === 0 && !result.warning
        ? {
            ...result,
            degraded: !this.provider?.getDiagnostics,
            ...(this.provider?.getDiagnostics
              ? {}
              : { warning: "No language provider exposes diagnostics." }),
          }
        : result,
    );
  }
}
