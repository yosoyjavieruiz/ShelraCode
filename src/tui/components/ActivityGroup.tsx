import type { KeyEvent } from "@opentui/core";
import type { TranscriptMessage } from "../state/conversation.js";
import type { ThemeTokens } from "../theme/tokens.js";
import { themeColor } from "../theme/tokens.js";
import { StatusMark, type StatusState } from "./StatusMark.js";

export function ActivityGroup(props: {
  theme: ThemeTokens;
  messages: TranscriptMessage[];
  expanded: boolean;
  onToggle: () => void;
}) {
  const colors = props.theme.colors;
  const first = props.messages[0];
  const kinds = [
    ...new Set(
      props.messages.map(
        (item) => item.text.trim().split(/\s+/)[0]?.toUpperCase() || "TOOL",
      ),
    ),
  ];
  const status = props.messages.some((item) => item.status === "danger")
    ? "danger"
    : props.messages.some((item) => item.status === "warning")
      ? "warning"
      : props.messages.every((item) => item.status === "success")
        ? "success"
        : "info";
  const summary = `${kinds.slice(0, 2).join(" + ")}${
    props.messages.length > 1 ? ` · ${props.messages.length} actions` : ""
  }`;
  return (
    <box
      flexDirection="column"
      gap={0}
      focusable
      onMouseDown={props.onToggle}
      onKeyDown={(event: KeyEvent) => {
        if (event.name === "return" || event.name === "enter") {
          event.preventDefault();
          props.onToggle();
        }
      }}
    >
      <box flexDirection="row" gap={1}>
        <text fg={themeColor(props.theme, colors.text.muted)}>
          {props.expanded ? "v" : ">"}
        </text>
        <StatusMark
          theme={props.theme}
          state={status as StatusState}
          label={summary}
          detail={props.expanded ? "" : "Enter to expand"}
        />
      </box>
      {props.expanded
        ? props.messages.map((message) => (
            <box flexDirection="row" gap={1} paddingLeft={3}>
              <text fg={themeColor(props.theme, colors.text.secondary)}>
                {message.text}
              </text>
              {message.detail ? (
                <text fg={themeColor(props.theme, colors.text.muted)}>
                  {message.detail}
                </text>
              ) : null}
            </box>
          ))
        : null}
    </box>
  );
}
