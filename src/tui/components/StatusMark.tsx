import type { ThemeTokens } from "../theme/tokens.js";
import { themeColor } from "../theme/tokens.js";

export type StatusState = "success" | "warning" | "danger" | "info" | "muted";

const glyphs: Record<StatusState, string> = {
  success: "✓",
  warning: "!",
  danger: "×",
  info: "→",
  muted: "○",
};

export function StatusMark(props: {
  theme: ThemeTokens;
  state: StatusState;
  label: string;
  detail?: string;
}) {
  const colors = props.theme.colors;
  const color =
    props.state === "success"
      ? colors.status.success
      : props.state === "warning"
        ? colors.status.warning
        : props.state === "danger"
          ? colors.status.danger
          : props.state === "info"
            ? colors.status.info
            : colors.text.muted;
  return (
    <text fg={themeColor(props.theme, color)}>
      <strong>{glyphs[props.state]}</strong> {props.label}
      {props.detail ? ` · ${props.detail}` : ""}
    </text>
  );
}
