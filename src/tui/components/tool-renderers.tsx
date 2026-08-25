import { For, type JSX } from "solid-js";
import type {
  ActivityKind,
  ToolActivityViewModel,
} from "../presentation/types.js";
import type { ThemeTokens } from "../theme/tokens.js";
import { themeColor } from "../theme/tokens.js";

export interface ToolRendererProps {
  theme: ThemeTokens;
  activity: ToolActivityViewModel;
  groupCount: number;
  index: number;
  expanded: () => boolean;
}

export type ToolRenderer = (props: ToolRendererProps) => JSX.Element;

type RendererOptions = {
  runningVerb: string;
  showLiveTail: boolean;
};

function duration(value?: number): string | undefined {
  if (value === undefined) return undefined;
  return value < 1_000 ? `${value}ms` : `${(value / 1_000).toFixed(1)}s`;
}

function branchMarker(groupCount: number, index: number): string {
  return index === groupCount - 1 ? "└─" : "├─";
}

function stateGlyph(state: ToolActivityViewModel["state"]): string {
  switch (state) {
    case "pending":
      return "○";
    case "running":
      return "●";
    case "success":
      return "✓";
    case "failed":
      return "×";
    case "cancelled":
      return "!";
  }
}

function stateColor(
  theme: ThemeTokens,
  state: ToolActivityViewModel["state"],
): string | undefined {
  const colors = theme.colors;
  switch (state) {
    case "running":
      return themeColor(theme, colors.purple[400]);
    case "success":
      return themeColor(theme, colors.status.success);
    case "failed":
      return themeColor(theme, colors.status.danger);
    case "cancelled":
      return themeColor(theme, colors.status.warning);
    case "pending":
      return themeColor(theme, colors.text.muted);
  }
}

function detailColor(
  theme: ThemeTokens,
  activity: ToolActivityViewModel,
  line: string,
): string | undefined {
  const colors = theme.colors;
  if (
    (activity.kind === "edit" ||
      activity.operation === "create" ||
      activity.operation === "overwrite" ||
      activity.operation === "delete") &&
    activity.diff
  ) {
    if (line.startsWith("+ ")) return themeColor(theme, colors.git.added);
    if (line.startsWith("- ")) return themeColor(theme, colors.git.removed);
    return themeColor(theme, colors.text.muted);
  }
  return themeColor(theme, colors.text.tertiary);
}

function rendererFor(options: RendererOptions): ToolRenderer {
  return (props) => {
    const colors = props.theme.colors;
    const color = (value: string) => themeColor(props.theme, value);
    const active = props.activity.state === "running";
    const failed = props.activity.state === "failed";
    const glyph = stateGlyph(props.activity.state);
    const detail = active
      ? `${options.runningVerb}…`
      : props.activity.state === "pending"
        ? "queued"
        : props.activity.state === "cancelled"
          ? ["cancelled", duration(props.activity.durationMs)]
              .filter(Boolean)
              .join(" · ")
          : [props.activity.summary, duration(props.activity.durationMs)]
              .filter(Boolean)
              .join(" · ");
    return (
      <box flexDirection="column">
        <box
          flexDirection="row"
          gap={1}
          paddingLeft={props.groupCount > 1 ? 1 : 0}
        >
          <text
            fg={
              props.groupCount > 1
                ? color(colors.text.muted)
                : stateColor(props.theme, props.activity.state)
            }
          >
            {props.groupCount > 1
              ? branchMarker(props.groupCount, props.index)
              : glyph}
          </text>
          {props.groupCount > 1 ? (
            <text fg={stateColor(props.theme, props.activity.state)}>
              {glyph}
            </text>
          ) : null}
          <text
            fg={color(failed ? colors.status.danger : colors.text.secondary)}
          >
            <strong>{props.activity.label.padEnd(7)}</strong>
          </text>
          <text fg={color(colors.text.primary)}>{props.activity.target}</text>
          <box flexGrow={1} />
          {detail ? <text fg={color(colors.text.muted)}>{detail}</text> : null}
        </box>
        {() =>
          (props.expanded() || failed) && props.activity.details?.length ? (
            <box
              flexDirection="column"
              paddingLeft={props.groupCount > 1 ? 5 : 3}
            >
              <For each={props.activity.details}>
                {(line) => (
                  <text
                    width="100%"
                    wrapMode="word"
                    fg={detailColor(props.theme, props.activity, line)}
                  >
                    {line}
                  </text>
                )}
              </For>
            </box>
          ) : null
        }
        {() =>
          options.showLiveTail && active && props.activity.liveTail?.length ? (
            <box
              flexDirection="column"
              paddingLeft={props.groupCount > 1 ? 5 : 3}
            >
              <For each={props.activity.liveTail}>
                {(line) => (
                  <text
                    width="100%"
                    wrapMode="word"
                    fg={color(colors.text.muted)}
                  >
                    {line}
                  </text>
                )}
              </For>
            </box>
          ) : null
        }
      </box>
    );
  };
}

const readRenderer = rendererFor({
  runningVerb: "reading",
  showLiveTail: false,
});
const searchRenderer = rendererFor({
  runningVerb: "searching",
  showLiveTail: false,
});
const editRenderer = rendererFor({
  runningVerb: "editing",
  showLiveTail: false,
});
const writeRenderer = rendererFor({
  runningVerb: "writing",
  showLiveTail: false,
});
const runRenderer = rendererFor({ runningVerb: "running", showLiveTail: true });
const testRenderer = rendererFor({
  runningVerb: "testing",
  showLiveTail: true,
});
const genericRenderer = rendererFor({
  runningVerb: "working",
  showLiveTail: false,
});

export const ToolRendererRegistry: Readonly<
  Record<
    "read" | "search" | "edit" | "write" | "run" | "test" | "generic",
    ToolRenderer
  >
> = Object.freeze({
  read: readRenderer,
  search: searchRenderer,
  edit: editRenderer,
  write: writeRenderer,
  run: runRenderer,
  test: testRenderer,
  generic: genericRenderer,
});

export function getToolRenderer(kind: unknown): ToolRenderer {
  if (typeof kind !== "string") return ToolRendererRegistry.generic;
  if (kind === "read") return ToolRendererRegistry.read;
  if (kind === "search") return ToolRendererRegistry.search;
  if (kind === "edit") return ToolRendererRegistry.edit;
  if (kind === "write") return ToolRendererRegistry.write;
  if (kind === "run") return ToolRendererRegistry.run;
  if (kind === "test") return ToolRendererRegistry.test;
  return ToolRendererRegistry.generic;
}

export function isKnownToolActivityKind(kind: unknown): kind is ActivityKind {
  return (
    kind === "read" ||
    kind === "search" ||
    kind === "edit" ||
    kind === "write" ||
    kind === "list" ||
    kind === "run" ||
    kind === "test" ||
    kind === "diff" ||
    kind === "status" ||
    kind === "tool"
  );
}
