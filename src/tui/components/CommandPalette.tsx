import type { KeyEvent } from "@opentui/core";
import { For } from "solid-js";
import type { UICommand } from "../commands/registry.js";
import { groupUICommands, rankUICommands } from "../commands/registry.js";
import type { ThemeTokens } from "../theme/tokens.js";
import { themeColor } from "../theme/tokens.js";

function trimTo(value: string, width: number): string {
  const safeWidth = Math.max(1, width);
  if (value.length <= safeWidth) return value;
  if (safeWidth < 4) return value.slice(0, safeWidth);
  return `${value.slice(0, safeWidth - 3)}...`;
}

export function CommandPalette(props: {
  theme: ThemeTokens;
  query: string;
  commands: UICommand[];
  selectedIndex: number;
  recentIds?: string[];
  width?: number;
  height?: number;
  onInput: (value: string) => void;
  onSubmit: (index?: number) => void;
  onKeyDown?: (event: KeyEvent) => void;
}) {
  const width = () => props.width ?? 120;
  const height = () => props.height ?? 40;
  const panelWidth = () =>
    Math.max(36, Math.min(width() - 4, width() < 110 ? 76 : 96));
  const contentWidth = () => Math.max(24, panelWidth() - 4);
  const showDescriptions = () => width() >= 120;
  const showShortcuts = () => width() >= 100;
  const maxItems = () =>
    height() < 28 ? (width() < 110 ? 5 : 8) : width() < 110 ? 6 : 12;
  const visible = () =>
    rankUICommands(props.commands, props.query, props.recentIds).slice(
      0,
      maxItems(),
    );
  const groups = () => groupUICommands(visible());
  const colors = props.theme.colors;
  const panelLeft = () => Math.max(2, Math.floor((width() - panelWidth()) / 2));
  const groupHeaderCount = () => groups().size;
  const panelHeight = () => {
    const footer = showShortcuts() ? 1 : 0;
    const calculated = 6 + visible().length + groupHeaderCount() + footer;
    return Math.min(Math.max(8, calculated), Math.max(8, height() - 3));
  };
  return (
    <box
      position="absolute"
      top={2}
      left={panelLeft()}
      width={panelWidth()}
      height={panelHeight()}
      padding={1}
      border
      borderStyle="single"
      borderColor={themeColor(props.theme, colors.border.focus)}
      backgroundColor={themeColor(props.theme, colors.background.floating)}
      shouldFill
      focusedBorderColor={themeColor(props.theme, colors.purple[400])}
      zIndex={200}
      flexDirection="column"
      gap={0}
    >
      <box flexDirection="row" gap={1} height={1}>
        <text width={2} fg={themeColor(props.theme, colors.purple[300])}>
          {"? "}
        </text>
        <input
          width={Math.max(10, contentWidth() - 3)}
          value={props.query}
          onInput={props.onInput}
          onSubmit={() => props.onSubmit()}
          onKeyDown={props.onKeyDown}
          focused
          backgroundColor={themeColor(props.theme, colors.background.floating)}
          textColor={themeColor(props.theme, colors.text.primary)}
          placeholder="Search commands..."
          placeholderColor={themeColor(props.theme, colors.text.muted)}
          cursorColor={themeColor(props.theme, colors.purple[400])}
        />
      </box>
      <text fg={themeColor(props.theme, colors.border.subtle)}>
        {"-".repeat(contentWidth())}
      </text>
      {visible().length === 0 ? (
        <text fg={themeColor(props.theme, colors.text.muted)}>
          No matching commands
        </text>
      ) : (
        <For each={[...groups().entries()]}>
          {(entry) => (
            <box height={1 + entry[1].length} flexDirection="column" gap={0}>
              <text fg={themeColor(props.theme, colors.text.muted)}>
                {entry[0].toUpperCase()}
              </text>
              <For each={entry[1]}>
                {(command) => {
                  const absoluteIndex = () =>
                    visible().findIndex((item) => item.id === command.id);
                  const selected = () =>
                    absoluteIndex() === props.selectedIndex;
                  const shortcut = command.keybinding ?? "";
                  const shortcutWidth = showShortcuts()
                    ? Math.min(16, Math.max(8, contentWidth() - 30))
                    : 0;
                  const availableLabelWidth = Math.max(
                    8,
                    contentWidth() -
                      2 -
                      (showShortcuts() ? shortcutWidth + 1 : 0),
                  );
                  const description =
                    showDescriptions() && command.description
                      ? ` · ${command.description}`
                      : "";
                  return (
                    <box
                      height={1}
                      paddingX={1}
                      flexDirection="row"
                      gap={1}
                      backgroundColor={
                        selected()
                          ? themeColor(props.theme, colors.background.active)
                          : undefined
                      }
                      focusable
                      onMouseDown={() => props.onSubmit(absoluteIndex())}
                      onKeyDown={(event: KeyEvent) => {
                        if (event.name === "return" || event.name === "enter") {
                          event.preventDefault();
                          props.onSubmit(absoluteIndex());
                        }
                      }}
                    >
                      <text
                        width={availableLabelWidth}
                        fg={themeColor(
                          props.theme,
                          selected()
                            ? colors.text.primary
                            : colors.text.secondary,
                        )}
                      >
                        <strong>
                          {trimTo(
                            `${selected() ? "> " : "  "}${command.label}${description}`,
                            availableLabelWidth,
                          )}
                        </strong>
                      </text>
                      {showShortcuts() ? (
                        <text
                          width={shortcutWidth}
                          fg={themeColor(props.theme, colors.text.tertiary)}
                        >
                          {trimTo(shortcut, shortcutWidth)}
                        </text>
                      ) : null}
                    </box>
                  );
                }}
              </For>
            </box>
          )}
        </For>
      )}
      {showShortcuts() ? (
        <text fg={themeColor(props.theme, colors.text.muted)}>
          Up/Down navigate Enter run Esc close
        </text>
      ) : null}
    </box>
  );
}
