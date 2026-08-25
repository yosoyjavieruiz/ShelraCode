import type { ThemeTokens } from "../theme/tokens.js";
import { themeColor } from "../theme/tokens.js";

export function WorkspaceHeader(props: {
  theme: ThemeTokens;
  eyebrow?: string;
  title: string;
  detail?: string;
}) {
  const colors = props.theme.colors;
  return (
    <box flexDirection="column" gap={1} paddingBottom={1}>
      {props.eyebrow ? (
        <text fg={themeColor(props.theme, colors.text.muted)}>
          {props.eyebrow.toUpperCase()}
        </text>
      ) : null}
      <text fg={themeColor(props.theme, colors.text.primary)}>
        <strong>{props.title}</strong>
        {props.detail ? `  ${props.detail}` : ""}
      </text>
    </box>
  );
}
