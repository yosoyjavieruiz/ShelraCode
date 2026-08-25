/** Machine-readable failures with an explicit recovery boundary. */
export type ToolErrorCode =
  | "INVALID_ARGUMENT"
  | "NOT_FOUND"
  | "PATH_NOT_FOUND"
  | "PATH_EXISTS"
  | "PATH_IS_FILE"
  | "PATH_IS_DIRECTORY"
  | "OUTSIDE_WORKSPACE"
  | "PERMISSION_DENIED"
  | "BINARY_FILE"
  | "OUTPUT_TRUNCATED"
  | "COMMAND_FAILED"
  | "COMMAND_TIMEOUT"
  | "TEST_FAILED"
  | "STALE_EDIT"
  | "CONFLICT"
  | "RUNTIME_UNAVAILABLE"
  | "MODEL_ERROR"
  | "CANCELLED";

export interface ToolErrorOptions {
  recoverable?: boolean;
  field?: string;
  path?: string;
  suggestedAction?: string;
  details?: Record<string, unknown>;
}

function defaultRecoverable(code: ToolErrorCode): boolean {
  return (
    code !== "OUTSIDE_WORKSPACE" &&
    code !== "PERMISSION_DENIED" &&
    code !== "PATH_EXISTS"
  );
}

export class ToolError extends Error {
  readonly code: ToolErrorCode;
  readonly recoverable: boolean;
  readonly field?: string;
  readonly path?: string;
  readonly suggestedAction?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ToolErrorCode,
    message: string,
    options: ToolErrorOptions = {},
  ) {
    super(message);
    this.name = "ToolError";
    this.code = code;
    this.recoverable = options.recoverable ?? defaultRecoverable(code);
    this.field = options.field;
    this.path = options.path;
    this.suggestedAction = options.suggestedAction;
    this.details = options.details;
  }
}

export interface ToolErrorDetails {
  code: ToolErrorCode;
  message: string;
  recoverable: boolean;
  field?: string;
  path?: string;
  suggestedAction?: string;
  details?: Record<string, unknown>;
}

export function toolErrorCode(error: unknown): ToolErrorCode | undefined {
  return error instanceof ToolError ? error.code : undefined;
}

export function toolErrorDetails(error: unknown): ToolErrorDetails | undefined {
  if (!(error instanceof ToolError)) return undefined;
  return {
    code: error.code,
    message: error.message,
    recoverable: error.recoverable,
    ...(error.field === undefined ? {} : { field: error.field }),
    ...(error.path === undefined ? {} : { path: error.path }),
    ...(error.suggestedAction === undefined
      ? {}
      : { suggestedAction: error.suggestedAction }),
    ...(error.details === undefined ? {} : { details: error.details }),
  };
}
