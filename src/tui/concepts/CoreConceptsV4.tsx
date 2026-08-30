import type { ThemeTokens } from "../theme/tokens.js";
import { getTheme, themeColor } from "../theme/tokens.js";
import { PRODUCT_NAME } from "../../product/identity.js";

export type CoreConceptKind = "editorial" | "timeline" | "command-canvas";
export type CoreConceptState = "home" | "conversation";

export type ContentGeometry = {
  x: number;
  width: number;
};

export function getV4ContentGeometry(terminalWidth: number): ContentGeometry {
  const safeWidth = Math.max(1, Math.floor(terminalWidth));
  const contentWidth =
    safeWidth <= 88
      ? safeWidth - 2
      : safeWidth <= 109
        ? safeWidth - 6
        : safeWidth <= 139
          ? Math.min(112, safeWidth - 8)
          : safeWidth <= 179
            ? Math.min(124, safeWidth - 12)
            : Math.min(132, safeWidth - 16);
  const width = Math.max(1, contentWidth);
  return { x: Math.floor((safeWidth - width) / 2), width };
}

function Header(props: { theme: ThemeTokens; width: number }) {
  const colors = props.theme.colors;
  return (
    <box width="100%" height={1} paddingX={1} flexDirection="row">
      <text fg={themeColor(props.theme, colors.purple[500])}>◆</text>
      <text fg={themeColor(props.theme, colors.text.primary)}>
        <strong> {PRODUCT_NAME}</strong>
      </text>
      <text fg={themeColor(props.theme, colors.text.tertiary)}>
        {props.width >= 58 ? "   ~/shelra · main" : "  shelra"}
      </text>
      <box flexGrow={1} />
      <text fg={themeColor(props.theme, colors.text.secondary)}>
        {props.width >= 54 ? "Local · Private" : "Local"}
      </text>
    </box>
  );
}

function Status(props: {
  theme: ThemeTokens;
  width: number;
  active?: boolean;
}) {
  const colors = props.theme.colors;
  return (
    <box width="100%" height={1} paddingX={1} flexDirection="row">
      <text
        fg={themeColor(
          props.theme,
          props.active ? colors.purple[400] : colors.text.tertiary,
        )}
      >
        {props.active ? "● Inspecting repository" : "Ready"}
      </text>
      <box flexGrow={1} />
      {props.width >= 68 ? (
        <text fg={themeColor(props.theme, colors.text.tertiary)}>
          Local · Qwen 2.5 Coder
        </text>
      ) : null}
      {props.width >= 96 ? (
        <text fg={themeColor(props.theme, colors.text.muted)}> ctx 4k/32k</text>
      ) : null}
      {props.active ? (
        <text fg={themeColor(props.theme, colors.text.secondary)}>
          {props.width >= 54 ? "   Ctrl+C" : "  ^C"}
        </text>
      ) : null}
    </box>
  );
}

function BoundedContent(props: {
  width: number;
  flexGrow?: number;
  height?: number;
  children: unknown;
}) {
  const geometry = getV4ContentGeometry(props.width);
  return (
    <box
      width="100%"
      height={props.height}
      minHeight={props.flexGrow ? 1 : undefined}
      flexGrow={props.flexGrow}
      flexDirection="column"
      alignItems="center"
    >
      <box
        width={geometry.width}
        height={props.height}
        minHeight={props.flexGrow ? 1 : undefined}
        flexGrow={props.flexGrow}
        flexDirection="column"
      >
        {props.children}
      </box>
    </box>
  );
}

