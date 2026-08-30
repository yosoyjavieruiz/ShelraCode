import type { KeyEvent, Renderable } from "@opentui/core";
import { createEffect, For } from "solid-js";
import type { ThemeTokens } from "../theme/tokens.js";
import { themeColor } from "../theme/tokens.js";

// This is the original ShelraCode home mark. Keep the two source sizes: the
// compact raster is what made the logo fit the 80-column welcome screen,
// while the block wordmark is used once the content column has room for it.
// The logo is intentionally data, not a canvas or a separate screen, so it
// remains part of the same home flow as the suggestions and composer.
const WIDE_HOME_LOGO = [
  "███████╗ ██╗  ██╗ ███████╗ ██╗      ██████╗   █████╗       ██████╗  ██████╗  ██████╗  ███████╗",
  "██╔════╝ ██║  ██║ ██╔════╝ ██║      ██╔══██╗ ██╔══██╗     ██╔════╝ ██╔═══██╗ ██╔══██╗ ██╔════╝",
  "███████╗ ███████║ █████╗   ██║      ██████╔╝ ███████║     ██║      ██║   ██║ ██║  ██║ █████╗  ",
  "╚════██║ ██╔══██║ ██╔══╝   ██║      ██╔══██╗ ██╔══██║     ██║      ██║   ██║ ██║  ██║ ██╔══╝  ",
  "███████║ ██║  ██║ ███████╗ ███████╗ ██║  ██║ ██║  ██║     ╚██████╗ ╚██████╔╝ ██████╔╝ ███████╗",
  "╚══════╝ ╚═╝  ╚═╝ ╚══════╝ ╚══════╝ ╚═╝  ╚═╝ ╚═╝  ╚═╝      ╚═════╝  ╚═════╝  ╚═════╝  ╚══════╝",
] as const;

const COMPACT_HOME_LOGO = [
  "░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░ ░░░░ ░░░░ ░░░░ ░░░░",
  "░███ █░░█ ████ █░░░ ███░ ░██░ ░░░ ████ ░██░ ███░ ████",
  "█    █░░█ █    █░░░ █  █ █  █ ░░░ █    █  █ █  █ █   ",
  " ██░ ████ ███░ █░░░ ███  ████ ░░░ █░░░ █░░█ █░░█ ███░",
  "░  █ █  █ █  ░ █░░░ █  █ █  █ ░░░ █░░░ █░░█ █░░█ █  ░",
  "███  █░░█ ████ ████ █░░█ █░░█ ░░░ ████  ██  ███  ████",
  "   ░  ░░             ░░   ░░  ░░░      ░  ░    ░     ",
  "░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░░ ░░░ ░░░░ ░░░░ ░░░░ ░░░░",
] as const;

function homeLogo(width: number): readonly string[] {
  // The wide mark is 94 cells before terminal glyph-width accounting and
  // needs the wider reading column. Keep the original compact mark at 100
  // columns so it never truncates against the shared content padding.
  if (width >= 110) return WIDE_HOME_LOGO;
  if (width >= 57) return COMPACT_HOME_LOGO;
  return [];
}

export function homeSuggestions(dirty: boolean): string[] {
  return dirty
    ? [
        "Review my current changes",
        "Run tests for changed files",
        "Find likely regressions",
      ]
    : [
        "Explain this repository",
        "Map the architecture",
        "Find the main entry points",
      ];
}

export function moveHomeSuggestionIndex(
  current: number,
  direction: 1 | -1,
  count: number,
): number {
  if (count <= 0) return 0;
  if (current < 0) return direction === 1 ? 0 : count - 1;
  return (current + direction + count) % count;
}

function HomeSuggestionRow(props: {
  theme: ThemeTokens;
  suggestion: string;
  index: number;
  selected: () => boolean;
  onReady: (value: Renderable) => void;
  onSelect: (index: number) => void;
  onActivate: (value: string, event?: KeyEvent) => void;
}) {
  const colors = props.theme.colors;
  return (
    <box
      id={`home-suggestion-${props.index}`}
      ref={props.onReady}
      width="100%"
      flexDirection="row"
      focusable
      backgroundColor={themeColor(
        props.theme,
        props.selected() ? colors.background.active : colors.background.canvas,
      )}
      onMouseDown={() => {
        props.onSelect(props.index);
        props.onActivate(props.suggestion);
      }}
      onKeyDown={(event: KeyEvent) => {
        if (event.name === "return" || event.name === "enter") {
          props.onSelect(props.index);
          props.onActivate(props.suggestion, event);
        }
      }}
    >
      <text
        fg={themeColor(
          props.theme,
          props.selected() ? colors.purple[400] : colors.text.muted,
        )}
      >
        {props.selected() ? "› " : "  "}
      </text>
      <text
        fg={themeColor(
          props.theme,
          props.selected() ? colors.text.primary : colors.text.secondary,
        )}
      >
        {props.suggestion}
      </text>
    </box>
  );
}

