import type { ThemeTokens } from "../theme/tokens.js";
import { themeColor } from "../theme/tokens.js";

export function ProgressBar(props: {
  theme: ThemeTokens;
  label: string;
  value: number;
  max: number;
  width?: number;
}) {
  const colors = props.theme.colors;
  const ratio =
    props.max > 0 ? Math.max(0, Math.min(1, props.value / props.max)) : 0;
  const percent = Math.round(ratio * 100);
  const width = Math.max(8, props.width ?? 18);
  const filled = Math.round(width * ratio);
  return (
    <box flexDirection="row" gap={1}>
      <text fg={themeColor(props.theme, colors.text.secondary)}>
        {props.label}
      </text>
      <text fg={themeColor(props.theme, colors.purple[300])}>
        {"█".repeat(filled)}
      </text>
      <text fg={themeColor(props.theme, colors.text.muted)}>
        {"░".repeat(width - filled)} {percent}%
      </text>
    </box>
  );
}