function Composer(props: {
  theme: ThemeTokens;
  width: number;
  treatment: CoreConceptKind;
}) {
  const colors = props.theme.colors;
  const geometry = getV4ContentGeometry(props.width);
  const meta =
    props.width < 54
      ? "@   Auto   ↵"
      : "@ context        Auto · Local first             Enter ↵";
  if (props.treatment === "timeline") {
    return (
      <box
        width={geometry.width}
        height={5}
        flexDirection="column"
        paddingX={1}
        border={["top"]}
        borderColor={themeColor(props.theme, colors.border.focus)}
        backgroundColor={themeColor(props.theme, colors.background.surface)}
      >
        <text fg={themeColor(props.theme, colors.text.tertiary)}>
          Ask {PRODUCT_NAME}…
        </text>
        <box flexGrow={1} />
        <text fg={themeColor(props.theme, colors.text.muted)}>{meta}</text>
      </box>
    );
  }
  if (props.treatment === "command-canvas") {
    return (
      <box
        width={geometry.width}
        height={5}
        flexDirection="column"
        paddingX={1}
        paddingY={1}
        backgroundColor={themeColor(props.theme, colors.background.elevated)}
        border={["left"]}
        borderColor={themeColor(props.theme, colors.purple[500])}
      >
        <text fg={themeColor(props.theme, colors.text.tertiary)}>
          Ask {PRODUCT_NAME}…
        </text>
        <box flexGrow={1} />
        <text fg={themeColor(props.theme, colors.text.muted)}>{meta}</text>
      </box>
    );
  }
  return (
    <box
      width={geometry.width}
      height={5}
      flexDirection="column"
      paddingX={1}
      paddingY={0}
      border
      borderStyle="rounded"
      borderColor={themeColor(props.theme, colors.border.focus)}
      backgroundColor={themeColor(props.theme, colors.background.surface)}
    >
      <text fg={themeColor(props.theme, colors.text.tertiary)}>
        Ask {PRODUCT_NAME}…
      </text>
      <box flexGrow={1} />
      <text fg={themeColor(props.theme, colors.text.muted)}>{meta}</text>
    </box>
  );
}

function Suggestion(props: {
  theme: ThemeTokens;
  text: string;
  selected?: boolean;
  prefix?: string;
}) {
  const colors = props.theme.colors;
  return (
    <box
      flexDirection="row"
      backgroundColor={themeColor(
        props.theme,
        props.selected ? colors.background.active : colors.background.canvas,
      )}
    >
      <text
        fg={themeColor(
          props.theme,
          props.selected ? colors.purple[400] : colors.text.muted,
        )}
      >
        {props.prefix ?? "›"}
      </text>
      <text
        fg={themeColor(
          props.theme,
          props.selected ? colors.text.primary : colors.text.secondary,
        )}
      >
        {` ${props.text}`}
      </text>
    </box>
  );
}

function Home(props: {
  theme: ThemeTokens;
  width: number;
  height: number;
  kind: CoreConceptKind;
}) {
  const colors = props.theme.colors;
  const compact = props.height <= 24;
  if (props.kind === "timeline") {
    return (
      <>
        <BoundedContent width={props.width} flexGrow={1}>
          <box
            flexGrow={1}
            flexDirection="column"
            justifyContent="center"
            paddingX={1}
          >
            <text fg={themeColor(props.theme, colors.purple[500])}>◆</text>
            <text fg={themeColor(props.theme, colors.text.primary)}>
              <strong>{PRODUCT_NAME}</strong>
            </text>
            <text fg={themeColor(props.theme, colors.text.secondary)}>
              Your models. Your code.
            </text>
            <box height={compact ? 1 : 2} />
            <text fg={themeColor(props.theme, colors.text.tertiary)}>
              Local ready · zero-cost routes available
            </text>
            <box height={compact ? 1 : 2} />
            <Suggestion
              theme={props.theme}
              text="Review my current changes"
              selected
            />
            <Suggestion
              theme={props.theme}
              text="Run tests for changed files"
            />
            <Suggestion theme={props.theme} text="Find likely regressions" />
          </box>
        </BoundedContent>
        <BoundedContent width={props.width} height={5}>
          <Composer
            theme={props.theme}
            width={props.width}
            treatment={props.kind}
          />
        </BoundedContent>
      </>
    );
  }
  if (props.kind === "command-canvas") {
    return (
      <>
        <BoundedContent width={props.width} flexGrow={1}>
          <box flexGrow={1} flexDirection="column" justifyContent="center">
            <box alignItems="center" flexDirection="column">
              <text fg={themeColor(props.theme, colors.purple[500])}>◆</text>
              <text fg={themeColor(props.theme, colors.text.primary)}>
                <strong>{PRODUCT_NAME}</strong>
              </text>
              <text fg={themeColor(props.theme, colors.text.secondary)}>
                Your models. Your code.
              </text>
            </box>
            <box height={compact ? 1 : 3} />
            <Composer
              theme={props.theme}
              width={props.width}
              treatment={props.kind}
            />
            <box height={compact ? 1 : 2} />
            <box
              flexDirection="row"
              justifyContent="space-between"
              paddingX={1}
            >
              <text fg={themeColor(props.theme, colors.text.secondary)}>
                Review changes
              </text>
              <text fg={themeColor(props.theme, colors.text.secondary)}>
                Find failing tests
              </text>
              {props.width >= 98 ? (
                <text fg={themeColor(props.theme, colors.text.secondary)}>
                  Explain this repository
                </text>
              ) : null}
            </box>
          </box>
        </BoundedContent>
      </>
    );
  }
  return (
    <>
      <BoundedContent width={props.width} flexGrow={1}>
        <box
          flexGrow={1}
          flexDirection="column"
          justifyContent="center"
          alignItems="center"
        >
          <text fg={themeColor(props.theme, colors.purple[500])}>◆</text>
          <text fg={themeColor(props.theme, colors.text.primary)}>
            <strong>{PRODUCT_NAME}</strong>
          </text>
          <text fg={themeColor(props.theme, colors.text.secondary)}>
            Your models. Your code.
          </text>
          <box height={compact ? 1 : 2} />
          <text fg={themeColor(props.theme, colors.text.tertiary)}>
            Local ready · zero-cost routes available
          </text>
          <box height={compact ? 1 : 2} />
          <box
            flexDirection="column"
            width={Math.min(48, getV4ContentGeometry(props.width).width)}
          >
            <Suggestion
              theme={props.theme}
              text="Review my current changes"
              selected
            />
            <Suggestion
              theme={props.theme}
              text="Run tests for changed files"
            />
            <Suggestion theme={props.theme} text="Look for regressions" />
          </box>
        </box>
      </BoundedContent>
      <BoundedContent width={props.width} height={5}>
        <Composer
          theme={props.theme}
          width={props.width}
          treatment={props.kind}
        />
      </BoundedContent>
    </>
  );
}

