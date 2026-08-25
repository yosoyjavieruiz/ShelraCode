import type { ThemeTokens } from "../theme/tokens.js";
import { themeColor } from "../theme/tokens.js";
import type { AgentPhase } from "../../agent/task-state.js";

// ShelraCode's signature working indicator (docs/ui-chat-v2/AGENT-MATRIX.md).
// Shown only for the abstract phases of a turn — before the loop has
// produced any concrete tool activity worth rendering on its own (see
// isAbstractAgentPhase, presentation/adapter.ts). Real activity (READ,
// SEARCH, EDIT, RUN, TEST…) always replaces it; the two never show at once.

const PHASE_LABELS: Record<AgentPhase, string> = {
  frame: "Thinking",
  discover: "Exploring repository",
  analyze: "Understanding request",
  plan: "Planning",
  act: "Preparing to act",
  observe: "Reviewing results",
  reflect: "Reflecting",
  verify: "Verifying",
  review: "Reviewing changes",
  complete: "Done",
  blocked: "Blocked",
  failed: "Failed",
  cancelled: "Cancelled",
};

export function agentPhaseLabel(phase: AgentPhase | undefined): string {
  return phase ? (PHASE_LABELS[phase] ?? "Thinking") : "Thinking";
}

// A compact 2x2 matrix without the visual weight of a card. The active cell
// follows the perimeter so the eye reads a calm orbit instead of a random
// flicker. Four positions at the host's 120ms tick are about 8fps. The
// smaller grid is roughly half the previous visual area while preserving the
// ShelraCode signature.
const GRID_SIZE = 2;
const ORBIT_CELLS = [0, 1, 3, 2] as const;

function formatElapsed(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m${seconds.toString().padStart(2, "0")}s`;
}

function MatrixDot(props: {
  theme: ThemeTokens;
  active: () => boolean;
  warm: () => boolean;
}) {
  const colors = props.theme.colors;
  return (
    <text
      fg={themeColor(
        props.theme,
        props.active()
          ? props.warm()
            ? colors.status.warning
            : colors.purple[500]
          : colors.text.muted,
      )}
    >
      {() => (props.active() ? "●" : "·")}
    </text>
  );
}

export function AgentMatrixPulse(props: {
  theme: ThemeTokens;
  phase: () => AgentPhase | undefined;
  // Raw ticking counter (e.g. the host's existing status-bar spinner tick)
  // — reused rather than owning a second timer, so there is only ever one
  // animation source driving the screen while a task is busy.
  tick: () => number;
  elapsedSeconds: () => number;
  width: () => number;
  interruptible?: () => boolean;
  reducedMotion?: () => boolean;
}) {
  const colors = props.theme.colors;
  const color = (value: string) => themeColor(props.theme, value);
  const label = () => agentPhaseLabel(props.phase());
  const elapsedText = () => {
    const seconds = props.elapsedSeconds();
    return seconds > 0 ? `${formatElapsed(seconds)} · ` : "";
  };
  const canInterrupt = () => props.interruptible?.() ?? true;
  const metaLine = () =>
    `${elapsedText()}${canInterrupt() ? "Esc interrupt" : ""}`;
  const activeCell = () =>
    ORBIT_CELLS[props.tick() % ORBIT_CELLS.length] ?? ORBIT_CELLS[0];
  const compact = () => props.width() < 32;
  const reduced = () => props.reducedMotion?.() ?? false;
  // Claude Code's own long-wait treatment (docs/ui-chat-v2/RESEARCH.md): the
  // indicator warms from violet to amber past 10s so a long turn still
  // reads as "alive", not "stuck", without adding a second signal.
  const warm = () => props.elapsedSeconds() >= 10;
  const labelColor = () =>
    color(warm() ? colors.status.warning : colors.purple[400]);

  if (reduced() || compact()) {
    // Reduced motion (NO_COLOR-adjacent accessibility mode) and very narrow
    // terminals both collapse to one static line — no animated glyph.
    return (
      <box id="agent-matrix" flexDirection="column">
        <text fg={labelColor()}>{() => `Agent · ${label()}`}</text>
        <text fg={color(colors.text.muted)}>{metaLine}</text>
      </box>
    );
  }

  // No border and no padding: a two-row matrix sits beside the useful
  // activity copy. It remains in normal transcript flow, so it cannot cover
  // the composer or force an unrelated screen-wide redraw.
  return (
    <box id="agent-matrix" flexDirection="row" gap={2} alignItems="center">
      <box flexDirection="column">
        {Array.from({ length: GRID_SIZE }, (_, row) => (
          <box flexDirection="row" gap={1}>
            {Array.from({ length: GRID_SIZE }, (_, column) => {
              const index = row * GRID_SIZE + column;
              return (
                <MatrixDot
                  theme={props.theme}
                  active={() => index === activeCell()}
                  warm={warm}
                />
              );
            })}
          </box>
        ))}
      </box>
      <box flexDirection="column">
        <text fg={labelColor()}>{() => `Agent · ${label()}`}</text>
        <text fg={color(colors.text.muted)}>{metaLine}</text>
      </box>
    </box>
  );
}
