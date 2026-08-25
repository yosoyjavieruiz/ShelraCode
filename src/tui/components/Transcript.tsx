import {
  RGBA,
  SyntaxStyle,
  type KeyEvent,
  type ScrollBoxRenderable,
} from "@opentui/core";
import { createEffect, createMemo, createSignal, For, Index } from "solid-js";
import type { AgentPhase } from "../../agent/task-state.js";
import type { TranscriptItem } from "../presentation/types.js";
import type {
  ActivityState,
  ToolActivityViewModel,
} from "../presentation/types.js";
import type { TranscriptMessage } from "../state/conversation.js";
import type { ThemeTokens } from "../theme/tokens.js";
import { themeColor } from "../theme/tokens.js";
import { AgentMatrixPulse } from "./AgentMatrixPulse.js";
import { getToolRenderer } from "./tool-renderers.js";

export type { TranscriptMessage } from "../state/conversation.js";

function hideScrollbars(scrollbox: ScrollBoxRenderable): void {
  queueMicrotask(() => {
    scrollbox.verticalScrollBar.visible = false;
    scrollbox.horizontalScrollBar.visible = false;
  });
  setTimeout(() => {
    scrollbox.scrollTo({ x: 0, y: scrollbox.scrollHeight });
  }, 0);
}

export interface MarkdownSegment {
  kind: "text" | "code";
  content: string;
  lang?: string;
}

// A fenced code block inside an assistant message reliably comes back
// *blank* from OpenTUI's combined `<markdown>` renderable — confirmed by
// direct captures both streaming and not: non-streaming loses the
// surrounding prose instead, streaming loses the code block itself. Same
// framework/component OpenCode (built on the same OpenTUI) has open,
// unresolved upstream issues for ("Syntax highlighting completely broken",
// "Markdown rendering broken since opentui upgrade") — not a ShelraCode
// misuse. Standalone `<code>` (CodeRenderable, real tree-sitter
// highlighting) renders correctly in isolation, so the fix here is to stop
// asking `<markdown>` to handle fenced code at all: split it out and hand
// code segments to `<code>` directly, prose segments to plain `<text>`.
// Streaming leaves an unterminated fence as plain text until the closing
// ``` arrives — visible raw backticks for a moment, self-corrects, and
// never silently drops content either way.
const FENCE_PATTERN = /```([\w+-]*)\n([\s\S]*?)```/g;

export function segmentMarkdown(content: string): MarkdownSegment[] {
  const segments: MarkdownSegment[] = [];
  let lastIndex = 0;
  FENCE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = FENCE_PATTERN.exec(content)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        kind: "text",
        content: content.slice(lastIndex, match.index),
      });
    }
    const lang = match[1]?.toLowerCase() || undefined;
    const code = (match[2] ?? "").replace(/\n$/, "");
    segments.push({ kind: "code", content: code, lang });
    lastIndex = FENCE_PATTERN.lastIndex;
  }
  if (lastIndex < content.length || segments.length === 0) {
    segments.push({ kind: "text", content: content.slice(lastIndex) });
  }
  return segments;
}

const LANG_TO_FILETYPE: Record<string, string> = {
  ts: "typescript",
  tsx: "tsx",
  js: "javascript",
  jsx: "jsx",
  py: "python",
  rb: "ruby",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  yml: "yaml",
  md: "markdown",
};

function codeFiletype(lang: string | undefined): string | undefined {
  if (!lang) return undefined;
  return LANG_TO_FILETYPE[lang] ?? lang;
}

function CodeBlock(props: {
  theme: ThemeTokens;
  content: string;
  lang?: string;
}) {
  const colors = props.theme.colors;
  const color = (value: string) => themeColor(props.theme, value);
  const style = (hex: string, extra: Record<string, unknown> = {}) =>
    props.theme.colorsEnabled ? { fg: RGBA.fromHex(hex), ...extra } : extra;
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: style(colors.text.primary),
    keyword: style(colors.purple[400], { bold: true }),
    string: style(colors.status.success),
    comment: style(colors.text.muted),
    function: style(colors.status.info),
    "function.method": style(colors.status.info),
    type: style(colors.purple[300]),
    number: style(colors.status.warning),
    constant: style(colors.status.warning),
    operator: style(colors.text.secondary),
    punctuation: style(colors.text.tertiary),
    property: style(colors.text.secondary),
  });
  return (
    <box
      flexDirection="column"
      width="100%"
      backgroundColor={color(colors.background.elevated)}
      paddingX={1}
    >
      {props.lang ? (
        <text fg={color(colors.text.muted)}>{props.lang}</text>
      ) : null}
      <code
        width="100%"
        content={props.content}
        filetype={codeFiletype(props.lang)}
        syntaxStyle={syntaxStyle}
      />
    </box>
  );
}