function EditorialConversation(props: { theme: ThemeTokens; width: number }) {
  const colors = props.theme.colors;
  return (
    <box flexDirection="column" paddingX={1} paddingY={1} gap={1}>
      <text fg={themeColor(props.theme, colors.text.tertiary)}>You</text>
      <text fg={themeColor(props.theme, colors.text.primary)}>
        Fix the token refresh race condition and run the auth tests.
      </text>
      <box height={1} />
      <text fg={themeColor(props.theme, colors.text.tertiary)}>
        {PRODUCT_NAME}
      </text>
      <text fg={themeColor(props.theme, colors.text.primary)}>
        I’ll trace the refresh lifecycle, make the smallest safe change, then
        verify it.
      </text>
      <box height={1} />
      <text fg={themeColor(props.theme, colors.text.secondary)}>
        Inspecting authentication
      </text>
      <text fg={themeColor(props.theme, colors.text.muted)}>
        {"│ READ      src/auth/session.ts                         12ms"}
      </text>
      <text fg={themeColor(props.theme, colors.text.muted)}>
        {"│ SEARCH    refreshToken                               18ms"}
      </text>
      <text fg={themeColor(props.theme, colors.purple[400])}>
        {"│ EDIT      src/auth/session.ts                       +8 −3"}
      </text>
      <text fg={themeColor(props.theme, colors.text.secondary)}>
        {"└ TEST      auth suite                          running…"}
      </text>
    </box>
  );
}

function TimelineConversation(props: { theme: ThemeTokens; width: number }) {
  const colors = props.theme.colors;
  return (
    <box flexDirection="column" paddingX={1} paddingY={1}>
      <box flexDirection="row">
        <text width={3} fg={themeColor(props.theme, colors.text.muted)}>
          ●
        </text>
        <box flexDirection="column" flexGrow={1}>
          <text fg={themeColor(props.theme, colors.text.tertiary)}>You</text>
          <text fg={themeColor(props.theme, colors.text.primary)}>
            Fix the token refresh race condition and run the auth tests.
          </text>
        </box>
      </box>
      <box height={1} />
      <box flexDirection="row">
        <text width={3} fg={themeColor(props.theme, colors.purple[500])}>
          ◆
        </text>
        <box flexDirection="column" flexGrow={1} gap={1}>
          <text fg={themeColor(props.theme, colors.text.tertiary)}>
            {PRODUCT_NAME}
          </text>
          <text fg={themeColor(props.theme, colors.text.primary)}>
            I’ll inspect the session lifecycle and verify the repair.
          </text>
          <box
            flexDirection="column"
            paddingX={1}
            backgroundColor={themeColor(props.theme, colors.background.surface)}
          >
            <text fg={themeColor(props.theme, colors.text.secondary)}>
              Inspecting authentication · 2/4
            </text>
            <text fg={themeColor(props.theme, colors.text.muted)}>
              {"✓ Read session.ts                                   12ms"}
            </text>
            <text fg={themeColor(props.theme, colors.text.muted)}>
              {"✓ Search refreshToken                              18ms"}
            </text>
            <text fg={themeColor(props.theme, colors.purple[400])}>
              {"● Edit session.ts                                  +8 −3"}
            </text>
            <text fg={themeColor(props.theme, colors.text.muted)}>
              ○ Run auth suite
            </text>
          </box>
        </box>
      </box>
    </box>
  );
}

