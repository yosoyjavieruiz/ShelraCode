import type { ToolRisk } from "../../tools/types.js";

export type ActivityKind =
  | "read"
  | "search"
  | "edit"
  | "write"
  | "list"
  | "run"
  | "test"
  | "diff"
  | "status"
  | "tool";

export type ActivityState =
  "pending" | "running" | "success" | "failed" | "cancelled";

export interface ToolActivityViewModel {
  id: string;
  kind: ActivityKind;
  label: string;
  target: string;
  state: ActivityState;
  durationMs?: number;
  summary?: string;
  details?: string[];
  risk?: ToolRisk;
  // Last few lines of live output while `state === "running"` (Shell/
  // RunTests only — see AppEvent's "tool.output"). Cleared once the tool
  // finishes; `details`/`summary` take over as the permanent record.
  liveTail?: string[];
  // EditFile only — a real added/removed line diff computed from the tool
  // call's own oldText/newText input (see computeLineDiff, adapter.ts),
  // not a placeholder like "1 replacement". `diffLines` are prefixed
  // " "/"+"/"-" for the expanded view; `diff` is the +/− summary stat.
  diff?: { added: number; removed: number };
  diffLines?: string[];
  operation?:
    | "read"
    | "list"
    | "search"
    | "edit"
    | "create"
    | "overwrite"
    | "delete"
    | "execute";
  pathKind?: "file" | "directory" | "missing" | "unknown";
}

export interface RouteViewModel {
  source: "local" | "free";
  model: string;
  provider?: string;
  runtime?: string;
}

type TurnItem = { id: string; turnId: string };

export type TranscriptItem =
  | (TurnItem & { kind: "user-turn"; text: string })
  | (TurnItem & {
      kind: "model-progress";
      phase: "reasoning";
      chars: number;
      streaming: boolean;
    })
  | (TurnItem & {
      kind: "assistant-text";
      text: string;
      streaming: boolean;
    })
  | (TurnItem & {
      kind: "activity-group";
      label: string;
      activities: ToolActivityViewModel[];
      expanded: boolean;
    })
  | (TurnItem & {
      kind: "test-result";
      passed: number;
      failed: number;
      duration?: string;
      details: string[];
    })
  | (TurnItem & {
      kind: "route-event";
      route: RouteViewModel;
      previous?: RouteViewModel;
      reason?: string;
    })
  | (TurnItem & {
      kind: "plan-update";
      completed: number;
      total: number;
      steps: Array<{ label: string; state: ActivityState }>;
      expanded: boolean;
    })
  | (TurnItem & {
      kind: "file-change";
      path: string;
      additions: number;
      deletions: number;
      details?: string[];
    })
  | (TurnItem & {
      kind: "error-notice";
      title: string;
      detail?: string;
      recoverable: boolean;
    })
  | (TurnItem & {
      kind: "approval-request";
      description: string;
      risk: "external" | "write" | "destructive" | "unknown";
    })
  | (TurnItem & {
      kind: "completion-notice";
      title: "Done";
      summary?: string;
    });
