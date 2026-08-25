import type { ThemeTokens } from "../theme/tokens.js";
import { themeColor } from "../theme/tokens.js";

type AccessorOrValue<T> = T | (() => T);

function readProp<T>(value: AccessorOrValue<T> | undefined): T | undefined {
  return typeof value === "function" ? (value as () => T)() : value;
}

function humanRoute(value?: string): string {
  return value === "FREE" ? "Free" : "Local";
}

function formatElapsed(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${seconds.toString().padStart(2, "0")}s`;
}

export function StatusBar(props: {
  theme: ThemeTokens;
  // Accessors are preferred for live values (`notice={notice}`), while plain
  // values remain supported for static fixtures and simple component use.
  // Dynamic visibility is expressed as text content because this renderer's
  // element attributes do not reliably react to an invoked signal value.
  notice: AccessorOrValue<string>;
  width: AccessorOrValue<number>;
  route?: AccessorOrValue<string | undefined>;
  model?: AccessorOrValue<string | undefined>;
  context?: AccessorOrValue<string | undefined>;
  busy?: AccessorOrValue<boolean>;
  showSpinner?: AccessorOrValue<boolean>;
  spinnerFrame?: AccessorOrValue<string>;
  elapsedSeconds?: AccessorOrValue<number>;
}) {
  const colors = props.theme.colors;
  const active = () =>
    props.busy !== undefined
      ? Boolean(readProp(props.busy))
      : /running|inspect|read|search|edit|test/i.test(
          readProp(props.notice) ?? "",
        );
  const showSpinner = () => readProp(props.showSpinner) ?? active();
  const noticeText = () =>
    (readProp(props.notice) ?? "")
      .replace(/\s*·\s*(?:local-first|strict-zero|private|\$0|ready)\b/gi, "")
      .trim();
  const left = () =>
    active() ? noticeText() || "Working" : noticeText() || "Ready";
  const showModel = () =>
    (readProp(props.width) ?? 0) >= 68 && Boolean(readProp(props.model));
  const showContext = () =>
    showModel() &&
    (readProp(props.width) ?? 0) >= 96 &&
    Boolean(readProp(props.context));
  const elapsedSuffix = () => {
    const seconds = readProp(props.elapsedSeconds);
    return active() &&
      (readProp(props.width) ?? 0) >= 54 &&
      seconds !== undefined &&
      seconds > 0
      ? ` · ${formatElapsed(seconds)}`
      : "";
  };
  const leftLine = () => {
    const marker = showSpinner()
      ? `${readProp(props.spinnerFrame) ?? "●"} `
      : "";
    return `${marker}${left()}${elapsedSuffix()}`;
  };
  const modelLine = () =>
    showModel()
      ? `${humanRoute(readProp(props.route))} · ${readProp(props.model) ?? ""}`
      : "";
  const contextLine = () =>
    showContext() ? `   ${readProp(props.context) ?? ""}` : "";
  const hintLine = () =>
    active()
      ? (readProp(props.width) ?? 0) >= 54
        ? "   Esc interrupt"
        : "  ^C"
      : "";

  return (
    <box
      id="core-status"
      width="100%"
      height={1}
      minHeight={1}
      paddingX={1}
      flexDirection="row"
      flexShrink={0}
    >
      <text fg={themeColor(props.theme, colors.purple[400])}>{leftLine}</text>
      <box flexGrow={1} />
      <text fg={themeColor(props.theme, colors.text.tertiary)}>
        {modelLine}
      </text>
      <text fg={themeColor(props.theme, colors.text.muted)}>{contextLine}</text>
      <text fg={themeColor(props.theme, colors.text.secondary)}>
        {hintLine}
      </text>
    </box>
  );
}
