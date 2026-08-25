import type { KeyEvent } from "@opentui/core";
import type { ThemeTokens } from "../theme/tokens.js";
import { themeColor } from "../theme/tokens.js";
import { Meter, SectionHeading, StatusDot } from "./primitives.js";

type NavItem = {
  id: string;
  label: string;
  icon: string;
};

const navGroups: Array<{ label: string; items: NavItem[] }> = [
  {
    label: "WORKSPACE",
    items: [
      { id: "conversation", label: "Chat", icon: "◈" },
      { id: "plan", label: "Plan", icon: "≡" },
      { id: "diff", label: "Changes", icon: "±" },
    ],
  },
  {
    label: "SYSTEM",
    items: [
      { id: "models", label: "Models", icon: "◆" },
      { id: "providers", label: "Providers", icon: "●" },
      { id: "routing", label: "Routing", icon: "⇄" },
      { id: "quota", label: "Usage", icon: "▥" },
    ],
  },
  {
    label: "PROJECT",
    items: [
      { id: "context", label: "Context", icon: "@" },
      { id: "checkpoint", label: "Checkpoints", icon: "⌁" },
      { id: "settings", label: "Settings", icon: "⚙" },
    ],
  },
];

export function Sidebar(props: {
  theme: ThemeTokens;
  active: string;
  collapsed?: boolean;
  onNavigate: (id: string) => void;
}) {
  const colors = props.theme.colors;
  return (
    <box
      width={props.collapsed ? 5 : 24}
      paddingX={1}
      paddingY={1}
      flexDirection="column"
      gap={1}
      backgroundColor={themeColor(props.theme, colors.background.surface)}
    >
      {props.collapsed
        ? navGroups
            .flatMap((group) => group.items)
            .map((item) => (
              <text
                fg={themeColor(
                  props.theme,
                  props.active === item.id
                    ? colors.purple[300]
                    : colors.text.muted,
                )}
              >
                {item.icon}
              </text>
            ))
        : navGroups.map((group) => (
            <box flexDirection="column" gap={0}>
              <text fg={themeColor(props.theme, colors.text.muted)}>
                {group.label}
              </text>
              {group.items.map((item) => {
                const selected = props.active === item.id;
                return (
                  <box
                    height={1}
                    paddingX={1}
                    flexDirection="row"
                    gap={1}
                    backgroundColor={
                      selected
                        ? themeColor(props.theme, colors.background.active)
                        : undefined
                    }
                    onMouseDown={() => props.onNavigate(item.id)}
                    focusable
                    onKeyDown={(event: KeyEvent) => {
                      if (
                        event.name === "return" ||
                        event.name === "enter" ||
                        event.name === "space"
                      ) {
                        event.preventDefault();
                        props.onNavigate(item.id);
                      }
                    }}
                  >
                    <text
                      fg={themeColor(
                        props.theme,
                        selected ? colors.purple[300] : colors.text.muted,
                      )}
                    >
                      {selected ? "›" : item.icon}
                    </text>
                    <text
                      fg={themeColor(
                        props.theme,
                        selected ? colors.text.primary : colors.text.secondary,
                      )}
                    >
                      {item.label}
                    </text>
                  </box>
                );
              })}
            </box>
          ))}
      {!props.collapsed ? (
        <box flexGrow={1} justifyContent="flex-end" flexDirection="column">
          <text fg={themeColor(props.theme, colors.text.muted)}>
            Ctrl+X shortcuts
          </text>
        </box>
      ) : null}
    </box>
  );
}

export function Inspector(props: {
  theme: ThemeTokens;
  objective: string;
  route?: string;
  model?: string;
  contextFiles: string[];
  lines: string[];
}) {
  const colors = props.theme.colors;
  const steps = [
    { label: "Inspect repository", done: Boolean(props.objective) },
    { label: "Select policy-safe route", done: Boolean(props.route) },
    { label: "Implement and verify", done: false },
  ];
  return (
    <box
      width={32}
      paddingX={1}
      paddingY={1}
      flexDirection="column"
      gap={1}
      backgroundColor={themeColor(props.theme, colors.background.surface)}
    >
      <SectionHeading
        theme={props.theme}
        eyebrow="Inspector"
        title="Current task"
      />
      <text
        fg={themeColor(props.theme, colors.text.primary)}
        width="100%"
        wrapMode="word"
      >
        {props.objective || "No active task"}
      </text>
      <text fg={themeColor(props.theme, colors.text.muted)}>PLAN</text>
      {steps.map((step, index) => (
        <box flexDirection="row" gap={1}>
          <text
            fg={themeColor(
              props.theme,
              step.done
                ? colors.status.success
                : index === 1
                  ? colors.purple[300]
                  : colors.text.muted,
            )}
          >
            {step.done ? "✓" : index === 1 ? "●" : "○"}
          </text>
          <text
            fg={themeColor(
              props.theme,
              step.done ? colors.text.secondary : colors.text.primary,
            )}
          >
            {step.label}
          </text>
        </box>
      ))}
      <text fg={themeColor(props.theme, colors.text.muted)}>ROUTE</text>
      <box flexDirection="row" gap={1}>
        <StatusDot
          theme={props.theme}
          state={props.route ? "success" : "muted"}
        />
        <text fg={themeColor(props.theme, colors.text.secondary)}>
          {props.route ?? "AUTO · LOCAL-FIRST"}
        </text>
      </box>
      {props.model ? (
        <text fg={themeColor(props.theme, colors.purple[300])}>
          {props.model}
        </text>
      ) : null}
      <text fg={themeColor(props.theme, colors.text.muted)}>CONTEXT</text>
      <text fg={themeColor(props.theme, colors.text.secondary)}>
        {props.contextFiles.length || 0} files selected
      </text>
      {props.contextFiles.slice(0, 4).map((file) => (
        <text fg={themeColor(props.theme, colors.text.tertiary)}>
          {`  ${file}`}
        </text>
      ))}
      {props.lines.length > 0 ? (
        <box flexDirection="column">
          <text fg={themeColor(props.theme, colors.text.muted)}>SIGNAL</text>
          <Meter theme={props.theme} value={0.82} label="policy confidence" />
        </box>
      ) : null}
    </box>
  );
}