export function MarkdownBlock(props: {
  theme: ThemeTokens;
  // Accessor, not a plain string — an assistant message's content is what
  // streams token by token, more than anything else in this transcript.
  // Passed an already-invoked value here, this component (and everything
  // under it, including CodeBlock) would only ever render the very first
  // snapshot; passed the raw signal, `<Index>` (Transcript's own list, see
  // the file comment on why `<Index>` rather than `<For>`) can keep this
  // exact component instance mounted across every token and just patch
  // the rendered text in place — no per-token unmount/remount, no flicker.
  content: () => string;
  streaming?: () => boolean;
}) {
  const syntaxStyle = SyntaxStyle.fromStyles({
    default: props.theme.colorsEnabled
      ? { fg: RGBA.fromHex(props.theme.colors.text.primary) }
      : {},
    "markup.heading.1": props.theme.colorsEnabled
      ? { fg: RGBA.fromHex(props.theme.colors.purple[300]), bold: true }
      : { bold: true },
    "markup.raw": props.theme.colorsEnabled
      ? { fg: RGBA.fromHex(props.theme.colors.purple[200]) }
      : {},
  });
  // Both `createMemo` here matter, not just for dedup. `hasCodeBlock`/
  // `plain` gate which whole JSX shape renders below — without memoizing
  // them, that gate itself re-evaluates (and, confirmed by direct probing
  // of this render pipeline, fully *recreates* the branch it lands on,
  // even when the branch taken doesn't change) on every single call to
  // `props.content()`, i.e. every streamed token, which is the actual
  // mechanism behind the reported flicker — not `<For>` vs `<Index>`
  // (Transcript's own fix for the *outer* per-turn flicker), a second,
  // independent cause one level down. `createMemo` only notifies
  // downstream when its own boolean output changes, so for an ordinary
  // streaming reply (no code fence, ever `plain() === true`) the
  // conditional below now genuinely never re-runs after the first token.
  const segments = createMemo(() => segmentMarkdown(props.content()));
  const hasCodeBlock = createMemo(() =>
    segments().some((segment) => segment.kind === "code"),
  );
  const plain = createMemo(
    () => !hasCodeBlock() && !/[`*_#>\n]/.test(props.content()),
  );
  return (
    <>
      {() =>
        hasCodeBlock() ? (
          <box flexDirection="column" width="100%" gap={1}>
            <For each={segments()}>
              {(segment) =>
                segment.kind === "code" ? (
                  <CodeBlock
                    theme={props.theme}
                    content={segment.content}
                    lang={segment.lang}
                  />
                ) : segment.content.trim() ? (
                  <text
                    width="100%"
                    wrapMode="word"
                    fg={themeColor(
                      props.theme,
                      props.theme.colors.text.primary,
                    )}
                  >
                    {
                      // A prose segment here never goes through
                      // `<markdown>`'s own backtick-concealing (that's the
                      // renderer confirmed broken above) — strip inline
                      // `code` spans manually so a message with both a
                      // fenced block and inline code doesn't show raw
                      // backticks around the latter.
                      segment.content.trim().replace(/`([^`]+)`/g, "$1")
                    }
                  </text>
                ) : null
              }
            </For>
          </box>
        ) : plain() ? (
          <text
            id="markdown-plain-text"
            width="100%"
            wrapMode="word"
            fg={themeColor(props.theme, props.theme.colors.text.primary)}
          >
            {
              // Raw accessor, *not* invoked — this is what lets the text
              // keep updating after the branch above stops re-running:
              // Solid's own children-tracking on `<text>` patches the
              // rendered string in place independently of whichever
              // memoized computation decided this branch was the one to
              // mount. `{props.content()}` here (an invoked snapshot)
              // would go stale the moment the outer memo above stopped
              // re-running — exactly the failure mode this whole fix is
              // built to close, just relocated one line down instead of
              // fixed.
              props.content
            }
          </text>
        ) : (
          <markdown
            width="100%"
            content={props.content()}
            syntaxStyle={syntaxStyle}
            conceal
            streaming={props.streaming?.() ?? false}
            fg={themeColor(props.theme, props.theme.colors.text.primary)}
            bg={themeColor(props.theme, props.theme.colors.background.canvas)}
          />
        )
      }
    </>
  );
}

