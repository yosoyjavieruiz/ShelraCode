import type { KeyEvent, TextareaRenderable } from "@opentui/core";
import { createEffect } from "solid-js";
import type { ThemeTokens } from "../theme/tokens.js";
import { themeColor } from "../theme/tokens.js";

type AccessorOrValue<T> = T | (() => T);

function readProp<T>(value: AccessorOrValue<T> | undefined): T | undefined {
  return typeof value === "function" ? (value as () => T)() : value;
}

export function Composer(props: {
  theme: ThemeTokens;
  // Must be the raw signal accessor, not an already-invoked value
  // (`value={composerValue}`, not `value={composerValue()}`). This render
  // pipeline's reactive binding only tracks dependencies when it receives a
  // function to call itself — an invoked value is a frozen snapshot from
  // whenever the parent's render body last ran, and this component would
  // never see later updates (see the createEffect below and its call site).
  value: () => string;
  onInput: (value: string) => void;
  onSubmit?: (value: string) => void;
  onKeyDown?: (event: KeyEvent) => void;
  rows?: number;
  mode?: string;
  route?: string;
  focused?: boolean;
  width?: number;
  busy?: boolean;
  contextCount?: AccessorOrValue<number>;
  onContext?: () => void;
  onReady?: (editor: TextareaRenderable) => void;
}) {
  let editor: TextareaRenderable | undefined;
  // The last value *this component itself* reported up through onInput —
  // i.e. the editor's own buffer already contains it, verbatim, because
  // the user just typed it. Direct user feedback: "escribo el / y después
  // las letras se ponen delante, ejemplo letras/". Root cause: every
  // keystroke round-trips through the parent (onContentChange → onInput →
  // parent's setComposerValue → back down through the `value` prop below),
  // and without this guard the effect below can't tell "the parent is
  // handing back my own last edit" apart from "the parent changed the
  // value externally" (submit clearing the draft, Esc restoring one,
  // /model mode rewriting it). Calling `editor.setText()` for the former
  // case races the editor's own in-flight keystroke handling and resets
  // the cursor to the start of the buffer — the next character then
  // inserts *before* what was just typed instead of after it.
  let lastEchoedValue: string | undefined;
  // Tracks which editor *instance* has already had its cursor positioned,
  // so a fresh mount only gets corrected once. Direct instrumentation
  // (console.error on the `ref` callback and onContentChange, comparing
  // timestamps) found this can NOT be done in `ref` itself: `ref` fires
  // right after construction, but TextareaRenderable applies its
  // `initialValue` *prop* through a separate property setter — evaluated
  // by this render pipeline *after* `ref` runs — which calls `setText()`
  // again internally and silently re-resets the cursor to position 0,
  // undoing anything `ref` already did. `createEffect` below is the first
  // point that's guaranteed to observe the editor *after* that setter has
  // landed (its own first run is scheduled after the synchronous render
  // commit), so cursor correction belongs here instead.
  let cursorPositionedForEditor: TextareaRenderable | undefined;
  const initialValue = props.value();
  let initialSyncPending = true;
  let programmaticValue: string | undefined;
  // TextareaRenderable may report its initialValue synchronously during the
  // first property assignment. If a renderer defers that callback, the
  // microtask boundary still ends the initial-sync window before real input.
  queueMicrotask(() => {
    initialSyncPending = false;
  });
  createEffect(() => {
    // Calling props.value() *inside* the tracked effect is what subscribes
    // to the underlying signal — this is what makes the effect re-run when
    // it changes.
    const next = props.value();
    if (!editor) return;
    if (cursorPositionedForEditor !== editor) {
      cursorPositionedForEditor = editor;
      // A fresh mount with non-empty initial text (this render pipeline's
      // coarser, whole-subtree reactivity can remount Composer mid-flow —
      // see showMainContent's comment in app.tsx for a concrete trigger)
      // otherwise leaves the cursor at position 0, so the very next
      // keystroke inserts *before* existing content instead of after it.
      // Direct user feedback traced to exactly this: "escribo el / y
      // despues las letras se ponen delante ejemplo letras/".
      if (editor.plainText) editor.gotoBufferEnd();
    }
    if (next === lastEchoedValue) return;
    // `initialValue` on TextareaRenderable is write-once (guarded by an
    // internal `_initialValueSet` flag) — it only applies the very first
    // time it's set. Syncing external value changes (submit clearing the
    // draft, Esc restoring a palette draft, etc.) after mount requires the
    // live-buffer API instead.
    if (editor.plainText !== next) {
      programmaticValue = next;
      editor.setText(next);
      // setText's own doc comment: "completely reset the buffer state" —
      // that resets the cursor too (to the start), which is the wrong
      // default for every real caller of this path (a restored draft, a
      // rewritten /model query) — all of them want to keep typing from
      // where the text now ends, not from position 0.
      editor.gotoBufferEnd();
    }
  });
  const reportInput = (value: string): void => {
    lastEchoedValue = value;
    props.onInput(value);
  };
  const colors = props.theme.colors;
  const focused = () => props.focused ?? true;
  const width = () => props.width ?? 120;
  const rows = () => props.rows ?? (width() < 90 ? 2 : 3);
  const contextCount = () => readProp(props.contextCount) ?? 0;
  // Border top + border bottom = 2 fixed rows, plus the footer hint line.
  // Must match getCoreVerticalLayout's `composerHeight` in state/layout.ts —
  // that function reserves space for the transcript viewport based on this
  // same number, so the two can never silently drift out of sync without
  // the composer and the transcript overlapping.
  const totalHeight = () => rows() + 3;
  return (
    <box
      id="core-composer"
      width="100%"
      height={totalHeight()}
      minHeight={totalHeight()}
      flexShrink={0}
      flexDirection="column"
      border
      borderStyle="rounded"
      borderColor={themeColor(
        props.theme,
        focused() ? colors.purple[500] : colors.border.subtle,
      )}
      backgroundColor={themeColor(props.theme, colors.background.surface)}
    >
      <box
        id="core-composer-input-frame"
        width="100%"
        height={rows()}
        flexDirection="row"
      >
        <box
          id="core-composer-prompt-glyph"
          width={2}
          height={rows()}
          backgroundColor={themeColor(
            props.theme,
            focused() ? colors.background.active : colors.background.surface,
          )}
        >
          <text
            fg={themeColor(
              props.theme,
              focused() ? colors.purple[400] : colors.text.muted,
            )}
          >
            {"› "}
          </text>
        </box>
        <textarea
          id="core-composer-input"
          ref={(value) => {
            // Cursor positioning for a non-empty initialValue happens in
            // the createEffect above, not here — see its own comment for
            // why: this callback fires *before* the renderer applies the
            // `initialValue` prop through its own property setter, which
            // silently resets the cursor again after this point.
            editor = value;
            if (value) props.onReady?.(value);
          }}
          flexGrow={1}
          height={rows()}
          initialValue={initialValue}
          onContentChange={(value: unknown) => {
            const reported =
              typeof value === "string" ? value : (editor?.plainText ?? "");
            if (initialSyncPending && reported === initialValue) {
              initialSyncPending = false;
              return;
            }
            initialSyncPending = false;
            if (programmaticValue !== undefined) {
              if (programmaticValue === reported) {
                programmaticValue = undefined;
                return;
              }
              programmaticValue = undefined;
            }
            reportInput(reported);
          }}
          onKeyDown={props.onKeyDown}
          onSubmit={() => {
            const value = editor?.plainText ?? props.value();
            props.onSubmit?.(value);
            // Same write-once caveat as above: `initialValue` would be a
            // no-op here after the first render. `clear()` actually resets
            // the live buffer (text + cursor + undo history).
            if (editor) editor.clear();
          }}
          keyBindings={[
            { name: "return", action: "submit" },
            { name: "return", shift: true, action: "newline" },
          ]}
          placeholder="Ask ShelraCode…"
          focused={focused()}
          backgroundColor={themeColor(props.theme, colors.background.surface)}
          // A real (if subtle) surface shift on focus — previously identical
          // to the idle background, so the border color change was the only
          // felt focus cue at all. Kept quiet: the same violet-tinted
          // surface tone `HomeSuggestionRow` already uses for "selected",
          // not a new color.
          focusedBackgroundColor={themeColor(
            props.theme,
            colors.background.active,
          )}
          textColor={themeColor(props.theme, colors.text.primary)}
          placeholderColor={themeColor(props.theme, colors.text.tertiary)}
          cursorColor={themeColor(props.theme, colors.purple[400])}
          wrapMode="word"
        />
      </box>
      <box height={1} flexDirection="row" paddingX={1}>
        <box
          id="composer-context"
          height={1}
          focusable
          onMouseDown={() => props.onContext?.()}
          onKeyDown={(event: KeyEvent) => {
            if (event.name === "return" || event.name === "enter") {
              event.preventDefault();
              props.onContext?.();
            }
          }}
        >
          <text fg={themeColor(props.theme, colors.text.muted)}>
            {() => `@ context${contextCount() ? ` ${contextCount()}` : ""}`}
          </text>
        </box>
        <text fg={themeColor(props.theme, colors.text.tertiary)}>
          {`   ${props.mode ?? "Auto"}`}
        </text>
        {width() >= 54 ? (
          <text fg={themeColor(props.theme, colors.text.tertiary)}>
            {` · ${(props.route ?? "Local first")
              .replace(/-/g, " ")
              .toLowerCase()}`}
          </text>
        ) : null}
        <box flexGrow={1} />
        <text
          fg={themeColor(
            props.theme,
            props.busy ? colors.text.secondary : colors.text.muted,
          )}
        >
          {props.busy
            ? "Esc interrupt"
            : focused() && width() >= 60
              ? "Shift+Enter newline · Esc clear"
              : width() >= 54
                ? "Enter ↵"
                : "↵"}
        </text>
      </box>
    </box>
  );
}
