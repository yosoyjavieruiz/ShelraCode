export type PurpleScale = {
  50: string;
  100: string;
  200: string;
  300: string;
  400: string;
  500: string;
  600: string;
  700: string;
  800: string;
  900: string;
};

export type ThemeColors = {
  background: {
    canvas: string;
    surface: string;
    elevated: string;
    floating: string;
    active: string;
    selection: string;
  };
  border: {
    subtle: string;
    default: string;
    strong: string;
    interactive: string;
    focus: string;
  };
  text: {
    primary: string;
    secondary: string;
    tertiary: string;
    muted: string;
    disabled: string;
    inverse: string;
  };
  purple: PurpleScale;
  status: {
    success: string;
    warning: string;
    danger: string;
    info: string;
  };
  git: {
    added: string;
    removed: string;
    modified: string;
    renamed: string;
    addedBackground: string;
    removedBackground: string;
  };
};

export type ThemeTokens = {
  colors: ThemeColors;
  spacing: {
    xxs: number;
    xs: number;
    sm: number;
    md: number;
    lg: number;
  };
  colorsEnabled: boolean;
};

const colors: ThemeColors = {
  background: {
    canvas: "#000000",
    surface: "#050506",
    elevated: "#08080A",
    floating: "#0D0D10",
    active: "#15101D",
    selection: "#15101D",
  },
  border: {
    subtle: "#141416",
    default: "#202024",
    strong: "#34343A",
    interactive: "#513177",
    focus: "#513177",
  },
  text: {
    primary: "#F5F5F7",
    secondary: "#A1A1AA",
    tertiary: "#71717A",
    muted: "#52525B",
    disabled: "#44444C",
    inverse: "#050506",
  },
  purple: {
    50: "#F5F3FF",
    100: "#EDE9FE",
    200: "#DDD6FE",
    300: "#C4B5FD",
    400: "#A78BFA",
    500: "#8B5CF6",
    600: "#7C3AED",
    700: "#6D28D9",
    800: "#5B21B6",
    900: "#4C1D95",
  },
  status: {
    success: "#4ADE80",
    warning: "#FBBF24",
    danger: "#FB7185",
    info: "#38BDF8",
  },
  git: {
    added: "#4ADE80",
    removed: "#FB7185",
    modified: "#FBBF24",
    renamed: "#38BDF8",
    addedBackground: "#07130B",
    removedBackground: "#17090D",
  },
};

export function getTheme(noColor = Boolean(process.env.NO_COLOR)): ThemeTokens {
  return {
    colors,
    spacing: { xxs: 0, xs: 1, sm: 2, md: 3, lg: 5 },
    colorsEnabled: !noColor,
  };
}

export function themeColor(
  theme: ThemeTokens,
  value: string,
): string | undefined {
  return theme.colorsEnabled ? value : undefined;
}