export function legacyTranscriptItems(
  messages: readonly TranscriptMessage[],
): TranscriptItem[] {
  let turn = 0;
  return messages.map((message, index): TranscriptItem => {
    if (message.role === "user") turn += 1;
    const turnId = `legacy-${Math.max(1, turn)}`;
    const base = { id: `legacy-${index}`, turnId };
    if (message.role === "user") {
      return { ...base, kind: "user-turn", text: message.text };
    }
    if (message.role === "assistant") {
      return {
        ...base,
        kind: "assistant-text",
        text: message.text,
        streaming: false,
      };
    }
    if (message.role === "tool") {
      const [label = "TOOL", ...target] = message.text.split(" ");
      return {
        ...base,
        kind: "activity-group",
        label: "Agent activity",
        expanded: false,
        activities: [
          {
            id: `${base.id}-activity`,
            kind: "tool",
            label,
            target: target.join(" "),
            state: message.status === "danger" ? "failed" : "success",
            summary: message.detail,
          },
        ],
      };
    }
    if (message.role === "error") {
      return {
        ...base,
        kind: "error-notice",
        title: message.text,
        detail: message.detail,
        recoverable: message.status !== "danger",
      };
    }
    return {
      ...base,
      kind: "assistant-text",
      text: message.detail
        ? `${message.text}\n${message.detail}`
        : message.text,
      streaming: false,
    };
  });
}

export type TurnGroup = {
  id: string;
  user?: Extract<TranscriptItem, { kind: "user-turn" }>;
  assistant: TranscriptItem[];
};

export function groupTranscriptItems(
  items: readonly TranscriptItem[],
): TurnGroup[] {
  const groups: TurnGroup[] = [];
  for (const item of items) {
    let group = groups.find((candidate) => candidate.id === item.turnId);
    if (!group) {
      group = { id: item.turnId, assistant: [] };
      groups.push(group);
    }
    if (item.kind === "user-turn") group.user = item;
    else group.assistant.push(item);
  }
  return groups;
}

// Pure and stateless (see above) means every call rebuilds every TurnGroup
// object from scratch, even for turns whose items are byte-for-byte the
// same references as last time — which is most of a long conversation on
// every single streamed token, since `groupTranscriptItems` is re-run on
// every `items()` change. `<For each={groups()}>` (Transcript, below)
// diffs by object identity: handed a fresh object for every turn on every
// token, it has no way to tell 40 finished turns apart from the one
// actively streaming, and re-renders (destroys and rebuilds) all of them —
// the reported "parpadea, se renderiza mucho" flicker. This reuses the
// previous render's exact TurnGroup object for any turn whose `user` and
// `assistant` items are still the same references as last time, so `<For>`
// can correctly skip everything except the turn that actually changed.
// A streaming assistant-text item gets a *new* object every single token
// (appendAssistantText, presentation/adapter.ts, replaces the item's
// `text` field immutably — correct and necessary for the state tree, but
// it means strict reference equality below would call this item "changed"
// on every token, which would flow through as "this item's *group*
// changed" too, and defeat the whole point of this function even after
// switching Transcript's inner list from <For> to <Index> (see there): the
// group's own JSX getting recreated on every token means <Index>'s
// per-position stability never gets a chance to help, because its parent
// is torn down and rebuilt right along with it. Same id + same kind is
// "unchanged" for *this* purpose (structural — does the group's rendered
// shape need to change at all) even though the text differs; the actual
// live text is read separately, straight off a dedicated signal
// (Transcript's `streamingAssistantItem`), not off this snapshot.
function sameItemForGroupIdentity(
  a: TranscriptItem | undefined,
  b: TranscriptItem | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.kind === "assistant-text" && b.kind === "assistant-text") {
    return a.id === b.id;
  }
  return false;
}

export function reuseUnchangedGroups(
  next: readonly TurnGroup[],
  previous: ReadonlyMap<string, TurnGroup>,
): TurnGroup[] {
  return next.map((group) => {
    const prior = previous.get(group.id);
    if (
      prior &&
      prior.user === group.user &&
      prior.assistant.length === group.assistant.length &&
      prior.assistant.every((item, index) =>
        sameItemForGroupIdentity(item, group.assistant[index]),
      )
    ) {
      return prior;
    }
    return group;
  });
}

