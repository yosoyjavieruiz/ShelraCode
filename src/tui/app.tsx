import {
  useKeyboard,
  useRenderer,
  useTerminalDimensions,
} from "@opentui/solid";
import { createSignal } from "solid-js";
import { getTheme } from "./theme/tokens.js";

export function AppShell() {
  const renderer = useRenderer();
  const dimensions = useTerminalDimensions();
  const theme = getTheme();
  const [draft, setDraft] = createSignal("");
  const [notice, setNotice] = createSignal("Ready · local-first · strict-zero");

  useKeyboard((key) => {
    if (key.name === "escape") {
      if (draft()) {
        setDraft("");
        setNotice("Draft cleared");
      } else {
        renderer.destroy();
      }
      return;
    }

    if (key.ctrl && key.name === "k") {
      setNotice("Command palette · /models · /routing · /privacy · /doctor");
    }
  });

  const color = (value: string) => (theme.colorsEnabled ? value : undefined);

  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={theme.colorsEnabled ? theme.background : undefined}
    >
      <box
        height={2}
        paddingX={1}
        flexDirection="row"
        justifyContent="space-between"
        alignItems="center"
        border
        borderColor={color(theme.border)}
      >
        <text fg={color(theme.text)}>
          <strong>LocalCode</strong> <span>workspace</span>
        </text>
        <text fg={color(theme.success)}>LOCAL · PRIVATE</text>
      </box>

      <box flexGrow={1} flexDirection="column" padding={1} gap={1}>
        <text fg={color(theme.textMuted)}>
          <strong>Conversation</strong> · {dimensions().width}x
          {dimensions().height}
        </text>
        <box flexDirection="column" gap={1} flexGrow={1}>
          <text fg={color(theme.text)}>
            <strong>You</strong>
            {"\n"}Ask LocalCode to inspect, explain, or change this repository.
          </text>
          <box
            padding={1}
            border
            borderColor={color(theme.border)}
            backgroundColor={theme.colorsEnabled ? theme.surface : undefined}
          >
            <text fg={color(theme.textMuted)}>
              <span>▸ Ready</span> · local context is available; cloud routes
              remain policy-gated
            </text>
          </box>
        </box>
      </box>

      <box paddingX={1} paddingY={1} border borderColor={color(theme.border)}>
        <input
          width="100%"
          value={draft()}
          onInput={setDraft}
          placeholder="Ask anything…"
          focused
          backgroundColor={
            theme.colorsEnabled ? theme.surfaceRaised : undefined
          }
          textColor={color(theme.text)}
          placeholderColor={color(theme.textSubtle)}
          cursorColor={color(theme.accent)}
        />
      </box>

      <box
        height={1}
        paddingX={1}
        flexDirection="row"
        justifyContent="space-between"
      >
        <text fg={color(theme.textSubtle)}>{notice()}</text>
        <text fg={color(theme.textSubtle)}>
          Ctrl+K palette · Esc clear/exit
        </text>
      </box>
    </box>
  );
}
