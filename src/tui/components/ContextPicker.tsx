import type { KeyEvent, ScrollBoxRenderable } from "@opentui/core";
import { createEffect, createMemo } from "solid-js";
import type { ThemeTokens } from "../theme/tokens.js";
import { themeColor } from "../theme/tokens.js";
import { rankFileReferences } from "../state/search.js";

function trimTo(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width < 4) return value.slice(0, width);
  return `${value.slice(0, width - 3)}...`;
}

export function ContextPicker(props: {
  theme: ThemeTokens;
  width: number;
  height: number;
  files: () => string[];
  selectedFiles: () => string[];
  query: () => string;
  selectedIndex: () => number;
  onInput: (value: string) => void;
  onMove: (delta: number) => void;
  onToggle: (file: string) => void;
  onClose: () => void;
}) {
  const colors = props.theme.colors;
  const panelWidth = () => Math.max(36, Math.min(76, props.width - 8));
  const panelHeight = () =>
    Math.max(
      10,
      Math.min(props.height - 4, Math.min(24, props.files().length + 8)),
    );
  const filtered = createMemo(() => {
    return rankFileReferences(props.files(), props.query());
  });
  let viewport: ScrollBoxRenderable | undefined;
  createEffect(() => {
    const index = props.selectedIndex();
    queueMicrotask(() =>
      viewport?.scrollChildIntoView(`context-option-${index}`),
    );
  });
  const handleKeyDown = (event: KeyEvent): void => {
    if (event.name === "up" || event.name === "down") {
      event.preventDefault();
      props.onMove(event.name === "up" ? -1 : 1);
      return;
    }
    if (event.name === "return" || event.name === "enter") {
      event.preventDefault();
      const file = filtered()[props.selectedIndex()];
      if (file) props.onToggle(file);
      return;
    }
    if (event.name === "escape" || event.name === "esc") {
      event.preventDefault();
      props.onClose();
    }
  };

  return (
    <box
      position="absolute"
      top={Math.max(2, Math.floor((props.height - panelHeight()) / 2))}
      left={Math.max(2, Math.floor((props.width - panelWidth()) / 2))}
      width={panelWidth()}
      height={panelHeight()}
      padding={1}
      border
      borderStyle="single"
      borderColor={themeColor(props.theme, colors.border.default)}
      backgroundColor={themeColor(props.theme, colors.background.floating)}
      shouldFill
      zIndex={210}
      flexDirection="column"
    >
      <box height={1} flexDirection="row" justifyContent="space-between">
        <text fg={themeColor(props.theme, colors.text.primary)}>
          <strong>Context</strong>
        </text>
        <text fg={themeColor(props.theme, colors.text.tertiary)}>
          {() => `${props.selectedFiles().length} selected`}
        </text>
      </box>
      <input
        id="context-search"
        width="100%"
        value={props.query()}
        onInput={props.onInput}
        onKeyDown={handleKeyDown}
        focused
        backgroundColor={themeColor(props.theme, colors.background.floating)}
        textColor={themeColor(props.theme, colors.text.primary)}
        placeholder="Search repository files…"
        placeholderColor={themeColor(props.theme, colors.text.muted)}
        cursorColor={themeColor(props.theme, colors.purple[400])}
      />
      <text fg={themeColor(props.theme, colors.border.subtle)}>
        {"─".repeat(Math.max(1, panelWidth() - 4))}
      </text>
      <scrollbox
        ref={(value) => {
          viewport = value;
          queueMicrotask(() => {
            value.verticalScrollBar.visible = false;
            value.horizontalScrollBar.visible = false;
          });
        }}
        flexGrow={1}
        viewportCulling
      >
        <box flexDirection="column">
          {() =>
            filtered().map((file, index) => {
              const selected = () => index === props.selectedIndex();
              const included = () => props.selectedFiles().includes(file);
              return (
                <box
                  id={`context-option-${index}`}
                  height={1}
                  paddingX={1}
                  focusable
                  backgroundColor={
                    selected()
                      ? themeColor(props.theme, colors.background.active)
                      : undefined
                  }
                  onMouseDown={() => props.onToggle(file)}
                  onKeyDown={(event: KeyEvent) => {
                    if (event.name === "return" || event.name === "enter") {
                      event.preventDefault();
                      props.onToggle(file);
                    }
                  }}
                >
                  <text
                    width="100%"
                    fg={themeColor(
                      props.theme,
                      selected() ? colors.text.primary : colors.text.secondary,
                    )}
                  >
                    {`${included() ? "✓" : " "}  ${trimTo(file, panelWidth() - 8)}`}
                  </text>
                </box>
              );
            })
          }
          {filtered().length === 0 ? (
            <text fg={themeColor(props.theme, colors.text.muted)}>
              No matching files
            </text>
          ) : null}
        </box>
      </scrollbox>
      <text fg={themeColor(props.theme, colors.text.muted)}>
        Enter add/remove · Esc done
      </text>
    </box>
  );
}