type CompactActivitySummary = {
  label: string;
  glyph: string;
  color: string;
  countText: string;
  durationText?: string;
};

function compactActivitySummary(
  activities: readonly ToolActivityViewModel[],
  theme: ThemeTokens,
): CompactActivitySummary | undefined {
  const first = activities[0];
  if (!first || activities.length < 2) return undefined;
  if (activities.some((activity) => activity.kind !== first.kind)) {
    return undefined;
  }
  if (
    (first.kind === "run" || first.kind === "test") &&
    activities.some((activity) => activity.state === "running")
  ) {
    return undefined;
  }
  const nouns: Record<ToolActivityViewModel["kind"], string> = {
    read: "files",
    search: "searches",
    edit: "files",
    write: "files",
    list: "directories",
    run: "commands",
    test: "runs",
    diff: "changes",
    status: "checks",
    tool: "actions",
  };
  const failed = activities.some((activity) => activity.state === "failed");
  const running = activities.some((activity) => activity.state === "running");
  const pending = activities.some((activity) => activity.state === "pending");
  const cancelled = activities.some(
    (activity) => activity.state === "cancelled",
  );
  const state = failed
    ? "failed"
    : running
      ? "running"
      : pending
        ? "pending"
        : cancelled
          ? "cancelled"
          : "success";
  const durationMs = activities.reduce(
    (total, activity) => total + (activity.durationMs ?? 0),
    0,
  );
  const glyphs = {
    pending: "\u25cb",
    running: "\u25cf",
    success: "\u2713",
    failed: "\u00d7",
    cancelled: "!",
  } as const;
  const stateColors = {
    pending: theme.colors.text.muted,
    running: theme.colors.purple[400],
    success: theme.colors.status.success,
    failed: theme.colors.status.danger,
    cancelled: theme.colors.status.warning,
  } as const;
  return {
    label: first.label,
    glyph: glyphs[state],
    color: stateColors[state],
    countText: `${activities.length} ${nouns[first.kind]}`,
    ...(durationMs > 0 && !running
      ? {
          durationText:
            durationMs < 1_000
              ? `${durationMs}ms`
              : `${(durationMs / 1_000).toFixed(1)}s`,
        }
      : {}),
  };
}

export function Activity(props: {
  theme: ThemeTokens;
  item: Extract<TranscriptItem, { kind: "activity-group" }>;
  forceExpanded: boolean;
  expandedIds?: () => ReadonlySet<string>;
  onToggle?: (id: string) => void;
}) {
  const colors = props.theme.colors;
  const color = (value: string) => themeColor(props.theme, value);
  const count = () => props.item.activities.length;
  const expanded = () =>
    props.forceExpanded ||
    props.item.expanded ||
    props.expandedIds?.().has(props.item.id) === true;
  const groupSummary = createMemo(() =>
    compactActivitySummary(props.item.activities, props.theme),
  );
  const compact = createMemo(() => (expanded() ? undefined : groupSummary()));
  const toggle = () => props.onToggle?.(props.item.id);
  return (
    <box
      id={`activity-${props.item.id}`}
      flexDirection="column"
      focusable
      onMouseDown={toggle}
      onKeyDown={(event: KeyEvent) => {
        if (event.name === "return" || event.name === "enter") {
          event.preventDefault();
          toggle();
        }
      }}
    >
      {count() > 1 && (!compact() || expanded()) ? (
        <box flexDirection="row" gap={1}>
          <text fg={color(colors.text.muted)}>
            {() => (expanded() ? "└" : "›")}
          </text>
          <text fg={color(colors.text.secondary)}>{props.item.label}</text>
          <text
            fg={color(colors.text.muted)}
          >{`· ${groupSummary()?.countText ?? `${count()} actions`}`}</text>
        </box>
      ) : null}
      {() => {
        const summary = compact();
        if (summary) {
          return (
            <box flexDirection="row" gap={1}>
              <text fg={color(summary.color)}>{summary.glyph}</text>
              <text fg={color(colors.text.secondary)}>
                <strong>{summary.label.padEnd(7)}</strong>
              </text>
              <text fg={color(colors.text.primary)}>{summary.countText}</text>
              <box flexGrow={1} />
              {summary.durationText ? (
                <text fg={color(colors.text.muted)}>
                  {summary.durationText}
                </text>
              ) : null}
            </box>
          );
        }
        return (
          <For each={props.item.activities}>
            {(activity, activityIndex) =>
              getToolRenderer(activity.kind)({
                theme: props.theme,
                activity,
                groupCount: count(),
                index: activityIndex(),
                expanded,
              })
            }
          </For>
        );
      }}
    </box>
  );
}

