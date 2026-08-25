export type LayoutMode = "wide" | "medium" | "compact" | "narrow";

export type NavigationMode = "sidebar" | "collapsed" | "hidden";
export type InspectorMode = "panel" | "drawer" | "hidden";

export interface LayoutProfile {
  mode: LayoutMode;
  navigation: NavigationMode;
  inspector: InspectorMode;
  showExtendedStatus: boolean;
  composerRows: number;
  showOptionalHints: boolean;
}

export interface CoreContentGeometry {
  x: number;
  width: number;
}

export interface CoreVerticalRegion {
  y: number;
  height: number;
}

export interface CoreComposerRegion extends CoreVerticalRegion {
  inputRows: number;
}

export interface CoreVerticalLayout {
  header: CoreVerticalRegion;
  viewport: CoreVerticalRegion;
  composer: CoreComposerRegion;
  status: CoreVerticalRegion;
}

// The transcript and composer share one adaptive reading column. Narrow
// terminals get every usable cell; wider terminals gain deliberate negative
// space so prose does not become a full-width log. The values are intentionally
// a small, stable set rather than a continuously changing percentage: a
// terminal resize should not make the conversation rhythm twitch on every
// column.
export function getCoreContentGeometry(
  terminalWidth: number,
): CoreContentGeometry {
  const safeWidth = Math.max(1, Math.floor(terminalWidth));
  const { availableWidth, maxWidth } =
    safeWidth <= 88
      ? { availableWidth: safeWidth - 2, maxWidth: Number.POSITIVE_INFINITY }
      : safeWidth <= 139
        ? { availableWidth: safeWidth - 6, maxWidth: 116 }
        : safeWidth <= 179
          ? { availableWidth: safeWidth - 8, maxWidth: 128 }
          : { availableWidth: safeWidth - 8, maxWidth: 140 };
  const width = Math.max(1, Math.min(availableWidth, maxWidth));
  return { x: Math.floor((safeWidth - width) / 2), width };
}

function getComposerInputRows(
  terminalHeight: number,
  inputLineCount: number,
): number {
  const baseRows = terminalHeight <= 24 ? 2 : 3;
  const maxRows = terminalHeight <= 24 ? 5 : terminalHeight <= 30 ? 6 : 8;
  const requestedRows = Math.max(baseRows, Math.floor(inputLineCount));
  return Math.max(1, Math.min(maxRows, requestedRows));
}

export function getCoreVerticalLayout(
  terminalWidth: number,
  terminalHeight: number,
  inputLineCount: number,
): CoreVerticalLayout {
  void terminalWidth;
  const height = Math.max(4, Math.floor(terminalHeight));
  const header = { y: 0, height: 1 };
  const status = { y: height - 1, height: 1 };
  const desiredInputRows = getComposerInputRows(height, inputLineCount);
  // The composer is a fully bordered box now: border top (1) + input rows +
  // footer hint line (1) + border bottom (1) = inputRows + 3, one more
  // fixed row than before the border existed. Keep this in sync with
  // Composer.tsx's own height calculation — they must always agree, or the
  // transcript viewport above it is sized against a number the composer
  // doesn't actually use, and the two regions overlap.
  const maxInputRowsForViewport = Math.max(1, height - 6);
  const inputRows = Math.min(desiredInputRows, maxInputRowsForViewport);
  const composerHeight = inputRows + 3;
  const composer = {
    y: status.y - composerHeight,
    height: composerHeight,
    inputRows,
  };
  const viewport = {
    y: header.y + header.height,
    height: Math.max(1, composer.y - (header.y + header.height)),
  };
  return { header, viewport, composer, status };
}

export function getLayoutMode(width: number): LayoutMode {
  if (width < 80) return "narrow";
  if (width < 110) return "compact";
  if (width < 150) return "medium";
  return "wide";
}

export function getLayoutProfile(width: number): LayoutProfile {
  const mode = getLayoutMode(width);
  const showExtendedStatus = width >= 120;
  switch (mode) {
    case "wide":
      return {
        mode,
        navigation: "hidden",
        inspector: "hidden",
        showExtendedStatus,
        composerRows: 3,
        showOptionalHints: width >= 160,
      };
    case "medium":
      return {
        mode,
        navigation: "hidden",
        inspector: "hidden",
        showExtendedStatus,
        composerRows: 3,
        showOptionalHints: false,
      };
    case "compact":
      return {
        mode,
        navigation: "hidden",
        inspector: "hidden",
        showExtendedStatus,
        composerRows: 2,
        showOptionalHints: false,
      };
    case "narrow":
      return {
        mode,
        navigation: "hidden",
        inspector: "hidden",
        showExtendedStatus: false,
        composerRows: 2,
        showOptionalHints: false,
      };
  }
}
