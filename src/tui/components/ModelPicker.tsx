import type { KeyEvent, ScrollBoxRenderable } from "@opentui/core";
import { createEffect } from "solid-js";
import type { ModelCandidate } from "../../shared/types.js";
import { orderModelsForPicker } from "../state/search.js";
import type { ThemeTokens } from "../theme/tokens.js";
import { themeColor } from "../theme/tokens.js";

function trimTo(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width < 4) return value.slice(0, width);
  return `${value.slice(0, width - 3)}...`;
}

export function ModelPicker(props: {
  theme: ThemeTokens;
  width: number;
  height?: number;
  models: ModelCandidate[];
  activeModelId?: string;
  query: string;
  selectedIndex: number;
  onInput: (value: string) => void;
  onMove: (delta: number) => void;
  onSubmit: (model?: ModelCandidate) => void;
  onKeyDown?: (event: KeyEvent) => void;
}) {
  const colors = props.theme.colors;
  const compact = props.width <= 100;
  const filtered = () => orderModelsForPicker(props.models, props.query);
  const selectable = () => [undefined, ...filtered()];
  const selectedModel = () => selectable()[props.selectedIndex];
  const panelWidth = () =>
    props.width < 100
      ? Math.max(24, props.width - 4)
      : Math.min(100, Math.floor(props.width * 0.76));
  let modelViewport: ScrollBoxRenderable | undefined;
  createEffect(() => {
    const index = props.selectedIndex;
    queueMicrotask(() => {
      modelViewport?.scrollChildIntoView(`model-option-${index}`);
    });
  });
  const handleKeyDown = (event: KeyEvent) => {
    if (event.name === "up") {
      event.preventDefault();
      props.onMove(-1);
      return;
    }
    if (event.name === "down") {
      event.preventDefault();
      props.onMove(1);
      return;
    }
    if (event.name === "return" || event.name === "enter") {
      event.preventDefault();
      props.onSubmit(selectedModel());
      return;
    }
    props.onKeyDown?.(event);
  };
  const row = (model: ModelCandidate | undefined, index: number) => {
    const selected = () => props.selectedIndex === index;
    const marker = selected()
      ? ">"
      : model && props.activeModelId === model.id
        ? "*"
        : " ";
    if (!model) {
      return (
        <box
          id={`model-option-${index}`}
          height={1}
          paddingX={1}
          flexDirection="row"
          backgroundColor={
            selected()
              ? themeColor(props.theme, colors.background.active)
              : undefined
          }
          focusable
          onMouseDown={() => props.onSubmit()}
          onKeyDown={(event: KeyEvent) => {
            if (event.name === "return" || event.name === "enter")
              props.onSubmit();
          }}
        >
          <text
            fg={themeColor(
              props.theme,
              selected() ? colors.purple[300] : colors.text.muted,
            )}
          >
            {marker} <strong>Auto</strong>
            {compact ? "  local first" : "  local first · ask before paid"}
          </text>
        </box>
      );
    }
    const active = props.activeModelId === model.id;
    const source =
      model.source === "local"
        ? (model.local?.runtime ?? "local")
        : model.providerId;
    const rowWidth = Math.max(24, panelWidth() - 4);
    const sourceWidth = compact
      ? Math.min(14, Math.max(8, Math.floor(rowWidth * 0.3)))
      : 18;
    const labelWidth = Math.max(12, rowWidth - sourceWidth - 4);
    if (compact) {
      return (
        <box
          id={`model-option-${index}`}
          height={2}
          paddingX={1}
          flexDirection="column"
          backgroundColor={
            selected()
              ? themeColor(props.theme, colors.background.active)
              : undefined
          }
          focusable
          onMouseDown={() => props.onSubmit(model)}
          onKeyDown={(event: KeyEvent) => {
            if (event.name === "return" || event.name === "enter")
              props.onSubmit(model);
          }}
        >
          <text
            width="100%"
            fg={themeColor(
              props.theme,
              selected() ? colors.text.primary : colors.text.secondary,
            )}
          >
            <strong>
              {trimTo(`${marker} ${model.displayName}`, rowWidth)}
            </strong>
          </text>
          <text
            width="100%"
            fg={themeColor(
              props.theme,
              active ? colors.purple[300] : colors.text.muted,
            )}
          >
            {`    ${trimTo(active ? `active · ${source}` : source, rowWidth)}`}
          </text>
        </box>
      );
    }
    return (
      <box
        id={`model-option-${index}`}
        height={1}
        paddingX={1}
        flexDirection="row"
        justifyContent="space-between"
        backgroundColor={
          selected()
            ? themeColor(props.theme, colors.background.active)
            : undefined
        }
        focusable
        onMouseDown={() => props.onSubmit(model)}
        onKeyDown={(event: KeyEvent) => {
          if (event.name === "return" || event.name === "enter")
            props.onSubmit(model);
        }}
      >
        <text
          width={labelWidth}
          fg={themeColor(
            props.theme,
            selected() ? colors.text.primary : colors.text.secondary,
          )}
        >
          <strong>{`${marker} ${trimTo(model.displayName, labelWidth)}`}</strong>
          {active && !compact ? "  active" : ""}
        </text>
        <text
          width={sourceWidth}
          fg={themeColor(
            props.theme,
            active ? colors.purple[300] : colors.text.muted,
          )}
        >
          {trimTo(
            compact && active ? `active · ${source}` : source,
            sourceWidth,
          )}
        </text>
      </box>
    );
  };
  const local = () => filtered().filter((model) => model.source === "local");
  const cloud = () =>
    filtered().filter((model) => model.source === "free_cloud");
  const localStart = () => 1;
  const cloudStart = () => 1 + local().length;
  const hideScrollbars = (scrollbox: ScrollBoxRenderable): void => {
    modelViewport = scrollbox;
    queueMicrotask(() => {
      scrollbox.verticalScrollBar.visible = false;
      scrollbox.horizontalScrollBar.visible = false;
    });
  };
  const panelHeight = () => {
    const contentRows =
      1 +
      1 +
      1 +
      1 +
      (local().length > 0 ? 1 + local().length * (compact ? 2 : 1) : 0) +
      (cloud().length > 0 ? 1 + cloud().length * (compact ? 2 : 1) : 0) +
      1;
    return Math.max(
      12,
      Math.min(
        props.height ? props.height - 2 : 22,
        Math.min(34, contentRows + 4),
      ),
    );
  };
  return (
    <box
      position="absolute"
      top={1}
      left={Math.max(
        2,
        Math.floor((props.width - Math.min(props.width - 4, 100)) / 2),
      )}
      width={props.width < 100 ? props.width - 4 : "76%"}
      maxWidth={100}
      height={panelHeight()}
      padding={1}
      border
      borderStyle="single"
      borderColor={themeColor(props.theme, colors.purple[700])}
      backgroundColor={themeColor(props.theme, colors.background.floating)}
      shouldFill
      focusedBorderColor={themeColor(props.theme, colors.purple[400])}
      zIndex={210}
      flexDirection="column"
      gap={0}
    >
      <box flexDirection="row" gap={1} height={1}>
        <text fg={themeColor(props.theme, colors.purple[300])}>M</text>
        <text fg={themeColor(props.theme, colors.text.primary)}>
          <strong>Models · Choose model</strong>
        </text>
      </box>
      <box height={1}>
        <input
          width="100%"
          value={props.query}
          onInput={props.onInput}
          onKeyDown={handleKeyDown}
          focused
          backgroundColor={themeColor(props.theme, colors.background.floating)}
          textColor={themeColor(props.theme, colors.text.primary)}
          placeholder="Search models..."
          placeholderColor={themeColor(props.theme, colors.text.muted)}
          cursorColor={themeColor(props.theme, colors.purple[400])}
        />
      </box>
      <scrollbox ref={hideScrollbars} flexGrow={1} viewportCulling>
        <box flexDirection="column" gap={0}>
          <text fg={themeColor(props.theme, colors.text.muted)}>AUTO</text>
          {row(undefined, 0)}
          {local().length > 0 ? (
            <text fg={themeColor(props.theme, colors.text.muted)}>LOCAL</text>
          ) : null}
          {local().map((model, index) => row(model, localStart() + index))}
          {cloud().length > 0 ? (
            <text fg={themeColor(props.theme, colors.text.muted)}>
              FREE CLOUD
            </text>
          ) : null}
          {cloud().map((model, index) => row(model, cloudStart() + index))}
          {filtered().length === 0 ? (
            <text fg={themeColor(props.theme, colors.text.muted)}>
              No matching models
            </text>
          ) : null}
        </box>
      </scrollbox>
      <text fg={themeColor(props.theme, colors.text.muted)}>
        Up/Down select Enter choose Esc close
      </text>
    </box>
  );
}