function PresentationItem(props: {
  theme: ThemeTokens;
  // Accessor, not a plain value — see MarkdownBlock's own comment. Passed
  // from Transcript's `<Index>` (not `<For>`) so this exact component
  // instance stays mounted at its position for the item's whole lifetime;
  // every branch below reads `props.item()` fresh at use time (never
  // destructured once up front) specifically so fields that mutate in
  // place over time — assistant-text's `text` growing token by token,
  // activity-group's `activities`/`liveTail`, plan-update's `steps` —
  // patch in without a per-update remount. Only the branch *selection*
  // itself (`.kind`) is read once, since which kind an item is never
  // changes after it's created.
  item: () => TranscriptItem;
  // See reuseUnchangedGroups' own comment (above): a streaming item's
  // *group* is deliberately kept at a stable identity even while the
  // item's text changes underneath it, so `props.item()` for that one item
  // can be a frozen snapshot. This is the live source of truth for it —
  // matched by id, read fresh on every call, never memoized (its whole job
  // is to change on every token).
  streamingAssistantItem?: () => TranscriptItem | undefined;
  expandActivities: boolean;
  expandedActivityIds?: () => ReadonlySet<string>;
  onActivityToggle?: (id: string) => void;
}) {
  const colors = props.theme.colors;
  const color = (value: string) => themeColor(props.theme, value);
  const kind = props.item().kind;
  if (kind === "model-progress") {
    const current = () => {
      const value = props.item();
      return value.kind === "model-progress" ? value : undefined;
    };
    return (
      <text fg={color(colors.text.muted)}>
        {() => {
          const value = current();
          if (!value) return "";
          const count = value.chars.toLocaleString();
          return `MODEL ANALYSIS · ${value.streaming ? "streaming" : "captured"} · ${count} chars · private reasoning text hidden; visible actions follow`;
        }}
      </text>
    );
  }
  if (kind === "assistant-text") {
    const liveText = (): string => {
      const current = props.item();
      if (current.kind !== "assistant-text") return "";
      const live = props.streamingAssistantItem?.();
      return live?.id === current.id && live.kind === "assistant-text"
        ? live.text
        : current.text;
    };
    return (
      <MarkdownBlock
        theme={props.theme}
        content={liveText}
        streaming={() => {
          const current = props.item();
          return current.kind === "assistant-text" ? current.streaming : false;
        }}
      />
    );
  }
  if (kind === "activity-group") {
    // Activity (below) still takes a plain snapshot, not an accessor — it
    // owns its own memos over `item.activities` internally and re-deriving
    // those from a moving accessor is out of scope for this pass. Wrapping
    // the whole element in a reactive children function (the same
    // established pattern MarkdownBlock uses just above) means a live-tail
    // update still remounts this one activity list — same as before this
    // change, not worse — while assistant-text streaming (the actual
    // report) no longer does.
    return (
      <>
        {() => {
          const current = props.item();
          return current.kind === "activity-group" ? (
            <Activity
              theme={props.theme}
              item={current}
              forceExpanded={props.expandActivities}
              expandedIds={props.expandedActivityIds}
              onToggle={props.onActivityToggle}
            />
          ) : null;
        }}
      </>
    );
  }
  if (kind === "test-result") {
    const current = () => {
      const value = props.item();
      return value.kind === "test-result" ? value : undefined;
    };
    const passed = () => current()?.failed === 0;
    return (
      <box flexDirection="column">
        <text
          fg={color(passed() ? colors.status.success : colors.status.danger)}
        >
          {() =>
            `${passed() ? "✓" : "×"} Tests · ${current()?.passed ?? 0} passed${current()?.failed ? ` · ${current()?.failed} failed` : ""}${current()?.duration ? ` · ${current()?.duration}` : ""}`
          }
        </text>
        {() =>
          !passed() && (current()?.details.length ?? 0) > 0 ? (
            <text width="100%" wrapMode="word" fg={color(colors.text.tertiary)}>
              {current()?.details.slice(0, 4).join("\n")}
            </text>
          ) : null
        }
      </box>
    );
  }
  if (kind === "route-event") {
    const current = () => {
      const value = props.item();
      return value.kind === "route-event" ? value : undefined;
    };
    const next = () => {
      const route = current()?.route;
      if (!route) return "";
      return `${route.source === "local" ? "Local" : "Free"} · ${route.provider ? `${route.provider} · ` : ""}${route.model}`;
    };
    return (
      <>
        {() =>
          current()?.previous ? (
            <box flexDirection="column">
              <text fg={color(colors.text.secondary)}>Route changed</text>
              <text fg={color(colors.text.tertiary)}>
                {`${current()?.previous?.source === "local" ? "Local" : "Free"} · ${current()?.previous?.model}`}
              </text>
              <text fg={color(colors.purple[400])}>↓</text>
              <text fg={color(colors.text.primary)}>{next()}</text>
              {current()?.reason ? (
                <text fg={color(colors.text.tertiary)}>
                  {current()?.reason}
                </text>
              ) : null}
            </box>
          ) : (
            <text fg={color(colors.text.secondary)}>{`◆ ${next()}`}</text>
          )
        }
      </>
    );
  }
  if (kind === "plan-update") {
    const current = () => {
      const value = props.item();
      return value.kind === "plan-update" ? value : undefined;
    };
    const marker = (state: ActivityState) =>
      state === "success"
        ? "✓"
        : state === "running"
          ? "●"
          : state === "failed"
            ? "×"
            : "○";
    const markerColor = (state: ActivityState) =>
      state === "success"
        ? colors.status.success
        : state === "running"
          ? colors.purple[400]
          : state === "failed"
            ? colors.status.danger
            : colors.text.muted;
    return (
      <box flexDirection="column">
        <text fg={color(colors.text.secondary)}>
          {() => `Plan · ${current()?.completed ?? 0}/${current()?.total ?? 0}`}
        </text>
        <For each={current()?.steps ?? []}>
          {(step) => (
            <box flexDirection="row" gap={1}>
              <text fg={color(markerColor(step.state))}>
                {marker(step.state)}
              </text>
              <text
                fg={color(
                  step.state === "success"
                    ? colors.text.muted
                    : colors.text.primary,
                )}
              >
                {step.label}
              </text>
            </box>
          )}
        </For>
      </box>
    );
  }
  if (kind === "file-change") {
    return (
      <text fg={color(colors.text.secondary)}>
        {() => {
          const current = props.item();
          return current.kind === "file-change"
            ? `EDIT    ${current.path}   +${current.additions} −${current.deletions}`
            : "";
        }}
      </text>
    );
  }
  if (kind === "error-notice") {
    const current = () => {
      const value = props.item();
      return value.kind === "error-notice" ? value : undefined;
    };
    return (
      <box flexDirection="column">
        <text fg={color(colors.status.danger)}>
          {() => `! ${current()?.title ?? ""}`}
        </text>
        {() =>
          current()?.detail ? (
            <text fg={color(colors.text.tertiary)}>{current()?.detail}</text>
          ) : null
        }
      </box>
    );
  }
  if (kind === "approval-request") {
    return (
      <text fg={color(colors.status.warning)}>
        {() => {
          const current = props.item();
          return current.kind === "approval-request"
            ? `Approval required · ${current.description}`
            : "";
        }}
      </text>
    );
  }
  if (kind === "completion-notice") {
    return (
      <text fg={color(colors.status.success)}>
        {() => {
          const current = props.item();
          return current.kind === "completion-notice"
            ? `Done${current.summary ? ` · ${current.summary}` : ""}`
            : "";
        }}
      </text>
    );
  }
  return null;
}

