import type { AgentPhase } from "../../agent/task-state.js";
import type { AppEvent } from "../../shared/events.js";
import type { ModelCandidate } from "../../shared/types.js";
import type { ToolResult } from "../../tools/types.js";
import type {
  ActivityKind,
  ActivityState,
  RouteViewModel,
  ToolActivityViewModel,
  TranscriptItem,
} from "./types.js";

export interface TranscriptPresentation {
  items: TranscriptItem[];
  activeTurnId?: string;
  currentRoute?: RouteViewModel;
  // The loop's current abstract phase (see AgentPhase, task-state.ts) while
  // a task is running and hasn't produced concrete tool activity yet — the
  // signal AgentMatrixPulse renders. Cleared once the turn ends so a stale
  // phase from a previous task never lingers into the next idle state.
  agentPhase?: AgentPhase;
  // The host-driven verification stage (independent of any model tool
  // call) currently running a planned command — the live shell/test tail
  // for it, since (unlike a model-invoked RunTests call) it has no
  // activity-group entry of its own. Cleared by verification.finished.
  runningVerification?: { id: string; command: string; tail: string[] };
}

// Kept short on purpose (spec: "limit to a small number of lines, do NOT
// turn chat into a terminal log") — this is a live preview, not a pager.
const LIVE_TAIL_MAX_LINES = 6;

function appendLiveTail(
  existing: string[] | undefined,
  text: string,
): string[] {
  const incoming = text.split(/\r?\n/).filter((line) => line.length > 0);
  const combined = [...(existing ?? []), ...incoming];
  return combined.slice(-LIVE_TAIL_MAX_LINES);
}

// Phases that represent the model still "thinking" in the abstract, before
// or between concrete tool calls — the only phases AgentMatrixPulse should
// ever be shown for. "act" is deliberately excluded: it fires immediately
// before a tool.started event, so showing it would flash the matrix for a
// single tick right before the real activity indicator takes over.
const ABSTRACT_PHASES = new Set<AgentPhase>([
  "frame",
  "discover",
  "analyze",
  "plan",
  "observe",
  "reflect",
  "verify",
  "review",
]);

export function isAbstractAgentPhase(phase: AgentPhase | undefined): boolean {
  return phase !== undefined && ABSTRACT_PHASES.has(phase);
}

export function createTranscriptPresentation(): TranscriptPresentation {
  return { items: [] };
}

export function beginTranscriptTurn(
  state: TranscriptPresentation,
  input: { turnId: string; text: string },
): TranscriptPresentation {
  return {
    ...state,
    activeTurnId: input.turnId,
    items: [
      ...state.items,
      {
        kind: "user-turn",
        id: `user-${input.turnId}`,
        turnId: input.turnId,
        text: input.text,
      },
    ],
  };
}

function currentTurnId(state: TranscriptPresentation): string {
  return state.activeTurnId ?? "system";
}

