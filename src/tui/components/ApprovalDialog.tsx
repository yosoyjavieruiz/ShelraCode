import type { KeyEvent } from "@opentui/core";
import type { ThemeTokens } from "../theme/tokens.js";
import { themeColor } from "../theme/tokens.js";

export function ApprovalDialog(props: {
  theme: ThemeTokens;
  width: number;
  height: number;
  action?: string;
  impact?: string;
  onApprove?: () => void;
  onCancel?: () => void;
  onKeyDown?: (event: KeyEvent) => void;
}) {
  const colors = props.theme.colors;
  const panelWidth = Math.min(Math.max(48, props.width - 8), 86);
  return (
    <box
      id="approval-dialog"
      ref={(value) => queueMicrotask(() => value.focus())}
      position="absolute"
      top={Math.max(2, Math.floor((props.height - 15) / 2))}
      left={Math.max(2, Math.floor((props.width - panelWidth) / 2))}
      width={panelWidth}
      height={15}
      padding={1}
      border
      borderStyle="single"
      borderColor={themeColor(props.theme, colors.status.warning)}
      focusedBorderColor={themeColor(props.theme, colors.purple[400])}
      backgroundColor={themeColor(props.theme, colors.background.floating)}
      shouldFill
      focusable
      focused
      zIndex={220}
      onKeyDown={(event: KeyEvent) => {
        if (event.name === "return" || event.name === "enter") {
          event.preventDefault();
          props.onApprove?.();
        } else if (event.name === "escape" || event.name === "esc") {
          event.preventDefault();
          props.onCancel?.();
        } else {
          props.onKeyDown?.(event);
        }
      }}
    >
      <box flexDirection="column" gap={1}>
        <text fg={themeColor(props.theme, colors.status.warning)}>
          <strong>Approval required</strong>
        </text>
        <text fg={themeColor(props.theme, colors.text.primary)}>
          Allow workspace action
        </text>
        <text fg={themeColor(props.theme, colors.text.secondary)}>
          {props.action ?? "npm publish"}
        </text>
        <text fg={themeColor(props.theme, colors.text.secondary)}>
          {props.impact ?? "This creates an external side effect."}
        </text>
        <text fg={themeColor(props.theme, colors.text.muted)}>
          Review the exact action before allowing it once.
        </text>
        <text fg={themeColor(props.theme, colors.purple[300])}>
          Esc deny Enter allow once
        </text>
      </box>
    </box>
  );
}