export function Transcript(props: {
  theme: ThemeTokens;
  items?: TranscriptItem[] | (() => TranscriptItem[]);
  messages?: TranscriptMessage[];
  width: number;
  expandActivities?: boolean;
  expandedActivityIds?: () => ReadonlySet<string>;
  height?: number;
  density?: "comfortable" | "compact";
  onReady?: (viewport: ScrollBoxRenderable) => void;
  onActivityToggle?: (id: string) => void;
  // Abstract "still thinking" state (see AgentMatrixPulse) rendered as the
  // last item in the flow, after every turn group — never as a separate
  // overlay, so it scrolls and clears exactly like any other content and
  // can never overlap the composer below this viewport.
  agentPhase?: () => AgentPhase | undefined;
  agentTick?: () => number;
  agentElapsedSeconds?: () => number;
  agentReducedMotion?: () => boolean;
  // The host-driven verification stage's own live tail (see
  // presentation/adapter.ts) — mutually exclusive with agentPhase by
  // construction (verification.started clears it), so at most one of the
  // two ever renders here.
  runningVerification?: () =>
    { id: string; command: string; tail: string[] } | undefined;
}) {
  const color = (value: string) => themeColor(props.theme, value);
  let transcriptViewport: ScrollBoxRenderable | undefined;
  const items = createMemo(() => {
    const source = props.items;
    return typeof source === "function"
      ? source()
      : (source ?? legacyTranscriptItems(props.messages ?? []));
  });
  let previousGroupsById = new Map<string, TurnGroup>();
  const groups = createMemo(() => {
    const stabilized = reuseUnchangedGroups(
      groupTranscriptItems(items()),
      previousGroupsById,
    );
    previousGroupsById = new Map(stabilized.map((group) => [group.id, group]));
    return stabilized;
  });
  // The live text for whichever item is *currently* streaming — read
  // directly off `items()` (not off a possibly-reused/frozen TurnGroup, see
  // reuseUnchangedGroups above), so PresentationItem can show up-to-date
  // text for the one item that's actually updating while the group JSX
  // around it stays mounted. Plain accessor, not memoized: it's meant to be
  // called often (every token) — memoizing content that's *supposed* to
  // change every call would just add overhead, not save any.
  const streamingAssistantItem = (): TranscriptItem | undefined => {
    const list = items();
    for (let index = list.length - 1; index >= 0; index -= 1) {
      const candidate = list[index];
      if (candidate?.kind === "assistant-text" && candidate.streaming) {
        return candidate;
      }
    }
    return undefined;
  };
  const [following, setFollowing] = createSignal(true);
  const [hasNewActivity, setHasNewActivity] = createSignal(false);
  let previousItems: TranscriptItem[] | undefined;

  createEffect(() => {
    const currentItems = items();
    if (previousItems && currentItems !== previousItems && !following())
      setHasNewActivity(true);
    previousItems = currentItems;
  });

  const isAtBottom = (): boolean => {
    if (!transcriptViewport) return true;
    const maxScrollTop = Math.max(
      0,
      transcriptViewport.scrollHeight - transcriptViewport.height,
    );
    return transcriptViewport.scrollTop >= maxScrollTop - 1;
  };
  const updateScrollState = (): void => {
    const atBottom = isAtBottom();
    setFollowing(atBottom);
    if (atBottom) setHasNewActivity(false);
  };
  const scheduleScrollStateUpdate = (): void => {
    queueMicrotask(updateScrollState);
  };
  const resumeAtBottom = (): void => {
    transcriptViewport?.scrollTo({
      x: 0,
      y: transcriptViewport.scrollHeight,
    });
    setFollowing(true);
    setHasNewActivity(false);
  };
  const activityBannerWidth = Math.min(22, Math.max(1, props.width));
  const activityBannerLeft = Math.max(
    0,
    Math.floor((props.width - activityBannerWidth) / 2),
  );
  return (
    <box
      id="core-transcript-shell"
      position="relative"
      width="100%"
      height={props.height}
      flexGrow={props.height === undefined ? 1 : 0}
      minHeight={0}
    >
      <scrollbox
        id="core-transcript"
        ref={(value) => {
          transcriptViewport = value;
          hideScrollbars(value);
          props.onReady?.(value);
        }}
        flexGrow={1}
        minHeight={0}
        height="100%"
        width="100%"
        focusable
        onMouseScroll={scheduleScrollStateUpdate}
        onKeyDown={(event) => {
          if (event.name === "pageup") {
            event.preventDefault();
            transcriptViewport?.scrollBy({ x: 0, y: -1 }, "viewport");
            scheduleScrollStateUpdate();
          } else if (event.name === "pagedown") {
            event.preventDefault();
            transcriptViewport?.scrollBy({ x: 0, y: 1 }, "viewport");
            scheduleScrollStateUpdate();
          }
        }}
        stickyScroll
        stickyStart="bottom"
        viewportCulling
        scrollbarOptions={{ visible: false, showArrows: false }}
        contentOptions={{
          backgroundColor: color(props.theme.colors.background.canvas),
        }}
      >
        <box flexDirection="column" paddingX={1}>
          <box
            id="core-transcript-content"
            width="100%"
            flexDirection="column"
            gap={props.density === "compact" ? 0 : 1}
            paddingTop={1}
            paddingBottom={1}
          >
            <For each={groups()}>
              {(group) => (
                <box
                  flexDirection="column"
                  gap={props.density === "compact" ? 0 : 1}
                >
                  {group.user ? (
                    <box flexDirection="column">
                      <text fg={color(props.theme.colors.purple[300])}>
                        <strong>You</strong>
                      </text>
                      <text
                        width="100%"
                        wrapMode="word"
                        fg={color(props.theme.colors.text.primary)}
                      >
                        {group.user.text}
                      </text>
                    </box>
                  ) : null}
                  {group.assistant.length > 0 ? (
                    <box
                      flexDirection="column"
                      gap={props.density === "compact" ? 0 : 1}
                    >
                      <text fg={color(props.theme.colors.text.primary)}>
                        <strong>ShelraCode</strong>
                      </text>
                      {
                        // <Index>, not <For>: this is what actually fixes
                        // the reported streaming flicker. `<For>` keys by
                        // *value* — appendAssistantText (adapter.ts)
                        // returns a new object for the streaming item on
                        // every single token, so `<For>` saw a "removed"
                        // item and an "added" item each time and fully
                        // unmounted/remounted PresentationItem →
                        // MarkdownBlock on every keystroke, even though
                        // it's the *same* message just growing. `<Index>`
                        // keys by *position* instead — an assistant turn's
                        // items only ever grow at the end, never reorder,
                        // so position is a stable identity here. Its
                        // callback hands PresentationItem a live accessor
                        // for "whatever's at this position now" instead of
                        // a frozen value, so the mounted component just
                        // patches its text in place.
                      }
                      <Index each={group.assistant}>
                        {(item) => (
                          <PresentationItem
                            theme={props.theme}
                            item={item}
                            streamingAssistantItem={streamingAssistantItem}
                            expandActivities={props.expandActivities === true}
                            expandedActivityIds={props.expandedActivityIds}
                            onActivityToggle={props.onActivityToggle}
                          />
                        )}
                      </Index>
                    </box>
                  ) : null}
                </box>
              )}
            </For>
            {() =>
              props.agentPhase?.() !== undefined ? (
                <AgentMatrixPulse
                  theme={props.theme}
                  phase={props.agentPhase!}
                  tick={props.agentTick ?? (() => 0)}
                  elapsedSeconds={props.agentElapsedSeconds ?? (() => 0)}
                  width={() => props.width}
                  reducedMotion={props.agentReducedMotion}
                />
              ) : null
            }
            {() => {
              const running = props.runningVerification?.();
              if (!running) return null;
              return (
                <box id="verification-running" flexDirection="column">
                  <box flexDirection="row" gap={1}>
                    <text fg={color(props.theme.colors.purple[400])}>●</text>
                    <text fg={color(props.theme.colors.text.secondary)}>
                      <strong>{"TEST".padEnd(7)}</strong>
                    </text>
                    <text fg={color(props.theme.colors.text.primary)}>
                      {running.command}
                    </text>
                  </box>
                  {running.tail.length > 0 ? (
                    <box flexDirection="column" paddingLeft={3}>
                      {running.tail.map((line) => (
                        <text
                          width="100%"
                          wrapMode="word"
                          fg={color(props.theme.colors.text.muted)}
                        >
                          {line}
                        </text>
                      ))}
                    </box>
                  ) : null}
                </box>
              );
            }}
          </box>
        </box>
      </scrollbox>
      {() =>
        !following() && hasNewActivity() ? (
          <box
            id="transcript-new-activity"
            position="absolute"
            bottom={0}
            left={activityBannerLeft}
            width={activityBannerWidth}
            height={1}
            paddingX={1}
            focusable
            shouldFill
            // Keep the banner opaque even under NO_COLOR. The canvas is true
            // black, so this is structural occlusion rather than decoration.
            backgroundColor={
              props.theme.colorsEnabled
                ? props.theme.colors.background.active
                : props.theme.colors.background.canvas
            }
            zIndex={1000}
            onMouseDown={resumeAtBottom}
            onKeyDown={(event: KeyEvent) => {
              if (event.name === "return" || event.name === "enter") {
                event.preventDefault();
                resumeAtBottom();
              }
            }}
          >
            <text fg={color(props.theme.colors.purple[300])}>
              ↓ New activity
            </text>
          </box>
        ) : null
      }
    </box>
  );
}
