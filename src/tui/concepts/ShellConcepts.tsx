import type { ThemeTokens } from "../theme/tokens.js";
import { themeColor, getTheme } from "../theme/tokens.js";
import { Composer } from "../components/Composer.js";
import { StatusBar } from "../components/StatusBar.js";
import { TopBar } from "../components/TopBar.js";
import {
  Transcript,
  type TranscriptMessage,
} from "../components/Transcript.js";

export type ShellConceptKind =
  "minimal-canvas" | "context-ribbon" | "adaptive-edge";

const fixtureMessages: TranscriptMessage[] = [
  { role: "user", text: "Fix the authentication session race and run tests." },
  {
    role: "assistant",
    text: "I’ll inspect the session lifecycle, then verify the smallest safe change.",
  },
  {
    role: "tool",
    text: "READ src/auth/session.ts",
    detail: "12ms",
    status: "success",
  },
  {
    role: "tool",
    text: "SEARCH refreshToken",
    detail: "28ms",
    status: "success",
  },
  {
    role: "tool",
    text: "TEST auth.test.ts",
    detail: "31 passed",
    status: "success",
  },
];

function ConceptFooter(props: {
  theme: ThemeTokens;
  width: number;
  notice?: string;
}) {
  return (
    <StatusBar
      theme={props.theme}
      notice={() => props.notice ?? "Ready · local-first · strict-zero"}
      width={() => props.width}
      route={() => "LOCAL"}
      model={() => "Qwen Coder 7B"}
      context={() => "ctx 18k/32k"}
    />
  );
}

function SharedComposer(props: { theme: ThemeTokens; width: number }) {
  return (
    <Composer
      theme={props.theme}
      value={() => ""}
      onInput={() => undefined}
      width={props.width}
      rows={props.width < 110 ? 2 : 3}
      mode="AUTO"
      route="LOCAL-FIRST"
      focused
    />
  );
}

export function ShellConcept(props: {
  kind: ShellConceptKind;
  width: number;
  height: number;
  theme?: ThemeTokens;
}) {
  const theme = props.theme ?? getTheme();
  const colors = theme.colors;
  const contentWidth = Math.min(props.width - 4, 112);
  const transcript = (
    <Transcript theme={theme} messages={fixtureMessages} width={props.width} />
  );
  if (props.kind === "context-ribbon") {
    return (
      <box
        width="100%"
        height="100%"
        flexDirection="column"
        backgroundColor={themeColor(theme, colors.background.canvas)}
      >
        <TopBar
          theme={theme}
          width={props.width}
          route="LOCAL"
          model="Qwen Coder 7B"
          workspace="shelra"
          privacy="PRIVATE"
          mode="AUTO"
          branch="main"
        />
        <box
          paddingX={2}
          height={2}
          flexDirection="row"
          justifyContent="space-between"
          backgroundColor={themeColor(theme, colors.background.surface)}
        >
          <text fg={themeColor(theme, colors.text.secondary)}>
            <strong>ACTIVE TASK</strong> authentication session race
          </text>
          <text fg={themeColor(theme, colors.purple[300])}>LOCAL · 0 cost</text>
        </box>
        <box flexGrow={1} flexDirection="column" paddingX={2} gap={1}>
          <box flexGrow={1} minHeight={5}>
            {transcript}
          </box>
          <SharedComposer theme={theme} width={props.width} />
        </box>
        <ConceptFooter
          theme={theme}
          width={props.width}
          notice="Inspecting session lifecycle"
        />
      </box>
    );
  }
  if (props.kind === "adaptive-edge") {
    return (
      <box
        width="100%"
        height="100%"
        flexDirection="column"
        backgroundColor={themeColor(theme, colors.background.canvas)}
      >
        <TopBar
          theme={theme}
          width={props.width}
          route="LOCAL"
          model="Qwen Coder 7B"
          workspace="shelra"
          privacy="PRIVATE"
          mode="AUTO"
          branch="main"
        />
        <box flexGrow={1} flexDirection="row">
          {props.width >= 100 ? (
            <box
              width={5}
              paddingY={2}
              flexDirection="column"
              alignItems="center"
              gap={1}
            >
              <text fg={themeColor(theme, colors.purple[300])}>*</text>
              <text fg={themeColor(theme, colors.text.muted)}>o</text>
              <text fg={themeColor(theme, colors.text.muted)}>o</text>
              <text fg={themeColor(theme, colors.text.muted)}>o</text>
            </box>
          ) : null}
          <box
            flexGrow={1}
            flexDirection="column"
            width={props.width >= 100 ? props.width - 5 : "100%"}
            paddingX={2}
            gap={1}
          >
            <text fg={themeColor(theme, colors.text.muted)}>
              CONVERSATION / WORKSPACE
            </text>
            <box flexGrow={1} minHeight={5}>
              {transcript}
            </box>
            <SharedComposer theme={theme} width={props.width} />
          </box>
        </box>
        <ConceptFooter
          theme={theme}
          width={props.width}
          notice="Ready · edge context available"
        />
      </box>
    );
  }
  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={themeColor(theme, colors.background.canvas)}
    >
      <TopBar
        theme={theme}
        width={props.width}
        route="LOCAL"
        model="Qwen Coder 7B"
        workspace="shelra"
        privacy="PRIVATE"
        mode="AUTO"
        branch="main"
      />
      <box
        flexGrow={1}
        flexDirection="column"
        alignItems="center"
        paddingX={1}
        gap={1}
      >
        <box width="100%" flexGrow={1} flexDirection="column" paddingY={1}>
          <box width={contentWidth} flexGrow={1} flexDirection="column" gap={1}>
            <text fg={themeColor(theme, colors.text.muted)}>
              CONVERSATION / ACTIVE TASK
            </text>
            <box flexGrow={1} minHeight={5}>
              {transcript}
            </box>
          </box>
        </box>
        <box width={contentWidth}>
          <SharedComposer theme={theme} width={props.width} />
        </box>
      </box>
      <ConceptFooter theme={theme} width={props.width} />
    </box>
  );
}