function nextId(
  state: TranscriptPresentation,
  turnId: string,
  kind: TranscriptItem["kind"],
): string {
  const count = state.items.filter(
    (item) => item.turnId === turnId && item.kind === kind,
  ).length;
  return `${turnId}-${kind}-${count + 1}`;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringField(value: unknown, key: string): string | undefined {
  const candidate = record(value)?.[key];
  return typeof candidate === "string" && candidate ? candidate : undefined;
}

function activityMetadata(tool: string, input: unknown) {
  const fields = record(input);
  const path =
    stringField(fields, "path") ??
    stringField(fields, "filePath") ??
    stringField(fields, "file");
  const definitions: Record<
    string,
    { kind: ActivityKind; label: string; target?: string }
  > = {
    ReadFile: { kind: "read", label: "READ", target: path },
    SearchText: {
      kind: "search",
      label: "SEARCH",
      target: stringField(fields, "query") ?? stringField(fields, "pattern"),
    },
    EditFile: { kind: "edit", label: "EDIT", target: path },
    WriteFile: { kind: "write", label: "WRITE", target: path },
    ListFiles: { kind: "list", label: "LIST", target: path ?? "." },
    Shell: {
      kind: "run",
      label: "RUN",
      target: stringField(fields, "command"),
    },
    RunTests: {
      kind: "test",
      label: "TEST",
      target: stringField(fields, "command") ?? "test suite",
    },
    GitDiff: { kind: "diff", label: "DIFF", target: "working tree" },
    GitStatus: { kind: "status", label: "STATUS", target: "working tree" },
  };
  const definition = definitions[tool] ?? {
    kind: "tool" as const,
    label: tool.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase(),
  };
  return {
    kind: definition.kind,
    label: definition.label,
    target: definition.target ?? tool,
  };
}

function countLines(content: string): number {
  if (!content) return 0;
  const normalized = content.split("\r\n").join("\n");
  const withoutTrailingNewline = normalized.endsWith("\n")
    ? normalized.slice(0, -1)
    : normalized;
  return withoutTrailingNewline ? withoutTrailingNewline.split("\n").length : 0;
}

function resultPresentation(result: ToolResult): {
  summary?: string;
  details?: string[];
} {
  const output = record(result.output);
  if (!result.ok) {
    return {
      summary: result.error ?? "Failed",
      details: result.error ? [result.error] : undefined,
    };
  }
  if (result.tool === "ReadFile") {
    const content = stringField(output, "content") ?? "";
    const lines = countLines(content);
    return {
      summary: `${lines} ${lines === 1 ? "line" : "lines"}`,
      details: [
        `${lines} ${lines === 1 ? "line" : "lines"} read${record(output)?.truncated === true ? " · truncated" : ""}`,
      ],
    };
  }
  if (result.tool === "SearchText") {
    const matches = record(output)?.matches;
    const count = Array.isArray(matches) ? matches.length : 0;
    const details = Array.isArray(matches)
      ? matches.slice(0, 20).flatMap((value) => {
          if (typeof value === "string") return [value];
          const fields = record(value);
          const path = stringField(fields, "path");
          const line = fields?.line;
          const column = fields?.column;
          const preview = stringField(fields, "preview");
          if (!path || typeof line !== "number") return [];
          const location = `${path}:${line}${typeof column === "number" ? `:${column}` : ""}`;
          return [preview ? `${location} ${preview}` : location];
        })
      : undefined;
    return {
      summary: `${count} ${count === 1 ? "match" : "matches"}`,
      details,
    };
  }
  if (result.tool === "EditFile") {
    const replacements = record(output)?.replacements;
    return typeof replacements === "number"
      ? {
          summary: `${replacements} ${replacements === 1 ? "replacement" : "replacements"}`,
        }
      : {};
  }
  if (result.tool === "WriteFile") {
    const bytes = record(output)?.bytes;
    return typeof bytes === "number" ? { summary: `${bytes} bytes` } : {};
  }
  if (result.tool === "ListFiles") {
    const files = record(output)?.files;
    const count = Array.isArray(files) ? files.length : 0;
    return { summary: `${count} ${count === 1 ? "file" : "files"}` };
  }
  if (result.tool === "RunTests" || result.tool === "Shell") {
    const exitCode = record(output)?.exitCode;
    const commandOutput =
      stringField(output, "output") ??
      [stringField(output, "stdout"), stringField(output, "stderr")]
        .filter(Boolean)
        .join("");
    const counts =
      result.tool === "RunTests" ? testCounts(commandOutput) : undefined;
    return {
      summary:
        counts && (counts.passed > 0 || counts.failed > 0)
          ? `${counts.passed} passed${counts.failed ? ` · ${counts.failed} failed` : ""}`
          : typeof exitCode === "number"
            ? `exit ${exitCode}`
            : undefined,
      details: commandOutput
        ? commandOutput.split(/\r?\n/).filter(Boolean).slice(0, 40)
        : undefined,
    };
  }
  return {};
}

// A real added/removed line diff for EditFile, computed from the tool
// call's own input — oldText/newText are already the exact snippet being
// swapped (see editFileTool, tools/workspace.ts), so no extra file read is
// needed to render this. Classic O(len(old)×len(new)) LCS diff; guarded
// against pathological input sizes since this is a convenience view for a
// typical small edit, not a `git diff` replacement.
function splitLines(text: string): string[] {
  // A trailing newline is a line *terminator*, not an extra blank line — a
  // naive split would otherwise diff a stray trailing "" element whenever
  // both sides happen to end in "\n" (the common case), showing a spurious
  // blank context line at the end of every clean edit. An empty string is
  // zero lines, not one.
  if (text === "") return [];
  const normalized = text.replace(/\r\n/g, "\n");
  const withoutTrailingNewline = normalized.endsWith("\n")
    ? normalized.slice(0, -1)
    : normalized;
  return withoutTrailingNewline.split("\n");
}

function computeLineDiff(
  oldText: string,
  newText: string,
): { added: number; removed: number; lines: string[] } | undefined {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  if (oldLines.length * newLines.length > 200_000) return undefined;
  const m = oldLines.length;
  const n = newLines.length;
  const lcs: number[][] = Array.from({ length: m + 1 }, () =>
    new Array<number>(n + 1).fill(0),
  );
  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      const row = lcs[i]!;
      const nextRow = lcs[i + 1]!;
      row[j] =
        oldLines[i] === newLines[j]
          ? (nextRow[j + 1] ?? 0) + 1
          : Math.max(nextRow[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const lines: string[] = [];
  let added = 0;
  let removed = 0;
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (oldLines[i] === newLines[j]) {
      lines.push(`  ${oldLines[i]}`);
      i += 1;
      j += 1;
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      lines.push(`- ${oldLines[i]}`);
      removed += 1;
      i += 1;
    } else {
      lines.push(`+ ${newLines[j]}`);
      added += 1;
      j += 1;
    }
  }
  while (i < m) {
    lines.push(`- ${oldLines[i]}`);
    removed += 1;
    i += 1;
  }
  while (j < n) {
    lines.push(`+ ${newLines[j]}`);
    added += 1;
    j += 1;
  }
  return { added, removed, lines: lines.slice(0, 40) };
}

const PLAN_STEP_STATE: Record<
  "pending" | "active" | "done" | "failed" | "skipped",
  ActivityState
> = {
  pending: "pending",
  active: "running",
  done: "success",
  failed: "failed",
  skipped: "cancelled",
};

function activityGroupLabel(
  activities: readonly ToolActivityViewModel[],
): string {
  const kinds = new Set(activities.map((activity) => activity.kind));
  if (kinds.size === 1) {
    const kind = activities[0]?.kind;
    if (kind === "read") return "READ";
    if (kind === "search") return "SEARCH";
    if (kind === "edit") return "EDIT";
    if (kind === "write") return "WRITE";
    if (kind === "run") return "RUN";
    if (kind === "test") return "TEST";
  }
  const mutates = kinds.has("edit") || kinds.has("write");
  const verifies = kinds.has("test") || kinds.has("run");
  if (mutates && verifies) return "Updating and verifying changes";
  if (mutates) return "Updating files";
  if (verifies) return "Running verification";
  return "Inspecting repository";
}

function humanProvider(providerId: string): string {
  const known: Record<string, string> = {
    groq: "Groq",
    openrouter: "OpenRouter",
  };
  return (
    known[providerId] ??
    providerId
      .split("-")
      .filter(Boolean)
      .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
      .join(" ")
  );
}

function routesEqual(left: RouteViewModel, right: RouteViewModel): boolean {
  return (
    left.source === right.source &&
    left.model === right.model &&
    left.provider === right.provider &&
    left.runtime === right.runtime
  );
}

function routeView(candidate: ModelCandidate): RouteViewModel {
  if (candidate.source === "local") {
    return {
      source: "local",
      model: candidate.displayName,
      ...(candidate.local?.runtime ? { runtime: candidate.local.runtime } : {}),
    };
  }
  return {
    source: "free",
    provider: humanProvider(candidate.providerId),
    model: candidate.displayName,
  };
}

function testCounts(output: string): { passed: number; failed: number } {
  const pass = output.match(/(\d+)\s+(?:pass|passed)\b/i);
  const fail = output.match(/(\d+)\s+(?:fail|failed)\b/i);
  return {
    passed: pass ? Number(pass[1]) : 0,
    failed: fail ? Number(fail[1]) : 0,
  };
}

function appendAssistantText(
  state: TranscriptPresentation,
  text: string,
): TranscriptPresentation {
  if (!text) return state;
  const turnId = currentTurnId(state);
  const last = state.items.at(-1);
  if (last?.kind === "assistant-text" && last.turnId === turnId) {
    return {
      ...state,
      items: state.items.map((item) =>
        item.id === last.id && item.kind === "assistant-text"
          ? { ...item, text: item.text + text }
          : item,
      ),
    };
  }
  return {
    ...state,
    items: [
      ...state.items,
      {
        kind: "assistant-text",
        id: nextId(state, turnId, "assistant-text"),
        turnId,
        text,
        streaming: true,
      },
    ],
  };
}

function startTool(
  state: TranscriptPresentation,
  event: Extract<AppEvent, { type: "tool.started" }>,
): TranscriptPresentation {
  const turnId = currentTurnId(state);
  const metadata = activityMetadata(event.tool, event.input);
  const editFields =
    event.tool === "EditFile" ? record(event.input) : undefined;
  const oldText = stringField(editFields, "oldText");
  const newText =
    typeof editFields?.newText === "string" ? editFields.newText : undefined;
  const diff =
    oldText !== undefined && newText !== undefined
      ? computeLineDiff(oldText, newText)
      : undefined;
  const activity: ToolActivityViewModel = {
    id: event.callId,
    ...metadata,
    state: "running",
    ...(event.risk ? { risk: event.risk } : {}),
    ...(diff
      ? {
          diff: { added: diff.added, removed: diff.removed },
          diffLines: diff.lines,
        }
      : {}),
  };
  const lastIndex = state.items.length - 1;
  const lastItem = state.items[lastIndex];
  const groupIndex =
    lastItem?.turnId === turnId && lastItem.kind === "activity-group"
      ? lastIndex
      : -1;
  if (groupIndex >= 0) {
    return {
      ...state,
      items: state.items.map((item, index) =>
        index === groupIndex && item.kind === "activity-group"
          ? {
              ...item,
              activities: [...item.activities, activity],
              label: activityGroupLabel([...item.activities, activity]),
            }
          : item,
      ),
    };
  }
  return {
    ...state,
    items: [
      ...state.items,
      {
        kind: "activity-group",
        id: nextId(state, turnId, "activity-group"),
        turnId,
        label: activityGroupLabel([activity]),
        activities: [activity],
        expanded: false,
      },
    ],
  };
}

function finishTool(
  state: TranscriptPresentation,
  event: Extract<AppEvent, { type: "tool.finished" }>,
): TranscriptPresentation {
  const presentation = resultPresentation(event.result);
  return {
    ...state,
    items: state.items.map((item) =>
      item.kind !== "activity-group"
        ? item
        : {
            ...item,
            activities: item.activities.map((activity) => {
              if (activity.id !== event.callId) return activity;
              // A real diff (computed at tool.started from oldText/newText,
              // see startTool) is strictly more informative than the tool
              // result's own "N replacements" — spec §34 wants "+8 −3", not
              // a replacement count.
              const diffOverride =
                event.result.ok && activity.diff
                  ? {
                      summary: `+${activity.diff.added} −${activity.diff.removed}`,
                      details: activity.diffLines,
                    }
                  : {};
              return {
                ...activity,
                state:
                  event.result.code === "CANCELLED"
                    ? "cancelled"
                    : event.result.ok
                      ? "success"
                      : "failed",
                durationMs: event.result.durationMs,
                liveTail: undefined,
                ...presentation,
                ...diffOverride,
              };
            }),
          },
    ),
  };
}

function appendActivityOutput(
  state: TranscriptPresentation,
  callId: string,
  text: string,
): TranscriptPresentation {
  return {
    ...state,
    items: state.items.map((item) =>
      item.kind !== "activity-group"
        ? item
        : {
            ...item,
            activities: item.activities.map((activity) =>
              activity.id === callId && activity.state === "running"
                ? {
                    ...activity,
                    liveTail: appendLiveTail(activity.liveTail, text),
                  }
                : activity,
            ),
          },
    ),
  };
}

export function presentAppEvent(
  state: TranscriptPresentation,
  event: AppEvent,
): TranscriptPresentation {
  const turnId = currentTurnId(state);
  if (event.type === "phase.changed")
    return {
      ...state,
      agentPhase: isAbstractAgentPhase(event.phase) ? event.phase : undefined,
    };
  if (event.type === "assistant.delta")
    return appendAssistantText(state, event.text);
  if (event.type === "tool.started")
    return { ...startTool(state, event), agentPhase: undefined };
  if (event.type === "tool.finished") return finishTool(state, event);
  if (event.type === "plan.changed") {
    const steps = event.steps.map((step) => ({
      label: step.description,
      state: PLAN_STEP_STATE[step.status],
    }));
    const completed = event.steps.filter(
      (step) => step.status === "done",
    ).length;
    const lastIndex = state.items.length - 1;
    const lastItem = state.items[lastIndex];
    if (lastItem?.turnId === turnId && lastItem.kind === "plan-update") {
      return {
        ...state,
        items: state.items.map((item, index) =>
          index === lastIndex
            ? { ...item, steps, completed, total: event.steps.length }
            : item,
        ),
      };
    }
    return {
      ...state,
      items: [
        ...state.items,
        {
          kind: "plan-update",
          id: nextId(state, turnId, "plan-update"),
          turnId,
          completed,
          total: event.steps.length,
          steps,
          expanded: true,
        },
      ],
    };
  }
  if (event.type === "verification.started")
    return {
      ...state,
      agentPhase: undefined,
      runningVerification: { id: event.id, command: event.command, tail: [] },
    };
  if (event.type === "tool.output") {
    if (state.runningVerification?.id === event.callId)
      return {
        ...state,
        runningVerification: {
          ...state.runningVerification,
          tail: appendLiveTail(state.runningVerification.tail, event.text),
        },
      };
    return appendActivityOutput(state, event.callId, event.text);
  }
  if (event.type === "verification.finished") {
    const counts = testCounts(event.output);
    const details = event.output.split(/\r?\n/).filter(Boolean);
    const usefulFailureDetails = details.filter(
      (line) => !/^\s*\d+\s+(?:pass|passed|fail|failed)\b/i.test(line),
    );
    return {
      ...state,
      runningVerification: undefined,
      items: [
        ...state.items,
        {
          kind: "test-result",
          id: nextId(state, turnId, "test-result"),
          turnId,
          ...counts,
          details:
            counts.failed > 0
              ? (usefulFailureDetails.length > 0
                  ? usefulFailureDetails
                  : details
                ).slice(0, 2)
              : details.slice(0, 20),
        },
      ],
    };
  }
  if (event.type === "route.selected") {
    const candidate = event.decision.selected?.candidate;
    if (!candidate) {
      return presentAppEvent(state, {
        type: "route.failed",
        error: "No route is currently available",
        detail: event.decision.explanation,
      });
    }
    const route = routeView(candidate);
    if (!state.currentRoute) {
      // The initial route is quiet status context. Only a meaningful change
      // earns a transcript row, so model/provider metadata does not repeat
      // through every turn.
      return { ...state, currentRoute: route };
    }
    if (routesEqual(state.currentRoute, route)) {
      // Same route as before (e.g. the same local model handling the next
      // turn) — this is not a change and must not render as one.
      return state;
    }
    const items = state.currentRoute
      ? state.items.filter(
          (item) =>
            !(
              item.kind === "route-event" &&
              item.turnId === turnId &&
              item.previous === undefined
            ),
        )
      : state.items;
    return {
      ...state,
      currentRoute: route,
      items: [
        ...items,
        {
          kind: "route-event",
          id: nextId(state, turnId, "route-event"),
          turnId,
          route,
          ...(state.currentRoute ? { previous: state.currentRoute } : {}),
          ...(event.reason ? { reason: event.reason } : {}),
        },
      ],
    };
  }
  if (
    event.type === "route.failed" ||
    event.type === "task.failed" ||
    event.type === "task.blocked" ||
    event.type === "task.cancelled"
  ) {
    return {
      ...state,
      agentPhase: undefined,
      runningVerification: undefined,
      items: [
        ...state.items,
        {
          kind: "error-notice",
          id: nextId(state, turnId, "error-notice"),
          turnId,
          title: event.error,
          ...(event.detail ? { detail: event.detail } : {}),
          recoverable: event.type === "route.failed",
        },
      ],
    };
  }
  if (event.type === "approval.requested") {
    return {
      ...state,
      items: [
        ...state.items,
        {
          kind: "approval-request",
          id: nextId(state, turnId, "approval-request"),
          turnId,
          description: event.description,
          risk: "unknown",
        },
      ],
    };
  }
  if (event.type === "task.completed") {
    const completedItems = state.items.map((item) =>
      item.kind === "assistant-text" && item.turnId === turnId
        ? { ...item, streaming: false }
        : item,
    );
    const changedFiles = new Set(
      completedItems.flatMap((item) =>
        item.kind === "activity-group"
          ? item.activities
              .filter(
                (activity) =>
                  activity.state === "success" &&
                  (activity.kind === "edit" || activity.kind === "write"),
              )
              .map((activity) => activity.target)
          : [],
      ),
    );
    const latestTests = completedItems
      .filter((item) => item.kind === "test-result")
      .at(-1);
    const summaryParts: string[] = [];
    if (changedFiles.size > 0) {
      summaryParts.push(
        `${changedFiles.size} ${changedFiles.size === 1 ? "file" : "files"} changed`,
      );
    }
    if (latestTests?.kind === "test-result" && latestTests.failed === 0) {
      summaryParts.push(`${latestTests.passed} tests passed`);
    }
    const completion: TranscriptItem = {
      kind: "completion-notice",
      id: nextId(state, turnId, "completion-notice"),
      turnId,
      title: "Done",
      ...(summaryParts.length > 0 ? { summary: summaryParts.join(" · ") } : {}),
    };
    const trailingAssistant = completedItems.at(-1)?.kind === "assistant-text";
    let insertionIndex = completedItems.length;
    if (trailingAssistant) {
      while (
        insertionIndex > 0 &&
        completedItems[insertionIndex - 1]?.kind === "assistant-text"
      ) {
        insertionIndex -= 1;
      }
    }
    return {
      ...state,
      agentPhase: undefined,
      runningVerification: undefined,
      items: [
        ...completedItems.slice(0, insertionIndex),
        completion,
        ...completedItems.slice(insertionIndex),
      ],
    };
  }
  return state;
}
