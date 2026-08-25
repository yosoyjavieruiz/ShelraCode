import type { AgentPhase } from "../agent/task-state.js";
import type { ToolResult } from "../tools/types.js";
import type { ToolRisk } from "../tools/types.js";
import type { QuotaSnapshot, RouteDecision } from "./types.js";

export type AppEvent =
  | { type: "assistant.delta"; text: string }
  | { type: "phase.changed"; phase: AgentPhase }
  | {
      type: "tool.output";
      callId: string;
      tool: string;
      stream: "stdout" | "stderr";
      text: string;
    }
  | {
      type: "verification.started";
      id: string;
      stage?: string;
      command: string;
    }
  | {
      type: "plan.changed";
      steps: Array<{
        id: string;
        description: string;
        status: "pending" | "active" | "done" | "failed" | "skipped";
      }>;
    }
  | {
      type: "tool.started";
      callId: string;
      tool: string;
      input: unknown;
      risk?: ToolRisk;
    }
  | {
      type: "tool.finished";
      callId: string;
      tool: string;
      result: ToolResult;
    }
  | {
      type: "verification.finished";
      stage?: string;
      command?: string;
      exitCode: number;
      output: string;
    }
  | { type: "route.selected"; decision: RouteDecision; reason?: string }
  | { type: "route.failed"; error: string; detail?: string }
  | { type: "quota.updated"; quota: QuotaSnapshot }
  | { type: "checkpoint.created"; id: string }
  | { type: "approval.requested"; description: string }
  | { type: "task.completed"; result: unknown }
  | { type: "task.blocked"; error: string; detail?: string }
  | { type: "task.cancelled"; error: string; detail?: string }
  | { type: "task.failed"; error: string; detail?: string };

export type AppEventListener = (event: AppEvent) => void;

export class AppEventBus {
  private readonly listeners = new Set<AppEventListener>();

  subscribe(listener: AppEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event: AppEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
