import type { ThemeTokens } from "../theme/tokens.js";
import { themeColor } from "../theme/tokens.js";

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/(^|\s|·)\S/g, (character) => character.toUpperCase());
}

export function TopBar(props: {
  theme: ThemeTokens;
  width: number;
  route: string;
  privacy: string;
  workspace?: string;
  model?: string;
  mode?: string;
  branch?: string;
}) {
  const colors = props.theme.colors;
  const workspace = props.workspace ?? "project";
  const branch = props.branch ?? "main";
  const project =
    props.width >= 58 ? `   ~/${workspace} · ${branch}` : `  ${workspace}`;
  const route = props.route === "FREE" ? "Free" : "Local";
  const privacy = titleCase(props.privacy.replace(/\s*·\s*/g, " · "));
  const execution = props.width >= 54 ? `${route} · ${privacy}` : route;
  return (
    <box
      id="core-header"
      width="100%"
      height={1}
      minHeight={1}
      paddingX={1}
      flexDirection="row"
      flexShrink={0}
      backgroundColor={themeColor(props.theme, colors.background.canvas)}
    >
      <text fg={themeColor(props.theme, colors.purple[500])}>◆</text>
      <text fg={themeColor(props.theme, colors.text.primary)}>
        <strong> ShelraCode</strong>
      </text>
      <text fg={themeColor(props.theme, colors.text.tertiary)}>{project}</text>
      <box flexGrow={1} />
      <text fg={themeColor(props.theme, colors.text.secondary)}>
        {execution}
      </text>
    </box>
  );
}