export function HomeView(props: {
  theme: ThemeTokens;
  width: number;
  height?: number;
  model?: string;
  workspace?: string;
  branch?: string;
  dirty: boolean;
  selectedIndex: () => number;
  onSelect: (index: number) => void;
  onSuggestion: (value: string) => void;
  // Shrink-wrap instead of filling the viewport and pinning a hint at the
  // bottom of the leftover space. Used when the caller centers this block
  // together with the composer as one group (the "hero" landing state) —
  // in that mode there is no separate leftover region for a spacer to
  // claim, so the keyboard hint moves up to sit right under the
  // suggestions instead of pinning to a bottom edge that doesn't exist
  // here.
  compact?: boolean;
  }) {
  const colors = props.theme.colors;
  const suggestions = homeSuggestions(props.dirty);
  const logo = homeLogo(props.width);
  const rows: Array<Renderable | undefined> = [];
  createEffect(() => {
    const index = props.selectedIndex();
    if (index >= 0) queueMicrotask(() => rows[index]?.focus());
  });
  const activate = (value: string, event?: KeyEvent): void => {
    event?.preventDefault();
    props.onSuggestion(value);
  };
  // Concept B ("Anchored Workspace", docs/ui-core/CORE-LAYOUT-DECISION.md):
  // content anchors to the top at every terminal height instead of
  // vertically centering as a block — a tall terminal must never read as
  // "a small card floating in a large dead canvas". The empty space below
  // is intentional and is not filled with more content; a single quiet
  // hint line is pinned just above the composer when there's room for it.
  const tall = () => (props.height ?? 24) > 30;
  // Claude Code's welcome screen always names the working directory and
  // model up front — ShelraCode's status line named the model but never the
  // project, so a fresh session gave no confirmation of *which* repo you're
  // about to point an agent at. Kept to one quiet line, matching the
  // existing restraint: no new block, no border, no second line.
  const statusLine = () => {
    const project = props.workspace
      ? `${props.workspace}${props.branch ? ` · ${props.branch}` : ""}`
      : undefined;
    const ready = props.model
      ? `Local ready · ${props.model}`
      : "Local-first routing ready";
    return project ? `${project} · ${ready}` : ready;
  };
  return (
    <box
      id="core-home"
      flexGrow={props.compact ? 0 : 1}
      flexDirection="column"
      paddingX={1}
      paddingTop={props.compact ? 0 : tall() ? 2 : 1}
      // The composer's bordered box spans this column's full width — the
      // wordmark (94 or 53 cols) does not, so without centering it sits
      // flush against the left edge while the composer spans edge to edge
      // below it, and their centers never line up. `alignItems: "center"`
      // here (each direct child, i.e. the group below, shrinks to its own
      // content width and centers) plus the same on the group itself (so
      // its own narrower children — tagline, status line, "Try" — center
      // within the group's width, not just within the full column) gets
      // the wordmark's horizontal center to match the composer's.
      alignItems="center"
    >
      <box
        flexDirection="column"
        gap={props.width < 90 ? 0 : 2}
        alignItems="center"
      >
        {logo.length > 0 ? (
          <box flexDirection="column" alignItems="center">
            <For each={logo}>
              {(line) => (
                <text
                  wrapMode="none"
                  fg={themeColor(props.theme, colors.text.primary)}
                >
                  {line}
                </text>
              )}
            </For>
          </box>
        ) : (
          <box flexDirection="row" gap={1} alignItems="center">
            <text fg={themeColor(props.theme, colors.purple[500])}>◆</text>
            <text fg={themeColor(props.theme, colors.text.primary)}>
              <strong>ShelraCode</strong>
            </text>
          </box>
        )}
        <text fg={themeColor(props.theme, colors.text.secondary)}>
          Maximum intelligence. Your way.
        </text>
        <text fg={themeColor(props.theme, colors.text.tertiary)}>
          {statusLine()}
        </text>
        <box flexDirection="column" gap={0}>
          <text fg={themeColor(props.theme, colors.text.muted)}>Try</text>
          <For each={suggestions}>
            {(suggestion, index) => (
              <HomeSuggestionRow
                theme={props.theme}
                suggestion={suggestion}
                index={index()}
                selected={() => index() === props.selectedIndex()}
                onReady={(value) => {
                  rows[index()] = value;
                }}
                onSelect={props.onSelect}
                onActivate={activate}
              />
            )}
          </For>
        </box>
        {props.compact && props.width >= 70 ? (
          <text fg={themeColor(props.theme, colors.text.muted)}>
            {props.width >= 100
              ? "↑↓ browse · Enter to run · Ctrl+P commands"
              : "↑↓ · Enter · Ctrl+P"}
          </text>
        ) : null}
      </box>
      {!props.compact ? (
        <box flexGrow={1} flexDirection="column" justifyContent="flex-end">
          {props.width >= 70 ? (
            <text fg={themeColor(props.theme, colors.text.muted)}>
              {props.width >= 100
                ? "↑↓ browse · Enter to run · Ctrl+P commands"
                : "↑↓ · Enter · Ctrl+P"}
            </text>
          ) : null}
        </box>
      ) : null}
    </box>
  );
}
