import type { CheckpointService } from "../checkpoint/checkpoint.js";
import type { ProcessOutputChunk } from "../shared/process.js";
import type { LocalCodeLogger } from "../shared/logging.js";
import type { PermissionMode } from "../shared/types.js";
import type { ToolErrorCode } from "./errors.js";

export type ToolRisk = "read" | "write" | "execute" | "destructive";

export interface JsonSchemaProperty {
  type: "string" | "number" | "boolean" | "object" | "array";
  description?: string;
  enum?: readonly string[];
}

/** JSON Schema for a tool's arguments, sent to the model as the function's
 * `parameters` so it knows the real argument shape instead of an opaque
 * empty object. */
export interface ToolParameterSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolApprovalRequest {
  description: string;
  risk: ToolRisk;
}

export interface ToolExecutionContext {
  root: string;
  permissionMode: PermissionMode;
  signal: AbortSignal;
  network?: boolean;
  checkpoint?: CheckpointService;
  checkpointId?: string;
  env?: Record<string, string | undefined>;
  requestApproval?: (request: ToolApprovalRequest) => Promise<boolean>;
  /**
   * Optional live-output sink for long-running tools (Shell, RunTests) —
   * the host UI's live shell/test tail. Set per call by the loop, not part
   * of the base execution context; a tool that ignores it behaves exactly
   * as before.
   */
  onOutput?: (chunk: ProcessOutputChunk) => void;
  /** Structured tool/process lifecycle logging. */
  logger?: LocalCodeLogger;
}

export interface ToolDefinition<I, O> {
  name: string;
  description: string;
  risk: ToolRisk;
  parameters: ToolParameterSchema;
  validate(input: unknown): I;
  execute(input: I, ctx: ToolExecutionContext): Promise<O>;
}

export interface ToolResult<O = unknown> {
  tool: string;
  ok: boolean;
  output?: O;
  error?: string;
  /** Structured failure reason, set only when `error` came from a
   * `ToolError` (see tools/errors.ts). Lets the model — and any future
   * recovery logic — distinguish "wrong tool/argument, fix and retry" from
   * an opaque failure, instead of pattern-matching free-text messages. */
  code?: ToolErrorCode;
  recoverable?: boolean;
  field?: string;
  path?: string;
  suggestedAction?: string;
  details?: Record<string, unknown>;
  durationMs: number;
}
