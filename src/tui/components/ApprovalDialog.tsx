import type { KeyEvent } from "@opentui/core";
import type { ThemeTokens } from "../theme/tokens.js";
import { themeColor } from "../theme/tokens.js";
import {
  APPROVAL_OPTIONS,
  approvalDecisionForKey,
  type ApprovalOption,
} from "../state/approval.js";

export function ApprovalDialog(props: {
  theme: ThemeTokens;
  width: number;
  height: number;
  action?: string;
  impact?: string;
  selectedIndex?: number;
  onDecision?: (decision: ApprovalOption["decision"]) => void;
  onMove?: (delta: 1 | -1) => void;
  onApprove?: () => void;
  onCancel?: () => void;
  onKeyDown?: (event: KeyEvent) => void;
}) {
  const colors = props.theme.colors;
  const panelWidth = Math.min(Math.max(48, props.width - 8), 86);
  const selectedIndex = () =>
    Math.min(
      APPROVAL_OPTIONS.length - 1,
      Math.max(0, props.selectedIndex ?? 0),
    );
  return (
    <box
      id="approval-dialog"
      ref={(value) => queueMicrotask(() => value.focus())}
      position="absolute"
      top={Math.max(1, Math.floor((props.height - 20) / 2))}
      left={Math.max(2, Math.floor((props.width - panelWidth) / 2))}
      width={panelWidth}
      height={20}
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
          const option = APPROVAL_OPTIONS[selectedIndex()];
          if (option) props.onDecision?.(option.decision);
          else props.onApprove?.();
        } else if (event.name === "escape" || event.name === "esc") {
          event.preventDefault();
          if (props.onDecision) props.onDecision("deny");
          else props.onCancel?.();
        } else if (event.name === "up" || event.name === "down") {
          event.preventDefault();
          props.onMove?.(event.name === "up" ? -1 : 1);
        } else {
          const decision = approvalDecisionForKey(event.name);
          if (decision) props.onDecision?.(decision);
          else props.onKeyDown?.(event);
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
          Review the action and choose how long the permission should last.
        </text>
        <box flexDirection="column" gap={0}>
          {APPROVAL_OPTIONS.map((option, index) => (
            <box
              id={`approval-option-${index}`}
              height={1}
              flexDirection="row"
              gap={1}
              backgroundColor={
                index === selectedIndex()
                  ? themeColor(props.theme, colors.background.active)
                  : undefined
              }
            >
              <text fg={themeColor(props.theme, colors.text.primary)}>
                <strong>
                  {`${index === selectedIndex() ? "›" : " "} [${option.key}] ${option.label}`}
                </strong>
                {` · ${option.detail}`}
              </text>
            </box>
          ))}
        </box>
        <text fg={themeColor(props.theme, colors.purple[300])}>
          ↑↓ select · Enter confirm · Esc deny
        </text>
      </box>
    </box>
  );
}
