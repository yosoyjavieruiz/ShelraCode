import type { ThemeTokens } from "../theme/tokens.js";
import { themeColor } from "../theme/tokens.js";

export function Surface(props: {
  theme: ThemeTokens;
  tone?: "surface" | "elevated" | "floating" | "active";
  children?: unknown;
  width?: number | "auto" | `${number}%`;
  height?: number | "auto" | `${number}%`;
  flexGrow?: number;
  padding?: number;
  paddingX?: number;
  paddingY?: number;
  flexDirection?: "row" | "column";
  gap?: number;
  border?: boolean;
  borderColor?: string;
}) {
  const background = props.theme.colors.background;
  return (
    <box
      width={props.width}
      height={props.height}
      flexGrow={props.flexGrow}
      padding={props.padding}
      paddingX={props.paddingX}
      paddingY={props.paddingY}
      flexDirection={props.flexDirection}
      gap={props.gap}
      border={props.border}
      borderColor={themeColor(
        props.theme,
        props.borderColor ?? props.theme.colors.border.subtle,
      )}
      backgroundColor={themeColor(
        props.theme,
        background[props.tone ?? "surface"],
      )}
    >
      {props.children}
    </box>
  );
}

export function Divider(props: { theme: ThemeTokens; width: number }) {
  return (
    <text fg={themeColor(props.theme, props.theme.colors.border.subtle)}>
      {"─".repeat(Math.max(1, props.width))}
    </text>
  );
}

export function Kbd(props: { theme: ThemeTokens; children: string }) {
  return (
    <text
      fg={themeColor(props.theme, props.theme.colors.text.tertiary)}
      bg={themeColor(props.theme, props.theme.colors.background.elevated)}
    >
      {` ${props.children} `}
    </text>
  );
}

export function StatusDot(props: {
  theme: ThemeTokens;
  state: "success" | "warning" | "danger" | "info" | "muted";
  label?: string;
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
      ●{props.label ? ` ${props.label}` : ""}
    </text>
  );
}

export function Tag(props: {
  theme: ThemeTokens;
  label: string;
  tone?: "accent" | "local" | "cloud" | "muted" | "warning";
}) {
  const colors = props.theme.colors;
  const color =
    props.tone === "local"
      ? colors.purple[400]
      : props.tone === "cloud"
        ? colors.status.info
        : props.tone === "warning"
          ? colors.status.warning
          : props.tone === "muted"
            ? colors.text.tertiary
            : colors.purple[300];
  return (
    <text fg={themeColor(props.theme, color)}>
      <strong>{props.label}</strong>
    </text>
  );
}

export function Meter(props: {
  theme: ThemeTokens;
  value: number;
  width?: number;
  label?: string;
  tone?: "accent" | "success" | "warning" | "danger";
}) {
  const width = props.width ?? 16;
  const value = Math.max(0, Math.min(1, props.value));
  const filled = Math.round(width * value);
  const color =
    props.tone === "success"
      ? props.theme.colors.status.success
      : props.tone === "warning"
        ? props.theme.colors.status.warning
        : props.tone === "danger"
          ? props.theme.colors.status.danger
          : props.theme.colors.purple[500];
  return (
    <box flexDirection="row">
      <text fg={themeColor(props.theme, color)}>{"█".repeat(filled)}</text>
      <text fg={themeColor(props.theme, props.theme.colors.text.disabled)}>
        {"░".repeat(width - filled)}
      </text>
      {props.label ? (
        <text fg={themeColor(props.theme, props.theme.colors.text.secondary)}>
          {` ${props.label}`}
        </text>
      ) : null}
    </box>
  );
}

export function SectionHeading(props: {
  theme: ThemeTokens;
  eyebrow?: string;
  title: string;
  detail?: string;
}) {
  return (
    <box flexDirection="column" gap={1}>
      {props.eyebrow ? (
        <text fg={themeColor(props.theme, props.theme.colors.purple[400])}>
          <strong>{props.eyebrow.toUpperCase()}</strong>
        </text>
      ) : null}
      <text fg={themeColor(props.theme, props.theme.colors.text.primary)}>
        <strong>{props.title}</strong>
        {props.detail ? `  ${props.detail}` : ""}
      </text>
    </box>
  );
}

export function EmptyState(props: {
  theme: ThemeTokens;
  icon?: string;
  title: string;
  detail: string;
  action?: string;
}) {
  return (
    <box flexDirection="column" gap={1} padding={2}>
      <text fg={themeColor(props.theme, props.theme.colors.purple[300])}>
        <strong>{props.icon ?? "◈"}</strong>
      </text>
      <text fg={themeColor(props.theme, props.theme.colors.text.primary)}>
        <strong>{props.title}</strong>
      </text>
      <text fg={themeColor(props.theme, props.theme.colors.text.secondary)}>
        {props.detail}
      </text>
      {props.action ? (
        <text fg={themeColor(props.theme, props.theme.colors.purple[300])}>
          → {props.action}
        </text>
      ) : null}
    </box>
  );
}

export function LoadingState(props: {
  theme: ThemeTokens;
  title: string;
  detail: string;
}) {
  return (
    <box flexDirection="column" gap={1} padding={2}>
      <text fg={themeColor(props.theme, props.theme.colors.status.info)}>
        <strong>→ Loading</strong>
      </text>
      <text fg={themeColor(props.theme, props.theme.colors.text.primary)}>
        <strong>{props.title}</strong>
      </text>
      <text fg={themeColor(props.theme, props.theme.colors.text.secondary)}>
        {props.detail}
      </text>
    </box>
  );
}

export function Metric(props: {
  theme: ThemeTokens;
  label: string;
  value: string;
  tone?: "normal" | "success" | "warning";
}) {
  const color =
    props.tone === "success"
      ? props.theme.colors.status.success
      : props.tone === "warning"
        ? props.theme.colors.status.warning
        : props.theme.colors.text.primary;
  return (
    <box flexDirection="column">
      <text fg={themeColor(props.theme, props.theme.colors.text.muted)}>
        {props.label}
      </text>
      <text fg={themeColor(props.theme, color)}>
        <strong>{props.value}</strong>
      </text>
    </box>
  );
}
