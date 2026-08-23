export type ThemeTokens = {
  background: string;
  surface: string;
  surfaceRaised: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  accent: string;
  accentMuted: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  local: string;
  cloudFree: string;
  cloudPaid: string;
  colorsEnabled: boolean;
};

export function getTheme(noColor = Boolean(process.env.NO_COLOR)): ThemeTokens {
  return {
    background: "#0d1117",
    surface: "#111821",
    surfaceRaised: "#17212b",
    border: "#273444",
    borderStrong: "#3b5068",
    text: "#e6edf3",
    textMuted: "#9aaabd",
    textSubtle: "#6f8093",
    accent: "#8ab4f8",
    accentMuted: "#334b6b",
    success: "#7bd88f",
    warning: "#e6c77a",
    danger: "#f08a8a",
    info: "#8bd5ca",
    local: "#7bd88f",
    cloudFree: "#8ab4f8",
    cloudPaid: "#e6c77a",
    colorsEnabled: !noColor,
  };
}