function CommandCanvasConversation(props: {
  theme: ThemeTokens;
  width: number;
}) {
  const colors = props.theme.colors;
  return (
    <box flexDirection="column" paddingX={1} paddingY={1} gap={1}>
      <box flexDirection="row">
        <text width={12} fg={themeColor(props.theme, colors.text.tertiary)}>
          YOU
        </text>
        <text flexGrow={1} fg={themeColor(props.theme, colors.text.primary)}>
          Fix the token refresh race condition and run the auth tests.
        </text>
      </box>
      <box height={1} />
      <box flexDirection="row">
        <text width={12} fg={themeColor(props.theme, colors.purple[400])}>
          LOC·CODE
        </text>
        <box flexDirection="column" flexGrow={1} gap={1}>
          <text fg={themeColor(props.theme, colors.text.primary)}>
            I’ll inspect the refresh lifecycle, patch it, and run the focused
            suite.
          </text>
          <box
            flexDirection="column"
            border={["left"]}
            borderColor={themeColor(props.theme, colors.border.subtle)}
            paddingX={1}
          >
            <text fg={themeColor(props.theme, colors.text.secondary)}>
              {"READ    src/auth/session.ts                       12ms"}
            </text>
            <text fg={themeColor(props.theme, colors.text.secondary)}>
              {"SEARCH  refreshToken                             18ms"}
            </text>
            <text fg={themeColor(props.theme, colors.purple[400])}>
              {"EDIT    src/auth/session.ts                      +8 −3"}
            </text>
            <text fg={themeColor(props.theme, colors.text.secondary)}>
              {"TEST    auth suite                         running…"}
            </text>
          </box>
        </box>
      </box>
    </box>
  );
}

function Conversation(props: {
  theme: ThemeTokens;
  width: number;
  kind: CoreConceptKind;
}) {
  return (
    <>
      <BoundedContent width={props.width} flexGrow={1}>
        <scrollbox
          width="100%"
          height="100%"
          stickyScroll
          stickyStart="bottom"
          viewportCulling
          verticalScrollbarOptions={{ visible: false }}
        >
          {props.kind === "editorial" ? (
            <EditorialConversation theme={props.theme} width={props.width} />
          ) : props.kind === "timeline" ? (
            <TimelineConversation theme={props.theme} width={props.width} />
          ) : (
            <CommandCanvasConversation
              theme={props.theme}
              width={props.width}
            />
          )}
        </scrollbox>
      </BoundedContent>
      <BoundedContent width={props.width} height={5}>
        <Composer
          theme={props.theme}
          width={props.width}
          treatment={props.kind}
        />
      </BoundedContent>
    </>
  );
}

export function CoreConceptV4(props: {
  kind: CoreConceptKind;
  state: CoreConceptState;
  width: number;
  height: number;
  theme?: ThemeTokens;
}) {
  const theme = props.theme ?? getTheme();
  return (
    <box
      width="100%"
      height="100%"
      flexDirection="column"
      backgroundColor={themeColor(theme, theme.colors.background.canvas)}
    >
      <Header theme={theme} width={props.width} />
      {props.state === "home" ? (
        <Home
          theme={theme}
          width={props.width}
          height={props.height}
          kind={props.kind}
        />
      ) : (
        <Conversation theme={theme} width={props.width} kind={props.kind} />
      )}
      <Status
        theme={theme}
        width={props.width}
        active={props.state === "conversation"}
      />
    </box>
  );
}
