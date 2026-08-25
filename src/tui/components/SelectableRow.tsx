import type { KeyEvent } from "@opentui/core";
import type { ThemeTokens } from "../theme/tokens.js";
import { themeColor } from "../theme/tokens.js";

export function SelectableRow(props: {
  theme: ThemeTokens;
  title: string;
  subtitle?: string;
  trailing?: string;
  focused?: boolean;
  selected?: boolean;
  onActivate?: () => void;
}) {
  const colors = props.theme.colors;
  const active = props.focused || props.selected;
  return (
    <box
      width="100%"
      minHeight={1}
      paddingX={1}
      flexDirection="row"
      justifyContent="space-between"
      gap={2}
      focusable
      onMouseDown={props.onActivate}
      onKeyDown={(event: KeyEvent) => {
        if (
          event.name === "return" ||
          event.name === "enter" ||
          event.name === "space"
        ) {
          event.preventDefault();
          props.onActivate?.();
        }
      }}
      backgroundColor={
        active ? themeColor(props.theme, colors.background.active) : undefined
      }
    >
      <box flexDirection="row" gap={1} flexGrow={1}>
        <text
          fg={themeColor(
            props.theme,
            active ? colors.purple[300] : colors.text.muted,
          )}
        >
          {props.focused ? "›" : props.selected ? "●" : " "}
        </text>
        <box flexDirection="column" flexGrow={1}>
          <text
            fg={themeColor(
              props.theme,
              active ? colors.text.primary : colors.text.secondary,
            )}
          >
            {props.title}
          </text>
          {props.subtitle ? (
            <text fg={themeColor(props.theme, colors.text.muted)}>
              {props.subtitle}
            </text>
          ) : null}
        </box>
      </box>
      {props.trailing ? (
        <text
          fg={themeColor(
            props.theme,
            active ? colors.purple[300] : colors.text.tertiary,
          )}
        >
          {props.trailing}
        </text>
      ) : null}
    </box>
  );
}
