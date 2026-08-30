import type { KeyEvent } from "@opentui/core";
import type { ThemeTokens } from "../theme/tokens.js";
import { themeColor } from "../theme/tokens.js";
import {
  APPROVAL_OPTIONS,
  approvalDecisionForKey,
  type ApprovalOption,
} from "../state/approval.js";

type AccessorOrValue<T> = T | (() => T);

function readProp<T>(value: AccessorOrValue<T> | undefined): T | undefined {
  return typeof value === "function" ? (value as () => T)() : value;
}

export function ApprovalDialog(props: {
  theme: ThemeTokens;
  // Must be the raw signal accessor, not an already-invoked value
  // (`width={width}`, not `width={width()}`). This render pipeline's
  // reactive binding for a custom component only tracks a dependency when
  // it receives a function to call itself -- an invoked value is a frozen
  // snapshot from whenever the parent's render body last ran. Confirmed
  // bug: the whole dialog rendered invisible/stuck on the first real
  // approval request because every prop here was passed pre-invoked (see
  // src/tui/components/StatusBar.tsx and Composer.tsx for the same
  // constraint already documented and worked around there).
  width: AccessorOrValue<number>;
  height: AccessorOrValue<number>;
  action?: AccessorOrValue<string | undefined>;
  impact?: AccessorOrValue<string | undefined>;
  scopeDescription?: AccessorOrValue<string | undefined>;
  // Bounded before/after excerpt of the exact content this action would
  // write (see ToolApprovalRequest.preview, tools/types.ts) — approving a
  // write/edit/delete must show what will change, not just a path, so the
  // decision is never made blind to the actual content.
  preview?: AccessorOrValue<string[] | undefined>;
  busy?: AccessorOrValue<boolean>;
  selectedIndex?: AccessorOrValue<number>;
  onDecision?: (decision: ApprovalOption["decision"]) => void;
  onMove?: (delta: 1 | -1) => void;
  onApprove?: () => void;
  onCancel?: () => void;
  onKeyDown?: (event: KeyEvent) => void;
}) {
  const colors = props.theme.colors;
  const width = () => readProp(props.width) ?? 0;
  const height = () => readProp(props.height) ?? 0;
  const busy = () => readProp(props.busy) ?? false;
  const panelWidth = () => Math.min(Math.max(48, width() - 8), 86);
  const selectedIndex = () =>
    Math.min(
      APPROVAL_OPTIONS.length - 1,
      Math.max(0, readProp(props.selectedIndex) ?? 0),
    );
  // Capped short: this is a preview to sanity-check before deciding, not a
  // pager — the full diff still renders in the transcript once the action
  // runs (tool-renderers.tsx). Panel height grows to fit it so the preview
  // is never clipped by a fixed box.
  const PREVIEW_MAX_LINES = 8;
  const previewLines = () => (readProp(props.preview) ?? []).slice(0, PREVIEW_MAX_LINES);
  const panelHeight = () => 20 + (previewLines().length > 0 ? previewLines().length + 1 : 0);
  return (
    <box
      id="approval-dialog"
      ref={(value) => queueMicrotask(() => value.focus())}
      position="absolute"
      top={Math.max(1, Math.floor((height() - panelHeight()) / 2))}
      left={Math.max(2, Math.floor((width() - panelWidth()) / 2))}
      width={panelWidth()}
      height={panelHeight()}
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
        if (busy()) {
          event.preventDefault();
          return;
        }
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
          if (decision) {
            event.preventDefault();
            props.onDecision?.(decision);
          } else props.onKeyDown?.(event);
        }
      }}
    >
      <box flexDirection="column" gap={1}>
        <text fg={themeColor(props.theme, colors.status.warning)}>
          <strong>
            {() => (busy() ? "Saving permission" : "Approval required")}
          </strong>
        </text>
        <text fg={themeColor(props.theme, colors.text.primary)}>
          Allow workspace action
        </text>
        <text fg={themeColor(props.theme, colors.text.secondary)}>
          {() => readProp(props.action) ?? "npm publish"}
        </text>
        <text fg={themeColor(props.theme, colors.text.secondary)}>
          {() =>
            readProp(props.impact) ?? "This creates an external side effect."
          }
        </text>
        {() => {
          const lines = previewLines();
          const total = readProp(props.preview)?.length ?? 0;
          if (lines.length === 0) return null;
          return (
            <box flexDirection="column" gap={0}>
              {lines.map((line) => (
                <text
                  fg={themeColor(
                    props.theme,
                    line.startsWith("+")
                      ? colors.git.added
                      : line.startsWith("-")
                        ? colors.git.removed
                        : colors.text.muted,
                  )}
                >
                  {line}
                </text>
              ))}
              {total > lines.length ? (
                <text fg={themeColor(props.theme, colors.text.muted)}>
                  {`  … ${total - lines.length} more preview lines`}
                </text>
              ) : null}
            </box>
          );
        }}
        <text fg={themeColor(props.theme, colors.text.muted)}>
          {() =>
            busy()
              ? "Saving your permission before the agent continues…"
              : "Review the action and choose how long the permission should last."
          }
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
                  {() =>
                    `${index === selectedIndex() ? "›" : " "} [${option.key}] ${option.label}`
                  }
                </strong>
                {() => {
                  const scopeDescription = readProp(props.scopeDescription);
                  return ` · ${
                    option.decision === "session" && scopeDescription
                      ? `Do not ask again for ${scopeDescription} this session`
                      : option.decision === "project" && scopeDescription
                        ? `Save ${scopeDescription} for this project`
                        : option.detail
                  }`;
                }}
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
