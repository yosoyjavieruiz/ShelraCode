import { For } from "solid-js";
import type { ThemeTokens } from "../theme/tokens.js";
import { themeColor } from "../theme/tokens.js";

// Inline "/" suggestions, anchored directly above the composer as a small
// bottom sheet — not the Ctrl+P command palette (CommandPalette.tsx), which
// stays a deliberate full-screen "search everything" modal with its own
// input. This has no input of its own: the composer's real textarea stays
// focused and is the only place keystrokes go, so there's exactly one
// source of truth for what's typed and one obvious way to close it (clear
// the "/" or press Esc — both handled by the caller, not this component).
//
// Generic over what it's listing (commands, models, anything with an id +
// a primary/secondary label) — Claude Code resolves "/model opus" entirely
// inline, never leaving the composer for a separate screen; this is what
// makes that possible for ShelraCode's own commands-with-arguments (see
// app.tsx's slash-mode handling for "/model").
export interface SlashMenuRow {
  id: string;
  primary: string;
  secondary?: string;
}

const MAX_VISIBLE = 6;

export function SlashCommandMenu(props: {
  theme: ThemeTokens;
  // The composer's own draft text (e.g. "/mo") — displayed here styled as
  // a search field so the sheet visually confirms what's being searched,
  // even though the composer's real textarea underneath is still the one
  // actual cursor. Read-only display, not a second input: see the file
  // comment on why there's only ever one place keystrokes go.
  query: string;
  rows: SlashMenuRow[];
  selectedIndex: number;
  x: number;
  y: number;
  width: number;
  emptyHint?: string;
}) {
  const colors = props.theme.colors;
  const visible = () => props.rows.slice(0, MAX_VISIBLE);
  // Fixed height regardless of how many rows currently match — reflowing
  // (and re-anchoring, since this sheet is positioned by its own height)
  // on every keystroke as the match count changes is exactly the
  // "no me deja fluir bien" jankiness this fixes. Empty space below a
  // short result list is normal dropdown behavior, not a bug.
  const height = () => MAX_VISIBLE + 2 + 1 + 2;
  const menuY = () => Math.max(0, props.y - height() - 1);
  return (
    <box
      id="slash-command-menu"
      position="absolute"
      top={menuY()}
      left={props.x}
      width={props.width}
      height={height()}
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={themeColor(props.theme, colors.purple[500])}
      backgroundColor={themeColor(props.theme, colors.background.floating)}
      zIndex={150}
    >
      <box flexDirection="row" gap={1} height={1} paddingX={1}>
        <text fg={themeColor(props.theme, colors.purple[400])}>{"/"}</text>
        <text
          fg={themeColor(
            props.theme,
            props.query.length > 1 ? colors.text.primary : colors.text.tertiary,
          )}
        >
          {props.query.replace(/^\//, "") || "Search commands…"}
        </text>
      </box>
      <text fg={themeColor(props.theme, colors.border.subtle)}>
        {"─".repeat(Math.max(1, props.width - 2))}
      </text>
      {visible().length === 0 ? (
        <text fg={themeColor(props.theme, colors.text.muted)}>
          {props.emptyHint ?? "No matches · Esc to close"}
        </text>
      ) : (
        <For each={visible()}>
          {(row, index) => {
            const selected = () => index() === props.selectedIndex;
            return (
              <box
                flexDirection="row"
                gap={1}
                paddingX={1}
                backgroundColor={
                  selected()
                    ? themeColor(props.theme, colors.background.active)
                    : undefined
                }
              >
                <text
                  fg={themeColor(
                    props.theme,
                    selected() ? colors.purple[400] : colors.text.muted,
                  )}
                >
                  {row.primary}
                </text>
                {row.secondary ? (
                  <text
                    fg={themeColor(
                      props.theme,
                      selected() ? colors.text.primary : colors.text.secondary,
                    )}
                  >
                    {row.secondary}
                  </text>
                ) : null}
              </box>
            );
          }}
        </For>
      )}
      <text fg={themeColor(props.theme, colors.text.muted)}>
        {"  ↑↓ select · Enter run · Esc close"}
      </text>
    </box>
  );
}
