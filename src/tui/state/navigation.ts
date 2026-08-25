export type EscapeAction =
  | "close-overlay"
  | "return-conversation"
  | "cancel-task"
  | "clear-draft"
  | "noop";

export interface EscapeContext {
  overlayOpen: boolean;
  screen: string;
  activeTask: boolean;
  draft: string;
}

export function resolveEscapeAction(context: EscapeContext): EscapeAction {
  if (context.overlayOpen) return "close-overlay";
  if (context.screen !== "conversation" && context.screen !== "setup") {
    return "return-conversation";
  }
  if (context.activeTask) return "cancel-task";
  if (context.draft.length > 0) return "clear-draft";
  return "noop";
}
